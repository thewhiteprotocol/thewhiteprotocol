/**
 * Shared constants for The White Protocol
 * Used across all chains (Solana, Base, etc.)
 */

/** BN254 scalar field order - used by circom/snarkjs */
export const FIELD_PRIME = BigInt(
  '21888242871839275222246405745257275088548364400416034343698204186575808495617'
);

/** Default Merkle tree depth */
export const MERKLE_TREE_DEPTH = 20;

/** Maximum number of leaves in the Merkle tree: 2^20 */
export const MAX_LEAVES = 2 ** MERKLE_TREE_DEPTH;

/** Default batch size for settlement */
export const DEFAULT_BATCH_SIZE = 1;

/** Maximum batch size for settlement */
export const MAX_BATCH_SIZE = 10;

/** Relayer fee in basis points (50 = 0.5%) */
export const DEFAULT_RELAYER_FEE_BPS = 50;

/** Yield relayer fee in basis points (500 = 5%) */
export const YIELD_RELAYER_FEE_BPS = 500;

/** Minimum withdrawal amount (in token smallest unit) */
export const MIN_WITHDRAWAL_AMOUNT = 100;

/** Maximum number of yield-bearing mints per pool */
export const MAX_YIELD_MINTS = 8;

/** Seed prefixes for PDAs (shared across chains for consistency) */
export const SEEDS = {
  POOL_CONFIG: 'pool_config',
  MERKLE_TREE: 'merkle_tree',
  PENDING_DEPOSITS: 'pending',
  ASSET_VAULT: 'vault',
  VERIFICATION_KEY: 'vk',
  RELAYER_REGISTRY: 'relayer_registry',
  RELAYER_NODE: 'relayer_node',
  YIELD_REGISTRY: 'yield_registry',
  SPENT_NULLIFIER: 'nullifier',
} as const;

/** Proof types */
export enum ProofType {
  Deposit = 0,
  Withdraw = 1,
  JoinSplit = 2,
  Membership = 3,
  MerkleBatchUpdate = 4,
  WithdrawV2 = 5,
}

/**
 * Get circuit file paths
 * @param fromRoot - Whether paths should be from monorepo root (true) or package directory (false)
 */
export function getCircuitPaths(fromRoot: boolean = true) {
  const prefix = fromRoot ? '' : '../../';
  return {
    [ProofType.Deposit]: {
      wasm: `${prefix}circuits/deposit/build/deposit_js/deposit.wasm`,
      zkey: `${prefix}circuits/deposit/build/deposit.zkey`,
      vkey: `${prefix}circuits/deposit/build/deposit_vk.json`,
    },
    [ProofType.Withdraw]: {
      wasm: `${prefix}circuits/withdraw/build/withdraw_js/withdraw.wasm`,
      zkey: `${prefix}circuits/withdraw/build/withdraw.zkey`,
      vkey: `${prefix}circuits/withdraw/build/withdraw_vk.json`,
    },
    [ProofType.JoinSplit]: {
      wasm: `${prefix}circuits/joinsplit/build/joinsplit_js/joinsplit.wasm`,
      zkey: `${prefix}circuits/joinsplit/build/joinsplit.zkey`,
      vkey: `${prefix}circuits/joinsplit/build/joinsplit_vk.json`,
    },
    [ProofType.Membership]: {
      wasm: `${prefix}circuits/membership/build/membership_js/membership.wasm`,
      zkey: `${prefix}circuits/membership/build/membership.zkey`,
      vkey: `${prefix}circuits/membership/build/membership_vk.json`,
    },
    [ProofType.MerkleBatchUpdate]: {
      wasm: `${prefix}circuits/merkle_batch_update/build/merkle_batch_update_js/merkle_batch_update.wasm`,
      zkey: `${prefix}circuits/merkle_batch_update/build/merkle_batch_update.zkey`,
      vkey: `${prefix}circuits/merkle_batch_update/build/verification_key.json`,
    },
    [ProofType.WithdrawV2]: {
      wasm: `${prefix}circuits/withdraw_v2/build/withdraw_v2_js/withdraw_v2.wasm`,
      zkey: `${prefix}circuits/withdraw_v2/build/withdraw_v2.zkey`,
      vkey: `${prefix}circuits/withdraw_v2/build/withdraw_v2_vk.json`,
    },
  } as const;
}

/** Circuit file paths (from monorepo root) */
export const CIRCUIT_PATHS = getCircuitPaths(true);
