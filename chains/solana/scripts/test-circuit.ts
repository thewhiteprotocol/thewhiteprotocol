/**
 * Test MerkleBatchUpdate circuit locally - Debug version
 */

import * as path from "path";
import { createHash } from "crypto";

// @ts-ignore
const snarkjs = require("snarkjs");

const CIRCUIT_WASM = path.join(__dirname, "../circuits/build/merkle_batch_update/merkle_batch_update_js/merkle_batch_update.wasm");
const CIRCUIT_ZKEY = path.join(__dirname, "../circuits/build/merkle_batch_update/merkle_batch_update_final.zkey");
const VK_JSON = path.join(__dirname, "../circuits/build/merkle_batch_update/verification_key.json");

const MAX_BATCH_SIZE = 16;
const MERKLE_DEPTH = 20;

let poseidon: any;
let F: any;

async function initPoseidon() {
  // @ts-ignore
  const circomlibjs = require("circomlibjs");
  poseidon = await circomlibjs.buildPoseidon();
  F = poseidon.F;
}

function poseidonHash(inputs: bigint[]): bigint {
  const hash = poseidon(inputs.map(x => F.e(x)));
  return F.toObject(hash);
}

function bigintToBytes32BE(bn: bigint): number[] {
  const hex = bn.toString(16).padStart(64, "0");
  const bytes: number[] = [];
  for (let i = 0; i < 64; i += 2) {
    bytes.push(parseInt(hex.substr(i, 2), 16));
  }
  return bytes;
}

function bytes32ToBigint(bytes: number[] | Buffer): bigint {
  let hex = "0x";
  for (const b of bytes) {
    hex += b.toString(16).padStart(2, "0");
  }
  return BigInt(hex);
}

// Compute zeros for empty tree
function computeZeros(depth: number): bigint[] {
  const zeros: bigint[] = [0n];
  for (let i = 1; i <= depth; i++) {
    zeros[i] = poseidonHash([zeros[i - 1], zeros[i - 1]]);
  }
  return zeros;
}

// Compute sha256 hash matching circuit encoding  
function computeCommitmentsHash(commitments: bigint[], batchSize: number): bigint {
  const buffer = Buffer.alloc(MAX_BATCH_SIZE * 32);
  
  for (let i = 0; i < batchSize; i++) {
    const bytes = bigintToBytes32BE(commitments[i]);
    Buffer.from(bytes).copy(buffer, i * 32);
  }
  
  const hash = createHash("sha256").update(buffer).digest();
  const hashBigint = bytes32ToBigint(hash);
  const mask = (1n << 253n) - 1n;
  return hashBigint & mask;
}

async function main() {
  console.log("🧪 Testing MerkleBatchUpdate Circuit (Debug)\n");
  
  await initPoseidon();
  console.log("✓ Poseidon initialized");
  
  const zeros = computeZeros(MERKLE_DEPTH);
  
  console.log("\nZero hashes (first 5):");
  for (let i = 0; i <= 5; i++) {
    console.log(`  zeros[${i}] = ${zeros[i]}`);
  }
  console.log(`  zeros[${MERKLE_DEPTH}] (root) = ${zeros[MERKLE_DEPTH]}`);
  
  // Test with single commitment
  const commitment = 12345678901234567890n;
  const batchSize = 1;
  const startIndex = 0;
  
  // Old root = empty tree root
  const oldRoot = zeros[MERKLE_DEPTH];
  
  // Compute new root by inserting commitment at index 0
  // For index 0, all path indices are 0 (always left child)
  // Path elements are zeros at each level
  let current = commitment;
  for (let i = 0; i < MERKLE_DEPTH; i++) {
    // At level i, we're the left child, sibling is zeros[i]
    current = poseidonHash([current, zeros[i]]);
  }
  const newRoot = current;
  
  // Path for index 0: siblings are zeros[0..depth-1]
  const pathElements = zeros.slice(0, MERKLE_DEPTH);
  
  const commitmentsHash = computeCommitmentsHash([commitment], batchSize);
  
  console.log(`\nTest case: Insert 1 commitment at index 0`);
  console.log(`  Commitment: ${commitment}`);
  console.log(`  Old root: ${oldRoot}`);
  console.log(`  New root: ${newRoot}`);
  console.log(`  Path[0]: ${pathElements[0]}`);
  console.log(`  Path[1]: ${pathElements[1]}`);
  console.log(`  Commitments hash: ${commitmentsHash}`);
  
  // Verify old tree manually
  console.log("\nVerifying old tree path (leaf=0):");
  let verify = 0n;
  for (let i = 0; i < MERKLE_DEPTH; i++) {
    // Index 0 means always left child (pathIndex = 0)
    verify = poseidonHash([verify, pathElements[i]]);
    if (i < 3) {
      console.log(`  Level ${i}: hash(${i===0 ? '0' : 'prev'}, zeros[${i}]) = ${verify}`);
    }
  }
  console.log(`  Final computed root: ${verify}`);
  console.log(`  Expected old root: ${oldRoot}`);
  console.log(`  Match: ${verify === oldRoot}`);
  
  if (verify !== oldRoot) {
    console.log("\n❌ Path verification failed - roots don't match");
    return;
  }
  
  // Pad to MAX_BATCH_SIZE
  const paddedCommitments = [commitment.toString()];
  const paddedPaths: string[][] = [pathElements.map(x => x.toString())];
  
  while (paddedCommitments.length < MAX_BATCH_SIZE) {
    paddedCommitments.push("0");
    paddedPaths.push(new Array(MERKLE_DEPTH).fill("0"));
  }
  
  const input = {
    oldRoot: oldRoot.toString(),
    newRoot: newRoot.toString(),
    startIndex: startIndex.toString(),
    batchSize: batchSize.toString(),
    commitmentsHash: commitmentsHash.toString(),
    commitments: paddedCommitments,
    pathElements: paddedPaths,
  };
  
  console.log(`\n⏳ Generating proof...`);
  
  try {
    const { proof, publicSignals } = await snarkjs.groth16.fullProve(
      input,
      CIRCUIT_WASM,
      CIRCUIT_ZKEY
    );
    
    console.log(`✓ Proof generated!`);
    
    const vk = require(VK_JSON);
    const isValid = await snarkjs.groth16.verify(vk, publicSignals, proof);
    
    console.log(`✅ Proof ${isValid ? 'verified' : 'FAILED'}!`);
    
  } catch (err: any) {
    console.error(`\n❌ Error:`, err.message);
  }
}

main();
