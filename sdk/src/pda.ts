import { PublicKey } from '@solana/web3.js';
import { ProofType, proofTypeSeed } from './types';
import { keccak_256 } from '@noble/hashes/sha3';

/**
 * Default program ID for The White Protocol
 */
export const PROGRAM_ID = new PublicKey('BmtMrkgvVML9Gk7Bt6JRqweHAwW69oFTohaBRaLbgqpb');

// ============================================================================
// SEED CONSTANTS
// ============================================================================

/** Seed for PoolConfigV2 PDA */
export const POOL_SEED = Buffer.from('white_pool');

/** Seed for MerkleTreeV2 PDA */
export const MERKLE_TREE_SEED = Buffer.from('merkle_tree');

/** Seed for AssetVault PDA */
export const VAULT_SEED = Buffer.from('vault');

/** Seed for SpentNullifierV2 PDA */
export const NULLIFIER_SEED = Buffer.from('nullifier');

/** Seed for RelayerRegistry PDA */
export const RELAYER_REGISTRY_SEED = Buffer.from('relayer_registry');

/** Seed for RelayerNode PDA */
export const RELAYER_SEED = Buffer.from('relayer');

/** Seed for ComplianceConfig PDA */
export const COMPLIANCE_SEED = Buffer.from('compliance');
/** Seed for PendingDepositsBuffer PDA */
export const PENDING_SEED = Buffer.from('pending');

// ============================================================================
// PDA DERIVATION FUNCTIONS
// ============================================================================

/**
 * Derive PoolConfigV2 PDA address
 *
 * Seeds: ["pool_v2", authority]
 *
 * @param programId - The White Protocol program ID
 * @param authority - Pool authority public key
 * @returns [PDA address, bump seed]
 */
export function findPoolConfigPda(
  programId: PublicKey,
  authority: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [POOL_SEED, authority.toBuffer()],
    programId
  );
}

/**
 * Derive MerkleTreeV2 PDA address
 *
 * Seeds: ["merkle_tree_v2", pool_config]
 *
 * @param programId - The White Protocol program ID
 * @param poolConfig - Pool configuration account address
 * @returns [PDA address, bump seed]
 */
export function findMerkleTreePda(
  programId: PublicKey,
  poolConfig: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [MERKLE_TREE_SEED, poolConfig.toBuffer()],
    programId
  );
}

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
export function findAssetVaultPda(
  programId: PublicKey,
  poolConfig: PublicKey,
  assetId: Uint8Array
): [PublicKey, number] {
  if (assetId.length !== 32) {
    throw new Error('Asset ID must be 32 bytes');
  }
  return PublicKey.findProgramAddressSync(
    [VAULT_SEED, poolConfig.toBuffer(), Buffer.from(assetId)],
    programId
  );
}

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
export function findVerificationKeyPda(
  programId: PublicKey,
  poolConfig: PublicKey,
  proofType: ProofType
): [PublicKey, number] {
  const seed = proofTypeSeed(proofType);
  return PublicKey.findProgramAddressSync(
    [seed, poolConfig.toBuffer()],
    programId
  );
}

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
export function findSpentNullifierPda(
  programId: PublicKey,
  poolConfig: PublicKey,
  nullifierHash: Uint8Array
): [PublicKey, number] {
  if (nullifierHash.length !== 32) {
    throw new Error('Nullifier hash must be 32 bytes');
  }
  return PublicKey.findProgramAddressSync(
    [NULLIFIER_SEED, poolConfig.toBuffer(), Buffer.from(nullifierHash)],
    programId
  );
}

/**
 * Derive RelayerRegistry PDA address
 *
 * Seeds: ["relayer_registry", pool_config]
 *
 * @param programId - The White Protocol program ID
 * @param poolConfig - Pool configuration account address
 * @returns [PDA address, bump seed]
 */
export function findRelayerRegistryPda(
  programId: PublicKey,
  poolConfig: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [RELAYER_REGISTRY_SEED, poolConfig.toBuffer()],
    programId
  );
}

/**
 * Derive PendingDepositsBuffer PDA address
 *
 * Seeds: ["pending_deposits", pool_config]
 *
 * @param programId - The White Protocol program ID
 * @param poolConfig - Pool configuration public key
 * @returns [PDA address, bump seed]
 */
export function findPendingBufferPda(
  programId: PublicKey,
  poolConfig: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [PENDING_SEED, poolConfig.toBuffer()],
    programId
  );
}

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
export function findRelayerNodePda(
  programId: PublicKey,
  registry: PublicKey,
  operator: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [RELAYER_SEED, registry.toBuffer(), operator.toBuffer()],
    programId
  );
}

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
export function findComplianceConfigPda(
  programId: PublicKey,
  poolConfig: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [COMPLIANCE_SEED, poolConfig.toBuffer()],
    programId
  );
}

// ============================================================================
// ASSET ID HELPERS
// ============================================================================


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
export function computeAssetId(mint: PublicKey): Uint8Array {
  // Concatenate prefix and mint bytes
  const prefix = Buffer.from('white:asset_id:v1');
  const mintBytes = mint.toBuffer();
  const input = Buffer.concat([prefix, mintBytes]);
  
  // Compute keccak256 hash
  const hash = keccak_256(input);
  
  // Build output: 0x00 || hash[0..31]
  const out = new Uint8Array(32);
  out[0] = 0; // Leading zero for BN254 compatibility
  out.set(hash.slice(0, 31), 1);
  
  return out;
}

// ============================================================================
// BATCH HELPERS
// ============================================================================

/**
 * Derive all pool-related PDAs at once
 *
 * @param programId - The White Protocol program ID
 * @param authority - Pool authority
 * @returns Object containing all pool PDAs
 */
export function derivePoolPdas(
  programId: PublicKey,
  authority: PublicKey
): {
  poolConfig: PublicKey;
  poolConfigBump: number;
  merkleTree: PublicKey;
  merkleTreeBump: number;
  relayerRegistry: PublicKey;
  relayerRegistryBump: number;
  complianceConfig: PublicKey;
  complianceConfigBump: number;
} {
  const [poolConfig, poolConfigBump] = findPoolConfigPda(programId, authority);
  const [merkleTree, merkleTreeBump] = findMerkleTreePda(programId, poolConfig);
  const [relayerRegistry, relayerRegistryBump] = findRelayerRegistryPda(programId, poolConfig);
  const [complianceConfig, complianceConfigBump] = findComplianceConfigPda(programId, poolConfig);

  return {
    poolConfig,
    poolConfigBump,
    merkleTree,
    merkleTreeBump,
    relayerRegistry,
    relayerRegistryBump,
    complianceConfig,
    complianceConfigBump,
  };
}

/**
 * Derive asset vault PDAs for multiple assets
 *
 * @param programId - The White Protocol program ID
 * @param poolConfig - Pool configuration account
 * @param assetIds - Array of asset IDs
 * @returns Array of [vault address, bump] tuples
 */
export function deriveAssetVaultPdas(
  programId: PublicKey,
  poolConfig: PublicKey,
  assetIds: Uint8Array[]
): Array<[PublicKey, number]> {
  return assetIds.map(assetId => findAssetVaultPda(programId, poolConfig, assetId));
}

/**
 * Derive verification key PDAs for all proof types
 *
 * @param programId - The White Protocol program ID
 * @param poolConfig - Pool configuration account
 * @returns Object mapping proof type to [address, bump]
 */
export function deriveVerificationKeyPdas(
  programId: PublicKey,
  poolConfig: PublicKey
): Record<ProofType, [PublicKey, number]> {
  return {
    [ProofType.Deposit]: findVerificationKeyPda(programId, poolConfig, ProofType.Deposit),
    [ProofType.Withdraw]: findVerificationKeyPda(programId, poolConfig, ProofType.Withdraw),
    [ProofType.JoinSplit]: findVerificationKeyPda(programId, poolConfig, ProofType.JoinSplit),
    [ProofType.Membership]: findVerificationKeyPda(programId, poolConfig, ProofType.Membership),
    [ProofType.WithdrawV2]: findVerificationKeyPda(programId, poolConfig, ProofType.WithdrawV2),
  };
}
