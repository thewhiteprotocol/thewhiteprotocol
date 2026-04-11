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

import express, { Request, Response, Router } from 'express';
import { PublicKey, Connection } from '@solana/web3.js';
import * as snarkjs from 'snarkjs';
import * as fs from 'fs';
import * as path from 'path';
import { keccak_256 } from '@noble/hashes/sha3';

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
    console.log('[API Extensions] Poseidon hash initialized');
  } catch (err) {
    console.error('[API Extensions] Failed to initialize Poseidon:', err);
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
class ServerMerkleTree {
  private depth: number;
  private leaves: bigint[];
  private zeros: bigint[];
  
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
  
  getRoot(): bigint {
    if (this.leaves.length === 0) return this.zeros[this.depth];
    
    let level = [...this.leaves];
    const size = 1 << this.depth;
    while (level.length < size) level.push(0n);
    
    for (let d = 0; d < this.depth; d++) {
      const nextLevel: bigint[] = [];
      for (let i = 0; i < level.length; i += 2) {
        nextLevel.push(poseidonHash([level[i], level[i + 1]]));
      }
      level = nextLevel;
    }
    return level[0];
  }
  
  getMerklePath(index: number): { pathElements: bigint[]; pathIndices: number[] } {
    const pathElements: bigint[] = [];
    const pathIndices: number[] = [];
    let currentIndex = index;
    
    let level = [...this.leaves];
    const size = 1 << this.depth;
    while (level.length < size) level.push(0n);
    
    for (let d = 0; d < this.depth; d++) {
      const siblingIndex = currentIndex ^ 1;
      pathElements.push(level[siblingIndex] ?? this.zeros[d]);
      pathIndices.push(currentIndex & 1);
      
      const nextLevel: bigint[] = [];
      for (let i = 0; i < level.length; i += 2) {
        nextLevel.push(poseidonHash([level[i], level[i + 1]]));
      }
      level = nextLevel;
      currentIndex = currentIndex >> 1;
    }
    return { pathElements, pathIndices };
  }
  
  insert(commitment: bigint): number {
    const index = this.leaves.length;
    this.leaves.push(commitment);
    return index;
  }
  
  insertAt(index: number, commitment: bigint): void {
    while (this.leaves.length <= index) {
      this.leaves.push(0n);
    }
    this.leaves[index] = commitment;
  }
  
  getLeafCount(): number {
    return this.leaves.length;
  }
  
  getLeaves(): bigint[] {
    return [...this.leaves];
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
  let v = ((value % BN254_FIELD_ORDER) + BN254_FIELD_ORDER) % BN254_FIELD_ORDER;
  const out = new Uint8Array(32);
  for (let i = 31; i >= 0; i--) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
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

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
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
  
  constructor(config: ApiExtensionsConfig) {
    this.config = config;
    this.connection = new Connection(config.rpcEndpoint, 'confirmed');
    this.router = express.Router();
    this.merkleTree = null as any; // Initialized in initialize()
    
    this.setupRoutes();
  }
  
  /**
   * Initialize the API extensions (load circuits, poseidon)
   */
  async initialize(): Promise<void> {
    console.log('[API Extensions] Initializing...');
    
    // Initialize Poseidon
    await initPoseidon();
    
    // Reinitialize merkle tree now that poseidon is ready
    this.merkleTree = new ServerMerkleTree(this.config.treeDepth);
    
    // Load circuit artifacts
    await this.loadCircuitArtifacts();
    
    // Sync merkle tree from chain
    await this.syncMerkleTree();
    
    console.log('[API Extensions] Initialization complete');
  }
  
  private async loadCircuitArtifacts(): Promise<void> {
    const circuitsPath = this.config.circuitsPath;
    
    // Load deposit circuit
    const depositWasmPath = path.join(circuitsPath, 'deposit_js', 'deposit.wasm');
    const depositZkeyPath = path.join(circuitsPath, 'deposit.zkey');
    const depositVkPath = path.join(circuitsPath, 'deposit_vk.json');
    
    if (fs.existsSync(depositWasmPath)) {
      this.depositWasm = new Uint8Array(fs.readFileSync(depositWasmPath));
      console.log('[API Extensions] Loaded deposit.wasm');
    }
    if (fs.existsSync(depositZkeyPath)) {
      this.depositZkey = new Uint8Array(fs.readFileSync(depositZkeyPath));
      console.log('[API Extensions] Loaded deposit.zkey');
    }
    if (fs.existsSync(depositVkPath)) {
      this.depositVk = JSON.parse(fs.readFileSync(depositVkPath, 'utf8'));
      console.log('[API Extensions] Loaded deposit_vk.json');
    }
    
    // Load withdraw circuit
    const withdrawWasmPath = path.join(circuitsPath, 'withdraw_js', 'withdraw.wasm');
    const withdrawZkeyPath = path.join(circuitsPath, 'withdraw.zkey');
    const withdrawVkPath = path.join(circuitsPath, 'withdraw_vk.json');
    
    if (fs.existsSync(withdrawWasmPath)) {
      this.withdrawWasm = new Uint8Array(fs.readFileSync(withdrawWasmPath));
      console.log('[API Extensions] Loaded withdraw.wasm');
    }
    if (fs.existsSync(withdrawZkeyPath)) {
      this.withdrawZkey = new Uint8Array(fs.readFileSync(withdrawZkeyPath));
      console.log('[API Extensions] Loaded withdraw.zkey');
    }
    if (fs.existsSync(withdrawVkPath)) {
      this.withdrawVk = JSON.parse(fs.readFileSync(withdrawVkPath, 'utf8'));
      console.log('[API Extensions] Loaded withdraw_vk.json');
    }
  }
  
  private async syncMerkleTree(): Promise<void> {
    try {
      const [merkleTreePda] = PublicKey.findProgramAddressSync(
        [Buffer.from('merkle_tree_v2'), this.config.poolConfig.toBuffer()],
        this.config.programId
      );
      
      const accountInfo = await this.connection.getAccountInfo(merkleTreePda);
      if (!accountInfo) {
        console.log('[API Extensions] Merkle tree not found on chain, starting fresh');
        return;
      }
      
      // Parse next_leaf_index from account data
      const data = accountInfo.data;
      const nextLeafIndex = data.readUInt32LE(40);
      
      console.log(`[API Extensions] Merkle tree has ${nextLeafIndex} leaves on chain`);
      
      // TODO: Fetch actual commitments from events or database
      // For now, tree starts empty and gets populated via API calls
    } catch (err) {
      console.error('[API Extensions] Failed to sync merkle tree:', err);
    }
  }
  
  private setupRoutes(): void {
    // =========================================================================
    // POST /api/generate-commitment
    // Generate note commitment from secret, nullifier, amount, assetId
    // =========================================================================
    this.router.post('/generate-commitment', async (req: Request, res: Response) => {
      try {
        const { secret, nullifier, amount, assetId } = req.body;
        
        if (!secret || !nullifier || amount === undefined || !assetId) {
          return res.status(400).json({
            success: false,
            error: 'Missing required fields: secret, nullifier, amount, assetId',
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
        
        // Compute nullifier hash: Poseidon(nullifier, secret)
        const nullifierHash = poseidonHash([nullifierBigInt, secretBigInt]);
        
        res.json({
          success: true,
          commitment: commitment.toString(),
          commitmentHex: bytesToHex(feToBytes32BE(commitment)),
          nullifierHash: nullifierHash.toString(),
          nullifierHashHex: bytesToHex(feToBytes32BE(nullifierHash)),
        });
      } catch (error: any) {
        console.error('[generate-commitment] Error:', error);
        res.status(500).json({ success: false, error: error.message });
      }
    });
    
    // =========================================================================
    // POST /api/compute-asset-id
    // Compute asset ID from mint address
    // =========================================================================
    this.router.post('/compute-asset-id', async (req: Request, res: Response) => {
      try {
        const { mint } = req.body;
        
        if (!mint) {
          return res.status(400).json({
            success: false,
            error: 'Missing required field: mint',
          });
        }
        
        const mintPubkey = new PublicKey(mint);
        const assetId = computeAssetId(mintPubkey);
        const assetIdBigInt = assetIdToBigInt(assetId);
        
        res.json({
          success: true,
          assetId: assetIdBigInt.toString(),
          assetIdHex: bytesToHex(assetId),
          mint: mint,
        });
      } catch (error: any) {
        console.error('[compute-asset-id] Error:', error);
        res.status(500).json({ success: false, error: error.message });
      }
    });
    
    // =========================================================================
    // POST /api/deposit-proof
    // Generate deposit proof (heavy ZK operation)
    // =========================================================================
    this.router.post('/deposit-proof', async (req: Request, res: Response) => {
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
        
        console.log('[deposit-proof] Generating proof...');
        const startTime = Date.now();
        
        const circuitInput = {
          commitment: commitment.toString(),
          amount: amount.toString(),
          asset_id: assetId.toString(),
          secret: secret.toString(),
          nullifier: nullifier.toString(),
        };
        
        const { proof, publicSignals } = await snarkjs.groth16.fullProve(
          circuitInput,
          this.depositWasm,
          this.depositZkey
        );
        
        const proofTime = Date.now() - startTime;
        console.log(`[deposit-proof] Proof generated in ${proofTime}ms`);
        
        // Verify locally
        if (this.depositVk) {
          const isValid = await snarkjs.groth16.verify(this.depositVk, publicSignals, proof);
          if (!isValid) {
            return res.status(400).json({
              success: false,
              error: 'Generated proof failed local verification',
            });
          }
          console.log('[deposit-proof] Local verification passed');
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
        console.error('[deposit-proof] Error:', error);
        res.status(500).json({ success: false, error: error.message });
      }
    });
    
    // =========================================================================
    // POST /api/withdraw-proof
    // Generate withdraw proof (heavy ZK operation)
    // =========================================================================
    this.router.post('/withdraw-proof', async (req: Request, res: Response) => {
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
        
        // Validate merkle path length
        if (merklePath.length !== this.config.treeDepth || merklePathIndices.length !== this.config.treeDepth) {
          return res.status(400).json({
            success: false,
            error: `Invalid merkle path length: expected ${this.config.treeDepth}, got ${merklePath.length}`,
          });
        }
        
        console.log('[withdraw-proof] Generating proof...');
        const startTime = Date.now();
        
        // Convert recipient and relayer to scalars
        const recipientPubkey = new PublicKey(recipient);
        const relayerPubkey = new PublicKey(relayer);
        const recipientScalar = pubkeyToScalar(recipientPubkey);
        const relayerScalar = pubkeyToScalar(relayerPubkey);
        
        const circuitInput = {
          merkle_root: merkleRoot.toString(),
          nullifier_hash: nullifierHash.toString(),
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
        
        const { proof, publicSignals } = await snarkjs.groth16.fullProve(
          circuitInput,
          this.withdrawWasm,
          this.withdrawZkey
        );
        
        const proofTime = Date.now() - startTime;
        console.log(`[withdraw-proof] Proof generated in ${proofTime}ms`);
        
        // Verify locally
        if (this.withdrawVk) {
          const isValid = await snarkjs.groth16.verify(this.withdrawVk, publicSignals, proof);
          if (!isValid) {
            return res.status(400).json({
              success: false,
              error: 'Generated proof failed local verification',
            });
          }
          console.log('[withdraw-proof] Local verification passed');
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
        console.error('[withdraw-proof] Error:', error);
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
          [Buffer.from('merkle_tree_v2'), this.config.poolConfig.toBuffer()],
          this.config.programId
        );
        
        const [pendingBufferPda] = PublicKey.findProgramAddressSync(
          [Buffer.from('pending_deposits'), this.config.poolConfig.toBuffer()],
          this.config.programId
        );
        
        // Fetch accounts
        const [merkleInfo, pendingInfo] = await Promise.all([
          this.connection.getAccountInfo(merkleTreePda),
          this.connection.getAccountInfo(pendingBufferPda),
        ]);
        
        let merkleRoot = '0';
        let nextLeafIndex = 0;
        
        if (merkleInfo) {
          const data = merkleInfo.data;
          // Parse root (32 bytes at offset 8)
          const rootBytes = data.slice(8, 40);
          let root = 0n;
          for (let i = 0; i < 32; i++) {
            root = (root << 8n) | BigInt(rootBytes[i]);
          }
          merkleRoot = root.toString();
          nextLeafIndex = data.readUInt32LE(40);
        }
        
        let pendingCount = 0;
        const pendingCommitments: string[] = [];
        
        if (pendingInfo) {
          const data = pendingInfo.data;
          pendingCount = data.readUInt32LE(40);
          
          for (let i = 0; i < pendingCount; i++) {
            const start = 44 + i * 32;
            const commitmentBytes = data.slice(start, start + 32);
            let commitment = 0n;
            for (let j = 0; j < 32; j++) {
              commitment = (commitment << 8n) | BigInt(commitmentBytes[j]);
            }
            pendingCommitments.push(commitment.toString());
          }
        }
        
        res.json({
          success: true,
          poolConfig: this.config.poolConfig.toBase58(),
          programId: this.config.programId.toBase58(),
          merkle: {
            address: merkleTreePda.toBase58(),
            root: merkleRoot,
            rootHex: bytesToHex(feToBytes32BE(BigInt(merkleRoot))),
            nextLeafIndex: nextLeafIndex,
            treeDepth: this.config.treeDepth,
          },
          pending: {
            address: pendingBufferPda.toBase58(),
            count: pendingCount,
            commitments: pendingCommitments,
          },
        });
      } catch (error: any) {
        console.error('[pool-state] Error:', error);
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
        console.error('[merkle/proof] Error:', error);
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
        
        if (!commitment) {
          return res.status(400).json({
            success: false,
            error: 'Missing required field: commitment',
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
        
        const newRoot = this.merkleTree.getRoot();
        
        res.json({
          success: true,
          leafIndex: insertedIndex,
          newMerkleRoot: newRoot.toString(),
          newMerkleRootHex: bytesToHex(feToBytes32BE(newRoot)),
          totalLeaves: this.merkleTree.getLeafCount(),
        });
      } catch (error: any) {
        console.error('[merkle/insert] Error:', error);
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
          [Buffer.from('pending_deposits'), this.config.poolConfig.toBuffer()],
          this.config.programId
        );
        
        const pendingInfo = await this.connection.getAccountInfo(pendingBufferPda);
        if (pendingInfo) {
          const data = pendingInfo.data;
          const pendingCount = data.readUInt32LE(40);
          
          for (let i = 0; i < pendingCount; i++) {
            const start = 44 + i * 32;
            const commitmentBytes = data.slice(start, start + 32);
            let c = 0n;
            for (let j = 0; j < 32; j++) {
              c = (c << 8n) | BigInt(commitmentBytes[j]);
            }
            if (c === commitmentBigInt) {
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
        console.error('[note/:commitment] Error:', error);
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
        
        if (!commitment || leafIndex === undefined) {
          return res.status(400).json({
            success: false,
            error: 'Missing required fields: commitment, leafIndex',
          });
        }
        
        const commitmentBigInt = BigInt(commitment);
        this.merkleTree.insertAt(leafIndex, commitmentBigInt);
        
        res.json({
          success: true,
          commitment: commitmentBigInt.toString(),
          leafIndex,
          newMerkleRoot: this.merkleTree.getRoot().toString(),
        });
      } catch (error: any) {
        console.error('[settle-note] Error:', error);
        res.status(500).json({ success: false, error: error.message });
      }
    });
    
    // =========================================================================
    // POST /api/poseidon-hash
    // Generic Poseidon hash endpoint
    // =========================================================================
    this.router.post('/poseidon-hash', async (req: Request, res: Response) => {
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
        
        const inputsBigInt = inputs.map((i: string | number | bigint) => BigInt(i));
        const hash = poseidonHash(inputsBigInt);
        
        res.json({
          success: true,
          hash: hash.toString(),
          hashHex: bytesToHex(feToBytes32BE(hash)),
        });
      } catch (error: any) {
        console.error('[poseidon-hash] Error:', error);
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
        
        if (!pubkey) {
          return res.status(400).json({
            success: false,
            error: 'Missing required field: pubkey',
          });
        }
        
        const pubkeyObj = new PublicKey(pubkey);
        const scalar = pubkeyToScalar(pubkeyObj);
        
        res.json({
          success: true,
          pubkey: pubkey,
          scalar: scalar.toString(),
          scalarHex: bytesToHex(feToBytes32BE(scalar)),
        });
      } catch (error: any) {
        console.error('[pubkey-to-scalar] Error:', error);
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // =========================================================================
    // BUILD DEPOSIT TRANSACTION
    // =========================================================================
    this.router.post('/build-deposit-tx', async (req: Request, res: Response) => {
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
        const poolConfigInfo = await this.connection.getAccountInfo(this.config.poolConfig);
        if (!poolConfigInfo) throw new Error("Pool config not found");
        const authority = new PublicKey(poolConfigInfo.data.slice(8, 40));
        
        const [merkleTree] = PublicKey.findProgramAddressSync(
          [Buffer.from('merkle_tree_v2'), this.config.poolConfig.toBuffer()],
          this.config.programId
        );
        
        const [pendingBuffer] = PublicKey.findProgramAddressSync(
          [Buffer.from('pending_deposits'), this.config.poolConfig.toBuffer()],
          this.config.programId
        );
        
        const assetIdBytes = hexToBytes(assetId);
        const [assetVault] = PublicKey.findProgramAddressSync(
          [Buffer.from('vault_v2'), this.config.poolConfig.toBuffer(), assetIdBytes],
          this.config.programId
        );
        
        const [depositVk] = PublicKey.findProgramAddressSync(
          [Buffer.from('vk_deposit'), this.config.poolConfig.toBuffer()],
          this.config.programId
        );
        // Fetch vault token account from AssetVault state (stored, not derived)
        const assetVaultInfo = await this.connection.getAccountInfo(assetVault);
        if (!assetVaultInfo) {
          throw new Error('AssetVault not found for this asset. Asset may not be registered.');
        }
        // AssetVault layout: discriminator(8) + pool(32) + asset_id(32) + mint(32) + token_account(32)
        const vaultTokenAccount = new PublicKey(assetVaultInfo.data.slice(104, 136));
        console.log('[build-deposit-tx] Vault token account from state:', vaultTokenAccount.toBase58());

        // Get user token account
        const { getAssociatedTokenAddressSync, createAssociatedTokenAccountInstruction } = await import('@solana/spl-token');
        const userTokenAccount = getAssociatedTokenAddressSync(mintPubkey, depositor);
        
        const preInstructions: any[] = [];
        
        // Check if user ATA exists
        const userAtaInfo = await this.connection.getAccountInfo(userTokenAccount);
        if (!userAtaInfo) {
          console.log('[build-deposit-tx] User ATA does not exist, adding create instruction');
          preInstructions.push(createAssociatedTokenAccountInstruction(
            depositor, userTokenAccount, depositor, mintPubkey
          ));
        }

        // Build instruction data manually (discriminator + args)
        const discriminator = Buffer.from([53, 229, 96, 103, 104, 75, 182, 133]);
        const amountBuf = Buffer.alloc(8);
        amountBuf.writeBigUInt64LE(BigInt(amount));
        const commitmentBytes = hexToBytes(commitment);
        const proofBytes = hexToBytes(proofData);
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
        const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
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
            { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
            { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
          ],
          data: instructionData,
        });

        // Get recent blockhash
        const { blockhash, lastValidBlockHeight } = await this.connection.getLatestBlockhash();
        
        const tx = new Transaction();
        tx.recentBlockhash = blockhash;
        tx.feePayer = depositor;
        preInstructions.forEach(pre => tx.add(pre)); tx.add(ix);

        // Serialize (unsigned)
        const serializedTx = tx.serialize({ requireAllSignatures: false }).toString('base64');

        // Track commitment in local merkle tree for later proof generation
        const commitmentBigInt = BigInt('0x' + commitment);
        const insertedLeafIndex = this.merkleTree.insert(commitmentBigInt);
        console.log(`[build-deposit-tx] Tracked commitment in local tree at index ${insertedLeafIndex}`);

        res.json({
          success: true,
          transaction: serializedTx,
          blockhash,
          lastValidBlockHeight,
          leafIndex: insertedLeafIndex, // Return leaf index for frontend tracking
        });
      } catch (error: any) {
        console.error('[build-deposit-tx] Error:', error);
        res.status(500).json({ success: false, error: error.message });
      }
    });
  
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