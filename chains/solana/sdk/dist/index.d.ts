import { PublicKey, Connection, Keypair, TransactionSignature, VersionedTransaction } from '@solana/web3.js';
import BN from 'bn.js';
import { Program, AnchorProvider, BN as BN$1 } from '@coral-xyz/anchor';

/**
 * The White Protocol SDK - Poseidon Hash Implementation
 *
 * Circomlib-compatible Poseidon hash for BN254 scalar field.
 * Uses the same parameters as circomlib for circuit compatibility.
 *
 * @module crypto/poseidon
 */
/**
 * Initialize the Poseidon hasher
 * Must be called before using hash functions
 */
declare function initPoseidon(): Promise<void>;
/**
 * Hash two field elements (Merkle tree internal nodes)
 * @param left - Left child
 * @param right - Right child
 * @returns Hash as bigint
 */
declare function hashTwo(left: bigint, right: bigint): bigint;
/**
 * Hash four field elements (MASP commitment)
 * commitment = Poseidon(secret, nullifier, amount, asset_id)
 * @param a - First element (secret)
 * @param b - Second element (nullifier)
 * @param c - Third element (amount)
 * @param d - Fourth element (asset_id)
 * @returns Hash as bigint
 */
declare function hashFour(a: bigint, b: bigint, c: bigint, d: bigint): bigint;
/**
 * Compute MASP commitment
 * @param secret - Random blinding factor
 * @param nullifier - Nullifier preimage
 * @param amount - Token amount
 * @param assetId - Asset identifier
 * @returns Commitment as bigint
 */
declare function computeCommitment(secret: bigint, nullifier: bigint, amount: bigint, assetId: bigint): bigint;
/**
 * Compute nullifier hash
 * nullifier_hash = Poseidon(Poseidon(nullifier, secret), leaf_index)
 * @param nullifier - Nullifier preimage
 * @param secret - Secret blinding factor
 * @param leafIndex - Leaf position in Merkle tree
 * @returns Nullifier hash as bigint
 */
declare function computeNullifierHash(nullifier: bigint, secret: bigint, leafIndex: bigint): bigint;
/**
 * Convert Uint8Array to bigint (big-endian)
 */
declare function bytesToBigInt(bytes: Uint8Array): bigint;
/**
 * Convert bigint to Uint8Array (32 bytes, big-endian)
 */
declare function bigIntToBytes(value: bigint): Uint8Array;
/**
 * Convert bigint to field element bytes (32 bytes, little-endian for circuits)
 */
declare function bigIntToFieldBytes(value: bigint): Uint8Array;
/**
 * Generate a random field element
 */
declare function randomFieldElement(): bigint;
/**
 * BN254 scalar field modulus
 */
declare const FIELD_MODULUS: bigint;
/**
 * Check if value is a valid field element
 */
declare function isValidFieldElement(value: bigint): boolean;
/**
 * Reduce value modulo field
 */
declare function fieldMod(value: bigint): bigint;

/**
 * The White Protocol SDK - Note Management
 *
 * Handles creation, encryption, decryption, and storage of shielded notes.
 *
 * @module note/note
 */
/**
 * Represents a shielded note in The White Protocol
 */
interface Note {
    /** Random blinding factor */
    secret: bigint;
    /** Nullifier preimage */
    nullifier: bigint;
    /** Token amount */
    amount: bigint;
    /** Asset identifier */
    assetId: bigint;
    /** Commitment = Poseidon(secret, nullifier, amount, assetId) */
    commitment: bigint;
    /** Leaf index in Merkle tree (set after deposit) */
    leafIndex?: number;
    /** Merkle root at time of deposit */
    merkleRoot?: bigint;
    /** Block timestamp of deposit */
    depositTimestamp?: number;
    /** Transaction signature of deposit */
    depositSignature?: string;
}
/**
 * Serialized note format for storage
 */
interface SerializedNote {
    secret: string;
    nullifier: string;
    amount: string;
    assetId: string;
    commitment: string;
    leafIndex?: number;
    merkleRoot?: string;
    depositTimestamp?: number;
    depositSignature?: string;
}
/**
 * Note with computed nullifier hash (for withdrawal)
 */
interface NoteWithNullifier extends Note {
    /** Computed nullifier hash */
    nullifierHash: bigint;
}
/**
 * Create a new shielded note
 * @param amount - Token amount
 * @param assetId - Asset identifier (from computeAssetId)
 * @returns New note with commitment
 */
declare function createNote(amount: bigint, assetId: bigint): Promise<Note>;
/**
 * Create note from existing parameters (for recovery)
 */
declare function createNoteFromParams(secret: bigint, nullifier: bigint, amount: bigint, assetId: bigint, leafIndex?: number, merkleRoot?: bigint): Promise<Note>;
/**
 * Compute nullifier hash for a note (requires leaf index)
 * @param note - Note with leaf index set
 * @returns Note with nullifier hash
 */
declare function computeNoteNullifier(note: Note): Promise<NoteWithNullifier>;
/**
 * Serialize note to JSON-safe format
 */
declare function serializeNote(note: Note): SerializedNote;
/**
 * Deserialize note from JSON format
 */
declare function deserializeNote(data: SerializedNote): Note;
/**
 * Convert note commitment to bytes (for on-chain)
 */
declare function commitmentToBytes(commitment: bigint): Uint8Array;
/**
 * Convert bytes to commitment
 */
declare function bytesToCommitment(bytes: Uint8Array): bigint;
/**
 * Encrypt note for storage (basic encryption - use proper encryption in production)
 * @param note - Note to encrypt
 * @param password - Encryption password
 * @returns Encrypted note data
 */
declare function encryptNote(note: Note, password: string): Promise<Uint8Array>;
/**
 * Decrypt note from storage
 * @param encryptedData - Encrypted note data
 * @param password - Decryption password
 * @returns Decrypted note
 */
declare function decryptNote(encryptedData: Uint8Array, password: string): Promise<Note>;
/**
 * Note store for managing multiple notes
 */
declare class NoteStore {
    private notes;
    /**
     * Add a note to the store
     */
    add(note: Note): void;
    /**
     * Get a note by commitment
     */
    get(commitment: bigint): Note | undefined;
    /**
     * Get all unspent notes for an asset
     */
    getByAsset(assetId: bigint): Note[];
    /**
     * Get total balance for an asset
     */
    getBalance(assetId: bigint): bigint;
    /**
     * Remove a note (after spending)
     */
    remove(commitment: bigint): boolean;
    /**
     * Get all notes
     */
    getAll(): Note[];
    /**
     * Serialize store to JSON
     */
    serialize(): string;
    /**
     * Load store from JSON
     */
    static deserialize(data: string): NoteStore;
}

/**
 * The White Protocol SDK - Merkle Tree
 *
 * Client-side Merkle tree for proof generation.
 * Mirrors the on-chain incremental Merkle tree.
 *
 * @module merkle/tree
 */
/**
 * Merkle proof structure
 */
interface MerkleProof {
    /** Sibling hashes from leaf to root */
    pathElements: bigint[];
    /** Path indices (0 = left, 1 = right) */
    pathIndices: number[];
    /** Leaf value */
    leaf: bigint;
    /** Root after this leaf was inserted */
    root: bigint;
    /** Leaf index */
    leafIndex: number;
}
/**
 * Incremental Merkle Tree
 * Matches the on-chain MerkleTreeV2 structure
 */
declare class MerkleTree {
    /** Tree depth */
    readonly depth: number;
    /** Maximum number of leaves */
    readonly maxLeaves: number;
    /** Current number of leaves */
    private nextIndex;
    /** Filled subtrees (for efficient insertion) */
    private filledSubtrees;
    /** Zero values at each level */
    private zeros;
    /** All leaves (for proof generation) */
    private leaves;
    /** Root history */
    private rootHistory;
    /** Current root */
    private _root;
    constructor(depth: number);
    /**
     * Initialize Poseidon (must be called before using tree)
     */
    static create(depth: number): Promise<MerkleTree>;
    /**
     * Get current root
     */
    get root(): bigint;
    /**
     * Get next available leaf index
     */
    get nextLeafIndex(): number;
    /**
     * Check if tree is full
     */
    get isFull(): boolean;
    /**
     * Insert a leaf and return its index
     */
    insert(leaf: bigint): number;
    /**
     * Generate Merkle proof for a leaf
     */
    generateProof(leafIndex: number): MerkleProof;
    /**
     * Verify a Merkle proof
     */
    static verifyProof(proof: MerkleProof): boolean;
    /**
     * Check if a root is known (current or historical)
     */
    isKnownRoot(root: bigint): boolean;
    /**
     * Get root at a specific leaf index
     */
    getRootAtIndex(leafIndex: number): bigint | undefined;
    /**
     * Serialize tree state
     */
    serialize(): string;
    /**
     * Deserialize tree state
     */
    static deserialize(data: string): Promise<MerkleTree>;
}
/**
 * Sync Merkle tree with on-chain state
 */
declare function syncTreeWithChain(tree: MerkleTree, onChainLeaves: bigint[]): Promise<void>;

/**
 * The White Protocol SDK - Proof Generation
 *
 * Generates ZK proofs for deposits, withdrawals, and transfers.
 * Uses snarkjs for Groth16 proof generation.
 *
 * @module proof/prover
 */

/**
 * Proof type enumeration
 */
declare enum ProofType$1 {
    Deposit = 0,
    Withdraw = 1,
    JoinSplit = 2,
    Membership = 3
}
/**
 * Groth16 proof structure
 */
interface Groth16Proof {
    pi_a: string[];
    pi_b: string[][];
    pi_c: string[];
    protocol: string;
    curve: string;
}
/**
 * Proof with public signals
 */
interface ProofWithSignals {
    proof: Groth16Proof;
    publicSignals: string[];
}
/**
 * Serialized proof for on-chain submission (256 bytes)
 */
interface SerializedProof {
    proofData: Uint8Array;
    publicInputs: bigint[];
}
/**
 * Deposit proof inputs
 */
interface DepositProofInputs {
    commitment: bigint;
    amount: bigint;
    assetId: bigint;
    secret: bigint;
    nullifier: bigint;
}
/**
 * Withdraw proof inputs
 */
interface WithdrawProofInputs {
    merkleRoot: bigint;
    nullifierHash: bigint;
    assetId: bigint;
    recipient: PublicKey;
    amount: bigint;
    relayer: PublicKey;
    relayerFee: bigint;
    publicDataHash: bigint;
    secret: bigint;
    nullifier: bigint;
    leafIndex: number;
    merkleProof: MerkleProof;
}
/**
 * JoinSplit proof inputs
 */
interface JoinSplitProofInputs {
    merkleRoot: bigint;
    assetId: bigint;
    inputNotes: NoteWithNullifier[];
    outputNotes: Note[];
    publicAmount: bigint;
    relayer: PublicKey;
    relayerFee: bigint;
    inputMerkleProofs: MerkleProof[];
}
/**
 * Circuit files paths
 */
interface CircuitPaths {
    wasmPath: string;
    zkeyPath: string;
}
/**
 * Default circuit paths (relative to project root)
 */
declare const DEFAULT_CIRCUIT_PATHS: Record<ProofType$1, CircuitPaths>;
/**
 * Prover class for generating ZK proofs
 */
declare class Prover {
    private circuitPaths;
    private merkleTreeDepth;
    constructor(circuitPaths?: Partial<Record<ProofType$1, CircuitPaths>>, merkleTreeDepth?: number);
    /**
     * Generate deposit proof
     */
    generateDepositProof(inputs: DepositProofInputs): Promise<SerializedProof>;
    /**
     * Generate withdrawal proof
     */
    generateWithdrawProof(inputs: WithdrawProofInputs): Promise<SerializedProof>;
    /**
     * Generate JoinSplit proof
     */
    generateJoinSplitProof(inputs: JoinSplitProofInputs): Promise<SerializedProof>;
    /**
     * Serialize Groth16 proof to 256 bytes for on-chain verification
     */
    private serializeProof;
    private assertMerkleDepth;
    private assertCircuitArtifactsExist;
}
/**
 * Convert Solana PublicKey to scalar field element (canonical on-chain encoding)
 *
 * CANONICAL ENCODING (matches on-chain exactly):
 * scalar_bytes = 0x00 || pubkey_bytes[0..31]
 *
 * This drops the last byte of the pubkey and prefixes with 0x00 to ensure
 * the value fits in the BN254 scalar field without reduction.
 */
declare function pubkeyToScalar(pubkey: PublicKey): bigint;
/**
 * Verify proof locally (for testing)
 */
declare function verifyProofLocally(proofType: ProofType$1, proof: Groth16Proof, publicSignals: string[], vkeyPath: string): Promise<boolean>;
/**
 * Export verification key from zkey file
 */
declare function exportVerificationKey(zkeyPath: string): Promise<any>;

/**
 * The White Protocol SDK Type Definitions
 *
 * Types for interacting with the The White Protocol MASP (Multi-Asset Shielded Pool)
 */

/** 32-byte asset identifier (keccak256(mint_address)) */
type AssetId = Uint8Array;
/** 32-byte commitment value */
type Commitment = Uint8Array;
/** 32-byte nullifier hash */
type NullifierHash = Uint8Array;
/** 32-byte Merkle root */
type MerkleRoot = Uint8Array;
/**
 * Proof types supported by The White Protocol
 * Must match on-chain ProofType enum
 */
declare enum ProofType {
    /** Deposit proof - proves valid commitment */
    Deposit = 0,
    /** Withdrawal proof - proves valid nullifier and membership */
    Withdraw = 1,
    /** Join-Split proof - proves value conservation in internal transfer */
    JoinSplit = 2,
    /** Membership proof - proves stake >= threshold without spending */
    Membership = 3,
    /** Withdraw V2 proof - proves join-split with change output */
    WithdrawV2 = 5
}
/**
 * Returns the seed bytes for a proof type (for PDA derivation)
 */
declare function proofTypeSeed(proofType: ProofType): Uint8Array;
/**
 * Shielded action types for CPI
 */
declare enum ShieldedActionType {
    /** Swap via DEX (e.g., Jupiter) */
    DexSwap = 0,
    /** Deposit to lending protocol */
    LendingDeposit = 1,
    /** Borrow from lending protocol */
    LendingBorrow = 2,
    /** Stake tokens */
    Stake = 3,
    /** Unstake tokens */
    Unstake = 4,
    /** Custom action (protocol-specific) */
    Custom = 255
}
/**
 * Spend type for nullifiers
 */
declare enum SpendType {
    /** Standard withdrawal */
    Withdraw = 0,
    /** Join-Split transfer */
    JoinSplit = 1,
    /** Shielded CPI action */
    ShieldedCpi = 2
}
/**
 * Asset type classification
 */
declare enum AssetType {
    /** Standard SPL Token */
    SplToken = 0,
    /** Wrapped native SOL */
    NativeSol = 1,
    /** Token-2022 standard */
    Token2022 = 2
}
/**
 * Arguments for initializing a new MASP pool
 */
interface InitializePoolRequest {
    /** Merkle tree depth (4-24, determines max 2^depth commitments) */
    treeDepth: number;
    /** Number of historical roots to maintain (min 30) */
    rootHistorySize: number;
}
/**
 * Arguments for registering a new asset
 */
interface RegisterAssetRequest {
    /** SPL token mint address */
    mint: PublicKey;
    /** Optional: pre-computed asset ID (if omitted, computed from mint) */
    assetId?: Uint8Array;
}
/**
 * Arguments for depositing to the MASP
 */
interface DepositRequest {
    /** Amount to deposit (in token base units) */
    amount: BN | number;
    /**
     * Commitment = hash(secret, nullifier, amount, asset_id)
     * Must be generated off-chain using appropriate cryptographic primitives
     */
    commitment: Uint8Array;
    /** Asset identifier */
    assetId: Uint8Array;
    /** SPL token mint address */
    mint: PublicKey;
    /** Depositor's token account */
    depositorTokenAccount: PublicKey;
    /** Optional encrypted note for recipient */
    encryptedNote?: Uint8Array;
}
/**
 * Arguments for withdrawing from the MASP
 */
interface WithdrawRequest {
    /**
     * Groth16 proof bytes (exactly 256 bytes)
     * Generated off-chain by the withdrawal circuit
     */
    proofData: Uint8Array;
    /** Merkle root at time of proof generation */
    merkleRoot: Uint8Array;
    /** Nullifier hash to prevent double-spend */
    nullifierHash: Uint8Array;
    /** Recipient's public key */
    recipient: PublicKey;
    /** Withdrawal amount */
    amount: BN | number;
    /** Asset identifier */
    assetId: Uint8Array;
    /** SPL token mint address */
    mint: PublicKey;
    /** Recipient's token account */
    recipientTokenAccount: PublicKey;
    /** Relayer's token account (for fee) */
    relayerTokenAccount: PublicKey;
    /** Fee paid to relayer (must be <= amount/10) */
    relayerFee: BN | number;
    /** Optional relayer node account (for registered relayers) */
    relayerNode?: PublicKey;
}
/**
 * Arguments for private transfer (Join-Split)
 * Reserved for v2.1 - will throw NotImplemented
 */
interface PrivateTransferRequest {
    /** Groth16 proof for join-split circuit */
    proofData: Uint8Array;
    /** Merkle root */
    merkleRoot: Uint8Array;
    /** Nullifiers for spent inputs (max 2) */
    inputNullifiers: Uint8Array[];
    /** New commitments for outputs (max 2) */
    outputCommitments: Uint8Array[];
    /** Net public flow (positive = deposit, negative = withdraw, 0 = internal) */
    publicAmount: BN | number;
    /** Asset being transferred */
    assetId: Uint8Array;
    /** Fee for relayer */
    relayerFee: BN | number;
    /** Optional encrypted notes for output recipients */
    encryptedOutputs?: Uint8Array[];
}
/**
 * Arguments for proving pool membership
 * Reserved for v2.1 - will throw NotImplemented
 */
interface ProveMembershipRequest {
    /** Groth16 proof for membership circuit */
    proofData: Uint8Array;
    /** Merkle root */
    merkleRoot: Uint8Array;
    /** Minimum commitment value to prove */
    threshold: BN | number;
    /** Asset for threshold check */
    assetId: Uint8Array;
}
/**
 * Arguments for setting a verification key
 */
interface SetVerificationKeyRequest {
    /** Type of proof this VK is for */
    proofType: ProofType;
    /** Alpha point in G1 (64 bytes) */
    vkAlphaG1: Uint8Array;
    /** Beta point in G2 (128 bytes) */
    vkBetaG2: Uint8Array;
    /** Gamma point in G2 (128 bytes) */
    vkGammaG2: Uint8Array;
    /** Delta point in G2 (128 bytes) */
    vkDeltaG2: Uint8Array;
    /** IC points for public inputs (64 bytes each) */
    vkIc: Uint8Array[];
}
/**
 * Arguments for registering a relayer
 */
interface RegisterRelayerRequest {
    /** Fee in basis points (1 bp = 0.01%) */
    feeBps: number;
    /** Metadata URI (max 200 chars) */
    metadataUri: string;
}
/**
 * Arguments for updating a relayer
 */
interface UpdateRelayerRequest {
    /** New fee in basis points (optional) */
    feeBps?: number;
    /** New metadata URI (optional) */
    metadataUri?: string;
    /** Whether relayer is active (optional) */
    isActive?: boolean;
}
/**
 * Arguments for configuring the relayer registry
 */
interface ConfigureRelayerRegistryRequest {
    /** Minimum fee in basis points */
    minFeeBps: number;
    /** Maximum fee in basis points */
    maxFeeBps: number;
    /** Whether stake is required to register */
    requireStake: boolean;
    /** Minimum stake amount (if required) */
    minStakeAmount: BN | number;
}
/**
 * Arguments for configuring compliance
 */
interface ConfigureComplianceRequest {
    /** Whether encrypted note is required for deposits */
    requireEncryptedNote: boolean;
    /** Optional audit public key */
    auditPubkey?: PublicKey;
    /** Metadata schema version */
    metadataSchemaVersion: number;
}
/**
 * Pool configuration account data
 */
interface PoolConfigV2 {
    /** Current pool authority */
    authority: PublicKey;
    /** Pending authority for 2-step transfer */
    pendingAuthority: PublicKey;
    /** Associated Merkle tree account */
    merkleTree: PublicKey;
    /** Relayer registry account */
    relayerRegistry: PublicKey;
    /** Compliance configuration account */
    complianceConfig: PublicKey;
    /** Merkle tree depth */
    treeDepth: number;
    /** Number of registered assets */
    registeredAssetCount: number;
    /** Maximum number of assets allowed */
    maxAssets: number;
    /** PDA bump seed */
    bump: number;
    /** Pool paused flag */
    isPaused: boolean;
    /** VK configuration flags (bitfield) */
    vkConfigured: number;
    /** VK lock flags (bitfield) */
    vkLocked: number;
    /** Total deposits across all assets */
    totalDeposits: BN;
    /** Total withdrawals across all assets */
    totalWithdrawals: BN;
    /** Total join-split operations */
    totalJoinSplits: BN;
    /** Total membership proofs verified */
    totalMembershipProofs: BN;
    /** Pool creation timestamp */
    createdAt: BN;
    /** Last activity timestamp */
    lastActivityAt: BN;
    /** Schema version */
    version: number;
    /** Feature flags */
    featureFlags: number;
}
/**
 * Merkle tree account data
 */
interface MerkleTreeV2 {
    /** Reference to parent pool */
    pool: PublicKey;
    /** Tree depth */
    depth: number;
    /** Current number of leaves */
    nextLeafIndex: number;
    /** Maximum leaves (2^depth) */
    maxLeaves: number;
    /** Current root */
    currentRoot: Uint8Array;
    /** Size of root history */
    rootHistorySize: number;
    /** Circular buffer position */
    rootHistoryPosition: number;
    /** Tree initialization timestamp */
    initializedAt: BN;
    /** Last insertion timestamp */
    lastInsertAt: BN;
    /** Root history (variable length) */
    rootHistory: Uint8Array[];
    /** Filled subtrees for efficient insertion */
    filledSubtrees: Uint8Array[];
}
/**
 * Asset vault account data
 */
interface AssetVault {
    /** Reference to parent pool */
    pool: PublicKey;
    /** Asset identifier */
    assetId: Uint8Array;
    /** SPL token mint address */
    mint: PublicKey;
    /** Token account holding shielded assets */
    tokenAccount: PublicKey;
    /** PDA bump seed */
    bump: number;
    /** Whether this asset is active */
    isActive: boolean;
    /** Whether deposits are enabled */
    depositsEnabled: boolean;
    /** Whether withdrawals are enabled */
    withdrawalsEnabled: boolean;
    /** Minimum deposit amount */
    minDeposit: BN;
    /** Maximum deposit amount per transaction */
    maxDeposit: BN;
    /** Total value deposited (lifetime) */
    totalDeposited: BN;
    /** Total value withdrawn (lifetime) */
    totalWithdrawn: BN;
    /** Current shielded balance */
    shieldedBalance: BN;
    /** Number of deposits */
    depositCount: BN;
    /** Number of withdrawals */
    withdrawalCount: BN;
    /** Asset registration timestamp */
    registeredAt: BN;
    /** Last activity timestamp */
    lastActivityAt: BN;
    /** Token decimals */
    decimals: number;
    /** Asset type */
    assetType: number;
    /** Optional metadata URI */
    metadataUri: string;
}
/**
 * Verification key account data
 */
interface VerificationKeyAccountV2 {
    /** Reference to parent pool */
    pool: PublicKey;
    /** Proof type this VK is for */
    proofType: number;
    /** Whether the VK is initialized */
    isInitialized: boolean;
    /** PDA bump seed */
    bump: number;
    /** Alpha point in G1 (64 bytes) */
    vkAlphaG1: Uint8Array;
    /** Beta point in G2 (128 bytes) */
    vkBetaG2: Uint8Array;
    /** Gamma point in G2 (128 bytes) */
    vkGammaG2: Uint8Array;
    /** Delta point in G2 (128 bytes) */
    vkDeltaG2: Uint8Array;
    /** IC points for public inputs */
    vkIc: Uint8Array[];
    /** Number of public inputs */
    publicInputsCount: number;
    /** VK hash for integrity */
    vkHash: Uint8Array;
    /** When VK was set */
    setAt: BN;
    /** Who set the VK */
    setBy: PublicKey;
}
/**
 * Spent nullifier account data
 */
interface SpentNullifierV2 {
    /** Reference to parent pool */
    pool: PublicKey;
    /** The nullifier hash */
    nullifierHash: Uint8Array;
    /** Asset ID for this nullifier */
    assetId: Uint8Array;
    /** How this nullifier was spent */
    spendType: number;
    /** When it was spent */
    spentAt: BN;
    /** Slot when spent */
    spentSlot: BN;
    /** Who submitted the spend */
    spentBy: PublicKey;
    /** PDA bump */
    bump: number;
}
/**
 * Relayer registry account data
 */
interface RelayerRegistry {
    /** Reference to parent pool */
    pool: PublicKey;
    /** PDA bump seed */
    bump: number;
    /** Whether the registry is active */
    isActive: boolean;
    /** Number of registered relayers */
    relayerCount: number;
    /** Minimum fee in basis points */
    minFeeBps: number;
    /** Maximum fee in basis points */
    maxFeeBps: number;
    /** Whether stake is required */
    requireStake: boolean;
    /** Minimum stake amount */
    minStakeAmount: BN;
    /** Total fees collected */
    totalFeesCollected: BN;
    /** Total transactions processed */
    totalTransactions: BN;
    /** Registry creation timestamp */
    createdAt: BN;
    /** Last update timestamp */
    lastUpdatedAt: BN;
}
/**
 * Relayer node account data
 */
interface RelayerNode {
    /** Reference to registry */
    registry: PublicKey;
    /** Operator public key */
    operator: PublicKey;
    /** Fee in basis points */
    feeBps: number;
    /** Whether relayer is active */
    isActive: boolean;
    /** PDA bump seed */
    bump: number;
    /** Total fees earned */
    totalFeesEarned: BN;
    /** Total transactions processed */
    totalTransactions: BN;
    /** Registration timestamp */
    registeredAt: BN;
    /** Last activity timestamp */
    lastActivityAt: BN;
    /** Metadata URI */
    metadataUri: string;
}
/**
 * Relayer info (simplified for queries)
 */
interface RelayerInfo {
    /** Relayer node account address */
    address: PublicKey;
    /** Operator public key */
    operator: PublicKey;
    /** Fee in basis points */
    feeBps: number;
    /** Whether relayer is active */
    isActive: boolean;
    /** Metadata URI */
    metadataUri: string;
}
/**
 * Compliance configuration account data
 */
interface ComplianceConfig {
    /** Reference to parent pool */
    pool: PublicKey;
    /** PDA bump seed */
    bump: number;
    /** Whether encrypted note is required */
    requireEncryptedNote: boolean;
    /** Whether audit is enabled */
    auditEnabled: boolean;
    /** Audit public key */
    auditPubkey: PublicKey;
    /** Compliance level */
    complianceLevel: number;
    /** Metadata schema version */
    metadataSchemaVersion: number;
    /** Creation timestamp */
    createdAt: BN;
    /** Last update timestamp */
    lastUpdatedAt: BN;
}
/**
 * Deposit event data (privacy-preserving)
 *
 * Does NOT include amount or depositor to prevent correlation attacks.
 * These fields are intentionally omitted from production events.
 */
interface DepositMaspEvent {
    pool: PublicKey;
    commitment: Uint8Array;
    leafIndex: number;
    /** New Merkle root after insertion */
    merkleRoot: Uint8Array;
    assetId: Uint8Array;
    timestamp: BN;
}
/**
 * Withdraw event data (privacy-preserving)
 *
 * Does NOT include recipient or amount to minimize correlation attacks.
 * While these are visible in transaction accounts, omitting from events
 * makes large-scale indexing significantly harder.
 */
interface WithdrawMaspEvent {
    pool: PublicKey;
    nullifierHash: Uint8Array;
    assetId: Uint8Array;
    relayer: PublicKey;
    relayerFee: BN;
    timestamp: BN;
}
/**
 * Result of pool initialization
 */
interface InitializePoolResult {
    /** Pool config account address */
    poolConfig: PublicKey;
    /** Merkle tree account address */
    merkleTree: PublicKey;
    /** Relayer registry account address */
    relayerRegistry: PublicKey;
    /** Compliance config account address */
    complianceConfig: PublicKey;
    /** Transaction signature */
    signature: string;
}
/**
 * Result of deposit operation
 */
interface DepositResult {
    /** Transaction signature */
    signature: string;
    /** Leaf index in Merkle tree */
    leafIndex: number;
}
/**
 * Result of withdrawal operation
 */
interface WithdrawResult {
    /** Transaction signature */
    signature: string;
}
/** Minimum Merkle tree depth */
declare const MIN_TREE_DEPTH = 4;
/** Maximum Merkle tree depth */
declare const MAX_TREE_DEPTH = 24;
/** Minimum root history size */
declare const MIN_ROOT_HISTORY_SIZE = 30;
/** Default root history size */
declare const DEFAULT_ROOT_HISTORY_SIZE = 100;
/** Size of Groth16 proof in bytes */
declare const PROOF_SIZE = 256;
/** Size of G1 point in bytes */
declare const G1_POINT_SIZE = 64;
/** Size of G2 point in bytes */
declare const G2_POINT_SIZE = 128;
/** Maximum metadata URI length */
declare const MAX_METADATA_URI_LEN = 200;
/** Maximum encrypted note size */
declare const MAX_ENCRYPTED_NOTE_SIZE = 1024;
/** Native SOL asset ID (special case) */
declare const NATIVE_SOL_ASSET_ID: Uint8Array<ArrayBuffer>;
/** Feature flag: MASP enabled */
declare const FEATURE_MASP: number;
/** Feature flag: JoinSplit enabled */
declare const FEATURE_JOIN_SPLIT: number;
/** Feature flag: Membership proofs enabled */
declare const FEATURE_MEMBERSHIP: number;
/** Feature flag: Shielded CPI enabled */
declare const FEATURE_SHIELDED_CPI: number;
/** Feature flag: Compliance required */
declare const FEATURE_COMPLIANCE: number;
/**
 * Convert a number to BN
 */
declare function toBN(value: BN | number | string | bigint): BN;
/**
 * Convert bytes to hex string
 */
declare function toHex(bytes: Uint8Array): string;
/**
 * Convert hex string to bytes
 */
declare function fromHex(hex: string): Uint8Array;
/**
 * Check if two byte arrays are equal
 */
declare function bytesEqual(a: Uint8Array, b: Uint8Array): boolean;
/**
 * Check if a commitment is valid (non-zero, correct length)
 */
declare function isValidCommitment(commitment: Uint8Array): boolean;
/**
 * Check if a nullifier is valid (non-zero, correct length)
 */
declare function isValidNullifier(nullifier: Uint8Array): boolean;
/**
 * Check if proof data has valid length
 */
declare function isValidProofLength(proofData: Uint8Array): boolean;

/**
 * Default program ID for The White Protocol
 */
declare const PROGRAM_ID: PublicKey;
/** Seed for PoolConfigV2 PDA */
declare const POOL_SEED: Buffer<ArrayBuffer>;
/** Seed for MerkleTreeV2 PDA */
declare const MERKLE_TREE_SEED: Buffer<ArrayBuffer>;
/** Seed for AssetVault PDA */
declare const VAULT_SEED: Buffer<ArrayBuffer>;
/** Seed for SpentNullifierV2 PDA */
declare const NULLIFIER_SEED: Buffer<ArrayBuffer>;
/** Seed for RelayerRegistry PDA */
declare const RELAYER_REGISTRY_SEED: Buffer<ArrayBuffer>;
/** Seed for RelayerNode PDA */
declare const RELAYER_SEED: Buffer<ArrayBuffer>;
/** Seed for ComplianceConfig PDA */
declare const COMPLIANCE_SEED: Buffer<ArrayBuffer>;
/** Seed for PendingDepositsBuffer PDA */
declare const PENDING_SEED: Buffer<ArrayBuffer>;
/**
 * Derive PoolConfigV2 PDA address
 *
 * Seeds: ["pool_v2", authority]
 *
 * @param programId - The White Protocol program ID
 * @param authority - Pool authority public key
 * @returns [PDA address, bump seed]
 */
declare function findPoolConfigPda(programId: PublicKey, authority: PublicKey): [PublicKey, number];
/**
 * Derive MerkleTreeV2 PDA address
 *
 * Seeds: ["merkle_tree_v2", pool_config]
 *
 * @param programId - The White Protocol program ID
 * @param poolConfig - Pool configuration account address
 * @returns [PDA address, bump seed]
 */
declare function findMerkleTreePda(programId: PublicKey, poolConfig: PublicKey): [PublicKey, number];
/**
 * Derive AssetVault PDA address
 *
 * Seeds: ["vault_v2", pool_config, asset_id]
 *
 * @param programId - The White Protocol program ID
 * @param poolConfig - Pool configuration account address
 * @param assetId - 32-byte asset identifier
 * @returns [PDA address, bump seed]
 */
declare function findAssetVaultPda(programId: PublicKey, poolConfig: PublicKey, assetId: Uint8Array): [PublicKey, number];
/**
 * Derive VerificationKeyAccountV2 PDA address
 *
 * Seeds: [proof_type_seed, pool_config]
 *
 * @param programId - The White Protocol program ID
 * @param poolConfig - Pool configuration account address
 * @param proofType - Type of proof
 * @returns [PDA address, bump seed]
 */
declare function findVerificationKeyPda(programId: PublicKey, poolConfig: PublicKey, proofType: ProofType): [PublicKey, number];
/**
 * Derive SpentNullifierV2 PDA address
 *
 * Seeds: ["nullifier_v2", pool_config, nullifier_hash]
 *
 * @param programId - The White Protocol program ID
 * @param poolConfig - Pool configuration account address
 * @param nullifierHash - 32-byte nullifier hash
 * @returns [PDA address, bump seed]
 */
declare function findSpentNullifierPda(programId: PublicKey, poolConfig: PublicKey, nullifierHash: Uint8Array): [PublicKey, number];
/**
 * Derive RelayerRegistry PDA address
 *
 * Seeds: ["relayer_registry", pool_config]
 *
 * @param programId - The White Protocol program ID
 * @param poolConfig - Pool configuration account address
 * @returns [PDA address, bump seed]
 */
declare function findRelayerRegistryPda(programId: PublicKey, poolConfig: PublicKey): [PublicKey, number];
/**
 * Derive PendingDepositsBuffer PDA address
 *
 * Seeds: ["pending_deposits", pool_config]
 *
 * @param programId - The White Protocol program ID
 * @param poolConfig - Pool configuration public key
 * @returns [PDA address, bump seed]
 */
declare function findPendingBufferPda(programId: PublicKey, poolConfig: PublicKey): [PublicKey, number];
/**
 * Derive RelayerNode PDA address
 *
 * Seeds: ["relayer", registry, operator]
 *
 * @param programId - The White Protocol program ID
 * @param registry - Relayer registry account address
 * @param operator - Relayer operator public key
 * @returns [PDA address, bump seed]
 */
declare function findRelayerNodePda(programId: PublicKey, registry: PublicKey, operator: PublicKey): [PublicKey, number];
/**
 * Derive ComplianceConfig PDA address
 *
 * Seeds: ["compliance", pool_config]
 *
 * @param programId - The White Protocol program ID
 * @param poolConfig - Pool configuration account address
 * @returns [PDA address, bump seed]
 */
/**
 * Derive ComplianceConfig PDA address
 *
 * Seeds: ["compliance", pool_config]
 *
 * @param programId - The White Protocol program ID
 * @param poolConfig - Pool configuration account address
 * @returns [PDA address, bump seed]
 */
declare function findComplianceConfigPda(programId: PublicKey, poolConfig: PublicKey): [PublicKey, number];
/**
 * Compute asset ID from mint address using keccak256
 *
 * This matches the on-chain computation:
 * asset_id = 0x00 || keccak256("white:asset_id:v1" || mint)[0..31]
 *
 * The leading zero byte ensures the value fits in BN254 Fr field.
 *
 * @param mint - SPL token mint address
 * @returns 32-byte asset identifier
 */
declare function computeAssetId(mint: PublicKey): Uint8Array;
/**
 * Derive all pool-related PDAs at once
 *
 * @param programId - The White Protocol program ID
 * @param authority - Pool authority
 * @returns Object containing all pool PDAs
 */
declare function derivePoolPdas(programId: PublicKey, authority: PublicKey): {
    poolConfig: PublicKey;
    poolConfigBump: number;
    merkleTree: PublicKey;
    merkleTreeBump: number;
    relayerRegistry: PublicKey;
    relayerRegistryBump: number;
    complianceConfig: PublicKey;
    complianceConfigBump: number;
};
/**
 * Derive asset vault PDAs for multiple assets
 *
 * @param programId - The White Protocol program ID
 * @param poolConfig - Pool configuration account
 * @param assetIds - Array of asset IDs
 * @returns Array of [vault address, bump] tuples
 */
declare function deriveAssetVaultPdas(programId: PublicKey, poolConfig: PublicKey, assetIds: Uint8Array[]): Array<[PublicKey, number]>;
/**
 * Derive verification key PDAs for all proof types
 *
 * @param programId - The White Protocol program ID
 * @param poolConfig - Pool configuration account
 * @returns Object mapping proof type to [address, bump]
 */
declare function deriveVerificationKeyPdas(programId: PublicKey, poolConfig: PublicKey): Record<ProofType, [PublicKey, number]>;

/**
 * The White Protocol SDK Client
 *
 * Simplified client for interacting with the The White Protocol MASP protocol
 */

/** Default program ID */
/** Supported LST mints for Yield Mode */
declare const SUPPORTED_LST_MINTS: {
    JitoSOL: PublicKey;
    mSOL: PublicKey;
};
/**
 * Options for creating a WhiteProtocolClient
 */
interface WhiteProtocolClientOptions {
    provider?: AnchorProvider;
    connection?: Connection;
    wallet?: Keypair;
    programId?: PublicKey;
    idl?: any;
}
/**
 * Main client for interacting with the The White Protocol MASP protocol
 */
declare class WhiteProtocolClient {
    readonly program: Program;
    readonly provider: AnchorProvider;
    readonly programId: PublicKey;
    constructor(options: WhiteProtocolClientOptions);
    /**
     * Get authority public key
     */
    get authority(): PublicKey;
    /**
     * Initialize a new MASP pool
     */
    initializePool(treeDepth: number, rootHistorySize: number): Promise<{
        signature: TransactionSignature;
        poolConfig: PublicKey;
        merkleTree: PublicKey;
    }>;
    /**
     * Initialize pool registries (relayer registry, compliance config)
     */
    initializePoolRegistries(poolConfig: PublicKey): Promise<TransactionSignature>;
    /**
     * Register an asset (SPL token) in the pool
     */
    registerAsset(poolConfig: PublicKey, mint: PublicKey): Promise<TransactionSignature>;
    /**
     * Set verification key for a proof type
     */
    setVerificationKey(poolConfig: PublicKey, proofType: ProofType, vkAlphaG1: Uint8Array, vkBetaG2: Uint8Array, vkGammaG2: Uint8Array, vkDeltaG2: Uint8Array, vkIc: Uint8Array[]): Promise<TransactionSignature>;
    /**
     * Deposit funds into the shielded pool
     */
    deposit(poolConfig: PublicKey, mint: PublicKey, amount: bigint | BN$1, commitment: Uint8Array, proofData: Uint8Array, encryptedNote?: Uint8Array | null): Promise<{
        signature: TransactionSignature;
        leafIndex: number;
    }>;
    withdraw(poolConfig: PublicKey, mint: PublicKey, recipient: PublicKey, amount: bigint | BN$1, merkleRoot: Uint8Array, nullifierHash: Uint8Array, proofData: Uint8Array, relayerFee?: bigint | BN$1): Promise<{
        signature: TransactionSignature;
    }>;
    /**
     * Withdraw V2 (join-split with change)
     * Enables partial withdrawals with a change output
     *
     * @param poolConfig - Pool configuration account
     * @param mint - Token mint address
     * @param recipient - Recipient address for withdrawn funds
     * @param amount - Gross withdrawal amount (includes relayer fee)
     * @param merkleRoot - Merkle root for proof verification
     * @param nullifierHash0 - Primary nullifier hash
     * @param nullifierHash1 - Secondary nullifier hash (pass zeros if unused)
     * @param changeCommitment - Change output commitment
     * @param proofData - ZK proof bytes (256 bytes)
     * @param relayerFee - Fee for relayer service
     */
    withdrawV2(poolConfig: PublicKey, mint: PublicKey, recipient: PublicKey, amount: bigint | BN$1, merkleRoot: Uint8Array, nullifierHash0: Uint8Array, nullifierHash1: Uint8Array, changeCommitment: Uint8Array, proofData: Uint8Array, relayerFee?: bigint | BN$1): Promise<{
        signature: TransactionSignature;
    }>;
    /**
     * Fetch pool configuration
     */
    fetchPoolConfig(poolConfig: PublicKey): Promise<any>;
    /**
     * Fetch Merkle tree state
     */
    fetchMerkleTree(merkleTree: PublicKey): Promise<any>;
    /**
     * Fetch asset vault
     */
    fetchAssetVault(assetVault: PublicKey): Promise<any>;
    /**
     * Check if nullifier has been spent
     */
    isNullifierSpent(poolConfig: PublicKey, nullifierHash: Uint8Array): Promise<boolean>;
    /**
     * Deposit SOL with Yield Mode (swap to LST first)
     *
     * Flow:
     * 1. Swap SOL -> LST using Jupiter
     * 2. Deposit LST to pool (existing deposit flow)
     * 3. Store note metadata with principal SOL amount
     *
     * @param params - Deposit parameters with yield mode options
     * @returns Swap signature and deposit signature
     */
    depositYieldSol(params: {
        poolConfig: PublicKey;
        merkleTree: PublicKey;
        assetVault: PublicKey;
        mintLST: PublicKey;
        amountSolLamports: bigint;
        slippageBps?: number;
    }): Promise<{
        swapSig: string;
        depositSig: string;
        lstAmountDeposited: bigint;
        principalSol: bigint;
    }>;
    /**
     * Withdraw with Yield Mode (5% performance fee on positive yield)
     *
     * Flow:
     * 1. Fetch current LST -> SOL quote
     * 2. Calculate fee: max(0, current_value - principal) * 0.05
     * 3. Generate withdraw_v2 proof with relayer_fee
     * 4. Submit via relayer endpoint (relayer signs)
     *
     * @param params - Withdraw parameters with yield mode options
     * @returns Withdraw signature and optional swap signature
     */
    withdrawYieldV2(params: {
        poolConfig: PublicKey;
        merkleTree: PublicKey;
        assetVault: PublicKey;
        mintLST: PublicKey;
        recipient: PublicKey;
        amountLstAtomic: bigint;
        principalSolLamports: bigint;
        swapToSol?: boolean;
        slippageBps?: number;
    }): Promise<{
        withdrawSig: string;
        lstAmount: bigint;
        feeSol: bigint;
        feeLst: bigint;
        swapSig?: string;
    }>;
}
/**
 * Create a WhiteProtocolClient from IDL JSON
 */
declare function createWhiteProtocolClient(provider: AnchorProvider, idl: any, programId?: PublicKey): WhiteProtocolClient;

/**
 * Jupiter Aggregator Integration for Yield Mode
 *
 * Provides SOL <-> LST swap functionality using Jupiter V6 API
 */

/**
 * Jupiter quote response (V6 API)
 */
type JupiterQuote = {
    inputMint: string;
    outputMint: string;
    inAmount: string;
    outAmount: string;
    otherAmountThreshold: string;
    swapMode: "ExactIn" | "ExactOut";
    slippageBps: number;
    priceImpactPct: string;
    routePlan: any[];
    contextSlot?: number;
    timeTaken?: number;
};
/**
 * Jupiter swap transaction response
 */
type JupiterSwapResponse = {
    swapTransaction: string;
    lastValidBlockHeight?: number;
    prioritizationFeeLamports?: number;
};
/**
 * Get Jupiter quote for exact input swap
 *
 * @param params - Quote parameters
 * @returns Jupiter quote with route and amounts
 */
declare function jupiterQuoteExactIn(params: {
    inputMint: PublicKey;
    outputMint: PublicKey;
    amount: bigint;
    slippageBps: number;
}): Promise<JupiterQuote>;
/**
 * Execute Jupiter swap with exact input
 *
 * @param params - Swap execution parameters
 * @returns Transaction signature
 */
declare function jupiterSwapExactIn(params: {
    connection: Connection;
    userPublicKey: PublicKey;
    quote: JupiterQuote;
    signTransaction: (tx: VersionedTransaction) => Promise<VersionedTransaction>;
}): Promise<{
    signature: string;
}>;
/**
 * Build a no-op memo transaction (reserved for future use)
 */
declare function buildNoopMemoTx(params: {
    payer: PublicKey;
    memo: string;
    recentBlockhash: string;
}): VersionedTransaction;

/**
 * The White Protocol SDK
 *
 * Complete TypeScript SDK for The White Protocol - Privacy-preserving Multi-Asset Shielded Pool.
 *
 * @packageDocumentation
 */

/**
 * Initialize the SDK (must be called before using crypto functions)
 */
declare function initializeSDK(): Promise<void>;
/**
 * SDK version
 */
declare const SDK_VERSION = "2.0.0";
/**
 * Check if SDK is production ready
 */
declare const IS_PRODUCTION_READY = false;
declare const SDK_STATUS = "alpha";
/**
 * Protocol name
 */
declare const PROTOCOL_NAME = "The White Protocol";

export { type AssetId, AssetType, type AssetVault, COMPLIANCE_SEED, type CircuitPaths, type Commitment, type ComplianceConfig, type ConfigureComplianceRequest, type ConfigureRelayerRegistryRequest, DEFAULT_CIRCUIT_PATHS, DEFAULT_ROOT_HISTORY_SIZE, type DepositMaspEvent, type DepositProofInputs, type DepositRequest, type DepositResult, FEATURE_COMPLIANCE, FEATURE_JOIN_SPLIT, FEATURE_MASP, FEATURE_MEMBERSHIP, FEATURE_SHIELDED_CPI, FIELD_MODULUS, G1_POINT_SIZE, G2_POINT_SIZE, type Groth16Proof, IS_PRODUCTION_READY, type InitializePoolRequest, type InitializePoolResult, type JoinSplitProofInputs, type JupiterQuote, type JupiterSwapResponse, MAX_ENCRYPTED_NOTE_SIZE, MAX_METADATA_URI_LEN, MAX_TREE_DEPTH, MERKLE_TREE_SEED, MIN_ROOT_HISTORY_SIZE, MIN_TREE_DEPTH, type MerkleProof, type MerkleRoot, MerkleTree, type MerkleTreeV2, NATIVE_SOL_ASSET_ID, NULLIFIER_SEED, type Note, NoteStore, type NoteWithNullifier, type NullifierHash, PENDING_SEED, POOL_SEED, PROGRAM_ID, PROOF_SIZE, PROTOCOL_NAME, type PoolConfigV2, type PrivateTransferRequest, ProofType, type ProofWithSignals, type ProveMembershipRequest, Prover, RELAYER_REGISTRY_SEED, RELAYER_SEED, type RegisterAssetRequest, type RegisterRelayerRequest, type RelayerInfo, type RelayerNode, type RelayerRegistry, SDK_STATUS, SDK_VERSION, SUPPORTED_LST_MINTS, type SerializedNote, type SerializedProof, type SetVerificationKeyRequest, ShieldedActionType, SpendType, type SpentNullifierV2, type UpdateRelayerRequest, VAULT_SEED, type VerificationKeyAccountV2, WhiteProtocolClient, type WhiteProtocolClientOptions, type WithdrawMaspEvent, type WithdrawProofInputs, type WithdrawRequest, type WithdrawResult, bigIntToBytes, bigIntToFieldBytes, buildNoopMemoTx, bytesEqual, bytesToBigInt, bytesToCommitment, commitmentToBytes, computeAssetId, computeCommitment, computeNoteNullifier, computeNullifierHash, createNote, createNoteFromParams, createWhiteProtocolClient, decryptNote, deriveAssetVaultPdas, derivePoolPdas, deriveVerificationKeyPdas, deserializeNote, encryptNote, exportVerificationKey, fieldMod, findAssetVaultPda, findComplianceConfigPda, findMerkleTreePda, findPendingBufferPda, findPoolConfigPda, findRelayerNodePda, findRelayerRegistryPda, findSpentNullifierPda, findVerificationKeyPda, fromHex, hashFour, hashTwo, initPoseidon, initializeSDK, isValidCommitment, isValidFieldElement, isValidNullifier, isValidProofLength, jupiterQuoteExactIn, jupiterSwapExactIn, proofTypeSeed, pubkeyToScalar, randomFieldElement, serializeNote, syncTreeWithChain, toBN, toHex, verifyProofLocally };
