/**
 * Debug settlement - trace the exact mismatch between proof and on-chain verification
 */

import * as anchor from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import * as fs from 'fs';
import * as snarkjs from 'snarkjs';
import { buildPoseidon } from 'circomlibjs';
import { createHash } from 'crypto';

const PROGRAM_ID = new PublicKey("C9GAJTFVgijNzB4SWZeNKmzruzjzrZ4H6J1DpKha9GoW");
const POOL_CONFIG = new PublicKey("EYjYoV3RpvmYBcUi6LVGaYUzCbEjeHxga7nE7D5GEgaS");
const FIELD_PRIME = BigInt("21888242871839275222246405745257275088548364400416034343698204186575808495617");

// Compute commitments hash the same way as the circuit
function computeCommitmentsHash(commitments: bigint[], batchSize: number, maxBatch: number): bigint {
  const bitsBE: number[] = [];
  
  for (let i = 0; i < maxBatch; i++) {
    const isActive = i < batchSize;
    const value = isActive ? commitments[i] : BigInt(0);
    
    for (let j = 255; j >= 0; j--) {
      bitsBE.push(Number((value >> BigInt(j)) & BigInt(1)));
    }
  }
  
  const bytes = Buffer.alloc(bitsBE.length / 8);
  for (let i = 0; i < bitsBE.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j++) {
      byte = (byte << 1) | bitsBE[i + j];
    }
    bytes[i / 8] = byte;
  }
  
  const hash = createHash('sha256');
  hash.update(bytes);
  const digest = hash.digest();
  
  const digestBits: number[] = [];
  for (let i = 0; i < digest.length; i++) {
    for (let j = 7; j >= 0; j--) {
      digestBits.push((digest[i] >> j) & 1);
    }
  }
  
  let result = BigInt(0);
  for (let i = 0; i < 253; i++) {
    const bitPos = 255 - i;
    const bit = digestBits[bitPos];
    result = result | (BigInt(bit) << BigInt(i));
  }
  
  return result % FIELD_PRIME;
}

// sha256 to field element (lower 253 bits)
function sha256ToField(hash: Buffer): bigint {
  const buf = Buffer.from(hash);
  buf[0] &= 0x1F; // Clear top 3 bits
  return BigInt('0x' + buf.toString('hex'));
}

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  Debug Settlement Proof");
  console.log("═══════════════════════════════════════════════════════════════\n");
  
  // Load the batch proof
  const proofJson = JSON.parse(fs.readFileSync('./test-proofs/batch_proof.json', 'utf8'));
  
  // Get on-chain state
  const [merkleTreePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("merkle_tree"), POOL_CONFIG.toBuffer()],
    PROGRAM_ID
  );
  
  const idl = JSON.parse(fs.readFileSync('./target/idl/white_protocol.json', 'utf8'));
  const program = new anchor.Program(idl, provider);
  
  const merkleTree = await (program.account as any).merkleTree.fetch(merkleTreePda);
  const [pendingBufferPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("pending"), POOL_CONFIG.toBuffer()],
    PROGRAM_ID
  );
  const pendingBuffer = await (program.account as any).pendingDepositsBuffer.fetch(pendingBufferPda);
  
  const onChainOldRoot = BigInt('0x' + Buffer.from(merkleTree.currentRoot).toString('hex'));
  const onChainStartIndex = Number(merkleTree.nextLeafIndex);
  
  console.log("On-chain state:");
  console.log("  Old Root:", onChainOldRoot.toString());
  console.log("  Start Index:", onChainStartIndex);
  
  // Get first pending commitment
  const firstCommitment = BigInt('0x' + Buffer.from(pendingBuffer.deposits[0].commitment).toString('hex'));
  console.log("  First Commitment:", firstCommitment.toString());
  
  // Build public inputs exactly like on-chain
  const poseidon = await buildPoseidon();
  const hash2 = (a: bigint, b: bigint): bigint => {
    const result = poseidon([a, b]);
    return BigInt(poseidon.F.toString(result));
  };
  
  // Compute zero values
  const zeros: bigint[] = [BigInt(0)];
  for (let i = 1; i <= 20; i++) {
    zeros.push(hash2(zeros[i-1], zeros[i-1]));
  }
  
  // Fetch on-chain tree state for correct path element computation
  const onChainFilledSubtrees: bigint[] = merkleTree.filledSubtrees.map(
    (b: number[]) => BigInt('0x' + Buffer.from(b).toString('hex'))
  );
  const onChainZeros: bigint[] = merkleTree.zeros.map(
    (b: number[]) => BigInt('0x' + Buffer.from(b).toString('hex'))
  );
  
  // Compute correct new root using actual tree state
  function computeNewRoot(commitment: bigint, startIdx: number): bigint {
    let current = commitment;
    for (let level = 0; level < 20; level++) {
      const isRightChild = ((startIdx >> level) & 1) === 1;
      const sibling = isRightChild ? onChainFilledSubtrees[level] : onChainZeros[level];
      if (isRightChild) {
        current = hash2(sibling, current);
      } else {
        current = hash2(current, sibling);
      }
    }
    return current;
  }
  
  const newRoot = computeNewRoot(firstCommitment, onChainStartIndex);
  
  console.log("\nComputed new root:", newRoot.toString());
  
  // Compute commitments hash
  const commitmentsHash = computeCommitmentsHash([firstCommitment], 1, 1);
  console.log("Commitments hash:", commitmentsHash.toString());
  
  // Build public inputs
  const startIndexScalar = BigInt(onChainStartIndex);
  const batchSizeScalar = BigInt(1);
  
  console.log("\nPublic Inputs for verification:");
  console.log("  [0] oldRoot:", onChainOldRoot.toString());
  console.log("  [1] newRoot:", newRoot.toString());
  console.log("  [2] startIndex:", startIndexScalar.toString());
  console.log("  [3] batchSize:", batchSizeScalar.toString());
  console.log("  [4] commitmentsHash:", commitmentsHash.toString());
  
  // Compare with proof's public signals
  console.log("\nProof public signals:");
  for (let i = 0; i < proofJson.publicSignals.length; i++) {
    const proofValue = BigInt(proofJson.publicSignals[i]);
    console.log(`  [${i}] ${proofValue.toString()}`);
  }
  
  // Check match
  console.log("\nPublic inputs match:");
  const expectedInputs = [onChainOldRoot, newRoot, startIndexScalar, batchSizeScalar, commitmentsHash];
  let allMatch = true;
  for (let i = 0; i < 5; i++) {
    const proofValue = BigInt(proofJson.publicSignals[i]);
    const expected = expectedInputs[i];
    const match = proofValue === expected ? "✓" : "✗";
    if (proofValue !== expected) allMatch = false;
    console.log(`  [${i}] ${match} Proof: ${proofValue.toString().substring(0, 30)}... Expected: ${expected.toString().substring(0, 30)}...`);
  }
  
  if (!allMatch) {
    console.log("\n⚠️  WARNING: Proof public signals DO NOT match current on-chain state!");
    console.log("   The proof may be stale. Regenerate with: npx tsx scripts/test-batch-proof.ts");
  }
  
  // Verify proof locally with snarkjs
  console.log("\nLocal snarkjs verification:");
  const vkey = JSON.parse(fs.readFileSync('./circuits/build/merkle_batch_update/verification_key.json', 'utf8'));
  const isValid = await snarkjs.groth16.verify(vkey, proofJson.publicSignals, proofJson.proof);
  console.log("  Result:", isValid ? "✓ VALID" : "✗ INVALID");
  
  // Now format the proof in different ways and check
  console.log("\n=== Proof Format Analysis ===");
  
  // Format 1: SDK style [0][1], [0][0], [1][1], [1][0]
  function formatSDK(proof: any): Buffer {
    const buf = Buffer.alloc(256);
    let offset = 0;
    
    const toHex32 = (val: string) => BigInt(val).toString(16).padStart(64, '0');
    
    // pi_a
    buf.write(toHex32(proof.pi_a[0]), offset, 32, 'hex');
    offset += 32;
    buf.write(toHex32(proof.pi_a[1]), offset, 32, 'hex');
    offset += 32;
    
    // pi_b: [0][1], [0][0], [1][1], [1][0]
    buf.write(toHex32(proof.pi_b[0][1]), offset, 32, 'hex');
    offset += 32;
    buf.write(toHex32(proof.pi_b[0][0]), offset, 32, 'hex');
    offset += 32;
    buf.write(toHex32(proof.pi_b[1][1]), offset, 32, 'hex');
    offset += 32;
    buf.write(toHex32(proof.pi_b[1][0]), offset, 32, 'hex');
    offset += 32;
    
    // pi_c
    buf.write(toHex32(proof.pi_c[0]), offset, 32, 'hex');
    offset += 32;
    buf.write(toHex32(proof.pi_c[1]), offset, 32, 'hex');
    
    return buf;
  }
  
  // Format 2: Sequential [0][0], [0][1], [1][0], [1][1]
  function formatSequential(proof: any): Buffer {
    const buf = Buffer.alloc(256);
    let offset = 0;
    
    const toHex32 = (val: string) => BigInt(val).toString(16).padStart(64, '0');
    
    // pi_a
    buf.write(toHex32(proof.pi_a[0]), offset, 32, 'hex');
    offset += 32;
    buf.write(toHex32(proof.pi_a[1]), offset, 32, 'hex');
    offset += 32;
    
    // pi_b: [0][0], [0][1], [1][0], [1][1]
    buf.write(toHex32(proof.pi_b[0][0]), offset, 32, 'hex');
    offset += 32;
    buf.write(toHex32(proof.pi_b[0][1]), offset, 32, 'hex');
    offset += 32;
    buf.write(toHex32(proof.pi_b[1][0]), offset, 32, 'hex');
    offset += 32;
    buf.write(toHex32(proof.pi_b[1][1]), offset, 32, 'hex');
    offset += 32;
    
    // pi_c
    buf.write(toHex32(proof.pi_c[0]), offset, 32, 'hex');
    offset += 32;
    buf.write(toHex32(proof.pi_c[1]), offset, 32, 'hex');
    
    return buf;
  }
  
  const sdkFormat = formatSDK(proofJson.proof);
  const seqFormat = formatSequential(proofJson.proof);
  
  console.log("\nSDK format (G2: [0][1], [0][0], [1][1], [1][0]):");
  console.log("  First 16 bytes:", sdkFormat.slice(0, 16).toString('hex'));
  console.log("  Bytes 64-80 (pi_b start):", sdkFormat.slice(64, 80).toString('hex'));
  
  console.log("\nSequential format (G2: [0][0], [0][1], [1][0], [1][1]):");
  console.log("  First 16 bytes:", seqFormat.slice(0, 16).toString('hex'));
  console.log("  Bytes 64-80 (pi_b start):", seqFormat.slice(64, 80).toString('hex'));
}

main().catch(console.error);
