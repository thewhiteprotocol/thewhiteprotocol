/**
 * Provision Verification Keys for The White Protocol v2
 * 
 * Uses chunked upload for large VKs (Withdraw, JoinSplit)
 */

import * as anchor from "@coral-xyz/anchor";
import { PublicKey, SystemProgram, ComputeBudgetProgram } from "@solana/web3.js";
import { readFileSync, existsSync } from "fs";
import * as snarkjs from "snarkjs";

const PROGRAM_ID = new PublicKey("BmtMrkgvVML9Gk7Bt6JRqweHAwW69oFTohaBRaLbgqpb");

enum ProofType {
  Deposit = 0,
  Withdraw = 1,
  JoinSplit = 2,
  Membership = 3,
}

const ZKEY_PATHS: Record<ProofType, string> = {
  [ProofType.Deposit]: "circuits/build/deposit.zkey",
  [ProofType.Withdraw]: "circuits/build/withdraw.zkey",
  [ProofType.JoinSplit]: "circuits/build/joinsplit.zkey",
  [ProofType.Membership]: "circuits/build/membership.zkey",
};

const VK_SEEDS: Record<ProofType, string> = {
  [ProofType.Deposit]: "vk_deposit",
  [ProofType.Withdraw]: "vk_withdraw",
  [ProofType.JoinSplit]: "vk_joinsplit",
  [ProofType.Membership]: "vk_membership",
};

function proofTypeToAnchor(proofType: ProofType): any {
  switch (proofType) {
    case ProofType.Deposit: return { deposit: {} };
    case ProofType.Withdraw: return { withdraw: {} };
    case ProofType.JoinSplit: return { joinSplit: {} };
    case ProofType.Membership: return { membership: {} };
  }
}

function g1ToBytes(point: any): number[] {
  const x = Array.isArray(point) ? BigInt(point[0]) : BigInt(point.x);
  const y = Array.isArray(point) ? BigInt(point[1]) : BigInt(point.y);
  return [...bigIntToBytes32(x), ...bigIntToBytes32(y)];
}

function g2ToBytes(point: any): number[] {
  let x0: bigint, x1: bigint, y0: bigint, y1: bigint;
  if (Array.isArray(point)) {
    x0 = BigInt(point[0][0]); x1 = BigInt(point[0][1]);
    y0 = BigInt(point[1][0]); y1 = BigInt(point[1][1]);
  } else {
    x0 = BigInt(point.x[0]); x1 = BigInt(point.x[1]);
    y0 = BigInt(point.y[0]); y1 = BigInt(point.y[1]);
  }
  return [...bigIntToBytes32(x1), ...bigIntToBytes32(x0), ...bigIntToBytes32(y1), ...bigIntToBytes32(y0)];
}

function bigIntToBytes32(value: bigint): number[] {
  const hex = value.toString(16).padStart(64, "0");
  const bytes: number[] = [];
  for (let i = 0; i < 32; i++) {
    bytes.push(parseInt(hex.substr(i * 2, 2), 16));
  }
  return bytes;
}

async function extractVK(zkeyPath: string): Promise<any> {
  if (!existsSync(zkeyPath)) throw new Error(`zkey not found: ${zkeyPath}`);
  return await snarkjs.zKey.exportVerificationKey(zkeyPath);
}

function deriveVkAccount(proofType: ProofType, poolConfig: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(VK_SEEDS[proofType]), poolConfig.toBuffer()],
    PROGRAM_ID
  );
}

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  const shouldLock = process.argv.includes("--lock");
  let proofTypes = [ProofType.Deposit, ProofType.Withdraw, ProofType.JoinSplit, ProofType.Membership];
  
  const proofTypesArg = process.argv.find(a => a.startsWith("--types="));
  if (proofTypesArg) {
    const types = proofTypesArg.split("=")[1].split(",");
    proofTypes = types.map(t => ProofType[t as keyof typeof ProofType]);
  }
  
  const connection = new anchor.web3.Connection(
    process.env.ANCHOR_PROVIDER_URL || "https://api.devnet.solana.com",
    "confirmed"
  );
  const wallet = anchor.Wallet.local();
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed" });
  anchor.setProvider(provider);

  const idl = JSON.parse(readFileSync("target/idl/white_protocol.json", "utf8"));
  const program = new anchor.Program(idl, provider);
  const authority = wallet.publicKey;

  const [poolConfig] = PublicKey.findProgramAddressSync(
    [Buffer.from("pool_v2"), authority.toBuffer()],
    PROGRAM_ID
  );

  console.log("=== The White Protocol v2 VK Provisioning ===");
  console.log("Authority:", authority.toString());
  console.log("Pool Config:", poolConfig.toString());
  console.log("Proof Types:", proofTypes.map(t => ProofType[t]).join(", "));
  console.log("Will Lock:", shouldLock);

  for (const proofType of proofTypes) {
    const typeName = ProofType[proofType];
    const zkeyPath = ZKEY_PATHS[proofType];
    
    console.log(`\n--- ${typeName} ---`);
    
    if (!existsSync(zkeyPath)) {
      console.log(`⚠ Skipping ${typeName}: ${zkeyPath} not found`);
      continue;
    }

    try {
      console.log(`Extracting VK from ${zkeyPath}...`);
      const vk = await extractVK(zkeyPath);
      
      const vkAlphaG1 = g1ToBytes(vk.vk_alpha_1);
      const vkBetaG2 = g2ToBytes(vk.vk_beta_2);
      const vkGammaG2 = g2ToBytes(vk.vk_gamma_2);
      const vkDeltaG2 = g2ToBytes(vk.vk_delta_2);
      const vkIc = (vk.IC as any[]).map((ic: any) => g1ToBytes(ic));
      
      const totalSize = 64 + 128 + 128 + 128 + (vkIc.length * 64);
      console.log(`  IC points: ${vkIc.length}, VK size: ${totalSize} bytes`);
      
      const [vkAccount] = deriveVkAccount(proofType, poolConfig);
      console.log(`  VK Account: ${vkAccount.toString()}`);
      
      const anchorProofType = proofTypeToAnchor(proofType);
      
      // Use chunked upload for large VKs (> 5 IC points)
      const useChunked = vkIc.length > 5;
      
      if (useChunked) {
        console.log(`  Using chunked upload (${vkIc.length} IC points)...`);
        
        // Step 1: Initialize VK
        console.log(`  Step 1: Initialize VK...`);
        const initTx = await (program.methods as any)
          .initializeVkV2(
            anchorProofType,
            vkAlphaG1,
            vkBetaG2,
            vkGammaG2,
            vkDeltaG2,
            vkIc.length
          )
          .accounts({
            authority,
            poolConfig,
            vkAccount,
            systemProgram: SystemProgram.programId,
          })
          .preInstructions([
            ComputeBudgetProgram.setComputeUnitLimit({ units: 300_000 }),
          ])
          .rpc();
        console.log(`    ✓ Init tx: ${initTx}`);
        await sleep(500);
        
        // Step 2: Append IC points in chunks of 3
        const chunkSize = 3;
        for (let i = 0; i < vkIc.length; i += chunkSize) {
          const chunk = vkIc.slice(i, Math.min(i + chunkSize, vkIc.length));
          console.log(`  Step 2: Append IC points ${i + 1}-${i + chunk.length}...`);
          
          const appendTx = await (program.methods as any)
            .appendVkIcV2(anchorProofType, chunk)
            .accounts({
              authority,
              poolConfig,
              vkAccount,
            })
            .rpc();
          console.log(`    ✓ Append tx: ${appendTx}`);
          await sleep(500);
        }
        
        // Step 3: Finalize VK
        console.log(`  Step 3: Finalize VK...`);
        const finalizeTx = await (program.methods as any)
          .finalizeVkV2(anchorProofType)
          .accounts({
            authority,
            poolConfig,
            vkAccount,
          })
          .rpc();
        console.log(`    ✓ Finalize tx: ${finalizeTx}`);
        
      } else {
        // Use single transaction for small VKs
        console.log(`  Setting VK (single tx)...`);
        const setTx = await (program.methods as any)
          .setVerificationKeyV2(
            anchorProofType,
            vkAlphaG1,
            vkBetaG2,
            vkGammaG2,
            vkDeltaG2,
            vkIc
          )
          .accounts({
            authority,
            poolConfig,
            vkAccount,
            systemProgram: SystemProgram.programId,
          })
          .preInstructions([
            ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
          ])
          .rpc();
        console.log(`  ✓ Set VK tx: ${setTx}`);
      }
      
      // Optionally lock
      if (shouldLock) {
        console.log(`  Locking VK...`);
        await sleep(500);
        const lockTx = await (program.methods as any)
          .lockVerificationKeyV2(anchorProofType)
          .accounts({ authority, poolConfig, vkAccount })
          .rpc();
        console.log(`  ✓ Locked VK tx: ${lockTx}`);
      }
      
    } catch (e: any) {
      console.error(`  ✗ Error: ${e.message?.slice(0, 400) || e}`);
      if (e.logs) console.error(`  Logs:`, e.logs.slice(-5).join('\n    '));
    }
  }

  console.log("\n=== Provisioning Complete ===");
  if (!shouldLock) {
    console.log("Note: VKs are NOT locked. Run with --lock to lock them.");
  }
}

main().catch(console.error);
