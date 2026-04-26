/**
 * The White Protocol Relayer API Extensions
 * 
 * Handles ALL heavy cryptographic operations server-side:
 * - Proof generation (deposit, withdraw)
 * - Poseidon hashing for commitments
 * - Merkle tree operations
 * - Asset ID computation
 * 
 * This file should be integrated into your existing relayer at:
 * relayer/src/api-extensions.ts
 * 
 * @module relayer/api-extensions
 */

import express, { Request, Response, Router, NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import { PublicKey, Connection } from '@solana/web3.js';
import { BorshCoder, EventParser } from '@coral-xyz/anchor';
import * as snarkjs from 'snarkjs';
import * as fs from 'fs';
import * as path from 'path';
import { keccak_256 } from '@noble/hashes/sha3';
import { logger } from './logger';
import { loadMerkleTreeState, saveMerkleTreeState, loadPendingState, savePendingState, loadSettledCommitments, saveSettledCommitments } from './state-store';
import { withRetry } from './retry';
import { TtlCache } from './cache/ttl-cache';
import * as crypto from 'crypto';

// =============================================================================
// CONFIGURATION
// =============================================================================

interface ApiExtensionsConfig {
  /** Path to circuits directory */
  circuitsPath: string;
  /** Solana RPC endpoint */
  rpcEndpoint: string;
  /** Pool configuration pubkey */
  poolConfig: PublicKey;
  /** Program ID */
  programId: PublicKey;
  /** Merkle tree depth */
  treeDepth: number;
}

// BN254 scalar field order
const BN254_FIELD_ORDER = BigInt(
  '21888242871839275222246405745257275088548364400416034343698204186575808495617'
);

// Poseidon constants for 2-input hash (precomputed for BN254)
// These match circomlibjs implementation
const POSEIDON_C: bigint[] = [];
const POSEIDON_M: bigint[][] = [];

// =============================================================================
// POSEIDON HASH IMPLEMENTATION
// =============================================================================

/**
 * Initialize Poseidon constants (loaded once at startup)
 */
let poseidonInitialized = false;
let poseidonHashFn: ((inputs: bigint[]) => bigint) | null = null;

async function initPoseidon(): Promise<void> {
  if (poseidonInitialized) return;
  
  try {
    // Use circomlibjs for Poseidon - same as SDK
    const circomlibjs = await import('circomlibjs');
    const poseidon = await circomlibjs.buildPoseidon();
    
    poseidonHashFn = (inputs: bigint[]): bigint => {
      const hash = poseidon(inputs.map(i => i.toString()));
      return BigInt(poseidon.F.toString(hash));
    };
    
    poseidonInitialized = true;
    logger.info('Poseidon hash initialized');
  } catch (err) {
    logger.error('Failed to initialize Poseidon', { error: String(err) });
    throw new Error('Poseidon initialization failed');
  }
}

function poseidonHash(inputs: bigint[]): bigint {
  if (!poseidonHashFn) {
    throw new Error('Poseidon not initialized. Call initPoseidon() first.');
  }
  return poseidonHashFn(inputs);
}

// =============================================================================
// MERKLE TREE
// =============================================================================

/**
 * Server-side Merkle Tree implementation
 */
/**
 * Sparse incremental Merkle tree.
 * 
 * Stores only non-zero nodes in a Map, using level:index keys.
 * Updates are O(depth) per insertion. Path queries are O(depth).
 * This avoids the O(2^depth) memory blowup of naive implementations.
 */
class ServerMerkleTree {
  private depth: number;
  private leaves: bigint[];
  private zeros: bigint[];
  // Sparse storage: only non-zero nodes are stored.
  // Key format: "level:index" → hash value
  private nodes: Map<string, bigint> = new Map();
  
  constructor(depth: number = 20) {
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
  
  private nodeKey(level: number, index: number): string {
    return `${level}:${index}`;
  }
  
  private getNode(level: number, index: number): bigint {
    return this.nodes.get(this.nodeKey(level, index)) ?? this.zeros[level];
  }
  
  private setNode(level: number, index: number, value: bigint): void {
    const key = this.nodeKey(level, index);
    if (value === this.zeros[level]) {
      this.nodes.delete(key);
    } else {
      this.nodes.set(key, value);
    }
  }
  
  getRoot(): bigint {
    return this.getNode(this.depth, 0);
  }
  
  /**
   * Incrementally update the path from a leaf to the root.
   * Correctly handles out-of-order insertions because it reads
   * the CURRENT sibling hash at each level (which may have been
   * set by a previous insertion).
   */
  private updatePath(leafIndex: number, commitment: bigint): void {
    let currentHash = commitment;
    let currentIndex = leafIndex;
    
    for (let d = 0; d < this.depth; d++) {
      this.setNode(d, currentIndex, currentHash);
      
      const siblingIndex = currentIndex ^ 1;
      const siblingHash = this.getNode(d, siblingIndex);
      
      if (currentIndex & 1) {
        // Right child
        currentHash = poseidonHash([siblingHash, currentHash]);
      } else {
        // Left child
        currentHash = poseidonHash([currentHash, siblingHash]);
      }
      
      currentIndex = currentIndex >> 1;
    }
    
    // Set root
    this.setNode(this.depth, 0, currentHash);
  }
  
  getMerklePath(index: number): { pathElements: bigint[]; pathIndices: number[] } {
    if (index < 0 || index >= (1 << this.depth)) {
      throw new Error(`Leaf index ${index} out of bounds for depth ${this.depth}`);
    }
    
    const pathElements: bigint[] = [];
    const pathIndices: number[] = [];
    let currentIndex = index;
    
    for (let d = 0; d < this.depth; d++) {
      const siblingIndex = currentIndex ^ 1;
      pathElements.push(this.getNode(d, siblingIndex));
      pathIndices.push(currentIndex & 1);
      currentIndex = currentIndex >> 1;
    }
    
    return { pathElements, pathIndices };
  }
  
  insert(commitment: bigint): number {
    const index = this.leaves.length;
    this.leaves.push(commitment);
    this.updatePath(index, commitment);
    return index;
  }
  
  insertAt(index: number, commitment: bigint): void {
    const maxIndex = (1 << this.depth) - 1;
    if (index < 0 || index > maxIndex) {
      throw new Error(`Cannot insert at index ${index}: max is ${maxIndex}`);
    }
    while (this.leaves.length <= index) {
      this.leaves.push(0n);
    }
    this.leaves[index] = commitment;
    this.updatePath(index, commitment);
  }
  
  getLeafCount(): number {
    return this.leaves.length;
  }
  
  getLeaves(): bigint[] {
    return [...this.leaves];
  }
  
  setLeaves(leaves: bigint[]): void {
    this.leaves = [...leaves];
    this.nodes.clear();
    // Batch rebuild: only process non-zero subtrees
    for (let i = 0; i < this.leaves.length; i++) {
      if (this.leaves[i] !== 0n) {
        this.setNode(0, i, this.leaves[i]);
      }
    }
    for (let d = 0; d < this.depth; d++) {
      const nodeCount = 1 << (this.depth - d - 1);
      for (let i = 0; i < nodeCount; i++) {
        const leftKey = this.nodeKey(d, i * 2);
        const rightKey = this.nodeKey(d, i * 2 + 1);
        // Skip if both children are zero (not in map)
        if (!this.nodes.has(leftKey) && !this.nodes.has(rightKey)) {
          continue;
        }
        const left = this.getNode(d, i * 2);
        const right = this.getNode(d, i * 2 + 1);
        const parent = poseidonHash([left, right]);
        this.setNode(d + 1, i, parent);
      }
    }
  }

  /**
   * Simulate inserting a batch of commitments without mutating the tree.
   * Returns the Merkle paths for each insertion and the new root.
   * Used for off-chain ZK proof generation.
   */
  simulateBatchInsert(commitments: bigint[], startIndex: number): { paths: bigint[][]; newRoot: bigint } {
    const savedLeaves = [...this.leaves];
    const savedNodes = new Map(this.nodes);

    while (this.leaves.length < startIndex) {
      this.leaves.push(0n);
    }

    const paths: bigint[][] = [];
    for (const commitment of commitments) {
      const index = this.leaves.length;
      const { pathElements } = this.getMerklePath(index);
      paths.push(pathElements);
      this.insert(commitment);
    }

    const newRoot = this.getRoot();
    this.leaves = savedLeaves;
    this.nodes = savedNodes;

    return { paths, newRoot };
  }
}

// =============================================================================
// PROOF SERIALIZATION
// =============================================================================

function bigIntToHex(value: bigint): string {
  return value.toString(16).padStart(64, '0');
}

function hexToBytes32(hex: string): Uint8Array {
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return bytes;
}

function feToBytes32BE(value: bigint): Uint8Array {
  // Do NOT reduce modulo scalar order — proof coordinates are base field elements.
  // Also used for Merkle roots and commitments which must preserve full base-field representation.
  const hex = value.toString(16).padStart(64, '0');
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function serializeGroth16Proof(proof: any): Uint8Array {
  const proofBytes = new Uint8Array(256);
  
  // A point (G1): x, y - 64 bytes
  proofBytes.set(feToBytes32BE(BigInt(proof.pi_a[0])), 0);
  proofBytes.set(feToBytes32BE(BigInt(proof.pi_a[1])), 32);
  
  // B point (G2): 128 bytes - EIP-197 style (imag, real)
  proofBytes.set(feToBytes32BE(BigInt(proof.pi_b[0][1])), 64);
  proofBytes.set(feToBytes32BE(BigInt(proof.pi_b[0][0])), 96);
  proofBytes.set(feToBytes32BE(BigInt(proof.pi_b[1][1])), 128);
  proofBytes.set(feToBytes32BE(BigInt(proof.pi_b[1][0])), 160);
  
  // C point (G1): x, y - 64 bytes
  proofBytes.set(feToBytes32BE(BigInt(proof.pi_c[0])), 192);
  proofBytes.set(feToBytes32BE(BigInt(proof.pi_c[1])), 224);
  
  return proofBytes;
}

/** Maximum batch size — must match circuit compilation */
const MAX_BATCH_SIZE = 1;

/**
 * Compute SHA-256 hash of padded commitments, masked to 253 bits.
 * Matches on-chain commitmentsHash computation.
 */
function computeCommitmentsHash(commitments: bigint[], batchSize: number): bigint {
  const buffer = Buffer.alloc(MAX_BATCH_SIZE * 32);
  for (let i = 0; i < batchSize; i++) {
    const bytes = feToBytes32BE(commitments[i]);
    buffer.set(bytes, i * 32);
  }
  const hash = crypto.createHash('sha256').update(buffer).digest();
  const hashBigint = bytesToBigIntBE(hash);
  const mask = (1n << 253n) - 1n;
  return hashBigint & mask;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

function bytesToBigIntBE(bytes: Uint8Array): bigint {
  let result = 0n;
  for (const byte of bytes) {
    result = (result << 8n) | BigInt(byte);
  }
  return result;
}

function requireAccountSize(data: Buffer | Uint8Array, minSize: number, accountName: string): void {
  if (data.length < minSize) {
    throw new Error(`${accountName} account too small: expected at least ${minSize} bytes, got ${data.length}`);
  }
}

interface ParsedMerkleTreeAccount {
  pool: PublicKey;
  depth: number;
  nextLeafIndex: number;
  currentRoot: bigint;
  currentRootBytes: Uint8Array;
  rootHistoryIndex: number;
  rootHistorySize: number;
  totalLeaves: string;
  lastInsertionAt: string;
  version: number;
}

interface ParsedPendingDeposit {
  commitment: bigint;
  commitmentBytes: Uint8Array;
  timestamp: string;
}

interface ParsedPendingBufferAccount {
  pool: PublicKey;
  deposits: ParsedPendingDeposit[];
  totalPending: number;
  lastBatchAt: string;
  totalBatchesProcessed: string;
  totalDepositsBatched: string;
  bump: number;
  version: number;
}

function parseMerkleTreeAccount(data: Buffer): ParsedMerkleTreeAccount {
  requireAccountSize(data, 77, 'MerkleTree');

  let offset = 8; // Anchor discriminator
  const pool = new PublicKey(data.subarray(offset, offset + 32));
  offset += 32;

  const depth = data[offset];
  offset += 1;

  const nextLeafIndex = data.readUInt32LE(offset);
  offset += 4;

  const currentRootBytes = data.subarray(offset, offset + 32);
  const currentRoot = bytesToBigIntBE(currentRootBytes);
  offset += 32;

  requireAccountSize(data, offset + 4, 'MerkleTree.root_history');
  const rootHistoryLen = data.readUInt32LE(offset);
  offset += 4 + rootHistoryLen * 32;

  requireAccountSize(data, offset + 4, 'MerkleTree.root_history_metadata');
  const rootHistoryIndex = data.readUInt16LE(offset);
  offset += 2;
  const rootHistorySize = data.readUInt16LE(offset);
  offset += 2;

  requireAccountSize(data, offset + 4, 'MerkleTree.filled_subtrees');
  const filledSubtreesLen = data.readUInt32LE(offset);
  offset += 4 + filledSubtreesLen * 32;

  requireAccountSize(data, offset + 4, 'MerkleTree.zeros');
  const zerosLen = data.readUInt32LE(offset);
  offset += 4 + zerosLen * 32;

  requireAccountSize(data, offset + 17, 'MerkleTree.trailing_fields');
  const totalLeaves = data.readBigUInt64LE(offset).toString();
  offset += 8;
  const lastInsertionAt = data.readBigInt64LE(offset).toString();
  offset += 8;
  const version = data[offset];

  return {
    pool,
    depth,
    nextLeafIndex,
    currentRoot,
    currentRootBytes: Uint8Array.from(currentRootBytes),
    rootHistoryIndex,
    rootHistorySize,
    totalLeaves,
    lastInsertionAt,
    version,
  };
}

function parsePendingBufferAccount(data: Buffer): ParsedPendingBufferAccount {
  requireAccountSize(data, 44, 'PendingDepositsBuffer');

  let offset = 8; // Anchor discriminator
  const pool = new PublicKey(data.subarray(offset, offset + 32));
  offset += 32;

  const depositsLen = data.readUInt32LE(offset);
  offset += 4;

  requireAccountSize(data, offset + depositsLen * 40 + 30, 'PendingDepositsBuffer.deposits');
  const deposits: ParsedPendingDeposit[] = [];
  for (let i = 0; i < depositsLen; i++) {
    const commitmentBytes = data.subarray(offset, offset + 32);
    deposits.push({
      commitment: bytesToBigIntBE(commitmentBytes),
      commitmentBytes: Uint8Array.from(commitmentBytes),
      timestamp: data.readBigInt64LE(offset + 32).toString(),
    });
    offset += 40;
  }

  const totalPending = data.readUInt32LE(offset);
  offset += 4;
  const lastBatchAt = data.readBigInt64LE(offset).toString();
  offset += 8;
  const totalBatchesProcessed = data.readBigUInt64LE(offset).toString();
  offset += 8;
  const totalDepositsBatched = data.readBigUInt64LE(offset).toString();
  offset += 8;
  const bump = data[offset];
  offset += 1;
  const version = data[offset];

  return {
    pool,
    deposits,
    totalPending,
    lastBatchAt,
    totalBatchesProcessed,
    totalDepositsBatched,
    bump,
    version,
  };
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return bytes;
}

// =============================================================================
// ASSET ID COMPUTATION
// =============================================================================

/**
 * Compute asset ID from mint address
 * Matches on-chain: 0x00 || keccak256("white:asset_id:v1" || mint)[0..31]
 */
function computeAssetId(mint: PublicKey): Uint8Array {
  const prefix = new TextEncoder().encode('white:asset_id:v1');
  const mintBytes = mint.toBytes();
  const combined = new Uint8Array(prefix.length + mintBytes.length);
  combined.set(prefix);
  combined.set(mintBytes, prefix.length);
  
  const hash = keccak_256(combined);
  const assetId = new Uint8Array(32);
  assetId[0] = 0x00;
  assetId.set(hash.slice(0, 31), 1);
  
  return assetId;
}

function assetIdToBigInt(assetId: Uint8Array): bigint {
  let result = 0n;
  for (let i = 0; i < assetId.length; i++) {
    result = (result << 8n) | BigInt(assetId[i]);
  }
  return result;
}

// =============================================================================
// PUBKEY TO SCALAR
// =============================================================================

/**
 * Convert pubkey to scalar (matches on-chain encoding)
 * scalar_bytes = 0x00 || pubkey_bytes[0..31]
 */
function pubkeyToScalar(pubkey: PublicKey): bigint {
  const bytes = pubkey.toBytes();
  const scalarBytes = new Uint8Array(32);
  scalarBytes[0] = 0;
  for (let i = 0; i < 31; i++) {
    scalarBytes[i + 1] = bytes[i];
  }
  
  let result = 0n;
  for (let i = 0; i < 32; i++) {
    result = (result << 8n) | BigInt(scalarBytes[i]);
  }
  return result;
}

// =============================================================================
// INPUT VALIDATION HELPERS
// =============================================================================

function isValidBigIntString(value: unknown): boolean {
  if (typeof value !== 'string' && typeof value !== 'number') return false;
  const str = String(value).trim();
  if (str.length === 0 || str.length > 128) return false;
  return /^-?\d+$/.test(str);
}

function isValidUint32(value: unknown): boolean {
  if (typeof value !== 'number') return false;
  return Number.isInteger(value) && value >= 0 && value <= 0xffffffff;
}

function isValidSolanaPubkey(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 50) return false;
  try {
    new PublicKey(trimmed);
    return true;
  } catch {
    return false;
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise.finally(() => clearTimeout(timer)), timeoutPromise]);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// =============================================================================
// API EXTENSIONS CLASS
// =============================================================================

export class RelayerApiExtensions {
  private config: ApiExtensionsConfig;
  private connection: Connection;
  private router: Router;
  private merkleTree: ServerMerkleTree;
  
  // Circuit artifacts (loaded once)
  private depositWasm: Uint8Array | null = null;
  private depositZkey: Uint8Array | null = null;
  private depositVk: any = null;
  private withdrawWasm: Uint8Array | null = null;
  private withdrawZkey: Uint8Array | null = null;
  private withdrawVk: any = null;
  private withdrawV2Wasm: Uint8Array | null = null;
  private withdrawV2Zkey: Uint8Array | null = null;
  private withdrawV2Vk: any = null;
  private batchUpdateWasm: Uint8Array | null = null;
  private batchUpdateZkey: Uint8Array | null = null;
  private batchUpdateVk: any = null;
  
  // RPC response cache (5s TTL default)
  private rpcCache = new TtlCache<any>(5000);
  
  // Pending state tracking for sync
  private pendingState: {
    pendingCommitments: bigint[];
    nextLeafIndex: number;
  } = { pendingCommitments: [], nextLeafIndex: 0 };
  
  private syncIntervalId: ReturnType<typeof setInterval> | null = null;
  
  constructor(config: ApiExtensionsConfig) {
    this.config = config;
    this.connection = new Connection(config.rpcEndpoint, 'confirmed');
    this.router = express.Router();
    this.merkleTree = null as any; // Initialized in initialize()
    
    this.setupMiddleware();
    this.setupRoutes();
  }
  
  private setupMiddleware(): void {
    // Rate limiting (mirrors main relayer app)
    const globalLimiter = rateLimit({
      windowMs: 60 * 1000,
      max: 500,
      message: { error: 'Service temporarily unavailable' },
    });
    const perKeyLimiter = rateLimit({
      windowMs: 60 * 1000,
      max: 30,
      message: { error: 'Too many requests, please slow down' },
      keyGenerator: (req: Request) => req.ip || 'unknown',
    });
    this.router.use(globalLimiter);
    this.router.use(perKeyLimiter);
  }
  
  private requireAuth(req: Request, res: Response, next: NextFunction): void {
    const expected = process.env.SEQUENCER_AUTH_TOKEN;
    if (!expected) {
      res.status(500).json({ error: 'Server misconfiguration: missing SEQUENCER_AUTH_TOKEN' });
      return;
    }
    const provided = req.headers['x-sequencer-token'];
    if (!provided || provided !== expected) {
      res.status(401).json({ error: 'Unauthorized: invalid or missing X-Sequencer-Token header' });
      return;
    }
    next();
  }
  
  /**
   * Initialize the API extensions (load circuits, poseidon)
   */
  async initialize(): Promise<void> {
    logger.info('API Extensions initializing');
    
    // Initialize Poseidon
    await initPoseidon();
    
    // Reinitialize merkle tree now that poseidon is ready
    this.merkleTree = new ServerMerkleTree(this.config.treeDepth);

    // Primary recovery: rebuild from settled-commitments.json (authoritative)
    const settledState = loadSettledCommitments();
    if (settledState && settledState.commitments.length > 0) {
      logger.info('Rebuilding merkle tree from settled commitments', { count: settledState.commitments.length });
      for (const entry of settledState.commitments) {
        this.merkleTree.insertAt(entry.leafIndex, BigInt(entry.commitment));
      }
      logger.info('Restored merkle tree from settled commitments', {
        leafCount: this.merkleTree.getLeafCount(),
        root: this.merkleTree.getRoot().toString().slice(0, 20) + '...',
      });
    } else {
      // Fallback: restore from legacy merkle-tree-state.json
      const persistedMerkle = loadMerkleTreeState();
      if (persistedMerkle && persistedMerkle.leaves.length > 0) {
        this.merkleTree.setLeaves(persistedMerkle.leaves.map(l => BigInt(l)));
        logger.info('Restored merkle tree from disk', { leafCount: persistedMerkle.leaves.length });
      }
    }
    
    // Restore pending state
    const persistedPending = loadPendingState();
    if (persistedPending) {
      this.pendingState.pendingCommitments = persistedPending.pendingCommitments.map(c => BigInt(c));
      this.pendingState.nextLeafIndex = persistedPending.nextLeafIndex;
      logger.info('Restored pending state', {
        pendingCount: this.pendingState.pendingCommitments.length,
        nextLeafIndex: this.pendingState.nextLeafIndex,
      });
    }

    // Load circuit artifacts
    await this.loadCircuitArtifacts();

    // Sync merkle tree from chain after persisted state is restored so
    // settlements that happened while the service was down are detected.
    await this.syncMerkleTree();

    logger.info('API Extensions initialization complete');
  }
  
  /**
   * Start background sync loop (call from main relayer start())
   */
  startSyncLoop(intervalMs: number = 30000): void {
    if (this.syncIntervalId) {
      clearInterval(this.syncIntervalId);
    }
    this.syncIntervalId = setInterval(() => {
      this.syncMerkleTree().catch(err => {
        logger.error('Background sync failed', { error: String(err) });
      });
    }, intervalMs);
    logger.info('Started merkle tree sync loop', { intervalMs });
  }
  
  /**
   * Stop background sync loop
   */
  stopSyncLoop(): void {
    if (this.syncIntervalId) {
      clearInterval(this.syncIntervalId);
      this.syncIntervalId = null;
    }
  }
  
  private async loadCircuitArtifacts(): Promise<void> {
    const circuitsPath = this.config.circuitsPath;
    // Fallback path relative to dist/ (e.g. Render native Node.js)
    const fallbackPath = path.join(__dirname, '..', 'circuits', 'build');
    const pathsToTry = [circuitsPath, fallbackPath];

    const tryLoad = (relPath: string): string | null => {
      for (const base of pathsToTry) {
        const full = path.join(base, relPath);
        if (fs.existsSync(full)) return full;
      }
      return null;
    };
    
    // Load deposit circuit
    const depositWasm = tryLoad(path.join('deposit_js', 'deposit.wasm'));
    const depositZkey = tryLoad('deposit.zkey');
    const depositVk = tryLoad('deposit_vk.json');
    
    if (depositWasm) {
      this.depositWasm = new Uint8Array(fs.readFileSync(depositWasm));
      logger.info('Loaded deposit.wasm', { path: depositWasm });
    }
    if (depositZkey) {
      this.depositZkey = new Uint8Array(fs.readFileSync(depositZkey));
      logger.info('Loaded deposit.zkey', { path: depositZkey });
    }
    if (depositVk) {
      this.depositVk = JSON.parse(fs.readFileSync(depositVk, 'utf8'));
      logger.info('Loaded deposit_vk.json', { path: depositVk });
    }
    
    // Load withdraw circuit
    const withdrawWasm = tryLoad(path.join('withdraw_js', 'withdraw.wasm'));
    const withdrawZkey = tryLoad('withdraw.zkey');
    const withdrawVk = tryLoad('withdraw_vk.json');
    
    if (withdrawWasm) {
      this.withdrawWasm = new Uint8Array(fs.readFileSync(withdrawWasm));
      logger.info('Loaded withdraw.wasm', { path: withdrawWasm });
    }
    if (withdrawZkey) {
      this.withdrawZkey = new Uint8Array(fs.readFileSync(withdrawZkey));
      logger.info('Loaded withdraw.zkey', { path: withdrawZkey });
    }
    if (withdrawVk) {
      this.withdrawVk = JSON.parse(fs.readFileSync(withdrawVk, 'utf8'));
      logger.info('Loaded withdraw_vk.json', { path: withdrawVk });
    }
    
    // Load withdraw_v2 circuit
    const withdrawV2Wasm = tryLoad(path.join('withdraw_v2_js', 'withdraw_v2.wasm'));
    const withdrawV2Zkey = tryLoad('withdraw_v2.zkey');
    const withdrawV2Vk = tryLoad('withdraw_v2_vk.json');
    
    if (withdrawV2Wasm) {
      this.withdrawV2Wasm = new Uint8Array(fs.readFileSync(withdrawV2Wasm));
      logger.info('Loaded withdraw_v2.wasm', { path: withdrawV2Wasm });
    }
    if (withdrawV2Zkey) {
      this.withdrawV2Zkey = new Uint8Array(fs.readFileSync(withdrawV2Zkey));
      logger.info('Loaded withdraw_v2.zkey', { path: withdrawV2Zkey });
    }
    if (withdrawV2Vk) {
      this.withdrawV2Vk = JSON.parse(fs.readFileSync(withdrawV2Vk, 'utf8'));
      logger.info('Loaded withdraw_v2_vk.json', { path: withdrawV2Vk });
    }
    
    // Load merkle_batch_update circuit for settlement
    const batchUpdateWasm = tryLoad(path.join('merkle_batch_update', 'merkle_batch_update_js', 'merkle_batch_update.wasm'));
    const batchUpdateZkey = tryLoad(path.join('merkle_batch_update', 'merkle_batch_update.zkey'));
    const batchUpdateVk = tryLoad(path.join('merkle_batch_update', 'verification_key.json'));
    
    if (batchUpdateWasm) {
      this.batchUpdateWasm = new Uint8Array(fs.readFileSync(batchUpdateWasm));
      logger.info('Loaded merkle_batch_update.wasm', { path: batchUpdateWasm });
    } else {
      logger.warn('merkle_batch_update.wasm not found in any search path', { paths: pathsToTry });
    }
    if (batchUpdateZkey) {
      this.batchUpdateZkey = new Uint8Array(fs.readFileSync(batchUpdateZkey));
      logger.info('Loaded merkle_batch_update.zkey', { path: batchUpdateZkey });
    } else {
      logger.warn('merkle_batch_update.zkey not found in any search path', { paths: pathsToTry });
    }
    if (batchUpdateVk) {
      this.batchUpdateVk = JSON.parse(fs.readFileSync(batchUpdateVk, 'utf8'));
      logger.info('Loaded merkle_batch_update verification_key.json', { path: batchUpdateVk });
    }
  }
  
  /**
   * Persist current merkle tree leaves to disk
   */
  private persistMerkleTree(): void {
    saveMerkleTreeState({
      leaves: this.merkleTree.getLeaves().map(l => l.toString()),
    });
  }
  
  /**
   * Cached account info fetch with optional TTL override
   */
  private async getAccountInfoCached(pubkey: PublicKey, ttlMs: number = 5000): Promise<any> {
    const key = pubkey.toBase58();
    const cached = this.rpcCache.get(key);
    if (cached !== undefined) return cached;
    
    const info = await withRetry(
      () => this.connection.getAccountInfo(pubkey),
      { maxAttempts: 3, baseDelayMs: 500 }
    );
    this.rpcCache.set(key, info, ttlMs);
    return info;
  }

  private eventBytes32ToBigInt(value: unknown): bigint | null {
    if (value instanceof Uint8Array || Buffer.isBuffer(value)) {
      if (value.length !== 32) return null;
      return bytesToBigIntBE(value);
    }
    if (Array.isArray(value)) {
      if (value.length !== 32) return null;
      return bytesToBigIntBE(Uint8Array.from(value.map(v => Number(v))));
    }
    return null;
  }

  private async recoverMerkleTreeFromEvents(
    targetLeafCount: number,
    expectedRoot?: bigint
  ): Promise<void> {
    if (targetLeafCount <= 0) return;

    const idlPath = path.join(__dirname, 'idl', 'white_protocol.json');
    if (!fs.existsSync(idlPath)) {
      logger.warn('Cannot recover merkle tree from events: IDL not found', { idlPath });
      return;
    }

    const idl = JSON.parse(fs.readFileSync(idlPath, 'utf8'));
    const parser = new EventParser(this.config.programId, new BorshCoder(idl));
    const signatureLimit = Math.max(
      targetLeafCount * 10,
      parseInt(process.env.MERKLE_RECOVERY_SIGNATURE_LIMIT || '50', 10)
    );
    const signatures = await withRetry(
      () => this.connection.getSignaturesForAddress(
        this.config.programId,
        { limit: Math.min(signatureLimit, 1000) },
        'confirmed'
      ),
      { maxAttempts: 3, baseDelayMs: 500 }
    );
    const commitmentsByIndex = new Map<number, bigint>();

    for (const signatureInfo of signatures) {
      if (commitmentsByIndex.size >= targetLeafCount) break;

      // Small delay to avoid RPC rate limits (public RPCs are strict)
      await sleep(150);

      let tx;
      try {
        tx = await withRetry(
          () => this.connection.getTransaction(signatureInfo.signature, {
            commitment: 'confirmed',
            maxSupportedTransactionVersion: 0,
          }),
          { maxAttempts: 2, baseDelayMs: 1000 }
        );
      } catch (err) {
        logger.warn('Skipping transaction during merkle recovery', {
          signature: signatureInfo.signature,
          error: String(err),
        });
        continue;
      }
      const logs = tx?.meta?.logMessages;
      if (!logs) continue;

      for (const event of parser.parseLogs(logs)) {
        if (event.name !== 'CommitmentInsertedEvent') continue;

        const data = event.data as any;
        const pool = data.pool?.toBase58?.() ?? String(data.pool);
        if (pool !== this.config.poolConfig.toBase58()) continue;

        const leafIndexRaw = data.leaf_index ?? data.leafIndex;
        const leafIndex = Number(leafIndexRaw);
        if (!Number.isInteger(leafIndex) || leafIndex < 0 || leafIndex >= targetLeafCount) {
          continue;
        }

        const commitment = this.eventBytes32ToBigInt(data.commitment);
        if (commitment === null) continue;

        if (!commitmentsByIndex.has(leafIndex)) {
          commitmentsByIndex.set(leafIndex, commitment);
        }
      }
    }

    if (commitmentsByIndex.size === 0) {
      logger.warn('No CommitmentInsertedEvent logs found for merkle recovery', {
        targetLeafCount,
        poolConfig: this.config.poolConfig.toBase58(),
      });
      return;
    }

    for (const [leafIndex, commitment] of [...commitmentsByIndex.entries()].sort((a, b) => a[0] - b[0])) {
      this.merkleTree.insertAt(leafIndex, commitment);
    }
    this.persistMerkleTree();

    const rebuiltRoot = this.merkleTree.getRoot();
    if (expectedRoot !== undefined && rebuiltRoot !== expectedRoot) {
      logger.warn('Recovered merkle tree root does not match on-chain root', {
        recoveredLeaves: commitmentsByIndex.size,
        targetLeafCount,
        rebuiltRoot: rebuiltRoot.toString(),
        expectedRoot: expectedRoot.toString(),
      });
    } else {
      logger.info('Recovered merkle tree from CommitmentInsertedEvent logs', {
        recoveredLeaves: commitmentsByIndex.size,
        targetLeafCount,
      });
    }
  }
  
  private async syncMerkleTree(): Promise<void> {
    try {
      const [merkleTreePda] = PublicKey.findProgramAddressSync(
        [Buffer.from('merkle_tree'), this.config.poolConfig.toBuffer()],
        this.config.programId
      );
      
      const [pendingBufferPda] = PublicKey.findProgramAddressSync(
        [Buffer.from('pending'), this.config.poolConfig.toBuffer()],
        this.config.programId
      );
      
      const [merkleInfo, pendingInfo] = await Promise.all([
        this.getAccountInfoCached(merkleTreePda),
        this.getAccountInfoCached(pendingBufferPda),
      ]);
      
      if (!merkleInfo) {
        logger.info('Merkle tree not found on chain, starting fresh');
        return;
      }
      
      // Parse merkle tree using Anchor layout:
      // discriminator(8), pool(32), depth(1), next_leaf_index(4), current_root(32), ...
      const merkleAccount = parseMerkleTreeAccount(merkleInfo.data);
      const currentNextLeafIndex = merkleAccount.nextLeafIndex;

      // Try to recover missing tree leaves from on-chain events before proceeding
      const localLeafCount = this.merkleTree.getLeafCount();
      if (localLeafCount < currentNextLeafIndex) {
        await this.recoverMerkleTreeFromEvents(currentNextLeafIndex, merkleAccount.currentRoot);
      } else if (localLeafCount > currentNextLeafIndex) {
        // On-chain reset detected: local tree has more leaves than on-chain.
        // Clear local state to match on-chain empty/fresh tree.
        logger.warn('On-chain reset detected: local tree ahead of on-chain state. Clearing local state.', {
          localLeafCount,
          currentNextLeafIndex,
        });
        this.merkleTree = new ServerMerkleTree(this.config.treeDepth);
        this.pendingState = { pendingCommitments: [], nextLeafIndex: 0 };
        savePendingState({ pendingCommitments: [], nextLeafIndex: 0, lastSyncedAt: Date.now() });
        saveSettledCommitments({ commitments: [] });
        // Save empty merkle tree state
        this.persistMerkleTree();
      }
      
      // After recovery, check if we successfully backfilled
      const recoveredLeafCount = this.merkleTree.getLeafCount();
      const recoveryFailed = recoveredLeafCount < currentNextLeafIndex;
      if (recoveryFailed) {
        logger.warn('Merkle tree recovery incomplete; local tree is behind on-chain state', {
          localLeafCount: recoveredLeafCount,
          onChainNextLeafIndex: currentNextLeafIndex,
          gap: currentNextLeafIndex - recoveredLeafCount,
        });
        // CRITICAL FIX: Do NOT advance the pending-state cursor when recovery fails.
        // Advancing the cursor would permanently orphan those settled commitments,
        // making them impossible to verify for withdrawals. Leave the old cursor
        // in place so the next sync attempt can try recovery again (e.g., after
        // more RPC history is available or the IDL is fixed).
      }
      
      // Read current pending buffer
      const currentPending: bigint[] = [];
      if (pendingInfo) {
        const pendingAccount = parsePendingBufferAccount(pendingInfo.data);
        currentPending.push(...pendingAccount.deposits.map(d => d.commitment));
      }
      
      // Detect settled commitments by comparing with previous state
      const prevPending = this.pendingState.pendingCommitments;
      let prevNextLeafIndex = this.pendingState.nextLeafIndex;
      if (prevNextLeafIndex > currentNextLeafIndex) {
        logger.warn('Persisted pending state is ahead of on-chain merkle state; resetting sync cursor', {
          persistedNextLeafIndex: prevNextLeafIndex,
          currentNextLeafIndex,
        });
        prevNextLeafIndex = Math.min(this.merkleTree.getLeafCount(), currentNextLeafIndex);
      }
      
      // Only detect settlements if our local tree is caught up
      if (!recoveryFailed && currentNextLeafIndex > prevNextLeafIndex) {
        const numSettled = currentNextLeafIndex - prevNextLeafIndex;
        // Settled commitments are the first N from the previous pending buffer (FIFO)
        const settledCommitments = prevPending.slice(0, numSettled);
        
        if (settledCommitments.length > 0) {
          for (let i = 0; i < settledCommitments.length; i++) {
            const leafIndex = prevNextLeafIndex + i;
            this.merkleTree.insertAt(leafIndex, settledCommitments[i]);
            logger.info('Settled commitment inserted into local tree', {
              leafIndex,
              commitment: settledCommitments[i].toString(),
            });
          }
          this.persistMerkleTree();
        }
        
        logger.info('Batch settlement detected', {
          numSettled,
          oldNextLeafIndex: prevNextLeafIndex,
          newNextLeafIndex: currentNextLeafIndex,
        });
      } else if (recoveryFailed && currentNextLeafIndex > prevNextLeafIndex) {
        logger.warn('Skipping settlement detection because local tree recovery failed', {
          numSettled: currentNextLeafIndex - prevNextLeafIndex,
          prevNextLeafIndex,
          currentNextLeafIndex,
        });
      }
      
      // Update pending state ONLY with current on-chain buffer.
      // Keep the old nextLeafIndex if recovery failed so we retry next sync.
      this.pendingState.pendingCommitments = currentPending;
      const newNextLeafIndex = recoveryFailed ? prevNextLeafIndex : currentNextLeafIndex;
      this.pendingState.nextLeafIndex = newNextLeafIndex;
      savePendingState({
        pendingCommitments: currentPending.map(c => c.toString()),
        nextLeafIndex: newNextLeafIndex,
        lastSyncedAt: Date.now(),
      });
      
      logger.info('Merkle tree synced from chain', {
        nextLeafIndex: currentNextLeafIndex,
        pendingCount: currentPending.length,
        treeLeafCount: this.merkleTree.getLeafCount(),
      });
    } catch (err) {
      logger.error('Failed to sync merkle tree', { error: String(err) });
    }
  }
  
  private setupRoutes(): void {
    // All state-mutating and expensive endpoints require auth
    this.router.use(['/merkle/insert', '/settle-note'], this.requireAuth.bind(this));

    // =========================================================================
    // POST /api/generate-commitment
    // Generate note commitment from secret, nullifier, amount, assetId
    // =========================================================================
    this.router.post('/generate-commitment', this.requireAuth.bind(this), async (req: Request, res: Response) => {
      try {
        const { secret, nullifier, amount, assetId } = req.body;
        
        if (!secret || !nullifier || amount === undefined || !assetId) {
          return res.status(400).json({
            success: false,
            error: 'Missing required fields: secret, nullifier, amount, assetId',
          });
        }
        
        if (![secret, nullifier, amount, assetId].every(isValidBigIntString)) {
          return res.status(400).json({
            success: false,
            error: 'Invalid numeric field format',
          });
        }
        
        const secretBigInt = BigInt(secret);
        const nullifierBigInt = BigInt(nullifier);
        const amountBigInt = BigInt(amount);
        const assetIdBigInt = BigInt(assetId);
        
        // Compute commitment: Poseidon(secret, nullifier, amount, assetId)
        const commitment = poseidonHash([
          secretBigInt,
          nullifierBigInt,
          amountBigInt,
          assetIdBigInt,
        ]);
        
        res.json({
          success: true,
          commitment: commitment.toString(),
          commitmentHex: bytesToHex(feToBytes32BE(commitment)),
          note: 'nullifierHash will be computed at withdrawal time using leafIndex',
        });
      } catch (error: any) {
        logger.error('generate-commitment failed', { error: error.message });
        res.status(500).json({ success: false, error: error.message });
      }
    });
    
    // =========================================================================
    // POST /api/compute-nullifier-hash
    // Compute nullifier hash: Poseidon(Poseidon(nullifier, secret), leafIndex)
    // Matches circuit constraint in withdraw.circom
    // =========================================================================
    this.router.post('/compute-nullifier-hash', async (req: Request, res: Response) => {
      try {
        const { secret, nullifier, leafIndex } = req.body;
        
        if (!secret || !nullifier || leafIndex === undefined) {
          return res.status(400).json({
            success: false,
            error: 'Missing required fields: secret, nullifier, leafIndex',
          });
        }
        
        if (![secret, nullifier, leafIndex].every(isValidBigIntString)) {
          return res.status(400).json({
            success: false,
            error: 'Invalid numeric field format',
          });
        }
        
        const secretBigInt = BigInt(secret);
        const nullifierBigInt = BigInt(nullifier);
        const leafIndexBigInt = BigInt(leafIndex);
        
        // Circuit: nullifier_hash = Poseidon(Poseidon(nullifier, secret), leaf_index)
        const inner = poseidonHash([nullifierBigInt, secretBigInt]);
        const nullifierHash = poseidonHash([inner, leafIndexBigInt]);
        
        res.json({
          success: true,
          nullifierHash: nullifierHash.toString(),
          nullifierHashHex: bytesToHex(feToBytes32BE(nullifierHash)),
        });
      } catch (error: any) {
        logger.error('compute-nullifier-hash failed', { error: error.message });
        res.status(500).json({ success: false, error: error.message });
      }
    });
    
    // =========================================================================
    // POST /api/compute-asset-id
    // Compute asset ID from mint address
    // =========================================================================
    this.router.post('/compute-asset-id', this.requireAuth.bind(this), async (req: Request, res: Response) => {
      try {
        const { mint } = req.body;
        
        if (!isValidSolanaPubkey(mint)) {
          return res.status(400).json({
            success: false,
            error: 'Invalid mint address',
          });
        }
        
        const mintPubkey = new PublicKey(mint.trim());
        const assetId = computeAssetId(mintPubkey);
        const assetIdBigInt = assetIdToBigInt(assetId);
        
        res.json({
          success: true,
          assetId: assetIdBigInt.toString(),
          assetIdHex: bytesToHex(assetId),
          mint: mint,
        });
      } catch (error: any) {
        logger.error('compute-asset-id failed', { error: error.message });
        res.status(500).json({ success: false, error: error.message });
      }
    });
    
    // =========================================================================
    // POST /api/deposit-proof
    // Generate deposit proof (heavy ZK operation)
    // =========================================================================
    this.router.post('/deposit-proof', this.requireAuth.bind(this), async (req: Request, res: Response) => {
      try {
        const { secret, nullifier, commitment, amount, assetId } = req.body;
        
        if (!this.depositWasm || !this.depositZkey) {
          return res.status(503).json({
            success: false,
            error: 'Deposit circuit not loaded. Check circuitsPath configuration.',
          });
        }
        
        if (!secret || !nullifier || !commitment || amount === undefined || !assetId) {
          return res.status(400).json({
            success: false,
            error: 'Missing required fields: secret, nullifier, commitment, amount, assetId',
          });
        }
        
        if (![secret, nullifier, commitment, amount, assetId].every(isValidBigIntString)) {
          return res.status(400).json({
            success: false,
            error: 'Invalid numeric field format',
          });
        }
        
        logger.info('deposit-proof generating proof');
        const startTime = Date.now();
        
        const circuitInput = {
          commitment: commitment.toString(),
          amount: amount.toString(),
          asset_id: assetId.toString(),
          secret: secret.toString(),
          nullifier: nullifier.toString(),
        };
        
        const { proof, publicSignals } = await withTimeout(
          snarkjs.groth16.fullProve(circuitInput, this.depositWasm, this.depositZkey) as Promise<{ proof: any; publicSignals: any }>,
          60000,
          'Proof generation timed out'
        );
        
        const proofTime = Date.now() - startTime;
        logger.info('deposit-proof generated', { proofTimeMs: proofTime });
        
        // Verify locally
        if (this.depositVk) {
          const isValid = await snarkjs.groth16.verify(this.depositVk, publicSignals, proof);
          if (!isValid) {
            return res.status(400).json({
              success: false,
              error: 'Generated proof failed local verification',
            });
          }
          logger.info('deposit-proof local verification passed');
        }
        
        // Serialize for chain
        const proofBytes = serializeGroth16Proof(proof);
        
        res.json({
          success: true,
          proofData: bytesToHex(proofBytes),
          publicSignals: publicSignals,
          proofTimeMs: proofTime,
        });
      } catch (error: any) {
        logger.error('deposit-proof failed', { error: error.message });
        res.status(500).json({ success: false, error: error.message });
      }
    });
    
    // =========================================================================
    // POST /api/withdraw-proof
    // Generate withdraw proof (heavy ZK operation)
    // =========================================================================
    this.router.post('/withdraw-proof', this.requireAuth.bind(this), async (req: Request, res: Response) => {
      try {
        const {
          merkleRoot,
          nullifierHash,
          assetId,
          recipient,
          amount,
          relayer,
          relayerFee,
          publicDataHash,
          secret,
          nullifier,
          leafIndex,
          merklePath,
          merklePathIndices,
        } = req.body;
        
        if (!this.withdrawWasm || !this.withdrawZkey) {
          return res.status(503).json({
            success: false,
            error: 'Withdraw circuit not loaded. Check circuitsPath configuration.',
          });
        }
        
        // Validate required fields
        const requiredFields = [
          'merkleRoot', 'nullifierHash', 'assetId', 'recipient', 'amount',
          'relayer', 'relayerFee', 'secret', 'nullifier', 'leafIndex',
          'merklePath', 'merklePathIndices'
        ];
        const missing = requiredFields.filter(f => req.body[f] === undefined);
        if (missing.length > 0) {
          return res.status(400).json({
            success: false,
            error: `Missing required fields: ${missing.join(', ')}`,
          });
        }
        
        // Validate pubkey fields
        if (!isValidSolanaPubkey(recipient) || !isValidSolanaPubkey(relayer)) {
          return res.status(400).json({
            success: false,
            error: 'Invalid recipient or relayer public key',
          });
        }
        
        // Validate numeric fields
        if (![merkleRoot, nullifierHash, assetId, amount, relayerFee, secret, nullifier, leafIndex].every(isValidBigIntString)) {
          return res.status(400).json({
            success: false,
            error: 'Invalid numeric field format',
          });
        }
        
        // Validate merkle path length and contents
        if (!Array.isArray(merklePath) || merklePath.length !== this.config.treeDepth || !merklePath.every(p => isValidBigIntString(p))) {
          return res.status(400).json({
            success: false,
            error: `Invalid merkle path: expected ${this.config.treeDepth} numeric elements`,
          });
        }
        if (!Array.isArray(merklePathIndices) || merklePathIndices.length !== this.config.treeDepth || !merklePathIndices.every((i: number) => i === 0 || i === 1)) {
          return res.status(400).json({
            success: false,
            error: `Invalid merkle path indices: expected ${this.config.treeDepth} binary elements (0 or 1)`,
          });
        }
        
        logger.info('withdraw-proof generating proof');
        const startTime = Date.now();
        
        // Convert recipient and relayer to scalars
        const recipientPubkey = new PublicKey(recipient);
        const relayerPubkey = new PublicKey(relayer);
        const recipientScalar = pubkeyToScalar(recipientPubkey);
        const relayerScalar = pubkeyToScalar(relayerPubkey);
        
        // Compute nullifier hash internally to ensure circuit consistency
        // Circuit: nullifier_hash = Poseidon(Poseidon(nullifier, secret), leaf_index)
        const secretBigInt = BigInt(secret);
        const nullifierBigInt = BigInt(nullifier);
        const leafIndexBigInt = BigInt(leafIndex);
        const inner = poseidonHash([nullifierBigInt, secretBigInt]);
        const computedNullifierHash = poseidonHash([inner, leafIndexBigInt]);
        
        // Validate client's nullifierHash matches our computation (if they provided one)
        const clientNullifierHash = BigInt(nullifierHash);
        if (clientNullifierHash !== computedNullifierHash) {
          logger.warn('Client nullifierHash mismatch, using computed value', {
            client: clientNullifierHash.toString(),
            computed: computedNullifierHash.toString(),
          });
        }
        
        const circuitInput = {
          merkle_root: merkleRoot.toString(),
          nullifier_hash: computedNullifierHash.toString(),
          asset_id: assetId.toString(),
          recipient: recipientScalar.toString(),
          amount: amount.toString(),
          relayer: relayerScalar.toString(),
          relayer_fee: relayerFee.toString(),
          public_data_hash: (publicDataHash || '0').toString(),
          secret: secret.toString(),
          nullifier: nullifier.toString(),
          leaf_index: leafIndex.toString(),
          merkle_path: merklePath.map((p: string | bigint) => p.toString()),
          merkle_path_indices: merklePathIndices.map((i: number) => i.toString()),
        };
        
        const { proof, publicSignals } = await withTimeout(
          snarkjs.groth16.fullProve(circuitInput, this.withdrawWasm, this.withdrawZkey) as Promise<{ proof: any; publicSignals: any }>,
          60000,
          'Proof generation timed out'
        );
        
        const proofTime = Date.now() - startTime;
        logger.info('withdraw-proof generated', { proofTimeMs: proofTime });
        
        // Verify locally
        if (this.withdrawVk) {
          const isValid = await snarkjs.groth16.verify(this.withdrawVk, publicSignals, proof);
          if (!isValid) {
            return res.status(400).json({
              success: false,
              error: 'Generated proof failed local verification',
            });
          }
          logger.info('withdraw-proof local verification passed');
        }
        
        // Serialize for chain
        const proofBytes = serializeGroth16Proof(proof);
        
        res.json({
          success: true,
          proofData: bytesToHex(proofBytes),
          publicSignals: publicSignals,
          proofTimeMs: proofTime,
        });
      } catch (error: any) {
        logger.error('withdraw-proof failed', { error: error.message });
        res.status(500).json({ success: false, error: error.message });
      }
    });
    
    // =========================================================================
    // POST /api/withdraw-v2-proof
    // Generate withdraw v2 proof with change output support (partial withdrawals)
    // =========================================================================
    this.router.post('/withdraw-v2-proof', this.requireAuth.bind(this), async (req: Request, res: Response) => {
      try {
        const {
          merkleRoot,
          assetId,
          recipient,
          amount,
          noteAmount,
          relayer,
          relayerFee,
          publicDataHash,
          secret,
          nullifier,
          leafIndex,
          merklePath,
          merklePathIndices,
        } = req.body;
        
        if (!this.withdrawV2Wasm || !this.withdrawV2Zkey) {
          return res.status(503).json({
            success: false,
            error: 'Withdraw V2 circuit not loaded. Check circuitsPath configuration.',
          });
        }
        
        // Validate required fields
        const requiredFields = [
          'merkleRoot', 'assetId', 'recipient', 'amount', 'noteAmount',
          'relayer', 'relayerFee', 'secret', 'nullifier', 'leafIndex',
          'merklePath', 'merklePathIndices'
        ];
        const missing = requiredFields.filter(f => req.body[f] === undefined);
        if (missing.length > 0) {
          return res.status(400).json({
            success: false,
            error: `Missing required fields: ${missing.join(', ')}`,
          });
        }
        
        // Validate pubkey fields
        if (!isValidSolanaPubkey(recipient) || !isValidSolanaPubkey(relayer)) {
          return res.status(400).json({
            success: false,
            error: 'Invalid recipient or relayer public key',
          });
        }
        
        // Validate numeric fields
        if (![merkleRoot, assetId, amount, noteAmount, relayerFee, secret, nullifier, leafIndex].every(isValidBigIntString)) {
          return res.status(400).json({
            success: false,
            error: 'Invalid numeric field format',
          });
        }
        
        // Validate merkle path length and contents
        if (!Array.isArray(merklePath) || merklePath.length !== this.config.treeDepth || !merklePath.every(p => isValidBigIntString(p))) {
          return res.status(400).json({
            success: false,
            error: `Invalid merkle path: expected ${this.config.treeDepth} numeric elements`,
          });
        }
        if (!Array.isArray(merklePathIndices) || merklePathIndices.length !== this.config.treeDepth || !merklePathIndices.every((i: number) => i === 0 || i === 1)) {
          return res.status(400).json({
            success: false,
            error: `Invalid merkle path indices: expected ${this.config.treeDepth} binary elements (0 or 1)`,
          });
        }
        
        logger.info('withdraw-v2-proof generating proof');
        const startTime = Date.now();
        
        // Convert recipient and relayer to scalars
        const recipientPubkey = new PublicKey(recipient);
        const relayerPubkey = new PublicKey(relayer);
        const recipientScalar = pubkeyToScalar(recipientPubkey);
        const relayerScalar = pubkeyToScalar(relayerPubkey);
        
        // Compute nullifier hash internally to ensure circuit consistency
        const secretBigInt = BigInt(secret);
        const nullifierBigInt = BigInt(nullifier);
        const leafIndexBigInt = BigInt(leafIndex);
        const inner = poseidonHash([nullifierBigInt, secretBigInt]);
        const computedNullifierHash = poseidonHash([inner, leafIndexBigInt]);
        
        // Detect partial withdrawal
        const amountBigInt = BigInt(amount);
        const noteAmountBigInt = BigInt(noteAmount);
        const isPartial = noteAmountBigInt > amountBigInt;
        
        let changeSecret = '0';
        let changeNullifier = '0';
        let changeAmount = '0';
        let changeCommitment: string;
        
        if (isPartial) {
          const randScalar = () => {
            const buf = crypto.randomBytes(32);
            buf[0] &= 0x1F; // keep under BN254 field order (~253 bits)
            return BigInt('0x' + buf.toString('hex')).toString();
          };
          changeSecret = randScalar();
          changeNullifier = randScalar();
          changeAmount = (noteAmountBigInt - amountBigInt).toString();
          changeCommitment = poseidonHash([
            BigInt(changeSecret),
            BigInt(changeNullifier),
            BigInt(changeAmount),
            BigInt(assetId),
          ]).toString();
        } else {
          // Full withdrawal: dummy change commitment = Poseidon(0,0,0,assetId)
          changeCommitment = poseidonHash([
            BigInt(0), BigInt(0), BigInt(0), BigInt(assetId),
          ]).toString();
        }
        
        const circuitInput = {
          schema_version: '2',
          merkle_root: merkleRoot.toString(),
          asset_id: assetId.toString(),
          nullifier_hash_0: computedNullifierHash.toString(),
          nullifier_hash_1: '0',
          change_commitment: changeCommitment,
          recipient: recipientScalar.toString(),
          amount: amount.toString(),
          relayer: relayerScalar.toString(),
          relayer_fee: relayerFee.toString(),
          public_data_hash: (publicDataHash || '0').toString(),
          reserved_0: '0',
          input_secret: secret.toString(),
          input_nullifier: nullifier.toString(),
          input_amount: noteAmount.toString(),
          leaf_index: leafIndex.toString(),
          merkle_path: merklePath.map((p: string | bigint) => p.toString()),
          merkle_path_indices: merklePathIndices.map((i: number) => i.toString()),
          change_secret: changeSecret,
          change_nullifier: changeNullifier,
          change_amount: changeAmount,
        };
        
        const { proof, publicSignals } = await withTimeout(
          snarkjs.groth16.fullProve(circuitInput, this.withdrawV2Wasm, this.withdrawV2Zkey) as Promise<{ proof: any; publicSignals: any }>,
          60000,
          'Proof generation timed out'
        );
        
        const proofTime = Date.now() - startTime;
        logger.info('withdraw-v2-proof generated', { proofTimeMs: proofTime, isPartial });
        
        // Verify locally
        if (this.withdrawV2Vk) {
          const isValid = await snarkjs.groth16.verify(this.withdrawV2Vk, publicSignals, proof);
          if (!isValid) {
            return res.status(400).json({
              success: false,
              error: 'Generated proof failed local verification',
            });
          }
          logger.info('withdraw-v2-proof local verification passed');
        }
        
        // Serialize for chain
        const proofBytes = serializeGroth16Proof(proof);
        
        res.json({
          success: true,
          proofData: bytesToHex(proofBytes),
          publicSignals: publicSignals,
          proofTimeMs: proofTime,
          changeNote: isPartial ? {
            secret: changeSecret,
            nullifier: changeNullifier,
            amount: changeAmount,
            assetId: assetId.toString(),
            commitment: publicSignals[5], // index 5 is change_commitment
          } : null,
        });
      } catch (error: any) {
        logger.error('withdraw-v2-proof failed', { error: error.message });
        res.status(500).json({ success: false, error: error.message });
      }
    });
    
    // =========================================================================
    // GET /api/pool-state
    // Get current pool state (merkle root, pending buffer, etc.)
    // =========================================================================
    this.router.get('/pool-state', async (req: Request, res: Response) => {
      try {
        // Derive PDAs
        const [merkleTreePda] = PublicKey.findProgramAddressSync(
          [Buffer.from('merkle_tree'), this.config.poolConfig.toBuffer()],
          this.config.programId
        );
        
        const [pendingBufferPda] = PublicKey.findProgramAddressSync(
          [Buffer.from('pending'), this.config.poolConfig.toBuffer()],
          this.config.programId
        );
        
        // Fetch accounts
        const [merkleInfo, pendingInfo] = await Promise.all([
          this.getAccountInfoCached(merkleTreePda),
          this.getAccountInfoCached(pendingBufferPda),
        ]);
        
        let merkleRoot = '0';
        let merkleRootHex = bytesToHex(feToBytes32BE(0n));
        let nextLeafIndex = 0;
        let totalLeaves = '0';
        let rootHistoryIndex = 0;
        let rootHistorySize = 0;
        
        if (merkleInfo) {
          const merkleAccount = parseMerkleTreeAccount(merkleInfo.data);
          merkleRoot = merkleAccount.currentRoot.toString();
          merkleRootHex = bytesToHex(merkleAccount.currentRootBytes);
          nextLeafIndex = merkleAccount.nextLeafIndex;
          totalLeaves = merkleAccount.totalLeaves;
          rootHistoryIndex = merkleAccount.rootHistoryIndex;
          rootHistorySize = merkleAccount.rootHistorySize;
        }
        
        let pendingCount = 0;
        const pendingCommitments: string[] = [];
        
        if (pendingInfo) {
          const pendingAccount = parsePendingBufferAccount(pendingInfo.data);
          pendingCount = pendingAccount.totalPending;
          pendingCommitments.push(...pendingAccount.deposits.map(d => d.commitment.toString()));
        }
        
        res.json({
          success: true,
          poolConfig: this.config.poolConfig.toBase58(),
          programId: this.config.programId.toBase58(),
          merkle: {
            address: merkleTreePda.toBase58(),
            root: merkleRoot,
            rootHex: merkleRootHex,
            nextLeafIndex: nextLeafIndex,
            totalLeaves,
            rootHistoryIndex,
            rootHistorySize,
            treeDepth: this.config.treeDepth,
            localLeafCount: this.merkleTree.getLeafCount(),
          },
          pending: {
            address: pendingBufferPda.toBase58(),
            count: pendingCount,
            commitments: pendingCommitments,
          },
        });
      } catch (error: any) {
        logger.error('pool-state failed', { error: error.message });
        res.status(500).json({ success: false, error: error.message });
      }
    });
    
    // =========================================================================
    // GET /api/merkle/proof/:leafIndex
    // Get merkle proof for a leaf (requires synced tree)
    // =========================================================================
    this.router.get('/merkle/proof/:leafIndex', async (req: Request, res: Response) => {
      try {
        const leafIndex = parseInt(req.params.leafIndex);
        
        if (isNaN(leafIndex) || leafIndex < 0) {
          return res.status(400).json({
            success: false,
            error: 'Invalid leaf index',
          });
        }
        
        const leafCount = this.merkleTree.getLeafCount();
        
        if (leafIndex >= leafCount) {
          return res.status(400).json({
            success: false,
            error: `Leaf index ${leafIndex} not in tree. Current tree has ${leafCount} leaves.`,
            hint: 'Use POST /api/merkle/insert to add commitments to the tree.',
          });
        }
        
        const { pathElements, pathIndices } = this.merkleTree.getMerklePath(leafIndex);
        const root = this.merkleTree.getRoot();
        
        res.json({
          success: true,
          leafIndex: leafIndex,
          merkleRoot: root.toString(),
          merkleRootHex: bytesToHex(feToBytes32BE(root)),
          pathElements: pathElements.map(p => p.toString()),
          pathIndices: pathIndices,
        });
      } catch (error: any) {
        logger.error('merkle/proof failed', { error: error.message });
        res.status(500).json({ success: false, error: error.message });
      }
    });
    
    // =========================================================================
    // POST /api/merkle/insert
    // Insert commitment into local merkle tree (for tracking)
    // =========================================================================
    this.router.post('/merkle/insert', async (req: Request, res: Response) => {
      try {
        const { commitment, leafIndex } = req.body;
        
        if (!commitment || !isValidBigIntString(commitment)) {
          return res.status(400).json({
            success: false,
            error: 'Invalid commitment: must be a valid integer string',
          });
        }
        if (leafIndex !== undefined && !isValidUint32(leafIndex)) {
          return res.status(400).json({
            success: false,
            error: 'Invalid leafIndex: must be a non-negative integer',
          });
        }
        
        const commitmentBigInt = BigInt(commitment);
        
        let insertedIndex: number;
        if (leafIndex !== undefined) {
          this.merkleTree.insertAt(leafIndex, commitmentBigInt);
          insertedIndex = leafIndex;
        } else {
          insertedIndex = this.merkleTree.insert(commitmentBigInt);
        }
        this.persistMerkleTree();
        
        const newRoot = this.merkleTree.getRoot();
        
        res.json({
          success: true,
          leafIndex: insertedIndex,
          newMerkleRoot: newRoot.toString(),
          newMerkleRootHex: bytesToHex(feToBytes32BE(newRoot)),
          totalLeaves: this.merkleTree.getLeafCount(),
        });
      } catch (error: any) {
        logger.error('merkle/insert failed', { error: error.message });
        res.status(500).json({ success: false, error: error.message });
      }
    });
    
    // =========================================================================
    // GET /api/note/:commitment
    // Check note status (pending or settled) - used by frontend polling
    // =========================================================================
    this.router.get('/note/:commitment', async (req: Request, res: Response) => {
      try {
        const commitment = req.params.commitment;
        
        if (typeof commitment !== 'string' || commitment.length > 128) {
          return res.status(400).json({
            success: false,
            error: 'Invalid commitment parameter',
          });
        }
        
        // Handle both decimal string and hex formats
        let commitmentBigInt: bigint;
        if (commitment.startsWith('0x')) {
          commitmentBigInt = BigInt(commitment);
        } else if (/^[0-9a-fA-F]{64}$/.test(commitment)) {
          commitmentBigInt = BigInt('0x' + commitment);
        } else {
          commitmentBigInt = BigInt(commitment);
        }
        
        // Check local tree first (settled notes)
        const leaves = this.merkleTree.getLeaves();
        const leafIndex = leaves.findIndex(l => l === commitmentBigInt);
        
        if (leafIndex >= 0) {
          return res.json({
            success: true,
            status: 'settled',
            leafIndex,
            commitment: commitmentBigInt.toString(),
          });
        }
        
        // Check pending buffer on-chain
        const [pendingBufferPda] = PublicKey.findProgramAddressSync(
          [Buffer.from('pending'), this.config.poolConfig.toBuffer()],
          this.config.programId
        );
        
        const pendingInfo = await this.getAccountInfoCached(pendingBufferPda);
        if (pendingInfo) {
          const pendingAccount = parsePendingBufferAccount(pendingInfo.data);
          for (let i = 0; i < pendingAccount.deposits.length; i++) {
            if (pendingAccount.deposits[i].commitment === commitmentBigInt) {
              return res.json({
                success: true,
                status: 'pending',
                pendingIndex: i,
                commitment: commitmentBigInt.toString(),
              });
            }
          }
        }
        
        // Not found in either location
        res.json({ 
          success: true, 
          status: 'unknown', 
          commitment: commitmentBigInt.toString(),
          hint: 'Commitment not found in pending buffer or merkle tree',
        });
      } catch (error: any) {
        logger.error('note/:commitment failed', { error: error.message });
        res.status(500).json({ success: false, error: error.message });
      }
    });
    
    // =========================================================================
    // POST /api/track-deposit
    // Track a deposit made outside of /build-deposit-tx (e.g. from app/)
    // No auth required — this just adds the commitment to our pending tracking
    // =========================================================================
    this.router.post('/track-deposit', async (req: Request, res: Response) => {
      try {
        const { commitment, txHash } = req.body;
        
        if (!commitment || !isValidBigIntString(commitment)) {
          return res.status(400).json({
            success: false,
            error: 'Invalid commitment: must be a valid integer string',
          });
        }
        
        const commitmentBigInt = BigInt(commitment);
        
        // Add to pending tracking if not already present
        if (!this.pendingState.pendingCommitments.find(c => c === commitmentBigInt)) {
          this.pendingState.pendingCommitments.push(commitmentBigInt);
          savePendingState({
            pendingCommitments: this.pendingState.pendingCommitments.map(c => c.toString()),
            nextLeafIndex: this.pendingState.nextLeafIndex,
            lastSyncedAt: Date.now(),
          });
        }
        
        res.json({
          success: true,
          commitment: commitmentBigInt.toString(),
          txHash: txHash || null,
          pendingCount: this.pendingState.pendingCommitments.length,
        });
      } catch (error: any) {
        logger.error('track-deposit failed', { error: error.message });
        res.status(500).json({ success: false, error: error.message });
      }
    });
    
    // =========================================================================
    // POST /api/settle-note
    // Manually settle a note (move from pending to merkle tree)
    // Used when sequencer settles deposits
    // =========================================================================
    this.router.post('/settle-note', async (req: Request, res: Response) => {
      try {
        const { commitment, leafIndex } = req.body;
        
        if (!commitment || !isValidBigIntString(commitment)) {
          return res.status(400).json({
            success: false,
            error: 'Invalid commitment: must be a valid integer string',
          });
        }
        if (!isValidUint32(leafIndex)) {
          return res.status(400).json({
            success: false,
            error: 'Invalid leafIndex: must be a non-negative integer',
          });
        }
        
        const commitmentBigInt = BigInt(commitment);
        this.merkleTree.insertAt(leafIndex, commitmentBigInt);
        this.persistMerkleTree();
        
        res.json({
          success: true,
          commitment: commitmentBigInt.toString(),
          leafIndex,
          newMerkleRoot: this.merkleTree.getRoot().toString(),
        });
      } catch (error: any) {
        logger.error('settle-note failed', { error: error.message });
        res.status(500).json({ success: false, error: error.message });
      }
    });
    
    // =========================================================================
    // POST /api/poseidon-hash
    // Generic Poseidon hash endpoint
    // =========================================================================
    this.router.post('/poseidon-hash', this.requireAuth.bind(this), async (req: Request, res: Response) => {
      try {
        const { inputs } = req.body;
        
        if (!inputs || !Array.isArray(inputs) || inputs.length === 0) {
          return res.status(400).json({
            success: false,
            error: 'Missing or invalid inputs array',
          });
        }
        
        if (inputs.length > 16) {
          return res.status(400).json({
            success: false,
            error: 'Too many inputs. Poseidon supports up to 16 inputs.',
          });
        }
        
        if (!inputs.every(isValidBigIntString)) {
          return res.status(400).json({
            success: false,
            error: 'All inputs must be valid integers',
          });
        }
        
        const inputsBigInt = inputs.map((i: string | number | bigint) => BigInt(i));
        const hash = poseidonHash(inputsBigInt);
        
        res.json({
          success: true,
          hash: hash.toString(),
          hashHex: bytesToHex(feToBytes32BE(hash)),
        });
      } catch (error: any) {
        logger.error('poseidon-hash failed', { error: error.message });
        res.status(500).json({ success: false, error: error.message });
      }
    });
    
    // =========================================================================
    // POST /api/pubkey-to-scalar
    // Convert Solana pubkey to scalar for circuit inputs
    // =========================================================================
    this.router.post('/pubkey-to-scalar', async (req: Request, res: Response) => {
      try {
        const { pubkey } = req.body;
        
        if (!isValidSolanaPubkey(pubkey)) {
          return res.status(400).json({
            success: false,
            error: 'Invalid pubkey',
          });
        }
        
        const pubkeyObj = new PublicKey(pubkey.trim());
        const scalar = pubkeyToScalar(pubkeyObj);
        
        res.json({
          success: true,
          pubkey: pubkey,
          scalar: scalar.toString(),
          scalarHex: bytesToHex(feToBytes32BE(scalar)),
        });
      } catch (error: any) {
        logger.error('pubkey-to-scalar failed', { error: error.message });
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // =========================================================================
    // BUILD DEPOSIT TRANSACTION
    // =========================================================================
    this.router.post('/build-deposit-tx', this.requireAuth.bind(this), async (req: Request, res: Response) => {
      try {
        const { amount, commitment, assetId, proofData, depositorPubkey, mint } = req.body;
        
        if (!amount || !commitment || !assetId || !proofData || !depositorPubkey || !mint) {
          res.status(400).json({ 
            success: false, 
            error: 'Missing required fields: amount, commitment, assetId, proofData, depositorPubkey, mint' 
          });
          return;
        }

        const depositor = new PublicKey(depositorPubkey);
        const mintPubkey = new PublicKey(mint);
        
        // Derive PDAs
        // Fetch authority from pool_config account (stored at offset 8)
        const poolConfigInfo = await this.getAccountInfoCached(this.config.poolConfig);
        if (!poolConfigInfo) throw new Error("Pool config not found");
        const authority = new PublicKey(poolConfigInfo.data.slice(8, 40));
        
        const [merkleTree] = PublicKey.findProgramAddressSync(
          [Buffer.from('merkle_tree'), this.config.poolConfig.toBuffer()],
          this.config.programId
        );
        
        const [pendingBuffer] = PublicKey.findProgramAddressSync(
          [Buffer.from('pending'), this.config.poolConfig.toBuffer()],
          this.config.programId
        );
        
        const assetIdBytes = hexToBytes(assetId);
        const [assetVault] = PublicKey.findProgramAddressSync(
          [Buffer.from('vault'), this.config.poolConfig.toBuffer(), assetIdBytes],
          this.config.programId
        );
        
        const [depositVk] = PublicKey.findProgramAddressSync(
          [Buffer.from('vk_deposit'), this.config.poolConfig.toBuffer()],
          this.config.programId
        );
        // Fetch vault token account from AssetVault state (stored, not derived)
        const assetVaultInfo = await this.getAccountInfoCached(assetVault, 30000);
        if (!assetVaultInfo) {
          throw new Error('AssetVault not found for this asset. Asset may not be registered.');
        }
        // AssetVault layout: discriminator(8) + pool(32) + asset_id(32) + mint(32) + token_account(32)
        const vaultTokenAccount = new PublicKey(assetVaultInfo.data.slice(104, 136));
        logger.info('build-deposit-tx vault token account resolved', { vaultTokenAccount: vaultTokenAccount.toBase58() });

        // Get user token account
        const { getAssociatedTokenAddressSync, createAssociatedTokenAccountInstruction, createSyncNativeInstruction, NATIVE_MINT, TOKEN_PROGRAM_ID } = await import('@solana/spl-token');
        const { SystemProgram } = await import('@solana/web3.js');
        const userTokenAccount = getAssociatedTokenAddressSync(mintPubkey, depositor);
        
        const preInstructions: any[] = [];
        
        // Use idempotent ATA creation so tx succeeds even if ATA exists
        const { createAssociatedTokenAccountIdempotentInstruction } = await import('@solana/spl-token');
        preInstructions.push(createAssociatedTokenAccountIdempotentInstruction(
          depositor, userTokenAccount, depositor, mintPubkey, TOKEN_PROGRAM_ID
        ));

        // Auto-wrap native SOL into wSOL before deposit
        if (mintPubkey.equals(NATIVE_MINT)) {
          logger.info('build-deposit-tx native SOL deposit, adding wrap instructions');
          preInstructions.push(
            SystemProgram.transfer({
              fromPubkey: depositor,
              toPubkey: userTokenAccount,
              lamports: BigInt(amount),
            })
          );
          preInstructions.push(createSyncNativeInstruction(userTokenAccount));
        }

        // Build instruction data manually (discriminator + args)
        const discriminator = Buffer.from([53, 229, 96, 103, 104, 75, 182, 133]);
        const amountBuf = Buffer.alloc(8);
        amountBuf.writeBigUInt64LE(BigInt(amount));
        const commitmentBytes = hexToBytes(commitment);
        const proofBytes = hexToBytes(proofData);

        const [commitmentIndex] = PublicKey.findProgramAddressSync(
          [Buffer.from('commitment'), this.config.poolConfig.toBuffer(), Buffer.from(commitmentBytes)],
          this.config.programId
        );
        const proofLenBuf = Buffer.alloc(4);
        proofLenBuf.writeUInt32LE(proofBytes.length);
        
        // encrypted_note = None (0 byte for Option::None)
        const encryptedNoteNone = Buffer.from([0]);
        
        const instructionData = Buffer.concat([
          discriminator,
          amountBuf,
          commitmentBytes,
          assetIdBytes,
          proofLenBuf,
          proofBytes,
          encryptedNoteNone
        ]);

        // Build instruction
        const { TransactionInstruction, Transaction } = await import('@solana/web3.js');
        const SYSTEM_PROGRAM_ID = new PublicKey('11111111111111111111111111111111');

        const ix = new TransactionInstruction({
          programId: this.config.programId,
          keys: [
            { pubkey: depositor, isSigner: true, isWritable: true },
            { pubkey: this.config.poolConfig, isSigner: false, isWritable: true },
            { pubkey: authority, isSigner: false, isWritable: false },
            { pubkey: merkleTree, isSigner: false, isWritable: true },
            { pubkey: pendingBuffer, isSigner: false, isWritable: true },
            { pubkey: assetVault, isSigner: false, isWritable: true },
            { pubkey: vaultTokenAccount, isSigner: false, isWritable: true },
            { pubkey: userTokenAccount, isSigner: false, isWritable: true },
            { pubkey: mintPubkey, isSigner: false, isWritable: false },
            { pubkey: depositVk, isSigner: false, isWritable: false },
            { pubkey: commitmentIndex, isSigner: false, isWritable: true },
            { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
            { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
          ],
          data: instructionData,
        });

        // Get recent blockhash
        const { blockhash, lastValidBlockHeight } = await withRetry(
          () => this.connection.getLatestBlockhash(),
          { maxAttempts: 3, baseDelayMs: 500 }
        );
        
        const tx = new Transaction();
        tx.recentBlockhash = blockhash;
        tx.feePayer = depositor;
        preInstructions.forEach(pre => tx.add(pre)); tx.add(ix);

        // Serialize (unsigned)
        const serializedTx = tx.serialize({ requireAllSignatures: false }).toString('base64');

        // NOTE: We deliberately do NOT insert into the local Merkle tree here.
        // The commitment is only in the pending buffer until settlement.
        // Inserting pre-confirmation corrupts the tree if the tx never lands.

        res.json({
          success: true,
          transaction: serializedTx,
          blockhash,
          lastValidBlockHeight,
          leafIndex: undefined, // Leaf index unknown until settlement
        });
      } catch (error: any) {
        logger.error('build-deposit-tx failed', { error: error.message });
        res.status(500).json({ success: false, error: error.message });
      }
    });
  
  }
  // ============================================================================
  // BATCH SETTLEMENT (ZK-BASED)
  // ============================================================================

  /**
   * Generate a Groth16 proof for batch Merkle update.
   */
  private async generateBatchProof(
    oldRoot: bigint,
    newRoot: bigint,
    startIndex: number,
    batchSize: number,
    commitments: bigint[],
    paths: bigint[][]
  ): Promise<{ proofBytes: Uint8Array; publicSignals: bigint[] }> {
    if (!this.batchUpdateWasm || !this.batchUpdateZkey) {
      throw new Error('Batch update circuit artifacts not loaded');
    }

    const commitmentsHash = computeCommitmentsHash(commitments, batchSize);

    const paddedCommitments = [...commitments];
    const paddedPaths = [...paths];
    while (paddedCommitments.length < MAX_BATCH_SIZE) {
      paddedCommitments.push(0n);
      paddedPaths.push(new Array(this.config.treeDepth).fill(0n));
    }

    const circuitInput = {
      oldRoot: oldRoot.toString(),
      newRoot: newRoot.toString(),
      startIndex: startIndex.toString(),
      batchSize: batchSize.toString(),
      commitmentsHash: commitmentsHash.toString(),
      commitments: paddedCommitments.map(c => c.toString()),
      pathElements: paddedPaths.map(p => p.map(e => e.toString())),
    };

    logger.info('Generating batch settlement ZK proof', { batchSize, startIndex });
    const startTime = Date.now();
    const { proof, publicSignals } = await Promise.race([
      snarkjs.groth16.fullProve(circuitInput, this.batchUpdateWasm, this.batchUpdateZkey),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Proof generation timeout')), 120000))
    ]);
    logger.info('Batch proof generated', { durationMs: Date.now() - startTime });

    // Optional: local verification
    if (this.batchUpdateVk) {
      const valid = await snarkjs.groth16.verify(this.batchUpdateVk, publicSignals, proof);
      if (!valid) {
        throw new Error('Batch proof local verification failed');
      }
      logger.info('Batch proof locally verified');
    }

    const proofBytes = serializeGroth16Proof(proof);
    return { proofBytes, publicSignals: publicSignals.map((s: string) => BigInt(s)) };
  }

  /**
   * Prepare a ZK batch settlement for the current pending deposits.
   * Returns proof data ready for on-chain submission, or null if nothing to settle.
   */
  async settlePendingDeposits(): Promise<{
    proofBytes: Uint8Array;
    newRootBytes: Uint8Array;
    batchSize: number;
    startIndex: number;
    commitments: bigint[];
    merkleTreePda: PublicKey;
    pendingBufferPda: PublicKey;
    vkPda: PublicKey;
  } | null> {
    // Ensure tree is synced before generating proof
    await this.syncMerkleTree();

    const [merkleTreePda] = PublicKey.findProgramAddressSync(
      [Buffer.from('merkle_tree'), this.config.poolConfig.toBuffer()],
      this.config.programId
    );
    const [pendingBufferPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('pending'), this.config.poolConfig.toBuffer()],
      this.config.programId
    );
    const [vkPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('vk_merkle_batch'), this.config.poolConfig.toBuffer()],
      this.config.programId
    );

    const merkleInfo = await this.getAccountInfoCached(merkleTreePda, 0);
    const pendingInfo = await this.getAccountInfoCached(pendingBufferPda, 0);

    if (!merkleInfo || !pendingInfo) {
      logger.info('Batch settlement: merkle tree or pending buffer not found');
      return null;
    }

    const merkleAccount = parseMerkleTreeAccount(merkleInfo.data);
    const pendingAccount = parsePendingBufferAccount(pendingInfo.data);

    const onChainRoot = merkleAccount.currentRoot;
    const onChainIndex = merkleAccount.nextLeafIndex;
    const pendingCount = pendingAccount.deposits.length;

    if (pendingCount === 0) {
      return null;
    }

    const batchSize = Math.min(pendingCount, MAX_BATCH_SIZE);
    const startIndex = onChainIndex;

    // Verify local tree matches on-chain
    const localRoot = this.merkleTree.getRoot();
    if (localRoot !== onChainRoot) {
      logger.warn('Batch settlement: local tree root mismatch', {
        localRoot: localRoot.toString(16).slice(0, 16),
        onChainRoot: onChainRoot.toString(16).slice(0, 16),
      });
      // Attempt to rebuild from events one more time
      await this.recoverMerkleTreeFromEvents(onChainIndex, onChainRoot);
      const rebuiltRoot = this.merkleTree.getRoot();
      if (rebuiltRoot !== onChainRoot) {
        throw new Error('Local tree root mismatch after recovery — cannot generate proof');
      }
    }

    const commitments = pendingAccount.deposits.slice(0, batchSize).map(d => d.commitment);
    const { paths, newRoot } = this.merkleTree.simulateBatchInsert(commitments, startIndex);

    logger.info('Batch settlement: generating proof', {
      batchSize,
      startIndex,
      pendingCount,
      oldRoot: onChainRoot.toString(16).slice(0, 16),
      newRoot: newRoot.toString(16).slice(0, 16),
    });

    const { proofBytes } = await this.generateBatchProof(
      onChainRoot,
      newRoot,
      startIndex,
      batchSize,
      commitments,
      paths
    );

    const newRootBytes = feToBytes32BE(newRoot);

    return {
      proofBytes,
      newRootBytes,
      batchSize,
      startIndex,
      commitments,
      merkleTreePda,
      pendingBufferPda,
      vkPda,
    };
  }

  /**
   * Get the Express router
   */
  getRouter(): Router {
    return this.router;
  }
}

// =============================================================================
// FACTORY FUNCTION
// =============================================================================

/**
 * Create and initialize the API extensions
 */
export async function createApiExtensions(config: ApiExtensionsConfig): Promise<RelayerApiExtensions> {
  const extensions = new RelayerApiExtensions(config);
  await extensions.initialize();
  return extensions;
}

// =============================================================================
// INTEGRATION EXAMPLE
// =============================================================================

/**
 * Example: How to integrate into existing relayer
 * 
 * In your relayer/src/index.ts:
 * 
 * ```typescript
 * import { createApiExtensions } from './api-extensions';
 * 
 * // After creating your express app:
 * const apiExtensions = await createApiExtensions({
 *   circuitsPath: path.join(__dirname, '../../circuits/build'),
 *   rpcEndpoint: process.env.RPC_ENDPOINT || 'https://api.devnet.solana.com',
 *   poolConfig: new PublicKey(process.env.POOL_CONFIG!),
 *   programId: new PublicKey(process.env.PROGRAM_ID!),
 *   treeDepth: 20,
 * });
 * 
 * // Mount the API extensions
 * app.use('/api', apiExtensions.getRouter());
 * ```
 */
