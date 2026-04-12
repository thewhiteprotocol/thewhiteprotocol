import * as anchor from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import * as fs from 'fs';

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  
  const idl = JSON.parse(fs.readFileSync('./target/idl/white_protocol.json', 'utf8'));
  const program = new anchor.Program(idl as anchor.Idl, provider);
  
  const poolConfig = new PublicKey("EYjYoV3RpvmYBcUi6LVGaYUzCbEjeHxga7nE7D5GEgaS");
  
  // Get on-chain VK
  const [vkPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("vk_merkle_batch"), poolConfig.toBuffer()],
    program.programId
  );
  
  console.log("VK PDA:", vkPda.toBase58());
  
  // Fetch raw account data
  const account = await provider.connection.getAccountInfo(vkPda);
  if (!account) {
    console.log("VK account not found");
    return;
  }
  
  console.log("Account size:", account.data.length);
  
  // Decode manually based on IDL structure
  // Skip discriminator (8 bytes)
  let offset = 8;
  const data = account.data;
  
  // pool: pubkey (32 bytes)
  const pool = new PublicKey(data.slice(offset, offset + 32));
  offset += 32;
  
  // proof_type: u8 (1 byte)
  const proofType = data[offset];
  offset += 1;
  
  // vk_alpha_g1: [u8; 64] (64 bytes)
  offset += 64;
  
  // vk_beta_g2: [u8; 128] (128 bytes)
  offset += 128;
  
  // vk_gamma_g2: [u8; 128] (128 bytes)
  offset += 128;
  
  // vk_delta_g2: [u8; 128] (128 bytes)
  offset += 128;
  
  // vk_ic_len: u8 (1 byte)
  const vkIcLen = data[offset];
  offset += 1;
  
  // vk_ic: vec of [u8; 64]
  // For vec, we have: 4 bytes length (u32 LE) + data
  const vecLen = data.readUInt32LE(offset);
  offset += 4;
  
  // is_initialized: bool (1 byte)
  const isInitialized = data[offset];
  offset += 1;
  
  // is_locked: bool (1 byte)
  const isLocked = data[offset];
  offset += 1;
  
  console.log("\nDecoded VK Account:");
  console.log("  Pool:", pool.toBase58());
  console.log("  Proof Type:", proofType);
  console.log("  VK IC Len (stored):", vkIcLen);
  console.log("  VK IC Len (vec):", vecLen);
  console.log("  Is Initialized:", isInitialized);
  console.log("  Is Locked:", isLocked);
  
  // Load local VK
  const localVk = JSON.parse(fs.readFileSync('./circuits/build/merkle_batch_update/verification_key.json', 'utf8'));
  console.log("\nLocal VK:");
  console.log("  IC Length:", localVk.IC.length);
  console.log("  nPublic:", localVk.nPublic);
  
  if (vecLen === localVk.IC.length) {
    console.log("\n✓ IC count matches!");
  } else {
    console.log("\n✗ IC count mismatch!");
    console.log("  On-chain:", vecLen);
    console.log("  Local:", localVk.IC.length);
  }
  
  // Proof type mapping (from state/verification_key.rs)
  const proofTypes: Record<number, string> = {
    0: 'Deposit',
    1: 'Withdraw',
    2: 'JoinSplit',
    3: 'MerkleBatchUpdate',
    4: 'Membership'
  };
  console.log("\nProof Type:", proofTypes[proofType] || `Unknown (${proofType})`);
  
  if (proofType !== 3) {
    console.log("\n⚠️  WARNING: On-chain VK is not for MerkleBatchUpdate!");
    console.log("   Expected: 3 (MerkleBatchUpdate)");
    console.log("   Found:", proofType);
  }
}

main().catch(console.error);
