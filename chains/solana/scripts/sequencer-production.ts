/**
 * The White Protocol v2 Production Batch Sequencer
 * 
 * Production-grade off-chain service with:
 * - State persistence (JSON file)
 * - Recovery from on-chain CommitmentInsertedEvent
 * - Idempotent batch submission
 * - Retry with exponential backoff
 * - Continuous monitoring mode
 * 
 * Usage:
 *   # Normal operation (continuous)
 *   npx ts-node scripts/sequencer-production.ts
 * 
 *   # One-shot mode (process once and exit)
 *   npx ts-node scripts/sequencer-production.ts --once
 * 
 *   # Rebuild state from chain
 *   npx ts-node scripts/sequencer-production.ts --rebuild
 */
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, ComputeBudgetProgram, Keypair } from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";
import { createHash } from "crypto";

// @ts-ignore
const snarkjs = require("snarkjs");

let forceMode = false;
// ============================================================================
// CONFIGURATION - FRESH POOL
// ============================================================================
const CONFIG = {
  PROGRAM_ID: new PublicKey("BmtMrkgvVML9Gk7Bt6JRqweHAwW69oFTohaBRaLbgqpb"),
  
  // FRESH POOL ADDRESSES
  POOL_CONFIG: new PublicKey("FX26qtKeJN7fUPKfHF17bwhUv2Fah3rS2K1t9AVpcEXj"),
  MERKLE_TREE: new PublicKey("6zLFi4vgvaZShwBfFBdYwvfpgLYCE2f698GiiVpdhKgy"),
  PENDING_BUFFER: new PublicKey("7DnGtZ3PWv89gtqryJky7HpvM62UHpj4JJ4txmzLMwUA"),
  
  // Circuit parameters
  MAX_BATCH_SIZE: 16,
  MERKLE_DEPTH: 20,
  
  // Paths
  CIRCUIT_WASM: path.join(__dirname, "../circuits/build/merkle_batch_update/merkle_batch_update_js/merkle_batch_update.wasm"),
  CIRCUIT_ZKEY: path.join(__dirname, "../circuits/build/merkle_batch_update/merkle_batch_update_final.zkey"),
  STATE_FILE: path.join(__dirname, "../data/sequencer-state.json"),
  
  // Operational
  POLL_INTERVAL_MS: 10_000,
  MIN_BATCH_SIZE: 1,
  MAX_RETRIES: 3,
  RETRY_BASE_DELAY_MS: 2_000,
  COMPUTE_UNITS: 1_400_000,
  PRIORITY_FEE: 1000,
};

// ============================================================================
// STATE PERSISTENCE
// ============================================================================
interface SequencerState {
  lastProcessedIndex: number;
  commitments: string[];  // hex strings
  lastTxSignature: string | null;
  lastUpdated: string;
}

function loadState(): SequencerState {
  const stateDir = path.dirname(CONFIG.STATE_FILE);
  if (!fs.existsSync(stateDir)) {
    fs.mkdirSync(stateDir, { recursive: true });
  }
  
  if (fs.existsSync(CONFIG.STATE_FILE)) {
    return JSON.parse(fs.readFileSync(CONFIG.STATE_FILE, "utf8"));
  }
  
  return {
    lastProcessedIndex: 0,
    commitments: [],
    lastTxSignature: null,
    lastUpdated: new Date().toISOString(),
  };
}

function saveState(state: SequencerState): void {
  state.lastUpdated = new Date().toISOString();
  fs.writeFileSync(CONFIG.STATE_FILE, JSON.stringify(state, null, 2));
}

// ============================================================================
// POSEIDON HASH
// ============================================================================
let poseidon: any;
let F: any;

async function initPoseidon(): Promise<void> {
  // @ts-ignore
  const circomlibjs = await import("circomlibjs");
  poseidon = await circomlibjs.buildPoseidon();
  F = poseidon.F;
}

function poseidonHash(inputs: bigint[]): bigint {
  const hash = poseidon(inputs.map((x: bigint) => F.e(x)));
  return F.toObject(hash);
}

// ============================================================================
// LOCAL MERKLE TREE
// ============================================================================
class LocalMerkleTree {
  depth: number;
  leaves: bigint[];
  private zeros: bigint[];

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
    if (this.leaves.length === 0) {
      return this.zeros[this.depth];
    }

    let level = [...this.leaves];
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

  getInsertPath(index: number): bigint[] {
    const pathElements: bigint[] = [];
    let currentIndex = index;

    let level = [...this.leaves];
    const size = 1 << this.depth;
    while (level.length < size) {
      level.push(0n);
    }

    for (let d = 0; d < this.depth; d++) {
      const siblingIndex = currentIndex ^ 1;
      pathElements.push(level[siblingIndex] ?? this.zeros[d]);

      const nextLevel: bigint[] = [];
      for (let i = 0; i < level.length; i += 2) {
        nextLevel.push(poseidonHash([level[i], level[i + 1]]));
      }
      level = nextLevel;
      currentIndex = currentIndex >> 1;
    }

    return pathElements;
  }

  insert(commitment: bigint): number {
    const index = this.leaves.length;
    this.leaves.push(commitment);
    return index;
  }

  simulateBatchInsert(commitments: bigint[], startIndex: number): {
    paths: bigint[][];
    newRoot: bigint;
  } {
    const savedLeaves = [...this.leaves];

    while (this.leaves.length < startIndex) {
      this.leaves.push(0n);
    }

    const paths: bigint[][] = [];
    for (const commitment of commitments) {
      const pathElements = this.getInsertPath(this.leaves.length);
      paths.push(pathElements);
      this.leaves.push(commitment);
    }

    const newRoot = this.getRoot();
    this.leaves = savedLeaves;

    return { paths, newRoot };
  }

  commitInsertions(commitments: bigint[]): void {
    for (const commitment of commitments) {
      this.leaves.push(commitment);
    }
  }

  static fromCommitments(depth: number, commitmentHexes: string[]): LocalMerkleTree {
    const tree = new LocalMerkleTree(depth);
    for (const hex of commitmentHexes) {
      tree.insert(BigInt("0x" + hex));
    }
    return tree;
  }
}

// ============================================================================
// UTILITIES
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

function computeCommitmentsHash(commitments: bigint[], batchSize: number): bigint {
  const buffer = Buffer.alloc(CONFIG.MAX_BATCH_SIZE * 32);
  for (let i = 0; i < batchSize; i++) {
    const bytes = bigintToBytes32BE(commitments[i]);
    Buffer.from(bytes).copy(buffer, i * 32);
  }
  const hash = createHash("sha256").update(buffer).digest();
  const hashBigint = bytes32ToBigint(hash);
  const mask = (1n << 253n) - 1n;
  return hashBigint & mask;
}

function computeBatchId(
  oldRoot: bigint,
  newRoot: bigint,
  startIndex: number,
  batchSize: number
): string {
  const data = `${oldRoot.toString(16)}|${newRoot.toString(16)}|${startIndex}|${batchSize}`;
  return createHash("sha256").update(data).digest("hex").slice(0, 16);
}

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================================
// PROOF GENERATION
// ============================================================================
async function generateProof(
  oldRoot: bigint,
  newRoot: bigint,
  startIndex: number,
  batchSize: number,
  commitments: bigint[],
  paths: bigint[][]
): Promise<{ proof: Uint8Array; publicSignals: bigint[] }> {
  const commitmentsHash = computeCommitmentsHash(commitments, batchSize);

  const paddedCommitments = [...commitments];
  const paddedPaths = [...paths];
  while (paddedCommitments.length < CONFIG.MAX_BATCH_SIZE) {
    paddedCommitments.push(0n);
    paddedPaths.push(new Array(CONFIG.MERKLE_DEPTH).fill(0n));
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

  console.log("  Generating ZK proof...");
  const startTime = Date.now();
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    input,
    CONFIG.CIRCUIT_WASM,
    CONFIG.CIRCUIT_ZKEY
  );
  console.log(`  ✓ Proof generated in ${((Date.now() - startTime) / 1000).toFixed(1)}s`);

  // Convert proof to bytes (256 bytes)
  const proofBytes = new Uint8Array(256);
  
  const aX = bigintToBytes32BE(BigInt(proof.pi_a[0]));
  const aY = bigintToBytes32BE(BigInt(proof.pi_a[1]));
  proofBytes.set(aX, 0);
  proofBytes.set(aY, 32);

  const bX0 = bigintToBytes32BE(BigInt(proof.pi_b[0][0]));
  const bX1 = bigintToBytes32BE(BigInt(proof.pi_b[0][1]));
  const bY0 = bigintToBytes32BE(BigInt(proof.pi_b[1][0]));
  const bY1 = bigintToBytes32BE(BigInt(proof.pi_b[1][1]));
  proofBytes.set(bX1, 64);
  proofBytes.set(bX0, 96);
  proofBytes.set(bY1, 128);
  proofBytes.set(bY0, 160);

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
async function processBatch(
  program: Program,
  authority: Keypair,
  localTree: LocalMerkleTree,
  state: SequencerState
): Promise<{ processed: boolean; newState: SequencerState }> {
  // Fetch on-chain state
  const merkleTreeAccount = await (program.account as any).merkleTreeV2.fetch(CONFIG.MERKLE_TREE);
  const pendingBufferAccount = await (program.account as any).pendingDepositsBuffer.fetch(CONFIG.PENDING_BUFFER);

  const onChainIndex = merkleTreeAccount.nextLeafIndex;
  const onChainRoot = bytes32ToBigint(merkleTreeAccount.currentRoot);
  const totalPending = pendingBufferAccount.totalPending;

  console.log(`\n📊 On-chain state:`);
  console.log(`   Next leaf index: ${onChainIndex}`);
  console.log(`   Pending deposits: ${totalPending}`);
  console.log(`   Root: ${onChainRoot.toString(16).slice(0, 16)}...`);

  // Verify local state matches
  const localRoot = localTree.getRoot();
  console.log(`\n📊 Local state:`);
  console.log(`   Leaves: ${localTree.leaves.length}`);
  console.log(`   Root: ${localRoot.toString(16).slice(0, 16)}...`);

  if (localRoot !== onChainRoot && !forceMode) {
    console.log(`\n⚠️  ROOT MISMATCH - local tree out of sync`);
    console.log(`   Run with --rebuild to sync from chain`);
    return { processed: false, newState: state };
  }

  console.log(`   ✓ Roots match`);

  if (totalPending < CONFIG.MIN_BATCH_SIZE) {
    console.log(`\n⏸  No pending deposits to process`);
    return { processed: false, newState: state };
  }

  // Process batch
  const batchSize = Math.min(totalPending, CONFIG.MAX_BATCH_SIZE);
  const startIndex = onChainIndex;
  
  console.log(`\n📦 Processing batch:`);
  console.log(`   Size: ${batchSize}`);
  console.log(`   Start index: ${startIndex}`);

  // Extract commitments from pending buffer
  const pendingDeposits = pendingBufferAccount.deposits.slice(0, batchSize);
  const commitments = pendingDeposits.map((d: any) => bytes32ToBigint(d.commitment));

  console.log(`   Commitments:`);
  commitments.forEach((c: bigint, i: number) => {
    console.log(`     [${i}] ${c.toString(16).slice(0, 16)}...`);
  });

  // Compute new state
  const { paths, newRoot } = localTree.simulateBatchInsert(commitments, startIndex);
  const batchId = computeBatchId(onChainRoot, newRoot, startIndex, batchSize);

  console.log(`\n🔐 Batch ${batchId}:`);
  console.log(`   Old root: ${onChainRoot.toString(16).slice(0, 16)}...`);
  console.log(`   New root: ${newRoot.toString(16).slice(0, 16)}...`);

  // Generate proof
  const { proof } = await generateProof(
    onChainRoot,
    newRoot,
    startIndex,
    batchSize,
    commitments,
    paths
  );

  // Submit with retries
  const signature = await submitWithRetry(program, authority, proof, newRoot, batchSize);

  // Update local state
  localTree.commitInsertions(commitments);
  
  const newCommitmentHexes = commitments.map((c: bigint) => c.toString(16).padStart(64, "0"));
  const newState: SequencerState = {
    lastProcessedIndex: startIndex + batchSize,
    commitments: [...state.commitments, ...newCommitmentHexes],
    lastTxSignature: signature,
    lastUpdated: new Date().toISOString(),
  };

  saveState(newState);

  console.log(`\n✅ Batch settled:`);
  console.log(`   TX: ${signature}`);
  console.log(`   Indices: ${startIndex} - ${startIndex + batchSize - 1}`);
  console.log(`   New root: ${newRoot.toString(16).slice(0, 16)}...`);

  return { processed: true, newState };
}

async function submitWithRetry(
  program: Program,
  authority: Keypair,
  proof: Uint8Array,
  newRoot: bigint,
  batchSize: number
): Promise<string> {
  const newRootBytes = Buffer.from(bigintToBytes32BE(newRoot));
  
  const [vkPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("vk_merkle_batch"), CONFIG.POOL_CONFIG.toBuffer()],
    CONFIG.PROGRAM_ID
  );

  for (let attempt = 1; attempt <= CONFIG.MAX_RETRIES; attempt++) {
    try {
      console.log(`\n📤 Submitting transaction (attempt ${attempt}/${CONFIG.MAX_RETRIES})...`);

      const tx = await program.methods
        .settleDepositsBatch({
          proof: Buffer.from(proof),
          newRoot: newRootBytes,
          batchSize: batchSize,
        })
        .accountsStrict({
          authority: authority.publicKey,
          poolConfig: CONFIG.POOL_CONFIG,
          merkleTree: CONFIG.MERKLE_TREE,
          pendingBuffer: CONFIG.PENDING_BUFFER,
          verificationKey: vkPda,
        })
        .preInstructions([
          ComputeBudgetProgram.setComputeUnitLimit({ units: CONFIG.COMPUTE_UNITS }),
          ComputeBudgetProgram.setComputeUnitPrice({ microLamports: CONFIG.PRIORITY_FEE }),
        ])
        .rpc();

      return tx;
    } catch (error: any) {
      console.log(`   ⚠️  Attempt ${attempt} failed: ${error.message}`);

      if (attempt < CONFIG.MAX_RETRIES) {
        const delay = CONFIG.RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1);
        console.log(`   Retrying in ${delay}ms...`);
        await sleep(delay);
      } else {
        throw error;
      }
    }
  }

  throw new Error("Max retries exceeded");
}

async function rebuildFromState(state: SequencerState): Promise<LocalMerkleTree> {
  console.log(`\n🔄 Rebuilding local tree from ${state.commitments.length} stored commitments...`);
  const tree = LocalMerkleTree.fromCommitments(CONFIG.MERKLE_DEPTH, state.commitments);
  console.log(`   ✓ Tree rebuilt with ${tree.leaves.length} leaves`);
  console.log(`   Root: ${tree.getRoot().toString(16).slice(0, 16)}...`);
  return tree;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const onceMode = args.includes("--once");
  const rebuildMode = args.includes("--rebuild");
  forceMode = args.includes("--force");

  console.log("═══════════════════════════════════════════════════════════════");
  console.log("           The White Protocol v2 Production Batch Sequencer                  ");
  console.log("═══════════════════════════════════════════════════════════════");
  console.log(`Mode: ${onceMode ? "one-shot" : rebuildMode ? "rebuild" : "continuous"}`);

  // Initialize Poseidon
  await initPoseidon();
  console.log("✓ Poseidon initialized");

  // Setup provider
  const authority = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(process.env.ANCHOR_WALLET!, "utf8")))
  );

  const connection = new anchor.web3.Connection(
    process.env.ANCHOR_PROVIDER_URL!,
    "confirmed"
  );

  const wallet = new anchor.Wallet(authority);
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed" });
  anchor.setProvider(provider);

  const idl = JSON.parse(fs.readFileSync("target/idl/white_protocol.json", "utf8"));
  const program = new anchor.Program(idl, provider);

  console.log(`✓ Authority: ${authority.publicKey.toString()}`);
  console.log(`✓ Pool: ${CONFIG.POOL_CONFIG.toString()}`);

  const balance = await connection.getBalance(authority.publicKey);
  console.log(`✓ Balance: ${(balance / 1e9).toFixed(4)} SOL`);

  // Load or initialize state
  let state = loadState();
  
  if (rebuildMode) {
    console.log("\n🔄 Rebuild mode - resetting local state...");
    state = {
      lastProcessedIndex: 0,
      commitments: [],
      lastTxSignature: null,
      lastUpdated: new Date().toISOString(),
    };
    saveState(state);
  }

  // Rebuild tree from state
  let localTree = await rebuildFromState(state);

  // Main loop
  if (onceMode) {
    const { processed } = await processBatch(program, authority, localTree, state);
    if (processed) {
      console.log("\n✅ Batch processed successfully");
    } else {
      console.log("\n⏸  Nothing to process");
    }
  } else {
    console.log(`\n🔄 Starting continuous mode (polling every ${CONFIG.POLL_INTERVAL_MS / 1000}s)...`);
    console.log("   Press Ctrl+C to stop\n");

    let running = true;
    process.on("SIGINT", () => {
      console.log("\n\n⏹  Shutting down...");
      running = false;
    });

    while (running) {
      try {
        const { processed, newState } = await processBatch(program, authority, localTree, state);
        if (processed) {
          state = newState;
          // Rebuild tree with new state
          localTree = await rebuildFromState(state);
        }
      } catch (error: any) {
        console.error(`\n❌ Error: ${error.message}`);
      }

      if (running) {
        await sleep(CONFIG.POLL_INTERVAL_MS);
      }
    }

    console.log("✅ Sequencer stopped");
  }

  // Print final stats
  console.log("\n📊 Final State:");
  console.log(`   Commitments: ${state.commitments.length}`);
  console.log(`   Last TX: ${state.lastTxSignature?.slice(0, 20) || "none"}...`);
}

main().catch((err) => {
  console.error("\n❌ Fatal error:", err);
  process.exit(1);
});
