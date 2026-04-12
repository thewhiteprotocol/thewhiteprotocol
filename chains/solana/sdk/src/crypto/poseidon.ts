/**
 * The White Protocol SDK - Poseidon Hash Implementation
 * 
 * Circomlib-compatible Poseidon hash for BN254 scalar field.
 * Uses the same parameters as circomlib for circuit compatibility.
 * 
 * @module crypto/poseidon
 */

import { buildPoseidon } from 'circomlibjs';

// Singleton instance of Poseidon (use any to avoid circomlibjs type issues)
let poseidonInstance: any = null;

/**
 * Initialize the Poseidon hasher
 * Must be called before using hash functions
 */
export async function initPoseidon(): Promise<void> {
  if (!poseidonInstance) {
    poseidonInstance = await buildPoseidon();
  }
}

/**
 * Get the Poseidon instance (throws if not initialized)
 */
function getPoseidon(): any {
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
export function hashTwo(left: bigint, right: bigint): bigint {
  const poseidon = getPoseidon();
  const hash = poseidon([left, right]);
  return poseidon.F.toObject(hash) as bigint;
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
export function hashFour(a: bigint, b: bigint, c: bigint, d: bigint): bigint {
  const poseidon = getPoseidon();
  const hash = poseidon([a, b, c, d]);
  return poseidon.F.toObject(hash) as bigint;
}

/**
 * Compute MASP commitment
 * @param secret - Random blinding factor
 * @param nullifier - Nullifier preimage
 * @param amount - Token amount
 * @param assetId - Asset identifier
 * @returns Commitment as bigint
 */
export function computeCommitment(
  secret: bigint,
  nullifier: bigint,
  amount: bigint,
  assetId: bigint
): bigint {
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
export function computeNullifierHash(
  nullifier: bigint,
  secret: bigint,
  leafIndex: bigint
): bigint {
  const inner = hashTwo(nullifier, secret);
  return hashTwo(inner, leafIndex);
}

/**
 * Convert Uint8Array to bigint (big-endian)
 */
export function bytesToBigInt(bytes: Uint8Array): bigint {
  let result = BigInt(0);
  for (let i = 0; i < bytes.length; i++) {
    result = (result << BigInt(8)) | BigInt(bytes[i]);
  }
  return result;
}

/**
 * Convert bigint to Uint8Array (32 bytes, big-endian)
 */
export function bigIntToBytes(value: bigint): Uint8Array {
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
export function bigIntToFieldBytes(value: bigint): Uint8Array {
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
export function randomFieldElement(): bigint {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  
  // Ensure it's less than the field modulus by clearing top bits
  bytes[0] &= 0x1f; // BN254 scalar field is ~254 bits
  
  return bytesToBigInt(bytes);
}

/**
 * BN254 scalar field modulus
 */
export const FIELD_MODULUS = BigInt(
  '21888242871839275222246405745257275088548364400416034343698204186575808495617'
);

/**
 * Check if value is a valid field element
 */
export function isValidFieldElement(value: bigint): boolean {
  return value >= BigInt(0) && value < FIELD_MODULUS;
}

/**
 * Reduce value modulo field
 */
export function fieldMod(value: bigint): bigint {
  return ((value % FIELD_MODULUS) + FIELD_MODULUS) % FIELD_MODULUS;
}