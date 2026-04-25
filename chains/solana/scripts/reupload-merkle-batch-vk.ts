/**
 * Close existing MerkleBatchUpdate VK and re-upload fresh from zkey
 */

import * as anchor from "@coral-xyz/anchor";
import { PublicKey, SystemProgram, ComputeBudgetProgram } from "@solana/web3.js";
import * as fs from 'fs';

const PROGRAM_ID = new PublicKey("C9GAJTFVgijNzB4SWZeNKmzruzjzrZ4H6J1DpKha9GoW");
const POOL_CONFIG = new PublicKey("EYjYoV3RpvmYBcUi6LVGaYUzCbEjeHxga7nE7D5GEgaS");

function decimalToBytes32BE(decimal: string): number[] {
  const bn = BigInt(decimal);
  const hex = bn.toString(16).padStart(64, "0");
  const bytes: number[] = [];
  for (let i = 0; i < 64; i += 2) {
    bytes.push(parseInt(hex.substr(i, 2), 16));
  }
  return bytes;
}

function g1ToBytes(point: string[]): number[] {
  return [...decimalToBytes32BE(point[0]), ...decimalToBytes32BE(point[1])];
}

function g2ToBytes(point: string[][]): number[] {
  const x_c0 = decimalToBytes32BE(point[0][0]);
  const x_c1 = decimalToBytes32BE(point[0][1]);
  const y_c0 = decimalToBytes32BE(point[1][0]);
  const y_c1 = decimalToBytes32BE(point[1][1]);
  return [...x_c1, ...x_c0, ...y_c1, ...y_c0];
}

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const idl = JSON.parse(fs.readFileSync("target/idl/white_protocol.json", "utf8"));
  const program = new anchor.Program(idl as any, provider);
  const authority = provider.wallet.publicKey;

  const [vkPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("vk_merkle_batch"), POOL_CONFIG.toBuffer()],
    PROGRAM_ID
  );

  console.log("Authority:", authority.toBase58());
  console.log("VK PDA:", vkPda.toBase58());

  const account = await provider.connection.getAccountInfo(vkPda);
  if (account) {
    console.log("Existing VK found — closing first...");
    try {
      const txClose = await program.methods
        .closeVkV2({ merkleBatchUpdate: {} })
        .accounts({
          authority,
          poolConfig: POOL_CONFIG,
          vkAccount: vkPda,
        })
        .rpc();
      console.log("✅ VK closed:", txClose);
    } catch (e: any) {
      console.error("⚠️ Close failed (may already be closed):", e.message);
    }
  }

  const vkPath = "../../circuits/merkle_batch_update/build/verification_key_fresh.json";
  const vkJson = JSON.parse(fs.readFileSync(vkPath, "utf8"));

  console.log("\nPublic inputs:", vkJson.nPublic);
  console.log("IC points:", vkJson.IC.length);

  const alphaG1 = g1ToBytes(vkJson.vk_alpha_1);
  const betaG2 = g2ToBytes(vkJson.vk_beta_2);
  const gammaG2 = g2ToBytes(vkJson.vk_gamma_2);
  const deltaG2 = g2ToBytes(vkJson.vk_delta_2);
  const icPoints = vkJson.IC.map((ic: string[]) => g1ToBytes(ic));

  console.log("\n🚀 Initializing VK...");
  const tx1 = await (program.methods as any)
    .initializeVkV2({ merkleBatchUpdate: {} }, alphaG1, betaG2, gammaG2, deltaG2, icPoints.length)
    .accounts({
      authority,
      poolConfig: POOL_CONFIG,
      vkAccount: vkPda,
      systemProgram: SystemProgram.programId,
    })
    .preInstructions([ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 })])
    .rpc();
  console.log("✅ VK initialized:", tx1);

  console.log("\n🚀 Uploading IC points...");
  for (let i = 0; i < icPoints.length; i += 4) {
    const chunk = icPoints.slice(i, Math.min(i + 4, icPoints.length));
    const tx2 = await (program.methods as any)
      .appendVkIcV2({ merkleBatchUpdate: {} }, chunk)
      .accounts({
        authority,
        poolConfig: POOL_CONFIG,
        vkAccount: vkPda,
      })
      .preInstructions([ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 })])
      .rpc();
    console.log(`  ✅ IC chunk ${Math.floor(i / 4) + 1}/${Math.ceil(icPoints.length / 4)}:`, tx2.slice(0, 30));
  }

  console.log("\n🚀 Finalizing VK...");
  const tx3 = await (program.methods as any)
    .finalizeVkV2({ merkleBatchUpdate: {} })
    .accounts({
      authority,
      poolConfig: POOL_CONFIG,
      vkAccount: vkPda,
    })
    .rpc();
  console.log("✅ VK finalized:", tx3);

  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("  MerkleBatchUpdate VK Re-upload Complete!");
  console.log("═══════════════════════════════════════════════════════════════");
}

main().catch(console.error);
