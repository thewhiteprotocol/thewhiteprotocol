/**
 * Shared types for The White Protocol
 * Chain-agnostic data structures
 */

/** Serialized Groth16 proof for on-chain submission (256 bytes) */
export interface ProofData {
  /** 256 bytes of proof data */
  proofData: Uint8Array;
  /** Public inputs as big integers */
  publicInputs: bigint[];
}

/** Merkle proof for tree membership verification */
export interface MerkleProof {
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

/** Private note representing a deposit */
export interface Note {
  /** Secret value (private) */
  secret: bigint;
  /** Nullifier value (private) */
  nullifier: bigint;
  /** Token amount deposited */
  amount: bigint;
  /** Asset ID (hash of token mint/address) */
  assetId: bigint;
  /** Commitment hash (public) */
  commitment: bigint;
  /** Leaf index in Merkle tree */
  leafIndex?: number;
}

/** Commitment data stored on-chain */
export interface Commitment {
  /** The commitment hash */
  hash: bigint;
  /** Asset ID */
  assetId: bigint;
  /** Amount deposited */
  amount: bigint;
}

/** Deposit proof inputs */
export interface DepositProofInputs {
  /** The commitment being proven */
  commitment: bigint;
  /** Amount deposited */
  amount: bigint;
  /** Asset ID */
  assetId: bigint;
  /** Secret value */
  secret: bigint;
  /** Nullifier value */
  nullifier: bigint;
}

/** Withdraw proof inputs */
export interface WithdrawProofInputs {
  /** Current Merkle root */
  merkleRoot: bigint;
  /** Nullifier hash (prevents double-spend) */
  nullifierHash: bigint;
  /** Asset ID being withdrawn */
  assetId: bigint;
  /** Recipient address (as scalar) */
  recipient: bigint;
  /** Amount to withdraw */
  amount: bigint;
  /** Relayer address (as scalar) */
  relayer: bigint;
  /** Relayer fee */
  relayerFee: bigint;
  /** Public data hash (reserved) */
  publicDataHash: bigint;
  /** Note secret */
  secret: bigint;
  /** Note nullifier */
  nullifier: bigint;
  /** Leaf index in tree */
  leafIndex: number;
  /** Merkle proof for leaf */
  merkleProof: MerkleProof;
}

/** JoinSplit proof inputs (for 2-input -> 2-output transactions) */
export interface JoinSplitProofInputs {
  /** Current Merkle root */
  merkleRoot: bigint;
  /** Asset ID */
  assetId: bigint;
  /** Input notes with nullifiers */
  inputNotes: Array<{
    secret: bigint;
    nullifier: bigint;
    amount: bigint;
    leafIndex: number;
    merkleProof: MerkleProof;
  }>;
  /** Output notes */
  outputNotes: Array<{
    secret: bigint;
    nullifier: bigint;
    amount: bigint;
  }>;
  /** Public amount (positive = deposit, negative = withdraw) */
  publicAmount: bigint;
  /** Relayer address */
  relayer: bigint;
  /** Relayer fee */
  relayerFee: bigint;
}

/** Merkle batch update proof inputs */
export interface MerkleBatchUpdateProofInputs {
  /** Previous Merkle root */
  oldRoot: bigint;
  /** New Merkle root after insertion */
  newRoot: bigint;
  /** Starting leaf index for batch */
  startIndex: number;
  /** Number of commitments in batch */
  batchSize: number;
  /** Hash of all commitments in batch */
  commitmentsHash: bigint;
  /** Commitments being inserted */
  commitments: bigint[];
  /** Merkle paths for each commitment */
  pathElements: bigint[][];
}

/** Nullifier hash computation result */
export interface NullifierData {
  /** The nullifier hash */
  hash: bigint;
  /** Associated commitment */
  commitment: bigint;
  /** Leaf index */
  leafIndex: number;
}

/** Transaction request for relayer */
export interface WithdrawalRequest {
  /** Proof data (hex string) */
  proofData: string;
  /** Merkle root (hex string) */
  merkleRoot: string;
  /** Nullifier hash (hex string) */
  nullifierHash: string;
  /** Recipient address */
  recipient: string;
  /** Amount to withdraw (string for precision) */
  amount: string;
  /** Asset ID (hex string) */
  assetId: string;
  /** Token mint/contract address */
  mint: string;
  /** Optional relayer fee */
  relayerFee?: string;
}

/** Relayer response */
export interface RelayerResponse {
  /** Whether the request succeeded */
  success: boolean;
  /** Transaction signature/hash */
  signature?: string;
  /** Error message if failed */
  error?: string;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/** Chain-agnostic asset identifier */
export interface AssetId {
  /** Chain ID (e.g., 'solana', 'base') */
  chain: string;
  /** Token address/mint on that chain */
  address: string;
  /** Computed asset ID hash */
  hash: Uint8Array;
}

/** Pool configuration (chain-agnostic representation) */
export interface PoolConfig {
  /** Pool identifier */
  address: string;
  /** Current Merkle root */
  merkleRoot: bigint;
  /** Next available leaf index */
  nextLeafIndex: number;
  /** Pool authority */
  authority: string;
  /** Supported assets */
  assets: string[];
  /** Is pool paused */
  isPaused: boolean;
}

/** Pending deposit in buffer */
export interface PendingDeposit {
  /** Commitment hash */
  commitment: Uint8Array;
  /** Timestamp when deposited */
  timestamp: number;
}
