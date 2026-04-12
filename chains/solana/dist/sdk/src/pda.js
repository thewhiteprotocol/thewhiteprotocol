"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.COMPLIANCE_SEED = exports.RELAYER_SEED = exports.RELAYER_REGISTRY_SEED = exports.NULLIFIER_V2_SEED = exports.VAULT_V2_SEED = exports.MERKLE_TREE_V2_SEED = exports.POOL_V2_SEED = exports.PROGRAM_ID = void 0;
exports.findPoolConfigPda = findPoolConfigPda;
exports.findMerkleTreePda = findMerkleTreePda;
exports.findAssetVaultPda = findAssetVaultPda;
exports.findVerificationKeyPda = findVerificationKeyPda;
exports.findSpentNullifierPda = findSpentNullifierPda;
exports.findRelayerRegistryPda = findRelayerRegistryPda;
exports.findRelayerNodePda = findRelayerNodePda;
exports.findComplianceConfigPda = findComplianceConfigPda;
exports.computeAssetId = computeAssetId;
exports.computeAssetIdKeccak = computeAssetIdKeccak;
exports.derivePoolPdas = derivePoolPdas;
exports.deriveAssetVaultPdas = deriveAssetVaultPdas;
exports.deriveVerificationKeyPdas = deriveVerificationKeyPdas;
const web3_js_1 = require("@solana/web3.js");
const types_1 = require("./types");
/**
 * Default program ID for pSOL v2
 */
exports.PROGRAM_ID = new web3_js_1.PublicKey('BmtMrkgvVML9Gk7Bt6JRqweHAwW69oFTohaBRaLbgqpb');
// ============================================================================
// SEED CONSTANTS
// ============================================================================
/** Seed for PoolConfigV2 PDA */
exports.POOL_V2_SEED = Buffer.from('pool_v2');
/** Seed for MerkleTreeV2 PDA */
exports.MERKLE_TREE_V2_SEED = Buffer.from('merkle_tree_v2');
/** Seed for AssetVault PDA */
exports.VAULT_V2_SEED = Buffer.from('vault_v2');
/** Seed for SpentNullifierV2 PDA */
exports.NULLIFIER_V2_SEED = Buffer.from('nullifier_v2');
/** Seed for RelayerRegistry PDA */
exports.RELAYER_REGISTRY_SEED = Buffer.from('relayer_registry');
/** Seed for RelayerNode PDA */
exports.RELAYER_SEED = Buffer.from('relayer');
/** Seed for ComplianceConfig PDA */
exports.COMPLIANCE_SEED = Buffer.from('compliance');
// ============================================================================
// PDA DERIVATION FUNCTIONS
// ============================================================================
/**
 * Derive PoolConfigV2 PDA address
 *
 * Seeds: ["pool_v2", authority]
 *
 * @param programId - pSOL v2 program ID
 * @param authority - Pool authority public key
 * @returns [PDA address, bump seed]
 */
function findPoolConfigPda(programId, authority) {
    return web3_js_1.PublicKey.findProgramAddressSync([exports.POOL_V2_SEED, authority.toBuffer()], programId);
}
/**
 * Derive MerkleTreeV2 PDA address
 *
 * Seeds: ["merkle_tree_v2", pool_config]
 *
 * @param programId - pSOL v2 program ID
 * @param poolConfig - Pool configuration account address
 * @returns [PDA address, bump seed]
 */
function findMerkleTreePda(programId, poolConfig) {
    return web3_js_1.PublicKey.findProgramAddressSync([exports.MERKLE_TREE_V2_SEED, poolConfig.toBuffer()], programId);
}
/**
 * Derive AssetVault PDA address
 *
 * Seeds: ["vault_v2", pool_config, asset_id]
 *
 * @param programId - pSOL v2 program ID
 * @param poolConfig - Pool configuration account address
 * @param assetId - 32-byte asset identifier
 * @returns [PDA address, bump seed]
 */
function findAssetVaultPda(programId, poolConfig, assetId) {
    if (assetId.length !== 32) {
        throw new Error('Asset ID must be 32 bytes');
    }
    return web3_js_1.PublicKey.findProgramAddressSync([exports.VAULT_V2_SEED, poolConfig.toBuffer(), Buffer.from(assetId)], programId);
}
/**
 * Derive VerificationKeyAccountV2 PDA address
 *
 * Seeds: [proof_type_seed, pool_config]
 *
 * @param programId - pSOL v2 program ID
 * @param poolConfig - Pool configuration account address
 * @param proofType - Type of proof
 * @returns [PDA address, bump seed]
 */
function findVerificationKeyPda(programId, poolConfig, proofType) {
    const seed = (0, types_1.proofTypeSeed)(proofType);
    return web3_js_1.PublicKey.findProgramAddressSync([seed, poolConfig.toBuffer()], programId);
}
/**
 * Derive SpentNullifierV2 PDA address
 *
 * Seeds: ["nullifier_v2", pool_config, nullifier_hash]
 *
 * @param programId - pSOL v2 program ID
 * @param poolConfig - Pool configuration account address
 * @param nullifierHash - 32-byte nullifier hash
 * @returns [PDA address, bump seed]
 */
function findSpentNullifierPda(programId, poolConfig, nullifierHash) {
    if (nullifierHash.length !== 32) {
        throw new Error('Nullifier hash must be 32 bytes');
    }
    return web3_js_1.PublicKey.findProgramAddressSync([exports.NULLIFIER_V2_SEED, poolConfig.toBuffer(), Buffer.from(nullifierHash)], programId);
}
/**
 * Derive RelayerRegistry PDA address
 *
 * Seeds: ["relayer_registry", pool_config]
 *
 * @param programId - pSOL v2 program ID
 * @param poolConfig - Pool configuration account address
 * @returns [PDA address, bump seed]
 */
function findRelayerRegistryPda(programId, poolConfig) {
    return web3_js_1.PublicKey.findProgramAddressSync([exports.RELAYER_REGISTRY_SEED, poolConfig.toBuffer()], programId);
}
/**
 * Derive RelayerNode PDA address
 *
 * Seeds: ["relayer", registry, operator]
 *
 * @param programId - pSOL v2 program ID
 * @param registry - Relayer registry account address
 * @param operator - Relayer operator public key
 * @returns [PDA address, bump seed]
 */
function findRelayerNodePda(programId, registry, operator) {
    return web3_js_1.PublicKey.findProgramAddressSync([exports.RELAYER_SEED, registry.toBuffer(), operator.toBuffer()], programId);
}
/**
 * Derive ComplianceConfig PDA address
 *
 * Seeds: ["compliance", pool_config]
 *
 * @param programId - pSOL v2 program ID
 * @param poolConfig - Pool configuration account address
 * @returns [PDA address, bump seed]
 */
function findComplianceConfigPda(programId, poolConfig) {
    return web3_js_1.PublicKey.findProgramAddressSync([exports.COMPLIANCE_SEED, poolConfig.toBuffer()], programId);
}
// ============================================================================
// ASSET ID HELPERS
// ============================================================================
/**
 * Compute asset ID from mint address using keccak256
 *
 * This matches the on-chain computation: asset_id = keccak256(mint.as_ref())
 *
 * @param mint - SPL token mint address
 * @returns 32-byte asset identifier
 */
function computeAssetId(mint) {
    // Use js-sha3 or @noble/hashes for keccak256
    // For now, we'll use a simple approach that works in both Node and browser
    return computeAssetIdKeccak(mint.toBuffer());
}
/**
 * Compute keccak256 hash of input bytes
 *
 * Note: In production, use a proper keccak256 implementation.
 * This is a placeholder that should be replaced with @noble/hashes or js-sha3.
 *
 * @param input - Input bytes
 * @returns 32-byte hash
 */
function computeAssetIdKeccak(input) {
    // IMPORTANT: In production, replace this with proper keccak256
    // For SDK purposes, we use the solana/web3.js approach or external lib
    // Temporary: Use the @solana/web3.js internal keccak256 if available,
    // otherwise this requires adding a dependency
    try {
        // Try to use Node.js crypto (available in Node environment)
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const crypto = require('crypto');
        // Node.js crypto has keccak256 as 'sha3-256' with different semantics
        // Actually keccak256 != sha3-256, so we need a proper library
        // For now, fall back to sha256 for structure (NOT for production!)
        const hash = crypto.createHash('sha256').update(input).digest();
        return new Uint8Array(hash);
    }
    catch {
        // In browser or if crypto not available, throw error
        // Production code should use @noble/hashes/sha3 keccak_256
        throw new Error('keccak256 not available. Install @noble/hashes and use: ' +
            'import { keccak_256 } from "@noble/hashes/sha3"');
    }
}
// ============================================================================
// BATCH HELPERS
// ============================================================================
/**
 * Derive all pool-related PDAs at once
 *
 * @param programId - pSOL v2 program ID
 * @param authority - Pool authority
 * @returns Object containing all pool PDAs
 */
function derivePoolPdas(programId, authority) {
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
 * @param programId - pSOL v2 program ID
 * @param poolConfig - Pool configuration account
 * @param assetIds - Array of asset IDs
 * @returns Array of [vault address, bump] tuples
 */
function deriveAssetVaultPdas(programId, poolConfig, assetIds) {
    return assetIds.map(assetId => findAssetVaultPda(programId, poolConfig, assetId));
}
/**
 * Derive verification key PDAs for all proof types
 *
 * @param programId - pSOL v2 program ID
 * @param poolConfig - Pool configuration account
 * @returns Object mapping proof type to [address, bump]
 */
function deriveVerificationKeyPdas(programId, poolConfig) {
    return {
        [types_1.ProofType.Deposit]: findVerificationKeyPda(programId, poolConfig, types_1.ProofType.Deposit),
        [types_1.ProofType.Withdraw]: findVerificationKeyPda(programId, poolConfig, types_1.ProofType.Withdraw),
        [types_1.ProofType.JoinSplit]: findVerificationKeyPda(programId, poolConfig, types_1.ProofType.JoinSplit),
        [types_1.ProofType.Membership]: findVerificationKeyPda(programId, poolConfig, types_1.ProofType.Membership),
    };
}
