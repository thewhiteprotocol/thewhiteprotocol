import { PublicKey } from '@solana/web3.js';
import { ProofType } from './types';
/**
 * Default program ID for The White Protocol
 */
export declare const PROGRAM_ID: PublicKey;
/** Seed for PoolConfigV2 PDA */
export declare const POOL_SEED: Buffer<ArrayBuffer>;
/** Seed for MerkleTreeV2 PDA */
export declare const MERKLE_TREE_SEED: Buffer<ArrayBuffer>;
/** Seed for AssetVault PDA */
export declare const VAULT_SEED: Buffer<ArrayBuffer>;
/** Seed for SpentNullifierV2 PDA */
export declare const NULLIFIER_SEED: Buffer<ArrayBuffer>;
/** Seed for RelayerRegistry PDA */
export declare const RELAYER_REGISTRY_SEED: Buffer<ArrayBuffer>;
/** Seed for RelayerNode PDA */
export declare const RELAYER_SEED: Buffer<ArrayBuffer>;
/** Seed for ComplianceConfig PDA */
export declare const COMPLIANCE_SEED: Buffer<ArrayBuffer>;
/** Seed for PendingDepositsBuffer PDA */
export declare const PENDING_SEED: Buffer<ArrayBuffer>;
/**
 * Derive PoolConfigV2 PDA address
 *
 * Seeds: ["pool_v2", authority]
 *
 * @param programId - The White Protocol program ID
 * @param authority - Pool authority public key
 * @returns [PDA address, bump seed]
 */
export declare function findPoolConfigPda(programId: PublicKey, authority: PublicKey): [PublicKey, number];
/**
 * Derive MerkleTreeV2 PDA address
 *
 * Seeds: ["merkle_tree_v2", pool_config]
 *
 * @param programId - The White Protocol program ID
 * @param poolConfig - Pool configuration account address
 * @returns [PDA address, bump seed]
 */
export declare function findMerkleTreePda(programId: PublicKey, poolConfig: PublicKey): [PublicKey, number];
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
export declare function findAssetVaultPda(programId: PublicKey, poolConfig: PublicKey, assetId: Uint8Array): [PublicKey, number];
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
export declare function findVerificationKeyPda(programId: PublicKey, poolConfig: PublicKey, proofType: ProofType): [PublicKey, number];
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
export declare function findSpentNullifierPda(programId: PublicKey, poolConfig: PublicKey, nullifierHash: Uint8Array): [PublicKey, number];
/**
 * Derive RelayerRegistry PDA address
 *
 * Seeds: ["relayer_registry", pool_config]
 *
 * @param programId - The White Protocol program ID
 * @param poolConfig - Pool configuration account address
 * @returns [PDA address, bump seed]
 */
export declare function findRelayerRegistryPda(programId: PublicKey, poolConfig: PublicKey): [PublicKey, number];
/**
 * Derive PendingDepositsBuffer PDA address
 *
 * Seeds: ["pending_deposits", pool_config]
 *
 * @param programId - The White Protocol program ID
 * @param poolConfig - Pool configuration public key
 * @returns [PDA address, bump seed]
 */
export declare function findPendingBufferPda(programId: PublicKey, poolConfig: PublicKey): [PublicKey, number];
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
export declare function findRelayerNodePda(programId: PublicKey, registry: PublicKey, operator: PublicKey): [PublicKey, number];
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
export declare function findComplianceConfigPda(programId: PublicKey, poolConfig: PublicKey): [PublicKey, number];
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
export declare function computeAssetId(mint: PublicKey): Uint8Array;
/**
 * Derive all pool-related PDAs at once
 *
 * @param programId - The White Protocol program ID
 * @param authority - Pool authority
 * @returns Object containing all pool PDAs
 */
export declare function derivePoolPdas(programId: PublicKey, authority: PublicKey): {
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
export declare function deriveAssetVaultPdas(programId: PublicKey, poolConfig: PublicKey, assetIds: Uint8Array[]): Array<[PublicKey, number]>;
/**
 * Derive verification key PDAs for all proof types
 *
 * @param programId - The White Protocol program ID
 * @param poolConfig - Pool configuration account
 * @returns Object mapping proof type to [address, bump]
 */
export declare function deriveVerificationKeyPdas(programId: PublicKey, poolConfig: PublicKey): Record<ProofType, [PublicKey, number]>;
//# sourceMappingURL=pda.d.ts.map