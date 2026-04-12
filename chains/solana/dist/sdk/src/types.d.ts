/**
 * pSOL v2 SDK Type Definitions
 *
 * Types for interacting with the pSOL v2 MASP (Multi-Asset Shielded Pool)
 */
import { PublicKey } from '@solana/web3.js';
import BN from 'bn.js';
/** 32-byte asset identifier (keccak256(mint_address)) */
export type AssetId = Uint8Array;
/** 32-byte commitment value */
export type Commitment = Uint8Array;
/** 32-byte nullifier hash */
export type NullifierHash = Uint8Array;
/** 32-byte Merkle root */
export type MerkleRoot = Uint8Array;
/**
 * Proof types supported by pSOL v2
 * Must match on-chain ProofType enum
 */
export declare enum ProofType {
    /** Deposit proof - proves valid commitment */
    Deposit = 0,
    /** Withdrawal proof - proves valid nullifier and membership */
    Withdraw = 1,
    /** Join-Split proof - proves value conservation in internal transfer */
    JoinSplit = 2,
    /** Membership proof - proves stake >= threshold without spending */
    Membership = 3
}
/**
 * Returns the seed bytes for a proof type (for PDA derivation)
 */
export declare function proofTypeSeed(proofType: ProofType): Uint8Array;
/**
 * Shielded action types for CPI
 */
export declare enum ShieldedActionType {
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
export declare enum SpendType {
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
export declare enum AssetType {
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
export interface InitializePoolRequest {
    /** Merkle tree depth (4-24, determines max 2^depth commitments) */
    treeDepth: number;
    /** Number of historical roots to maintain (min 30) */
    rootHistorySize: number;
}
/**
 * Arguments for registering a new asset
 */
export interface RegisterAssetRequest {
    /** SPL token mint address */
    mint: PublicKey;
    /** Optional: pre-computed asset ID (if omitted, computed from mint) */
    assetId?: Uint8Array;
}
/**
 * Arguments for depositing to the MASP
 */
export interface DepositRequest {
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
export interface WithdrawRequest {
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
export interface PrivateTransferRequest {
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
export interface ProveMembershipRequest {
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
export interface SetVerificationKeyRequest {
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
export interface RegisterRelayerRequest {
    /** Fee in basis points (1 bp = 0.01%) */
    feeBps: number;
    /** Metadata URI (max 200 chars) */
    metadataUri: string;
}
/**
 * Arguments for updating a relayer
 */
export interface UpdateRelayerRequest {
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
export interface ConfigureRelayerRegistryRequest {
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
export interface ConfigureComplianceRequest {
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
export interface PoolConfigV2 {
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
export interface MerkleTreeV2 {
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
export interface AssetVault {
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
export interface VerificationKeyAccountV2 {
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
export interface SpentNullifierV2 {
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
export interface RelayerRegistry {
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
export interface RelayerNode {
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
export interface RelayerInfo {
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
export interface ComplianceConfig {
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
export interface DepositMaspEvent {
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
export interface WithdrawMaspEvent {
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
export interface InitializePoolResult {
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
export interface DepositResult {
    /** Transaction signature */
    signature: string;
    /** Leaf index in Merkle tree */
    leafIndex: number;
}
/**
 * Result of withdrawal operation
 */
export interface WithdrawResult {
    /** Transaction signature */
    signature: string;
}
/** Minimum Merkle tree depth */
export declare const MIN_TREE_DEPTH = 4;
/** Maximum Merkle tree depth */
export declare const MAX_TREE_DEPTH = 24;
/** Minimum root history size */
export declare const MIN_ROOT_HISTORY_SIZE = 30;
/** Default root history size */
export declare const DEFAULT_ROOT_HISTORY_SIZE = 100;
/** Size of Groth16 proof in bytes */
export declare const PROOF_SIZE = 256;
/** Size of G1 point in bytes */
export declare const G1_POINT_SIZE = 64;
/** Size of G2 point in bytes */
export declare const G2_POINT_SIZE = 128;
/** Maximum metadata URI length */
export declare const MAX_METADATA_URI_LEN = 200;
/** Maximum encrypted note size */
export declare const MAX_ENCRYPTED_NOTE_SIZE = 1024;
/** Native SOL asset ID (special case) */
export declare const NATIVE_SOL_ASSET_ID: Uint8Array<ArrayBuffer>;
/** Feature flag: MASP enabled */
export declare const FEATURE_MASP: number;
/** Feature flag: JoinSplit enabled */
export declare const FEATURE_JOIN_SPLIT: number;
/** Feature flag: Membership proofs enabled */
export declare const FEATURE_MEMBERSHIP: number;
/** Feature flag: Shielded CPI enabled */
export declare const FEATURE_SHIELDED_CPI: number;
/** Feature flag: Compliance required */
export declare const FEATURE_COMPLIANCE: number;
/**
 * Convert a number to BN
 */
export declare function toBN(value: BN | number | string | bigint): BN;
/**
 * Convert bytes to hex string
 */
export declare function toHex(bytes: Uint8Array): string;
/**
 * Convert hex string to bytes
 */
export declare function fromHex(hex: string): Uint8Array;
/**
 * Check if two byte arrays are equal
 */
export declare function bytesEqual(a: Uint8Array, b: Uint8Array): boolean;
/**
 * Check if a commitment is valid (non-zero, correct length)
 */
export declare function isValidCommitment(commitment: Uint8Array): boolean;
/**
 * Check if a nullifier is valid (non-zero, correct length)
 */
export declare function isValidNullifier(nullifier: Uint8Array): boolean;
/**
 * Check if proof data has valid length
 */
export declare function isValidProofLength(proofData: Uint8Array): boolean;
//# sourceMappingURL=types.d.ts.map