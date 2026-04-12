/**
 * Test script for settle_deposits_batch instruction
 */

import * as anchor from "@coral-xyz/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  Testing Settle Deposits Batch");
  console.log("═══════════════════════════════════════════════════════════════\n");
  
  console.log("Authority:", provider.wallet.publicKey.toBase58());
  
  const idl = JSON.parse(fs.readFileSync('./target/idl/white_protocol.json', 'utf8'));
  const program = new anchor.Program(idl as anchor.Idl, provider);
  
  // Pool config
  const poolConfig = new PublicKey("EYjYoV3RpvmYBcUi6LVGaYUzCbEjeHxga7nE7D5GEgaS");
  
  // Derive PDAs
  const [merkleTreePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("merkle_tree"), poolConfig.toBuffer()],
    program.programId
  );
  
  const [pendingBufferPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("pending"), poolConfig.toBuffer()],
    program.programId
  );
  
  const [vkPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("vk_merkle_batch"), poolConfig.toBuffer()],
    program.programId
  );
  
  console.log("Pool Config:", poolConfig.toBase58());
  console.log("Merkle Tree:", merkleTreePda.toBase58());
  console.log("Pending Buffer:", pendingBufferPda.toBase58());
  console.log("VK:", vkPda.toBase58());
  
  // Load proof data
  const proofPath = path.join(__dirname, '../test-proofs/batch_proof.json');
  if (!fs.existsSync(proofPath)) {
    console.error("\n❌ Proof file not found:", proofPath);
    console.log("Run scripts/test-batch-proof.ts first to generate a proof");
    process.exit(1);
  }
  
  const proofData = JSON.parse(fs.readFileSync(proofPath, 'utf8'));
  console.log("\n✓ Proof loaded");
  console.log("  Public signals:", proofData.publicSignals.length);
  
  // Format proof for Anchor (256 bytes)
  const proof = proofData.proof;
  const proofBytes = Buffer.alloc(256);
  let offset = 0;
  
  // pi_a (G1 point) - 64 bytes
  proofBytes.write(BigInt(proof.pi_a[0]).toString(16).padStart(64, '0'), offset, 32, 'hex');
  offset += 32;
  proofBytes.write(BigInt(proof.pi_a[1]).toString(16).padStart(64, '0'), offset, 32, 'hex');
  offset += 32;
  
  // pi_b (G2 point) - 128 bytes
  proofBytes.write(BigInt(proof.pi_b[0][0]).toString(16).padStart(64, '0'), offset, 32, 'hex');
  offset += 32;
  proofBytes.write(BigInt(proof.pi_b[0][1]).toString(16).padStart(64, '0'), offset, 32, 'hex');
  offset += 32;
  proofBytes.write(BigInt(proof.pi_b[1][0]).toString(16).padStart(64, '0'), offset, 32, 'hex');
  offset += 32;
  proofBytes.write(BigInt(proof.pi_b[1][1]).toString(16).padStart(64, '0'), offset, 32, 'hex');
  offset += 32;
  
  // pi_c (G1 point) - 64 bytes
  proofBytes.write(BigInt(proof.pi_c[0]).toString(16).padStart(64, '0'), offset, 32, 'hex');
  offset += 32;
  proofBytes.write(BigInt(proof.pi_c[1]).toString(16).padStart(64, '0'), offset, 32, 'hex');
  
  // Extract newRoot from public signals
  const newRoot = BigInt(proofData.publicSignals[1]);
  const newRootBytes = Buffer.alloc(32);
  newRootBytes.write(newRoot.toString(16).padStart(64, '0'), 0, 32, 'hex');
  
  console.log("\nCalling settleDepositsBatch...");
  console.log("  New Root:", newRoot.toString().substring(0, 30) + "...");
  console.log("  Batch Size: 1");
  
  try {
    const tx = await program.methods
      .settleDepositsBatch({
        proof: Array.from(proofBytes),
        newRoot: Array.from(newRootBytes),
        batchSize: 1,
      })
      .accounts({
        authority: provider.wallet.publicKey,
        poolConfig: poolConfig,
        merkleTree: merkleTreePda,
        pendingBuffer: pendingBufferPda,
        verificationKey: vkPda,
      })
      .rpc();
    
    console.log("\n✅ Transaction successful!");
    console.log("  Signature:", tx);
    console.log("  Explorer: https://explorer.solana.com/tx/" + tx + "?cluster=devnet");
    
    // Fetch updated merkle tree state
    const merkleTree = await program.account.merkleTree.fetch(merkleTreePda);
    console.log("\nUpdated Merkle Tree state:");
    console.log("  Current Root:", Buffer.from(merkleTree.currentRoot).toString('hex').substring(0, 20) + "...");
    console.log("  Next Leaf Index:", merkleTree.nextLeafIndex.toString());
    
  } catch (error) {
    console.error("\n❌ Transaction failed:");
    console.error(error);
    
    // Check pending buffer
    try {
      const pendingBuffer = await program.account.pendingDepositsBuffer.fetch(pendingBufferPda);
      console.log("\nPending Buffer state:");
      console.log("  Count:", pendingBuffer.count.toString());
      console.log("  Head:", pendingBuffer.head.toString());
      console.log("  Tail:", pendingBuffer.tail.toString());
    } catch (e) {
      console.log("\nCould not fetch pending buffer state");
    }
  }
}

main().catch(console.error);
