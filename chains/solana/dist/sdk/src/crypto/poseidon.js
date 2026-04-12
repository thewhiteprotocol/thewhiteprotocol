"use strict";
/**
 * pSOL v2 SDK - Poseidon Hash Implementation
 *
 * Circomlib-compatible Poseidon hash for BN254 scalar field.
 * Uses the same parameters as circomlib for circuit compatibility.
 *
 * @module crypto/poseidon
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.FIELD_MODULUS = void 0;
exports.initPoseidon = initPoseidon;
exports.hashTwo = hashTwo;
exports.hashFour = hashFour;
exports.computeCommitment = computeCommitment;
exports.computeNullifierHash = computeNullifierHash;
exports.bytesToBigInt = bytesToBigInt;
exports.bigIntToBytes = bigIntToBytes;
exports.bigIntToFieldBytes = bigIntToFieldBytes;
exports.randomFieldElement = randomFieldElement;
exports.isValidFieldElement = isValidFieldElement;
exports.fieldMod = fieldMod;
const circomlibjs_1 = require("circomlibjs");
// Singleton instance of Poseidon
let poseidonInstance = null;
/**
 * Initialize the Poseidon hasher
 * Must be called before using hash functions
 */
async function initPoseidon() {
    if (!poseidonInstance) {
        poseidonInstance = await (0, circomlibjs_1.buildPoseidon)();
    }
}
/**
 * Get the Poseidon instance (throws if not initialized)
 */
function getPoseidon() {
    if (!poseidonInstance) {
        throw new Error('Poseidon not initialized. Call initPoseidon() first.');
    }
    return poseidonInstance;
}
/**
 * Hash two field elements (Merkle tree internal nodes)
 * @param left - Left child
 * @param right - Right child
 * @returns Hash as bigint
 */
function hashTwo(left, right) {
    const poseidon = getPoseidon();
    const hash = poseidon([left, right]);
    return poseidon.F.toObject(hash);
}
/**
 * Hash four field elements (MASP commitment)
 * commitment = Poseidon(secret, nullifier, amount, asset_id)
 * @param a - First element (secret)
 * @param b - Second element (nullifier)
 * @param c - Third element (amount)
 * @param d - Fourth element (asset_id)
 * @returns Hash as bigint
 */
function hashFour(a, b, c, d) {
    const poseidon = getPoseidon();
    const hash = poseidon([a, b, c, d]);
    return poseidon.F.toObject(hash);
}
/**
 * Compute MASP commitment
 * @param secret - Random blinding factor
 * @param nullifier - Nullifier preimage
 * @param amount - Token amount
 * @param assetId - Asset identifier
 * @returns Commitment as bigint
 */
function computeCommitment(secret, nullifier, amount, assetId) {
    return hashFour(secret, nullifier, amount, assetId);
}
/**
 * Compute nullifier hash
 * nullifier_hash = Poseidon(Poseidon(nullifier, secret), leaf_index)
 * @param nullifier - Nullifier preimage
 * @param secret - Secret blinding factor
 * @param leafIndex - Leaf position in Merkle tree
 * @returns Nullifier hash as bigint
 */
function computeNullifierHash(nullifier, secret, leafIndex) {
    const inner = hashTwo(nullifier, secret);
    return hashTwo(inner, leafIndex);
}
/**
 * Convert Uint8Array to bigint (big-endian)
 */
function bytesToBigInt(bytes) {
    let result = BigInt(0);
    for (let i = 0; i < bytes.length; i++) {
        result = (result << BigInt(8)) | BigInt(bytes[i]);
    }
    return result;
}
/**
 * Convert bigint to Uint8Array (32 bytes, big-endian)
 */
function bigIntToBytes(value) {
    const bytes = new Uint8Array(32);
    let temp = value;
    for (let i = 31; i >= 0; i--) {
        bytes[i] = Number(temp & BigInt(0xff));
        temp = temp >> BigInt(8);
    }
    return bytes;
}
/**
 * Convert bigint to field element bytes (32 bytes, little-endian for circuits)
 */
function bigIntToFieldBytes(value) {
    const bytes = new Uint8Array(32);
    let temp = value;
    for (let i = 0; i < 32; i++) {
        bytes[i] = Number(temp & BigInt(0xff));
        temp = temp >> BigInt(8);
    }
    return bytes;
}
/**
 * Generate a random field element
 */
function randomFieldElement() {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    // Ensure it's less than the field modulus by clearing top bits
    bytes[0] &= 0x1f; // BN254 scalar field is ~254 bits
    return bytesToBigInt(bytes);
}
/**
 * BN254 scalar field modulus
 */
exports.FIELD_MODULUS = BigInt('21888242871839275222246405745257275088548364400416034343698204186575808495617');
/**
 * Check if value is a valid field element
 */
function isValidFieldElement(value) {
    return value >= BigInt(0) && value < exports.FIELD_MODULUS;
}
/**
 * Reduce value modulo field
 */
function fieldMod(value) {
    return ((value % exports.FIELD_MODULUS) + exports.FIELD_MODULUS) % exports.FIELD_MODULUS;
}
