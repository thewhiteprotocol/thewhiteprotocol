/**
 * Fix MerkleBatchUpdate VK - close if exists with wrong type, then upload correctly
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

// Convert G2 point to bytes - using CORRECT SDK-compatible order
// Order: x_c1, x_c0, y_c1, y_c0 which maps to [0][1], [0][0], [1][1], [1][0]
function g2ToBytes(point: string[][]): number[] {
  const x_c0 = BigInt(point[0][0]).toString(16).padStart(64, '0');
  const x_c1 = BigInt(point[0][1]).toString(16).padStart(64, '0');
  const y_c0 = BigInt(point[1][0]).toString(16).padStart(64, '0');
  const y_c1 = BigInt(point[1][1]).toString(16).padStart(64, '0');
  
  const result: number[] = [];
  // x_c1 (32 bytes) = [0][1]
  for (let i = 0; i < 64; i += 2) result.push(parseInt(x_c1.substring(i, i + 2), 16));
  // x_c0 (32 bytes) = [0][0]
  for (let i = 0; i < 64; i += 2) result.push(parseInt(x_c0.substring(i, i + 2), 16));
  // y_c1 (32 bytes) = [1][1]
  for (let i = 0; i < 64; i += 2) result.push(parseInt(y_c1.substring(i, i + 2), 16));
  // y_c0 (32 bytes) = [1][0]
  for (let i = 0; i < 64; i += 2) result.push(parseInt(y_c0.substring(i, i + 2), 16));
  
  return result;
}

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  Fix MerkleBatchUpdate VK");
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
  
  console.log("\nVK PDA:", vkPda.toBase58());
  
  // Check if account exists
  const account = await provider.connection.getAccountInfo(vkPda);
  if (account) {
    console.log("\n⚠️  VK account already exists");
    console.log("  Data length:", account.data.length);
    console.log("  Proof type:", account.data[40]);
    
    // Check if it's the wrong type (4 = Membership instead of 3 = MerkleBatchUpdate)
    if (account.data[40] !== 3) {
      console.log("\n❌ Wrong proof type! Expected 3 (MerkleBatchUpdate), got", account.data[40]);
      console.log("   Closing VK account to re-upload...");
      
      try {
        await (program.methods as any)
          .closeVkV2({ merkleBatchUpdate: {} })
          .accounts({
            authority: provider.wallet.publicKey,
            poolConfig: POOL_CONFIG,
            vkAccount: vkPda,
          })
          .rpc();
        console.log("✓ VK account closed");
      } catch (e: any) {
        console.error("❌ Failed to close VK:", e.message);
        // Continue anyway - might be a different issue
      }
    }
  } else {
    console.log("\n✓ VK account does not exist, will create");
  }
  
  // Wait a bit for account closure to settle
  await new Promise(r => setTimeout(r, 2000));
  
  // Check again
  const accountAfter = await provider.connection.getAccountInfo(vkPda);
  if (accountAfter) {
    console.log("\n⚠️  VK account still exists after close attempt");
    console.log("  You may need to close it manually or wait for the transaction to confirm");
    return;
  }
  
  // Load VK data
  console.log("\nLoading VK from circuits/build/merkle_batch_update/verification_key.json");
  const vk = JSON.parse(fs.readFileSync('./circuits/build/merkle_batch_update/verification_key.json', 'utf8'));
  
  const alphaG1 = g1ToBytes(vk.vk_alpha_1);
  const betaG2 = g2ToBytes(vk.vk_beta_2);
  const gammaG2 = g2ToBytes(vk.vk_gamma_2);
  const deltaG2 = g2ToBytes(vk.vk_delta_2);
  const icPoints = vk.IC.map((ic: string[]) => g1ToBytes(ic));
  
  console.log("VK Data:");
  console.log("  IC Points:", icPoints.length);
  console.log("  Expected for MerkleBatchUpdate: 6");
  
  // Step 1: Initialize VK
  console.log("\n🚀 Step 1: Initializing VK with proof type MerkleBatchUpdate...");
  try {
    await (program.methods as any)
      .initializeVkV2(
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
        vkAccount: vkPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    
    console.log("✓ VK initialized");
  } catch (e: any) {
    console.error("❌ Failed to initialize VK:", e.message);
    if (e.logs) console.log("Logs:", e.logs.slice(-5));
    return;
  }
  
  // Step 2: Upload IC points (all at once)
  console.log("\n🚀 Step 2: Uploading IC points...");
  try {
    await (program.methods as any)
      .appendVkIcV2({ merkleBatchUpdate: {} }, icPoints)
      .accounts({
        authority: provider.wallet.publicKey,
        poolConfig: POOL_CONFIG,
        vkAccount: vkPda,
      })
      .rpc();
    console.log(`  All ${icPoints.length} IC points uploaded`);
  } catch (e: any) {
    console.error(`❌ Failed to upload IC points:`, e.message);
    if (e.logs) console.log("Logs:", e.logs.slice(-5));
    return;
  }
  
  // Step 3: Finalize VK
  console.log("\n🚀 Step 3: Finalizing VK...");
  try {
    await (program.methods as any)
      .finalizeVkV2({ merkleBatchUpdate: {} })
      .accounts({
        authority: provider.wallet.publicKey,
        poolConfig: POOL_CONFIG,
        vkAccount: vkPda,
      })
      .rpc();
    
    console.log("✓ VK finalized");
  } catch (e: any) {
    console.error("❌ Failed to finalize VK:", e.message);
    if (e.logs) console.log("Logs:", e.logs.slice(-5));
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
    console.log("  Proof Type:", after.data[40], "(3 = MerkleBatchUpdate)");
  }
}

main().catch(console.error);
