/**
 * Make a simple deposit
 */

import * as anchor from "@coral-xyz/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import * as fs from 'fs';

const PROGRAM_ID = new PublicKey("C9GAJTFVgijNzB4SWZeNKmzruzjzrZ4H6J1DpKha9GoW");
const POOL_CONFIG = new PublicKey("EYjYoV3RpvmYBcUi6LVGaYUzCbEjeHxga7nE7D5GEgaS");
const WSOL_MINT = new PublicKey("So11111111111111111111111111111111111111112");

// BN254 field prime
const FIELD_PRIME = BigInt("21888242871839275222246405745257275088548364400416034343698204186575808495617");

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  Make Deposit");
  console.log("═══════════════════════════════════════════════════════════════\n");
  
  const idl = JSON.parse(fs.readFileSync('./target/idl/white_protocol.json', 'utf8'));
  const program = new anchor.Program(idl as anchor.Idl, provider);
  
  // Get PDAs
  const [merkleTree] = PublicKey.findProgramAddressSync(
    [Buffer.from("merkle_tree"), POOL_CONFIG.toBuffer()],
    PROGRAM_ID
  );
  
  const [pendingBuffer] = PublicKey.findProgramAddressSync(
    [Buffer.from("pending"), POOL_CONFIG.toBuffer()],
    PROGRAM_ID
  );
  
  const [assetVault] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), POOL_CONFIG.toBuffer(), Buffer.from(WSOL_MINT.toBuffer())],
    PROGRAM_ID
  );
  
  const [depositVk] = PublicKey.findProgramAddressSync(
    [Buffer.from("vk_deposit"), POOL_CONFIG.toBuffer()],
    PROGRAM_ID
  );
  
  console.log("Pool Config:", POOL_CONFIG.toBase58());
  console.log("Merkle Tree:", merkleTree.toBase58());
  console.log("Pending Buffer:", pendingBuffer.toBase58());
  console.log("Asset Vault:", assetVault.toBase58());
  console.log("Deposit VK:", depositVk.toBase58());
  
  // Use a test commitment
  const commitment = Buffer.alloc(32);
  commitment.writeBigUInt64BE(BigInt("12345678901234567"), 0);
  
  console.log("\nCommitment:", commitment.toString('hex'));
  
  // For this test, we need a valid deposit proof
  // Since we don't have the deposit circuit set up, let's just check the state
  console.log("\n⚠️  Deposit requires a valid ZK proof from the deposit circuit.");
  console.log("   This test script is incomplete - need deposit proof generation.");
}

main().catch(console.error);
