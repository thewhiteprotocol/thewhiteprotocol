/**
 * Close the wrong VK and reupload with correct proof type
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
  console.log("  Close Wrong VK and Reupload with Correct Type");
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
  
  // Check current VK
  const account = await provider.connection.getAccountInfo(vkPda);
  if (account) {
    console.log("\nCurrent VK account:");
    console.log("  Lamports:", account.lamports);
    console.log("  Data size:", account.data.length);
    
    // Decode proof type from account data
    // Skip 8 bytes discriminator + 32 bytes pool = 40 bytes
    const proofType = account.data[40];
    console.log("  Stored proof type:", proofType);
    
    const proofTypes = ['Deposit', 'Withdraw', 'JoinSplit', 'MerkleBatchUpdate', 'Membership'];
    console.log("  Which is:", proofTypes[proofType] || 'Unknown');
    
    if (proofType !== 3) {
      console.log("\n⚠️  Wrong proof type! Need to close and reupload.");
      
      // Step 1: Close the VK account
      console.log("\n🚀 Step 1: Closing VK account...");
      try {
        // The program was updated, so we need to use the new instruction
        // But first, let's check if the IDL has the close_vk_v2 instruction
        const hasCloseInstruction = idl.instructions.some((ix: any) => ix.name === 'close_vk_v2');
        
        if (!hasCloseInstruction) {
          console.log("❌ IDL doesn't have close_vk_v2 instruction yet.");
          console.log("   The program was deployed but we need to manually construct the transaction.");
          
          // For now, let's try using the existing finalize_vk_v2 instruction 
          // with a special flag or use admin functions
          console.log("\nTrying alternative approach...");
          
          // Actually, let's just try to call initialize_vk_v2 which uses init_if_needed
          // If the account exists but is locked, it will fail
          // But we can try to overwrite it if it's not locked at pool level
          
          console.log("\n🚀 Step 1b: Trying to overwrite VK (init_if_needed)...");
          
          // Load VK data
          const vk = JSON.parse(fs.readFileSync('./circuits/build/merkle_batch_update/verification_key.json', 'utf8'));
          const alphaG1 = g1ToBytes(vk.vk_alpha_1);
          const betaG2 = g2ToBytes(vk.vk_beta_2);
          const gammaG2 = g2ToBytes(vk.vk_gamma_2);
          const deltaG2 = g2ToBytes(vk.vk_delta_2);
          const icPoints = vk.IC.map((ic: string[]) => g1ToBytes(ic));
          
          try {
            await program.methods
              .initVkV2(
                { merkleBatchUpdate: {} },  // Correct proof type
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
            
            console.log("✓ VK initialized (or init_if_needed worked)");
            
            // Continue with IC upload...
            for (let i = 0; i < icPoints.length; i++) {
              await program.methods
                .appendVkIcV2(i, icPoints[i])
                .accounts({
                  authority: provider.wallet.publicKey,
                  poolConfig: POOL_CONFIG,
                  verificationKey: vkPda,
                })
                .rpc();
              console.log(`  IC point ${i + 1}/${icPoints.length} uploaded`);
            }
            
            // Finalize
            await program.methods
              .finalizeVkV2()
              .accounts({
                authority: provider.wallet.publicKey,
                poolConfig: POOL_CONFIG,
                verificationKey: vkPda,
              })
              .rpc();
            
            console.log("✅ VK reuploaded with correct type!");
            
          } catch (e: any) {
            console.error("❌ Failed:", e.message);
            if (e.logs) {
              console.log("Logs:", e.logs.slice(-5));
            }
          }
          
          return;
        }
        
        // Use close_vk_v2 if available
        await program.methods
          .closeVkV2({ membership: {} })  // Close the wrong VK type
          .accounts({
            authority: provider.wallet.publicKey,
            poolConfig: POOL_CONFIG,
            vkAccount: vkPda,
          })
          .rpc();
        
        console.log("✓ VK account closed");
        
      } catch (e: any) {
        console.error("❌ Failed to close VK:", e.message);
        console.log("Continuing anyway...");
      }
    }
  }
}

main().catch(console.error);
