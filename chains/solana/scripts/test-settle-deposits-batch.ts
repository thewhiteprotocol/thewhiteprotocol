/**
 * Test script for settle_deposits_batch instruction
 * Uses the SAME proof format as the working deposit test
 */

import * as anchor from "@coral-xyz/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Format proof for Solana - MATCHES SDK serializeProof exactly
 * Layout (256 bytes):
 * - pi_a: x (32 bytes), y (32 bytes) at offset 0
 * - pi_b: [0][1] (32), [0][0] (32), [1][1] (32), [1][0] (32) at offset 64
 * - pi_c: x (32 bytes), y (32 bytes) at offset 192
 */
function formatProofForSolana(proof: any): Buffer {
  const proofBytes = Buffer.alloc(256);
  
  // Helper to convert bigint to 32-byte hex
  const toHex32 = (val: string) => BigInt(val).toString(16).padStart(64, '0');
  
  let offset = 0;
  
  // pi_a (G1) - 64 bytes: x, y
  const ax = toHex32(proof.pi_a[0]);
  const ay = toHex32(proof.pi_a[1]);
  proofBytes.write(ax, offset, 32, 'hex');
  offset += 32;
  proofBytes.write(ay, offset, 32, 'hex');
  offset += 32;
  
  // pi_b (G2) - 128 bytes: [0][1], [0][0], [1][1], [1][0]
  // This matches SDK: hexToBytes32(bigIntToHex(BigInt(proof.pi_b[0][1]))) etc.
  const bx01 = toHex32(proof.pi_b[0][1]);
  const bx00 = toHex32(proof.pi_b[0][0]);
  const bx11 = toHex32(proof.pi_b[1][1]);
  const bx10 = toHex32(proof.pi_b[1][0]);
  proofBytes.write(bx01, offset, 32, 'hex');
  offset += 32;
  proofBytes.write(bx00, offset, 32, 'hex');
  offset += 32;
  proofBytes.write(bx11, offset, 32, 'hex');
  offset += 32;
  proofBytes.write(bx10, offset, 32, 'hex');
  offset += 32;
  
  // pi_c (G1) - 64 bytes: x, y
  const cx = toHex32(proof.pi_c[0]);
  const cy = toHex32(proof.pi_c[1]);
  proofBytes.write(cx, offset, 32, 'hex');
  offset += 32;
  proofBytes.write(cy, offset, 32, 'hex');
  
  return proofBytes;
}

/**
 * Convert bigint to 32-byte big-endian array
 */
function bigintToBytes32(value: bigint): number[] {
  const hex = value.toString(16).padStart(64, '0');
  const bytes: number[] = [];
  for (let i = 0; i < 64; i += 2) {
    bytes.push(parseInt(hex.substring(i, i + 2), 16));
  }
  return bytes;
}

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  Testing Settle Deposits Batch (Fixed Proof Format)");
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
  
  const proofJson = JSON.parse(fs.readFileSync(proofPath, 'utf8'));
  console.log("\n✓ Proof loaded");
  console.log("  Public signals:", proofJson.publicSignals.length);
  
  // Format proof using SDK-compatible format
  const proofBytes = formatProofForSolana(proofJson.proof);
  console.log("  Proof bytes:", proofBytes.length, "bytes");
  
  // Log first few bytes for debugging
  console.log("  Proof header (first 16 bytes):", proofBytes.slice(0, 16).toString('hex'));
  
  // Extract values from public signals
  // Circuit public signals order: [oldRoot, newRoot, startIndex, batchSize, commitmentsHash]
  const proofOldRoot = BigInt(proofJson.publicSignals[0]);
  const proofNewRoot = BigInt(proofJson.publicSignals[1]);
  const proofStartIndex = BigInt(proofJson.publicSignals[2]);
  const proofBatchSize = BigInt(proofJson.publicSignals[3]);
  const proofCommitmentsHash = BigInt(proofJson.publicSignals[4]);
  
  console.log("\nProof Public Inputs:");
  console.log("  Old Root:", proofOldRoot.toString().substring(0, 30) + "...");
  console.log("  New Root:", proofNewRoot.toString().substring(0, 30) + "...");
  console.log("  Start Index:", proofStartIndex.toString());
  console.log("  Batch Size:", proofBatchSize.toString());
  console.log("  Commitments Hash:", proofCommitmentsHash.toString().substring(0, 30) + "...");
  
  // Validate against current on-chain state
  const merkleTree = await program.account.merkleTree.fetch(merkleTreePda);
  const pendingBuffer = await program.account.pendingDepositsBuffer.fetch(pendingBufferPda);
  
  const onChainOldRoot = BigInt('0x' + Buffer.from(merkleTree.currentRoot).toString('hex'));
  const onChainStartIndex = BigInt(merkleTree.nextLeafIndex);
  const pendingCount = pendingBuffer.deposits?.length || 0;
  
  console.log("\nOn-chain State:");
  console.log("  Current Root:", onChainOldRoot.toString().substring(0, 30) + "...");
  console.log("  Next Leaf Index:", onChainStartIndex.toString());
  console.log("  Pending Deposits:", pendingCount);
  
  // Check if proof is stale
  if (proofOldRoot !== onChainOldRoot) {
    console.error("\n❌ STALE PROOF: proof oldRoot != on-chain currentRoot");
    console.log("   Regenerate proof with: npx tsx scripts/test-batch-proof.ts");
    process.exit(1);
  }
  if (proofStartIndex !== onChainStartIndex) {
    console.error("\n❌ STALE PROOF: proof startIndex != on-chain nextLeafIndex");
    console.log("   Regenerate proof with: npx tsx scripts/test-batch-proof.ts");
    process.exit(1);
  }
  if (pendingCount < Number(proofBatchSize)) {
    console.error("\n❌ Not enough pending deposits for batch size:", proofBatchSize.toString());
    process.exit(1);
  }
  
  console.log("\n✓ Proof matches current on-chain state");
  
  // Convert newRoot to bytes for the instruction
  const newRootBytes = bigintToBytes32(proofNewRoot);
  
  console.log("\nCalling settleDepositsBatch...");
  
  try {
    const tx = await program.methods
      .settleDepositsBatch({
        proof: Array.from(proofBytes),
        newRoot: newRootBytes,
        batchSize: Number(proofBatchSize),
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
    
  } catch (error: any) {
    console.error("\n❌ Transaction failed:");
    console.error(error.message);
    
    if (error.logs) {
      console.error("\nProgram logs:");
      // Find relevant error lines
      const relevantLogs = error.logs.filter((log: string) => 
        log.includes('Error') || 
        log.includes('failed') || 
        log.includes('proof') ||
        log.includes('Proof')
      );
      relevantLogs.forEach((log: string) => console.error("  ", log));
    }
    
    // Check pending buffer
    try {
      const pendingBuffer = await program.account.pendingDepositsBuffer.fetch(pendingBufferPda);
      console.log("\nPending Buffer state:");
      console.log("  Deposits:", pendingBuffer.deposits?.length || 0);
      console.log("  Total Pending:", pendingBuffer.totalPending?.toString() || 'unknown');
    } catch (e) {
      console.log("\nCould not fetch pending buffer state");
    }
    
    process.exit(1);
  }
}

main().catch(console.error);
