/**
 * The White Protocol v2 Batch Sequencer
 * 
 * Off-chain service that:
 * 1. Monitors pending deposits buffer
 * 2. Computes Merkle paths locally
 * 3. Generates Groth16 proofs
 * 4. Submits settle_deposits_batch transactions
 * 
 * Usage: npx ts-node scripts/sequencer.ts
 */

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, ComputeBudgetProgram } from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";
import { createHash } from "crypto";

// @ts-ignore
const snarkjs = require("snarkjs");

// ============================================================================
// CONSTANTS
// ============================================================================

const PROGRAM_ID = new PublicKey("BmtMrkgvVML9Gk7Bt6JRqweHAwW69oFTohaBRaLbgqpb");
const POOL_CONFIG = new PublicKey("2Nz4ursFKF6HjtofSFZcn5n4jionZXRfEyPgprBERVqQ");
const MERKLE_TREE = new PublicKey("5PrZuZjt93CERcoe6NuNpuZoCGR15s1p2msH2xR7eryf");
const PENDING_BUFFER = new PublicKey("CwZNKy7oJUnyNPPrASRzLMfxvKTrpw3VSBk8ZHNewUw3");

const MAX_BATCH_SIZE = 16;
const MERKLE_DEPTH = 20;

const CIRCUIT_WASM = path.join(__dirname, "../circuits/build/merkle_batch_update/merkle_batch_update_js/merkle_batch_update.wasm");
const CIRCUIT_ZKEY = path.join(__dirname, "../circuits/build/merkle_batch_update/merkle_batch_update_final.zkey");

const VK_SEED = "vk_merkle_batch";

// ============================================================================
// POSEIDON HASH (matching circuit)
// ============================================================================

// Import circomlibjs for Poseidon
let poseidon: any;
let F: any;

async function initPoseidon() {
  const circomlibjs = await import("circomlibjs");
  poseidon = await circomlibjs.buildPoseidon();
  F = poseidon.F;
}

function poseidonHash(inputs: bigint[]): bigint {
  const hash = poseidon(inputs.map(x => F.e(x)));
  return F.toObject(hash);
}

// ============================================================================
// LOCAL MERKLE TREE
// ============================================================================

class LocalMerkleTree {
  depth: number;
  leaves: bigint[];
  zeros: bigint[];
  
  constructor(depth: number) {
    this.depth = depth;
    this.leaves = [];
    this.zeros = this.computeZeros();
  }
  
  private computeZeros(): bigint[] {
    const zeros: bigint[] = [0n];
    for (let i = 1; i <= this.depth; i++) {
      zeros[i] = poseidonHash([zeros[i - 1], zeros[i - 1]]);
    }
    return zeros;
  }
  
  getRoot(): bigint {
    return this.computeRoot(this.leaves.length);
  }
  
  private computeRoot(leafCount: number): bigint {
    if (leafCount === 0) {
      return this.zeros[this.depth];
    }
    
    let level = [...this.leaves];
    // Pad to power of 2
    const size = 1 << this.depth;
    while (level.length < size) {
      level.push(0n);
    }
    
    for (let d = 0; d < this.depth; d++) {
      const nextLevel: bigint[] = [];
      for (let i = 0; i < level.length; i += 2) {
        nextLevel.push(poseidonHash([level[i], level[i + 1]]));
      }
      level = nextLevel;
    }
    
    return level[0];
  }
  
  // Get path for inserting at index
  getInsertPath(index: number): bigint[] {
    const path: bigint[] = [];
    let currentIndex = index;
    
    // Build tree up to current state
    let level = [...this.leaves];
    const size = 1 << this.depth;
    while (level.length < size) {
      level.push(0n);
    }
    
    for (let d = 0; d < this.depth; d++) {
      const siblingIndex = currentIndex ^ 1;
      path.push(level[siblingIndex] ?? this.zeros[d]);
      
      const nextLevel: bigint[] = [];
      for (let i = 0; i < level.length; i += 2) {
        const left = level[i];
        const right = level[i + 1];
        nextLevel.push(poseidonHash([left, right]));
      }
      level = nextLevel;
      currentIndex = currentIndex >> 1;
    }
    
    return path;
  }
  
  insert(commitment: bigint): number {
    const index = this.leaves.length;
    this.leaves.push(commitment);
    return index;
  }
  
  // Simulate insertions and return intermediate roots + paths
  simulateBatchInsert(commitments: bigint[], startIndex: number): {
    paths: bigint[][];
    newRoot: bigint;
  } {
    const paths: bigint[][] = [];
    
    // Save current state
    const savedLeaves = [...this.leaves];
    
    // Ensure tree has leaves up to startIndex
    while (this.leaves.length < startIndex) {
      this.leaves.push(0n);
    }
    
    for (const commitment of commitments) {
      const path = this.getInsertPath(this.leaves.length);
      paths.push(path);
      this.leaves.push(commitment);
    }
    
    const newRoot = this.getRoot();
    
    // Restore state (sequencer updates only after tx confirms)
    this.leaves = savedLeaves;
    
    return { paths, newRoot };
  }
  
  // Commit insertions after successful tx
  commitInsertions(commitments: bigint[], startIndex: number) {
    while (this.leaves.length < startIndex) {
      this.leaves.push(0n);
    }
    for (const commitment of commitments) {
      this.leaves.push(commitment);
    }
  }
}

// ============================================================================
// PROOF GENERATION
// ============================================================================

function bigintToBytes32BE(bn: bigint): number[] {
  const hex = bn.toString(16).padStart(64, "0");
  const bytes: number[] = [];
  for (let i = 0; i < 64; i += 2) {
    bytes.push(parseInt(hex.substr(i, 2), 16));
  }
  return bytes;
}

function bytes32ToBigint(bytes: number[] | Uint8Array): bigint {
  let hex = "0x";
  for (const b of bytes) {
    hex += b.toString(16).padStart(2, "0");
  }
  return BigInt(hex);
}

// Compute sha256 hash matching circuit encoding
function computeCommitmentsHash(commitments: bigint[], batchSize: number): bigint {
  // Create buffer: MAX_BATCH_SIZE * 32 bytes
  const buffer = Buffer.alloc(MAX_BATCH_SIZE * 32);
  
  for (let i = 0; i < batchSize; i++) {
    const bytes = bigintToBytes32BE(commitments[i]);
    Buffer.from(bytes).copy(buffer, i * 32);
  }
  // Remaining slots are already 0
  
  const hash = createHash("sha256").update(buffer).digest();
  
  // Convert to field: take lower 253 bits
  const hashBigint = bytes32ToBigint(hash);
  const mask = (1n << 253n) - 1n;
  return hashBigint & mask;
}

async function generateProof(
  oldRoot: bigint,
  newRoot: bigint,
  startIndex: number,
  batchSize: number,
  commitments: bigint[],
  paths: bigint[][]
): Promise<{ proof: Uint8Array; publicSignals: bigint[] }> {
  
  const commitmentsHash = computeCommitmentsHash(commitments, batchSize);
  
  // Pad commitments and paths to MAX_BATCH_SIZE
  const paddedCommitments = [...commitments];
  const paddedPaths = [...paths];
  
  while (paddedCommitments.length < MAX_BATCH_SIZE) {
    paddedCommitments.push(0n);
    paddedPaths.push(new Array(MERKLE_DEPTH).fill(0n));
  }
  
  const input = {
    oldRoot: oldRoot.toString(),
    newRoot: newRoot.toString(),
    startIndex: startIndex.toString(),
    batchSize: batchSize.toString(),
    commitmentsHash: commitmentsHash.toString(),
    commitments: paddedCommitments.map(c => c.toString()),
    pathElements: paddedPaths.map(p => p.map(e => e.toString())),
  };
  
  console.log("Generating proof...");
  const startTime = Date.now();
  
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    input,
    CIRCUIT_WASM,
    CIRCUIT_ZKEY
  );
  
  console.log(`Proof generated in ${(Date.now() - startTime) / 1000}s`);
  
  // Convert proof to bytes (256 bytes: A + B + C)
  const proofBytes = new Uint8Array(256);
  
  // A (G1): 64 bytes
  const aX = bigintToBytes32BE(BigInt(proof.pi_a[0]));
  const aY = bigintToBytes32BE(BigInt(proof.pi_a[1]));
  proofBytes.set(aX, 0);
  proofBytes.set(aY, 32);
  
  // B (G2): 128 bytes - x_imag || x_real || y_imag || y_real
  const bX0 = bigintToBytes32BE(BigInt(proof.pi_b[0][0])); // real
  const bX1 = bigintToBytes32BE(BigInt(proof.pi_b[0][1])); // imag
  const bY0 = bigintToBytes32BE(BigInt(proof.pi_b[1][0])); // real
  const bY1 = bigintToBytes32BE(BigInt(proof.pi_b[1][1])); // imag
  proofBytes.set(bX1, 64);  // imag first
  proofBytes.set(bX0, 96);
  proofBytes.set(bY1, 128);
  proofBytes.set(bY0, 160);
  
  // C (G1): 64 bytes
  const cX = bigintToBytes32BE(BigInt(proof.pi_c[0]));
  const cY = bigintToBytes32BE(BigInt(proof.pi_c[1]));
  proofBytes.set(cX, 192);
  proofBytes.set(cY, 224);
  
  return {
    proof: proofBytes,
    publicSignals: publicSignals.map((s: string) => BigInt(s)),
  };
}

// ============================================================================
// MAIN SEQUENCER
// ============================================================================

interface PendingDeposit {
  commitment: number[];
  timestamp: bigint;
}

async function main() {
  console.log("🚀 The White Protocol v2 Batch Sequencer Starting...\n");
  
  // Initialize Poseidon
  await initPoseidon();
  console.log("✓ Poseidon initialized");
  
  // Setup Anchor
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  
  const idl = JSON.parse(fs.readFileSync("target/idl/white_protocol.json", "utf8"));
  const program = new Program(idl, provider);
  
  console.log(`✓ Connected to ${provider.connection.rpcEndpoint}`);
  console.log(`✓ Authority: ${provider.wallet.publicKey.toBase58()}`);
  
  // Initialize local Merkle tree
  const localTree = new LocalMerkleTree(MERKLE_DEPTH);

  // ✅ LOAD PAST COMMITMENTS FROM FILE
  const pastCommitmentsPath = path.join(__dirname, '..', 'past_commitments.json');
  
  if (fs.existsSync(pastCommitmentsPath)) {
    console.log('📂 Loading past commitments...');
    const pastData = JSON.parse(fs.readFileSync(pastCommitmentsPath, 'utf8'));
    
    for (const commitmentHex of pastData.commitments) {
      const commitment = BigInt('0x' + commitmentHex);
      localTree.insert(commitment);
      console.log(`   ✓ Preloaded commitment at index ${localTree.leaves.length - 1}`);
    }
    
    console.log(`✓ Local tree synced: ${localTree.leaves.length} past leaves loaded\n`);
  }
  
  // Load on-chain state
  console.log("");
  const merkleTreeAccount = await program.account.merkleTreeV2.fetch(MERKLE_TREE);
  const startIndex = merkleTreeAccount.nextLeafIndex;
  const onChainRoot = bytes32ToBigint(merkleTreeAccount.currentRoot);

  // 🐛 DEBUG: Verify local tree matches on-chain
  console.log("\n🐛 DEBUG - Tree State Comparison:");
  console.log("   Local leaves count:", localTree.leaves.length);
  const localRoot = localTree.getRoot();
  console.log("   Local root:   ", localRoot.toString(16).slice(0, 16) + "...");
  console.log("   On-chain root:", onChainRoot.toString(16).slice(0, 16) + "...");
  console.log("   Roots match:  ", localRoot === onChainRoot ? "✅ YES" : "❌ NO");
  if (localRoot !== onChainRoot) {
    console.log("\n   ❌ ROOT MISMATCH! Preloaded commitment or tree logic is wrong.");
    console.log("   Expected on-chain root but got different local root.");
  }
  
  console.log(`✓ On-chain state: nextLeafIndex=${startIndex}, root=${onChainRoot.toString(16).slice(0, 16)}...`);
  
  // Load pending buffer
  const pendingBufferAccount = await program.account.pendingDepositsBuffer.fetch(PENDING_BUFFER);
  const pendingDeposits: PendingDeposit[] = pendingBufferAccount.deposits;
  const totalPending = pendingBufferAccount.totalPending;
  
  console.log(`✓ Pending deposits: ${totalPending}`);
  
  if (totalPending === 0) {
    console.log("\n⏸ No pending deposits. Exiting.");
    return;
  }
  
  // Determine batch size
  const batchSize = Math.min(totalPending, MAX_BATCH_SIZE);
  console.log(`\n📦 Processing batch of ${batchSize} deposits...`);
  
  // Extract commitments
  const commitments = pendingDeposits.slice(0, batchSize).map(d => 
    bytes32ToBigint(d.commitment)
  );
  
  console.log("Commitments:");
  commitments.forEach((c, i) => {
    console.log(`  [${i}] ${c.toString(16).slice(0, 16)}...`);
  });
  
  // Sync local tree to on-chain state (simplified: assume fresh tree)
  // In production, load from persistent storage or rebuild from events
  
  // Simulate batch insert to get paths and new root
  const { paths, newRoot } = localTree.simulateBatchInsert(commitments, startIndex);
  
  console.log(`\nOld root: ${onChainRoot.toString(16).slice(0, 16)}...`);
  console.log(`New root: ${newRoot.toString(16).slice(0, 16)}...`);
  
  // Generate proof
  const { proof, publicSignals } = await generateProof(
    onChainRoot,
    newRoot,
    startIndex,
    batchSize,
    commitments,
    paths
  );
  
  console.log("\nPublic signals:");
  publicSignals.forEach((s, i) => {
    console.log(`  [${i}] ${s.toString(16).slice(0, 16)}...`);
  });
  
  // Derive VK PDA
  const [vkPda] = PublicKey.findProgramAddressSync(
    [Buffer.from(VK_SEED), POOL_CONFIG.toBuffer()],
    PROGRAM_ID
  );
  
  // Build transaction
  console.log("\n📤 Submitting transaction...");
  
  const newRootBytes = Buffer.from(bigintToBytes32BE(newRoot));
  
  const tx = await program.methods
    .settleDepositsBatch({
      proof: Buffer.from(proof),
      newRoot: newRootBytes,
      batchSize: batchSize,
    })
    .accounts({
      authority: provider.wallet.publicKey,
      poolConfig: POOL_CONFIG,
      merkleTree: MERKLE_TREE,
      pendingBuffer: PENDING_BUFFER,
      verificationKey: vkPda,
    })
    .preInstructions([
      ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1000 }),
    ])
    .rpc();
  
  console.log(`✅ Transaction confirmed: ${tx}`);
  
  // Commit to local tree after success
  localTree.commitInsertions(commitments, startIndex);
  
  console.log(`\n✅ Batch settled successfully!`);
  console.log(`   - Deposits processed: ${batchSize}`);
  console.log(`   - New leaf indices: ${startIndex} to ${startIndex + batchSize - 1}`);
  console.log(`   - New root: ${newRoot.toString(16).slice(0, 16)}...`);
}

main().catch((err) => {
  console.error("❌ Sequencer error:", err);
  process.exit(1);
});
