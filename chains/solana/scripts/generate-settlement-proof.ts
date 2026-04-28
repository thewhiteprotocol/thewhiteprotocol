/**
 * Generate batch settlement proof for actual pending deposit
 * 
 * IMPORTANT: This script now correctly computes tree roots using the same
 * zero-tree logic as the on-chain MerkleTree and the circuit.
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const FIELD_PRIME = BigInt("21888242871839275222246405745257275088548364400416034343698204186575808495617");

// The commitment from the pending buffer
const DEPOSIT_COMMITMENT = BigInt("0x1c3807786a50e0b422b898062c38ee28b0655249357193af6b3f908e557b294f");

// BN254 prime p (big-endian, same as on-chain)
const P = Buffer.from([
  0x30, 0x64, 0x4e, 0x72, 0xe1, 0x31, 0xa0, 0x29,
  0xb8, 0x50, 0x45, 0xb6, 0x81, 0x81, 0x58, 0x5d,
  0x97, 0x81, 0x6a, 0x91, 0x68, 0x71, 0xca, 0x8d,
  0x3c, 0x20, 0x8c, 0x16, 0xd8, 0x7c, 0xfd, 0x47,
]);

// Check if a >= b (both 32-byte big-endian)
function isGreaterOrEqual(a: Buffer, b: Buffer): boolean {
  for (let i = 0; i < 32; i++) {
    if (a[i] > b[i]) return true;
    if (a[i] < b[i]) return false;
  }
  return true; // equal
}

// Reduce mod P (same as on-chain)
function reduceModP(c: Buffer): Buffer {
  const result = Buffer.alloc(32);
  let borrow = 0;
  for (let i = 31; i >= 0; i--) {
    const diff = c[i] - P[i] - borrow;
    if (diff < 0) {
      result[i] = diff + 256;
      borrow = 1;
    } else {
      result[i] = diff;
      borrow = 0;
    }
  }
  return result;
}

// Compute commitments hash exactly as on-chain
function computeCommitmentsHash(commitments: bigint[], batchSize: number, maxBatch: number): bigint {
  const preimage = Buffer.alloc(maxBatch * 32, 0);
  
  for (let i = 0; i < maxBatch; i++) {
    if (i < batchSize && i < commitments.length) {
      // Convert commitment to 32-byte big-endian
      const cHex = commitments[i].toString(16).padStart(64, '0');
      const c = Buffer.from(cHex, 'hex');
      
      // Reduce mod P if >= P
      if (isGreaterOrEqual(c, P)) {
        const reduced = reduceModP(c);
        reduced.copy(preimage, i * 32);
      } else {
        c.copy(preimage, i * 32);
      }
    }
  }
  
  const hash = createHash('sha256').update(preimage).digest();
  
  // Convert to field element (lower 253 bits)
  const result = Buffer.from(hash);
  result[0] &= 0x1F; // Keep lower 5 bits of first byte
  
  return BigInt('0x' + result.toString('hex'));
}

async function main() {
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  Generate Batch Settlement Proof");
  console.log("═══════════════════════════════════════════════════════════════\n");
  
  const snarkjs = await import('snarkjs');
  const { buildPoseidon } = await import('circomlibjs');
  const poseidon = await buildPoseidon();
  
  const hash2 = (a: bigint, b: bigint): bigint => {
    const result = poseidon([a, b]);
    return BigInt(poseidon.F.toString(result));
  };
  
  // IMPORTANT: Use the SAME build directory as test-batch-proof.ts
  // Both directories have identical artifacts, but we standardize on:
  const circuitDir = path.join(__dirname, '../../../circuits/merkle_batch_update/build');
  const wasmPath = path.join(circuitDir, 'merkle_batch_update_js/merkle_batch_update.wasm');
  const zkeyPath = path.join(circuitDir, 'merkle_batch_update.zkey');
  
  console.log("Files:");
  console.log("  WASM:", fs.existsSync(wasmPath) ? "✓" : "✗");
  console.log("  ZKEY:", fs.existsSync(zkeyPath) ? "✓" : "✗");
  
  const depth = 20;
  const startIndex = 0;
  const batchSize = 1;
  const maxBatch = 1;
  
  // CORRECT empty tree root computation (matches on-chain MerkleTree.init)
  // zeros[0] = 0, zeros[i] = hash2(zeros[i-1], zeros[i-1])
  const zeros: bigint[] = [BigInt(0)];
  for (let i = 1; i <= depth; i++) {
    zeros.push(hash2(zeros[i - 1], zeros[i - 1]));
  }
  
  const oldRoot = zeros[depth];
  
  // CORRECT new root computation for insertion at startIndex = 0
  // At each level, since bit is 0 (left child), hash(current, zeros[level])
  let newRoot = DEPOSIT_COMMITMENT;
  for (let i = 0; i < depth; i++) {
    newRoot = hash2(newRoot, zeros[i]);
  }
  
  console.log("\nTree State:");
  console.log("  Old Root (empty tree):", oldRoot.toString());
  console.log("  New Root:", newRoot.toString());
  console.log("  Start Index:", startIndex);
  console.log("  Batch Size:", batchSize);
  
  // Compute commitments hash
  const commitmentsHash = computeCommitmentsHash([DEPOSIT_COMMITMENT], batchSize, maxBatch);
  console.log("  Commitments Hash:", commitmentsHash.toString());
  
  // Single commitment
  const commitments = [DEPOSIT_COMMITMENT.toString()];
  
  // Path elements for startIndex = 0: all zeros (siblings are zeros[level])
  const pathElements: string[][] = [];
  for (let i = 0; i < maxBatch; i++) {
    pathElements.push(zeros.slice(0, depth).map(z => z.toString()));
  }
  
  const input = {
    oldRoot: oldRoot.toString(),
    newRoot: newRoot.toString(),
    startIndex: startIndex,
    batchSize: batchSize,
    commitmentsHash: commitmentsHash.toString(),
    commitments: commitments,
    pathElements: pathElements
  };
  
  console.log("\nGenerating proof...");
  
  try {
    const { proof, publicSignals } = await snarkjs.groth16.fullProve(
      input,
      wasmPath,
      zkeyPath
    );
    
    console.log("✓ Proof generated successfully!");
    console.log("\nPublic Signals:", publicSignals);
    
    // Verify locally
    const vkey = JSON.parse(fs.readFileSync(path.join(circuitDir, 'verification_key.json'), 'utf8'));
    const isValid = await snarkjs.groth16.verify(vkey, publicSignals, proof);
    console.log("\nLocal snarkjs verification:", isValid ? "✓ VALID" : "✗ INVALID");
    
    // Format proof for Solana on-chain verifier
    // Layout (256 bytes, all big-endian):
    //   pi_a (G1):   x (32), y (32)               offset 0
    //   pi_b (G2):   x_imag (32), x_real (32),     offset 64
    //                y_imag (32), y_real (32)      offset 128
    //   pi_c (G1):   x (32), y (32)               offset 192
    // snarkjs format: pi_b[0][0]=x_real, pi_b[0][1]=x_imag,
    //                 pi_b[1][0]=y_real, pi_b[1][1]=y_imag
    const proofBytes = Buffer.alloc(256);
    let offset = 0;

    const toHex32 = (v: string) => BigInt(v).toString(16).padStart(64, '0');

    // pi_a (G1)
    proofBytes.write(toHex32(proof.pi_a[0]), offset, 32, 'hex');
    offset += 32;
    proofBytes.write(toHex32(proof.pi_a[1]), offset, 32, 'hex');
    offset += 32;

    // pi_b (G2) — Solana expects imaginary FIRST
    proofBytes.write(toHex32(proof.pi_b[0][1]), offset, 32, 'hex'); // x_imag
    offset += 32;
    proofBytes.write(toHex32(proof.pi_b[0][0]), offset, 32, 'hex'); // x_real
    offset += 32;
    proofBytes.write(toHex32(proof.pi_b[1][1]), offset, 32, 'hex'); // y_imag
    offset += 32;
    proofBytes.write(toHex32(proof.pi_b[1][0]), offset, 32, 'hex'); // y_real
    offset += 32;

    // pi_c (G1)
    proofBytes.write(toHex32(proof.pi_c[0]), offset, 32, 'hex');
    offset += 32;
    proofBytes.write(toHex32(proof.pi_c[1]), offset, 32, 'hex');
    
    // Save proof
    const outputDir = path.join(__dirname, '../test-proofs');
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(
      path.join(outputDir, 'settlement_proof.json'),
      JSON.stringify({
        proof: Array.from(proofBytes),
        newRoot: Array.from(Buffer.from(newRoot.toString(16).padStart(64, '0'), 'hex')),
        batchSize: 1,
        publicSignals,
        commitmentsHash: commitmentsHash.toString()
      }, null, 2)
    );
    
    console.log("\n✓ Proof saved to test-proofs/settlement_proof.json");
    
  } catch (error) {
    console.error("\n✗ Proof generation failed:", error);
    throw error;
  }
}

main().catch(console.error);
