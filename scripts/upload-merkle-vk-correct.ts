/**
 * Upload MerkleBatchUpdate VK with correct proof type (3)
 */

import * as anchor from "@coral-xyz/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import * as fs from 'fs';

const PROGRAM_ID = new PublicKey("C9GAJTFVgijNzB4SWZeNKmzruzjzrZ4H6J1DpKha9GoW");
const POOL_CONFIG = new PublicKey("EYjYoV3RpvmYBcUi6LVGaYUzCbEjeHxga7nE7D5GEgaS");

// Convert G1 point to bytes
function g1ToBytes(g1: string[]): number[] {
  const bytes: number[] = [];
  for (let i = 0; i < 2; i++) {
    const val = BigInt(g1[i]);
    const hex = val.toString(16).padStart(64, '0');
    for (let j = 0; j < 64; j += 2) {
      bytes.push(parseInt(hex.substring(j, j + 2), 16));
    }
  }
  return bytes;
}

// Convert G2 point to bytes
function g2ToBytes(g2: string[][]): number[] {
  const bytes: number[] = [];
  for (let coord = 0; coord < 2; coord++) {
    for (let i = 0; i < 2; i++) {
      const val = BigInt(g2[coord][i]);
      const hex = val.toString(16).padStart(64, '0');
      for (let j = 0; j < 64; j += 2) {
        bytes.push(parseInt(hex.substring(j, j + 2), 16));
      }
    }
  }
  return bytes;
}

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  Upload MerkleBatchUpdate VK (Correct Type)");
  console.log("═══════════════════════════════════════════════════════════════\n");
  
  console.log("Authority:", provider.wallet.publicKey.toBase58());
  console.log("Pool Config:", POOL_CONFIG.toBase58());
  
  const idl = JSON.parse(fs.readFileSync('./target/idl/white_protocol.json', 'utf8'));
  const program = new anchor.Program(idl as anchor.Idl, provider);
  
  // Get the merkle_batch VK PDA
  const [vkPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("vk_merkle_batch"), POOL_CONFIG.toBuffer()],
    PROGRAM_ID
  );
  
  console.log("VK PDA:", vkPda.toBase58());
  
  // Check if account exists
  const account = await provider.connection.getAccountInfo(vkPda);
  if (account) {
    console.log("\n⚠️  VK account already exists!");
    console.log("  Lamports:", account.lamports);
    console.log("  Owner:", account.owner.toBase58());
    return;
  }
  
  console.log("\n✓ VK account is available (was closed)");
  
  // Load VK data
  const vk = JSON.parse(fs.readFileSync('./circuits/build/merkle_batch_update/verification_key.json', 'utf8'));
  const alphaG1 = g1ToBytes(vk.vk_alpha_1);
  const betaG2 = g2ToBytes(vk.vk_beta_2);
  const gammaG2 = g2ToBytes(vk.vk_gamma_2);
  const deltaG2 = g2ToBytes(vk.vk_delta_2);
  const icPoints = vk.IC.map((ic: string[]) => g1ToBytes(ic));
  
  console.log("\nVK Data:");
  console.log("  IC Points:", icPoints.length);
  console.log("  Expected for MerkleBatchUpdate: 6");
  
  // Step 1: Initialize VK
  console.log("\n🚀 Step 1: Initializing VK...");
  try {
    await program.methods
      .initVkV2(
        { merkleBatchUpdate: {} },  // Proof type 3
        alphaG1,
        betaG2,
        gammaG2,
        deltaG2,
        icPoints.length
      )
      .accounts({
        authority: provider.wallet.publicKey,
        poolConfig: POOL_CONFIG,
        verificationKey: vkPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    
    console.log("✓ VK initialized");
    
  } catch (e: any) {
    console.error("❌ Failed to initialize VK:", e.message);
    if (e.logs) {
      console.log("Logs:", e.logs.slice(-5));
    }
    return;
  }
  
  // Step 2: Upload IC points
  console.log("\n🚀 Step 2: Uploading IC points...");
  for (let i = 0; i < icPoints.length; i++) {
    try {
      await program.methods
        .appendVkIcV2(i, icPoints[i])
        .accounts({
          authority: provider.wallet.publicKey,
          poolConfig: POOL_CONFIG,
          verificationKey: vkPda,
        })
        .rpc();
      console.log(`  IC point ${i + 1}/${icPoints.length} uploaded`);
    } catch (e: any) {
      console.error(`❌ Failed to upload IC point ${i}:`, e.message);
      return;
    }
  }
  
  // Step 3: Finalize VK
  console.log("\n🚀 Step 3: Finalizing VK...");
  try {
    await program.methods
      .finalizeVkV2()
      .accounts({
        authority: provider.wallet.publicKey,
        poolConfig: POOL_CONFIG,
        verificationKey: vkPda,
      })
      .rpc();
    
    console.log("✓ VK finalized");
    
  } catch (e: any) {
    console.error("❌ Failed to finalize VK:", e.message);
    if (e.logs) {
      console.log("Logs:", e.logs.slice(-5));
    }
    return;
  }
  
  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("  ✅ MerkleBatchUpdate VK uploaded successfully!");
  console.log("═══════════════════════════════════════════════════════════════");
  
  // Verify
  const after = await provider.connection.getAccountInfo(vkPda);
  if (after) {
    console.log("\nAccount info:");
    console.log("  Size:", after.data.length);
    console.log("  Lamports:", after.lamports);
    
    // Decode proof type
    const proofType = after.data[40];
    const proofTypes = ['Deposit', 'Withdraw', 'JoinSplit', 'MerkleBatchUpdate', 'Membership'];
    console.log("  Proof Type:", proofType, `(${proofTypes[proofType] || 'Unknown'})`);
  }
}

main().catch(console.error);
