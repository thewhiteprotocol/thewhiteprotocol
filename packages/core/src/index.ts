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
  computeAssetIdV1,
  computeAssetIdV2,
  computeAssetIdBigInt,
  computeAssetIdV1BigInt,
  computeAssetIdV2BigInt,
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

// Domain registry
export {
  ChainFamily,
  ProtocolDomain,
  type ProtocolDomainId,
  decomposeDomainId,
  composeDomainId,
  domainIdToBytes,
  domainIdToName,
} from './domains.js';

// Stealth addresses
export * from './stealth/index.js';

// Bridge message format
export {
  BridgeMessageType,
  BRIDGE_MESSAGE_DOMAIN_SEPARATOR,
  BRIDGE_MESSAGE_ENCODED_LENGTH,
  encodeBridgeMessageV1,
  hashBridgeMessageV1,
  hashEncodedBridgeMessageV1,
  validateBridgeMessageV1,
  assertValidBridgeMessageV1,
  parseBridgeMessageV1Json,
  bridgeMessageV1JsonReplacer,
} from './bridge-message.js';
export type {
  BridgeMessageV1,
  BridgeMessageValidationError,
} from './bridge-message.js';

// Bridge amount normalization
export {
  normalizeBridgeAmount,
  validateNormalizationParams,
  buildDestinationBridgeMintMessageFromSourceBridgeOut,
  BridgeAmountError,
} from './bridge-amount.js';
export type {
  NormalizationMode,
  NormalizeBridgeAmountParams,
  BridgeAmountNormalizationError,
  BuildBridgeMintParams,
} from './bridge-amount.js';

// Version
export const VERSION = '1.0.0';
