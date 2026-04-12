/**
 * Initialize a new pool with fresh VKs
 */
import * as anchor from "@coral-xyz/anchor";
import { PublicKey, SystemProgram, Keypair } from "@solana/web3.js";
import * as fs from 'fs';
import * as path from 'path';

const PROGRAM_ID = new PublicKey("C9GAJTFVgijNzB4SWZeNKmzruzjzrZ4H6J1DpKha9GoW");

// Convert G1 point (3 elements) to bytes (64 bytes - x, y coordinates)
function g1ToBytes(g1: string[]): number[] {
  const bytes: number[] = [];
  // Take first 2 elements (x, y) and convert to 32 bytes each
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
  // G2 has 2 coordinates, each with 2 field elements (c0, c1)
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
  console.log("  Initialize New Pool with MerkleBatchUpdate VK");
  console.log("═══════════════════════════════════════════════════════════════\n");
  
  console.log("Authority:", provider.wallet.publicKey.toBase58());
  
  const idl = JSON.parse(fs.readFileSync('./target/idl/white_protocol.json', 'utf8'));
  const program = new anchor.Program(idl as anchor.Idl, provider);
  
  // Create a new unique pool config with a random seed
  const uniqueSeed = Keypair.generate().publicKey.toBuffer().slice(0, 8);
  
  // Find pool config PDA
  const [poolConfig] = PublicKey.findProgramAddressSync(
    [Buffer.from("pool_v2"), provider.wallet.publicKey.toBuffer(), uniqueSeed],
    PROGRAM_ID
  );
  
  console.log("New Pool Config:", poolConfig.toBase58());
  console.log("Unique Seed:", uniqueSeed.toString('hex'));
  
  // Derive other PDAs
  const [merkleTree] = PublicKey.findProgramAddressSync(
    [Buffer.from("merkle_tree"), poolConfig.toBuffer()],
    PROGRAM_ID
  );
  
  const [pendingBuffer] = PublicKey.findProgramAddressSync(
    [Buffer.from("pending"), poolConfig.toBuffer()],
    PROGRAM_ID
  );
  
  const [relayerRegistry] = PublicKey.findProgramAddressSync(
    [Buffer.from("relayer_registry"), poolConfig.toBuffer()],
    PROGRAM_ID
  );
  
  const [complianceConfig] = PublicKey.findProgramAddressSync(
    [Buffer.from("compliance_config"), poolConfig.toBuffer()],
    PROGRAM_ID
  );
  
  console.log("Merkle Tree:", merkleTree.toBase58());
  console.log("Pending Buffer:", pendingBuffer.toBase58());
  
  // Check if pool already exists
  const existing = await provider.connection.getAccountInfo(poolConfig);
  if (existing) {
    console.log("\n⚠️  Pool already exists!");
    return;
  }
  
  // Initialize pool
  console.log("\n🚀 Initializing pool...");
  try {
    const tx = await program.methods
      .initializePoolV2(uniqueSeed)
      .accounts({
        authority: provider.wallet.publicKey,
        poolConfig: poolConfig,
        merkleTree: merkleTree,
        pendingDepositsBuffer: pendingBuffer,
        relayerRegistry: relayerRegistry,
        complianceConfig: complianceConfig,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    
    console.log("✅ Pool initialized!");
    console.log("  Tx:", tx);
  } catch (e) {
    console.error("❌ Failed to initialize pool:", e.message);
    return;
  }
  
  // Upload MerkleBatchUpdate VK
  console.log("\n🚀 Uploading MerkleBatchUpdate VK...");
  
  const vk = JSON.parse(fs.readFileSync('./circuits/build/merkle_batch_update/verification_key.json', 'utf8'));
  const alphaG1 = g1ToBytes(vk.vk_alpha_1);
  const betaG2 = g2ToBytes(vk.vk_beta_2);
  const gammaG2 = g2ToBytes(vk.vk_gamma_2);
  const deltaG2 = g2ToBytes(vk.vk_delta_2);
  const icPoints = vk.IC.map((ic: string[]) => g1ToBytes(ic));
  
  const [vkPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("vk_merkle_batch"), poolConfig.toBuffer()],
    PROGRAM_ID
  );
  
  console.log("VK PDA:", vkPda.toBase58());
  console.log("IC Points:", icPoints.length);
  
  try {
    // Initialize VK
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
        poolConfig: poolConfig,
        verificationKey: vkPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    
    // Upload IC points in chunks
    for (let i = 0; i < icPoints.length; i++) {
      await program.methods
        .appendVkIcV2(i, icPoints[i])
        .accounts({
          authority: provider.wallet.publicKey,
          poolConfig: poolConfig,
          verificationKey: vkPda,
        })
        .rpc();
      console.log(`  IC point ${i + 1}/${icPoints.length} uploaded`);
    }
    
    // Finalize VK
    await program.methods
      .finalizeVkV2()
      .accounts({
        authority: provider.wallet.publicKey,
        poolConfig: poolConfig,
        verificationKey: vkPda,
      })
      .rpc();
    
    console.log("✅ VK uploaded and finalized!");
    
  } catch (e) {
    console.error("❌ Failed to upload VK:", e.message);
  }
  
  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("  Pool Initialization Complete!");
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("\nPool Config:", poolConfig.toBase58());
  console.log("Merkle Tree:", merkleTree.toBase58());
  console.log("Pending Buffer:", pendingBuffer.toBase58());
  console.log("VK:", vkPda.toBase58());
}

main().catch(console.error);
