"use strict";
/**
 * pSOL v2 SDK Type Definitions
 *
 * Types for interacting with the pSOL v2 MASP (Multi-Asset Shielded Pool)
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.FEATURE_COMPLIANCE = exports.FEATURE_SHIELDED_CPI = exports.FEATURE_MEMBERSHIP = exports.FEATURE_JOIN_SPLIT = exports.FEATURE_MASP = exports.NATIVE_SOL_ASSET_ID = exports.MAX_ENCRYPTED_NOTE_SIZE = exports.MAX_METADATA_URI_LEN = exports.G2_POINT_SIZE = exports.G1_POINT_SIZE = exports.PROOF_SIZE = exports.DEFAULT_ROOT_HISTORY_SIZE = exports.MIN_ROOT_HISTORY_SIZE = exports.MAX_TREE_DEPTH = exports.MIN_TREE_DEPTH = exports.AssetType = exports.SpendType = exports.ShieldedActionType = exports.ProofType = void 0;
exports.proofTypeSeed = proofTypeSeed;
exports.toBN = toBN;
exports.toHex = toHex;
exports.fromHex = fromHex;
exports.bytesEqual = bytesEqual;
exports.isValidCommitment = isValidCommitment;
exports.isValidNullifier = isValidNullifier;
exports.isValidProofLength = isValidProofLength;
const bn_js_1 = __importDefault(require("bn.js"));
// ============================================================================
// ENUMS
// ============================================================================
/**
 * Proof types supported by pSOL v2
 * Must match on-chain ProofType enum
 */
var ProofType;
(function (ProofType) {
    /** Deposit proof - proves valid commitment */
    ProofType[ProofType["Deposit"] = 0] = "Deposit";
    /** Withdrawal proof - proves valid nullifier and membership */
    ProofType[ProofType["Withdraw"] = 1] = "Withdraw";
    /** Join-Split proof - proves value conservation in internal transfer */
    ProofType[ProofType["JoinSplit"] = 2] = "JoinSplit";
    /** Membership proof - proves stake >= threshold without spending */
    ProofType[ProofType["Membership"] = 3] = "Membership";
})(ProofType || (exports.ProofType = ProofType = {}));
/**
 * Returns the seed bytes for a proof type (for PDA derivation)
 */
function proofTypeSeed(proofType) {
    const seeds = {
        [ProofType.Deposit]: 'vk_deposit',
        [ProofType.Withdraw]: 'vk_withdraw',
        [ProofType.JoinSplit]: 'vk_joinsplit',
        [ProofType.Membership]: 'vk_membership',
    };
    return Buffer.from(seeds[proofType]);
}
/**
 * Shielded action types for CPI
 */
var ShieldedActionType;
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
})(ShieldedActionType || (exports.ShieldedActionType = ShieldedActionType = {}));
/**
 * Spend type for nullifiers
 */
var SpendType;
(function (SpendType) {
    /** Standard withdrawal */
    SpendType[SpendType["Withdraw"] = 0] = "Withdraw";
    /** Join-Split transfer */
    SpendType[SpendType["JoinSplit"] = 1] = "JoinSplit";
    /** Shielded CPI action */
    SpendType[SpendType["ShieldedCpi"] = 2] = "ShieldedCpi";
})(SpendType || (exports.SpendType = SpendType = {}));
/**
 * Asset type classification
 */
var AssetType;
(function (AssetType) {
    /** Standard SPL Token */
    AssetType[AssetType["SplToken"] = 0] = "SplToken";
    /** Wrapped native SOL */
    AssetType[AssetType["NativeSol"] = 1] = "NativeSol";
    /** Token-2022 standard */
    AssetType[AssetType["Token2022"] = 2] = "Token2022";
})(AssetType || (exports.AssetType = AssetType = {}));
// ============================================================================
// CONSTANTS
// ============================================================================
/** Minimum Merkle tree depth */
exports.MIN_TREE_DEPTH = 4;
/** Maximum Merkle tree depth */
exports.MAX_TREE_DEPTH = 24;
/** Minimum root history size */
exports.MIN_ROOT_HISTORY_SIZE = 30;
/** Default root history size */
exports.DEFAULT_ROOT_HISTORY_SIZE = 100;
/** Size of Groth16 proof in bytes */
exports.PROOF_SIZE = 256;
/** Size of G1 point in bytes */
exports.G1_POINT_SIZE = 64;
/** Size of G2 point in bytes */
exports.G2_POINT_SIZE = 128;
/** Maximum metadata URI length */
exports.MAX_METADATA_URI_LEN = 200;
/** Maximum encrypted note size */
exports.MAX_ENCRYPTED_NOTE_SIZE = 1024;
/** Native SOL asset ID (special case) */
exports.NATIVE_SOL_ASSET_ID = new Uint8Array([
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01,
]);
/** Feature flag: MASP enabled */
exports.FEATURE_MASP = 1 << 0;
/** Feature flag: JoinSplit enabled */
exports.FEATURE_JOIN_SPLIT = 1 << 1;
/** Feature flag: Membership proofs enabled */
exports.FEATURE_MEMBERSHIP = 1 << 2;
/** Feature flag: Shielded CPI enabled */
exports.FEATURE_SHIELDED_CPI = 1 << 3;
/** Feature flag: Compliance required */
exports.FEATURE_COMPLIANCE = 1 << 4;
// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================
/**
 * Convert a number to BN
 */
function toBN(value) {
    if (bn_js_1.default.isBN(value))
        return value;
    if (typeof value === "bigint")
        return new bn_js_1.default(value.toString());
    return new bn_js_1.default(value);
}
/**
 * Convert bytes to hex string
 */
function toHex(bytes) {
    return Buffer.from(bytes).toString('hex');
}
/**
 * Convert hex string to bytes
 */
function fromHex(hex) {
    return Uint8Array.from(Buffer.from(hex, 'hex'));
}
/**
 * Check if two byte arrays are equal
 */
function bytesEqual(a, b) {
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
function isValidCommitment(commitment) {
    if (commitment.length !== 32)
        return false;
    return !commitment.every(b => b === 0);
}
/**
 * Check if a nullifier is valid (non-zero, correct length)
 */
function isValidNullifier(nullifier) {
    if (nullifier.length !== 32)
        return false;
    return !nullifier.every(b => b === 0);
}
/**
 * Check if proof data has valid length
 */
function isValidProofLength(proofData) {
    return proofData.length === exports.PROOF_SIZE;
}
