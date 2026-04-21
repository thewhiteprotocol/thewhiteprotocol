/**
 * The White Protocol - Core Library
 * 
 * Chain-agnostic primitives for zero-knowledge private transactions.
 * Used by both Solana and Base chain implementations.
 */

// Constants
export {
  FIELD_PRIME,
  MERKLE_TREE_DEPTH,
  MAX_LEAVES,
  DEFAULT_BATCH_SIZE,
  MAX_BATCH_SIZE,
  DEFAULT_RELAYER_FEE_BPS,
  YIELD_RELAYER_FEE_BPS,
  MIN_WITHDRAWAL_AMOUNT,
  MAX_YIELD_MINTS,
  SEEDS,
  ProofType,
  CIRCUIT_PATHS,
} from './constants.js';

// Types
export type {
  ProofData,
  MerkleProof,
  Note,
  Commitment,
  DepositProofInputs,
  WithdrawProofInputs,
  JoinSplitProofInputs,
  MerkleBatchUpdateProofInputs,
  NullifierData,
  WithdrawalRequest,
  RelayerResponse,
  AssetId,
  PoolConfig,
  PendingDeposit,
} from './types.js';

// Crypto utilities
export {
  initializePoseidon,
  poseidonHash2,
  poseidonHash,
  computeAssetId,
  computeAssetIdBigInt,
  computeCommitment,
  computeNullifierHash,
  pubkeyToScalar,
  randomFieldElement,
  bigintToBytes32,
  bytes32ToBigint,
  computeMerkleRoot,
  computeZeroValues,
  verifyMerkleProof,
  formatProofForOnChain,
  parseProofFromOnChain,
} from './crypto.js';

// Proof generation
export {
  generateProof,
  verifyProof,
  generateSerializedProof,
  exportSolidityVerifier,
  ProofGenerator,
} from './proof.js';

// Stealth addresses
export * from './stealth/index.js';

// Version
export const VERSION = '1.0.0';
