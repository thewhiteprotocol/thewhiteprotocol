/**
 * Manually upload MerkleBatchUpdate VK
 */

import * as anchor from "@coral-xyz/anchor";
import { PublicKey, SystemProgram, Transaction, TransactionInstruction } from "@solana/web3.js";
import * as fs from 'fs';

const PROGRAM_ID = new PublicKey("C9GAJTFVgijNzB4SWZeNKmzruzjzrZ4H6J1DpKha9GoW");
const POOL_CONFIG = new PublicKey("EYjYoV3RpvmYBcUi6LVGaYUzCbEjeHxga7nE7D5GEgaS");

// Discriminators
const INIT_VK_DISCRIMINATOR = Buffer.from([0xc1, 0xeb, 0xe3, 0xe7, 0x33, 0xf0, 0xae, 0x90]);
const APPEND_VK_DISCRIMINATOR = Buffer.from([0xf4, 0xb7, 0xa8, 0x09, 0x91, 0x3e, 0x39, 0x63]);
const FINALIZE_VK_DISCRIMINATOR = Buffer.from([0xb3, 0xa8, 0x36, 0xff, 0x77, 0x87, 0xc9, 0xea]);

// Proof type enum
// Deposit = 0, Withdraw = 1, JoinSplit = 2, Membership = 3, MerkleBatchUpdate = 4
const PROOF_TYPE_MERKLE_BATCH_UPDATE = 4;

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
  console.log("  Manually Upload MerkleBatchUpdate VK");
  console.log("═══════════════════════════════════════════════════════════════\n");
  
  console.log("Authority:", provider.wallet.publicKey.toBase58());
  
  const [vkPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("vk_merkle_batch"), POOL_CONFIG.toBuffer()],
    PROGRAM_ID
  );
  
  console.log("VK PDA:", vkPda.toBase58());
  
  // Load VK data
  const vk = JSON.parse(fs.readFileSync('./circuits/build/merkle_batch_update/verification_key.json', 'utf8'));
  const alphaG1 = g1ToBytes(vk.vk_alpha_1);
  const betaG2 = g2ToBytes(vk.vk_beta_2);
  const gammaG2 = g2ToBytes(vk.vk_gamma_2);
  const deltaG2 = g2ToBytes(vk.vk_delta_2);
  const icPoints = vk.IC.map((ic: string[]) => g1ToBytes(ic));
  
  console.log("\nVK Data:");
  console.log("  IC Points:", icPoints.length);
  
  // Step 1: Initialize VK
  console.log("\n🚀 Step 1: Initializing VK...");
  
  // Build data: discriminator + proof_type (u8) + alpha_g1 (64 bytes) + beta_g2 (128) + gamma_g2 (128) + delta_g2 (128) + expected_ic (u8)
  const initData = Buffer.concat([
    INIT_VK_DISCRIMINATOR,
    Buffer.from([PROOF_TYPE_MERKLE_BATCH_UPDATE]), // proof_type
    Buffer.from(alphaG1), // 64 bytes
    Buffer.from(betaG2), // 128 bytes
    Buffer.from(gammaG2), // 128 bytes
    Buffer.from(deltaG2), // 128 bytes
    Buffer.from([icPoints.length]), // expected_ic_count
  ]);
  
  const initIx = new TransactionInstruction({
    keys: [
      { pubkey: provider.wallet.publicKey, isSigner: true, isWritable: true },
      { pubkey: POOL_CONFIG, isSigner: false, isWritable: true },
      { pubkey: vkPda, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId: PROGRAM_ID,
    data: initData,
  });
  
  try {
    const tx = new Transaction().add(initIx);
    const sig = await provider.sendAndConfirm(tx);
    console.log("✓ VK initialized");
    console.log("  Signature:", sig);
  } catch (e: any) {
    console.error("❌ Failed:", e.message);
    if (e.logs) {
      console.log("Logs:", e.logs.slice(-5));
    }
    return;
  }
  
  // Step 2: Upload IC points (one by one for simplicity)
  console.log("\n🚀 Step 2: Uploading IC points...");
  for (let i = 0; i < icPoints.length; i++) {
    // Build data: discriminator + proof_type (u8) + vec_len (u32 LE) + ic_point (64 bytes)
    const vecLen = Buffer.alloc(4);
    vecLen.writeUInt32LE(1, 0); // 1 element in the vec
    
    const appendData = Buffer.concat([
      APPEND_VK_DISCRIMINATOR,
      Buffer.from([PROOF_TYPE_MERKLE_BATCH_UPDATE]), // proof_type
      vecLen, // vec length (4 bytes)
      Buffer.from(icPoints[i]), // 64 bytes
    ]);
    
    const appendIx = new TransactionInstruction({
      keys: [
        { pubkey: provider.wallet.publicKey, isSigner: true, isWritable: false },
        { pubkey: POOL_CONFIG, isSigner: false, isWritable: false },
        { pubkey: vkPda, isSigner: false, isWritable: true },
      ],
      programId: PROGRAM_ID,
      data: appendData,
    });
    
    try {
      const tx = new Transaction().add(appendIx);
      await provider.sendAndConfirm(tx);
      console.log(`  IC point ${i + 1}/${icPoints.length} uploaded`);
    } catch (e: any) {
      console.error(`❌ Failed at IC point ${i}:`, e.message);
      return;
    }
  }
  
  // Step 3: Finalize VK
  console.log("\n🚀 Step 3: Finalizing VK...");
  
  const finalizeData = Buffer.concat([
    FINALIZE_VK_DISCRIMINATOR,
    Buffer.from([PROOF_TYPE_MERKLE_BATCH_UPDATE]), // proof_type
  ]);
  
  const finalizeIx = new TransactionInstruction({
    keys: [
      { pubkey: provider.wallet.publicKey, isSigner: true, isWritable: false },
      { pubkey: POOL_CONFIG, isSigner: false, isWritable: true },
      { pubkey: vkPda, isSigner: false, isWritable: true },
    ],
    programId: PROGRAM_ID,
    data: finalizeData,
  });
  
  try {
    const tx = new Transaction().add(finalizeIx);
    const sig = await provider.sendAndConfirm(tx);
    console.log("✓ VK finalized");
    console.log("  Signature:", sig);
  } catch (e: any) {
    console.error("❌ Failed:", e.message);
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
    const proofType = after.data[40];
    const proofTypes = ['Deposit', 'Withdraw', 'JoinSplit', 'MerkleBatchUpdate', 'Membership'];
    console.log("  Proof Type:", proofType, `(${proofTypes[proofType] || 'Unknown'})`);
  }
}

main().catch(console.error);
