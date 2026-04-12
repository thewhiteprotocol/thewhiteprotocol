/**
 * Run batch settlement with generated proof
 */

import * as anchor from "@coral-xyz/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import * as fs from 'fs';

const PROGRAM_ID = new PublicKey("C9GAJTFVgijNzB4SWZeNKmzruzjzrZ4H6J1DpKha9GoW");
const POOL_CONFIG = new PublicKey("EYjYoV3RpvmYBcUi6LVGaYUzCbEjeHxga7nE7D5GEgaS");

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  Run Batch Settlement");
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
  
  const [vkPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("vk_merkle_batch"), POOL_CONFIG.toBuffer()],
    PROGRAM_ID
  );
  
  console.log("Accounts:");
  console.log("  Pool:", POOL_CONFIG.toBase58());
  console.log("  Merkle Tree:", merkleTree.toBase58());
  console.log("  Pending Buffer:", pendingBuffer.toBase58());
  console.log("  VK:", vkPda.toBase58());
  
  // Load proof
  const proofData = JSON.parse(fs.readFileSync('./test-proofs/settlement_proof.json', 'utf8'));
  console.log("\n✓ Proof loaded");
  
  const proofBytes = new Uint8Array(proofData.proof);
  const newRoot = new Uint8Array(proofData.newRoot);
  
  console.log("  Proof bytes:", proofBytes.length);
  console.log("  New root:", Buffer.from(newRoot).toString('hex').slice(0, 20) + "...");
  
  // Get current state
  const treeBefore = await program.account.merkleTree.fetch(merkleTree);
  console.log("\nMerkle Tree (before):");
  console.log("  Root:", Buffer.from(treeBefore.currentRoot).toString('hex').slice(0, 20) + "...");
  console.log("  Next Index:", treeBefore.nextLeafIndex.toString());
  
  // Submit settlement
  console.log("\n🚀 Submitting settlement transaction...");
  
  try {
    const tx = await program.methods
      .settleDepositsBatch({
        proof: Array.from(proofBytes),
        newRoot: Array.from(newRoot),
        batchSize: 1,
      })
      .accounts({
        authority: provider.wallet.publicKey,
        poolConfig: POOL_CONFIG,
        merkleTree: merkleTree,
        pendingBuffer: pendingBuffer,
        verificationKey: vkPda,
      })
      .rpc();
    
    console.log("\n✅ Settlement successful!");
    console.log("  Tx:", tx);
    console.log("  Explorer: https://explorer.solana.com/tx/" + tx + "?cluster=devnet");
    
    // Verify state change
    const treeAfter = await program.account.merkleTree.fetch(merkleTree);
    console.log("\nMerkle Tree (after):");
    console.log("  Root:", Buffer.from(treeAfter.currentRoot).toString('hex').slice(0, 20) + "...");
    console.log("  Next Index:", treeAfter.nextLeafIndex.toString());
    
    if (treeAfter.nextLeafIndex.toNumber() > treeBefore.nextLeafIndex.toNumber()) {
      console.log("\n✓ Leaf index incremented!");
    }
    
    // Save note data for withdrawal test
    fs.writeFileSync('./test-proofs/settlement_result.json', JSON.stringify({
      tx,
      newRoot: Array.from(newRoot),
      leafIndex: 0,
    }, null, 2));
    
  } catch (e: any) {
    console.error("\n❌ Settlement failed:", e.message);
    if (e.logs) {
      console.log("\nLogs:");
      e.logs.forEach((log: string) => console.log("  ", log));
    }
  }
}

main().catch(console.error);
