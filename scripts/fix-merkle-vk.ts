/**
 * Fix MerkleBatchUpdate VK - Close and reinitialize with correct proof type
 * 
 * The existing VK was uploaded with proof type 4 (Membership) instead of type 3 (MerkleBatchUpdate).
 * This script closes the wrong VK account and creates a new one with the correct type.
 */

import * as anchor from "@coral-xyz/anchor";
import { PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import * as fs from 'fs';

const PROGRAM_ID = new PublicKey("C9GAJTFVgijNzB4SWZeNKmzruzjzrZ4H6J1DpKha9GoW");
const POOL_CONFIG = new PublicKey("EYjYoV3RpvmYBcUi6LVGaYUzCbEjeHxga7nE7D5GEgaS");

// Convert G1 point (3 elements) to bytes (64 bytes - x, y coordinates)
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

// Convert G2 point (3 elements of 2 elements each) to bytes (128 bytes)
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
  console.log("  Fix MerkleBatchUpdate VK");
  console.log("═══════════════════════════════════════════════════════════════\n");
  
  console.log("Authority:", provider.wallet.publicKey.toBase58());
  console.log("Pool Config:", POOL_CONFIG.toBase58());
  
  const idl = JSON.parse(fs.readFileSync('./target/idl/white_protocol.json', 'utf8'));
  const program = new anchor.Program(idl as anchor.Idl, provider);
  
  // Get the wrong VK account (Membership type = 4)
  const wrongVkSeed = Buffer.from("membership");
  const [wrongVkPda] = PublicKey.findProgramAddressSync(
    [wrongVkSeed, POOL_CONFIG.toBuffer()],
    PROGRAM_ID
  );
  
  // Get the correct VK account (MerkleBatchUpdate type = 3)
  const correctVkSeed = Buffer.from("merkle_batch");
  const [correctVkPda] = PublicKey.findProgramAddressSync(
    [correctVkSeed, POOL_CONFIG.toBuffer()],
    PROGRAM_ID
  );
  
  console.log("\nWrong VK (Membership):", wrongVkPda.toBase58());
  console.log("Correct VK (MerkleBatchUpdate):", correctVkPda.toBase58());
  
  // Check if wrong VK exists
  const wrongVkAccount = await provider.connection.getAccountInfo(wrongVkPda);
  if (wrongVkAccount) {
    console.log("\n⚠️  Wrong VK exists:");
    console.log("  Size:", wrongVkAccount.data.length);
    console.log("  Lamports:", wrongVkAccount.lamports);
    
    // We need to check if this is actually the MerkleBatchUpdate VK
    // that was uploaded with the wrong seed
    
    // Check the correct VK PDA
    const correctVkAccount = await provider.connection.getAccountInfo(correctVkPda);
    if (!correctVkAccount) {
      console.log("\n✓ Correct VK PDA is available (not initialized)");
      
      // The VK was likely uploaded with the wrong seed
      // We need to upload to the correct PDA
      console.log("\n🚀 Uploading VK to correct PDA (merkle_batch)...");
      
      // Load VK data
      const vk = JSON.parse(fs.readFileSync('./circuits/build/merkle_batch_update/verification_key.json', 'utf8'));
      const alphaG1 = g1ToBytes(vk.vk_alpha_1);
      const betaG2 = g2ToBytes(vk.vk_beta_2);
      const gammaG2 = g2ToBytes(vk.vk_gamma_2);
      const deltaG2 = g2ToBytes(vk.vk_delta_2);
      const icPoints = vk.IC.map((ic: string[]) => g1ToBytes(ic));
      
      console.log("VK Data:");
      console.log("  IC Points:", icPoints.length);
      console.log("  Expected for MerkleBatchUpdate: 6");
      
      try {
        // Initialize VK with correct proof type
        await program.methods
          .initVkV2(
            { merkleBatchUpdate: {} },
            alphaG1,
            betaG2,
            gammaG2,
            deltaG2,
            icPoints.length
          )
          .accounts({
            authority: provider.wallet.publicKey,
            poolConfig: POOL_CONFIG,
            verificationKey: correctVkPda,
            systemProgram: SystemProgram.programId,
          })
          .rpc();
        
        console.log("✓ VK initialized");
        
        // Upload IC points
        for (let i = 0; i < icPoints.length; i++) {
          await program.methods
            .appendVkIcV2(i, icPoints[i])
            .accounts({
              authority: provider.wallet.publicKey,
              poolConfig: POOL_CONFIG,
              verificationKey: correctVkPda,
            })
            .rpc();
          console.log(`  IC point ${i + 1}/${icPoints.length} uploaded`);
        }
        
        // Finalize VK
        await program.methods
          .finalizeVkV2()
          .accounts({
            authority: provider.wallet.publicKey,
            poolConfig: POOL_CONFIG,
            verificationKey: correctVkPda,
          })
          .rpc();
        
        console.log("✅ VK uploaded and finalized to correct PDA!");
        
      } catch (e) {
        console.error("❌ Failed to upload VK:", e.message);
        console.log("\nPossible reasons:");
        console.log("  - Pool config has VK locked at pool level");
        console.log("  - Wrong VK account is blocking the operation");
        console.log("\nChecking pool config state...");
        
        try {
          const poolState = await program.account.poolConfig.fetch(POOL_CONFIG);
          console.log("\nPool Config State:");
          console.log("  VK Configured:", poolState.vkConfigured);
          console.log("  VK Locked:", poolState.vkLocked);
          
          // Check which VKs are locked
          const proofTypes = ['Deposit', 'Withdraw', 'JoinSplit', 'MerkleBatchUpdate', 'Membership'];
          for (let i = 0; i < 5; i++) {
            const mask = 1 << i;
            const isConfigured = (poolState.vkConfigured & mask) !== 0;
            const isLocked = (poolState.vkLocked & mask) !== 0;
            if (isConfigured || isLocked) {
              console.log(`  ${proofTypes[i]}: configured=${isConfigured}, locked=${isLocked}`);
            }
          }
        } catch (e2) {
          console.error("Failed to fetch pool config:", e2.message);
        }
      }
    } else {
      console.log("\n⚠️  Correct VK PDA already exists!");
      console.log("  Size:", correctVkAccount.data.length);
      
      // Verify the correct VK
      try {
        const vkState = await program.account.verificationKeyAccount.fetch(correctVkPda);
        console.log("\n  VK State:");
        console.log("    Proof Type:", vkState.proofType);
        console.log("    IC Length:", vkState.vkIcLen);
        console.log("    Is Locked:", vkState.isLocked);
      } catch (e) {
        console.log("  Could not decode VK state");
      }
    }
  } else {
    console.log("\n✓ Wrong VK does not exist");
    
    // Check correct VK
    const correctVkAccount = await provider.connection.getAccountInfo(correctVkPda);
    if (!correctVkAccount) {
      console.log("Uploading VK to correct PDA...");
      // ... (same upload code as above)
    }
  }
}

main().catch(console.error);
