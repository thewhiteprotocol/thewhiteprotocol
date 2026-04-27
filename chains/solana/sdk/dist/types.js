/**
 * The White Protocol SDK Type Definitions
 *
 * Types for interacting with the The White Protocol MASP (Multi-Asset Shielded Pool)
 */
import BN from 'bn.js';
// ============================================================================
// ENUMS
// ============================================================================
/**
 * Proof types supported by The White Protocol
 * Must match on-chain ProofType enum
 */
export var ProofType;
(function (ProofType) {
    /** Deposit proof - proves valid commitment */
    ProofType[ProofType["Deposit"] = 0] = "Deposit";
    /** Withdrawal proof - proves valid nullifier and membership */
    ProofType[ProofType["Withdraw"] = 1] = "Withdraw";
    /** Join-Split proof - proves value conservation in internal transfer */
    ProofType[ProofType["JoinSplit"] = 2] = "JoinSplit";
    /** Membership proof - proves stake >= threshold without spending */
    ProofType[ProofType["Membership"] = 3] = "Membership";
    /** Withdraw V2 proof - proves join-split with change output */
    ProofType[ProofType["WithdrawV2"] = 5] = "WithdrawV2";
})(ProofType || (ProofType = {}));
/**
 * Returns the seed bytes for a proof type (for PDA derivation)
 */
export function proofTypeSeed(proofType) {
    const seeds = {
        [ProofType.Deposit]: 'vk_deposit',
        [ProofType.Withdraw]: 'vk_withdraw',
        [ProofType.JoinSplit]: 'vk_joinsplit',
        [ProofType.Membership]: 'vk_membership',
        [ProofType.WithdrawV2]: 'vk_withdraw_v2',
    };
    return Buffer.from(seeds[proofType]);
}
/**
 * Shielded action types for CPI
 */
export var ShieldedActionType;
(function (ShieldedActionType) {
    /** Swap via DEX (e.g., Jupiter) */
    ShieldedActionType[ShieldedActionType["DexSwap"] = 0] = "DexSwap";
    /** Deposit to lending protocol */
    ShieldedActionType[ShieldedActionType["LendingDeposit"] = 1] = "LendingDeposit";
    /** Borrow from lending protocol */
    ShieldedActionType[ShieldedActionType["LendingBorrow"] = 2] = "LendingBorrow";
    /** Stake tokens */
    ShieldedActionType[ShieldedActionType["Stake"] = 3] = "Stake";
    /** Unstake tokens */
    ShieldedActionType[ShieldedActionType["Unstake"] = 4] = "Unstake";
    /** Custom action (protocol-specific) */
    ShieldedActionType[ShieldedActionType["Custom"] = 255] = "Custom";
})(ShieldedActionType || (ShieldedActionType = {}));
/**
 * Spend type for nullifiers
 */
export var SpendType;
(function (SpendType) {
    /** Standard withdrawal */
    SpendType[SpendType["Withdraw"] = 0] = "Withdraw";
    /** Join-Split transfer */
    SpendType[SpendType["JoinSplit"] = 1] = "JoinSplit";
    /** Shielded CPI action */
    SpendType[SpendType["ShieldedCpi"] = 2] = "ShieldedCpi";
})(SpendType || (SpendType = {}));
/**
 * Asset type classification
 */
export var AssetType;
(function (AssetType) {
    /** Standard SPL Token */
    AssetType[AssetType["SplToken"] = 0] = "SplToken";
    /** Wrapped native SOL */
    AssetType[AssetType["NativeSol"] = 1] = "NativeSol";
    /** Token-2022 standard */
    AssetType[AssetType["Token2022"] = 2] = "Token2022";
})(AssetType || (AssetType = {}));
// ============================================================================
// CONSTANTS
// ============================================================================
/** Minimum Merkle tree depth */
export const MIN_TREE_DEPTH = 4;
/** Maximum Merkle tree depth */
export const MAX_TREE_DEPTH = 24;
/** Minimum root history size */
export const MIN_ROOT_HISTORY_SIZE = 30;
/** Default root history size */
export const DEFAULT_ROOT_HISTORY_SIZE = 100;
/** Size of Groth16 proof in bytes */
export const PROOF_SIZE = 256;
/** Size of G1 point in bytes */
export const G1_POINT_SIZE = 64;
/** Size of G2 point in bytes */
export const G2_POINT_SIZE = 128;
/** Maximum metadata URI length */
export const MAX_METADATA_URI_LEN = 200;
/** Maximum encrypted note size */
export const MAX_ENCRYPTED_NOTE_SIZE = 1024;
/** Native SOL asset ID (special case) */
export const NATIVE_SOL_ASSET_ID = new Uint8Array([
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01,
]);
/** Feature flag: MASP enabled */
export const FEATURE_MASP = 1 << 0;
/** Feature flag: JoinSplit enabled */
export const FEATURE_JOIN_SPLIT = 1 << 1;
/** Feature flag: Membership proofs enabled */
export const FEATURE_MEMBERSHIP = 1 << 2;
/** Feature flag: Shielded CPI enabled */
export const FEATURE_SHIELDED_CPI = 1 << 3;
/** Feature flag: Compliance required */
export const FEATURE_COMPLIANCE = 1 << 4;
// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================
/**
 * Convert a number to BN
 */
export function toBN(value) {
    if (BN.isBN(value))
        return value;
    if (typeof value === "bigint")
        return new BN(value.toString());
    return new BN(value);
}
/**
 * Convert bytes to hex string
 */
export function toHex(bytes) {
    return Buffer.from(bytes).toString('hex');
}
/**
 * Convert hex string to bytes
 */
export function fromHex(hex) {
    return Uint8Array.from(Buffer.from(hex, 'hex'));
}
/**
 * Check if two byte arrays are equal
 */
export function bytesEqual(a, b) {
    if (a.length !== b.length)
        return false;
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i])
            return false;
    }
    return true;
}
/**
 * Check if a commitment is valid (non-zero, correct length)
 */
export function isValidCommitment(commitment) {
    if (commitment.length !== 32)
        return false;
    return !commitment.every(b => b === 0);
}
/**
 * Check if a nullifier is valid (non-zero, correct length)
 */
export function isValidNullifier(nullifier) {
    if (nullifier.length !== 32)
        return false;
    return !nullifier.every(b => b === 0);
}
/**
 * Check if proof data has valid length
 */
export function isValidProofLength(proofData) {
    return proofData.length === PROOF_SIZE;
}
//# sourceMappingURL=types.js.map