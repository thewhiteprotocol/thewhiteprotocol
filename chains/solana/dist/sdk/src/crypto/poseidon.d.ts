/**
 * pSOL v2 SDK - Poseidon Hash Implementation
 *
 * Circomlib-compatible Poseidon hash for BN254 scalar field.
 * Uses the same parameters as circomlib for circuit compatibility.
 *
 * @module crypto/poseidon
 */
import { Poseidon } from 'circomlibjs';
/**
 * Initialize the Poseidon hasher
 * Must be called before using hash functions
 */
export declare function initPoseidon(): Promise<void>;
/**
 * Hash two field elements (Merkle tree internal nodes)
 * @param left - Left child
 * @param right - Right child
 * @returns Hash as bigint
 */
export declare function hashTwo(left: bigint, right: bigint): bigint;
/**
 * Hash four field elements (MASP commitment)
 * commitment = Poseidon(secret, nullifier, amount, asset_id)
 * @param a - First element (secret)
 * @param b - Second element (nullifier)
 * @param c - Third element (amount)
 * @param d - Fourth element (asset_id)
 * @returns Hash as bigint
 */
export declare function hashFour(a: bigint, b: bigint, c: bigint, d: bigint): bigint;
/**
 * Compute MASP commitment
 * @param secret - Random blinding factor
 * @param nullifier - Nullifier preimage
 * @param amount - Token amount
 * @param assetId - Asset identifier
 * @returns Commitment as bigint
 */
export declare function computeCommitment(secret: bigint, nullifier: bigint, amount: bigint, assetId: bigint): bigint;
/**
 * Compute nullifier hash
 * nullifier_hash = Poseidon(Poseidon(nullifier, secret), leaf_index)
 * @param nullifier - Nullifier preimage
 * @param secret - Secret blinding factor
 * @param leafIndex - Leaf position in Merkle tree
 * @returns Nullifier hash as bigint
 */
export declare function computeNullifierHash(nullifier: bigint, secret: bigint, leafIndex: bigint): bigint;
/**
 * Convert Uint8Array to bigint (big-endian)
 */
export declare function bytesToBigInt(bytes: Uint8Array): bigint;
/**
 * Convert bigint to Uint8Array (32 bytes, big-endian)
 */
export declare function bigIntToBytes(value: bigint): Uint8Array;
/**
 * Convert bigint to field element bytes (32 bytes, little-endian for circuits)
 */
export declare function bigIntToFieldBytes(value: bigint): Uint8Array;
/**
 * Generate a random field element
 */
export declare function randomFieldElement(): bigint;
/**
 * BN254 scalar field modulus
 */
export declare const FIELD_MODULUS: bigint;
/**
 * Check if value is a valid field element
 */
export declare function isValidFieldElement(value: bigint): boolean;
/**
 * Reduce value modulo field
 */
export declare function fieldMod(value: bigint): bigint;
export { Poseidon };
//# sourceMappingURL=poseidon.d.ts.map