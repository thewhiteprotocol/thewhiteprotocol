/**
 * Keccak256 Hashing - Production Implementation
 * 
 * Uses @noble/hashes for production-grade keccak256
 * Outputs match Solana program keccak exactly
 */

import { keccak_256 } from '@noble/hashes/sha3';
import { PublicKey } from '@solana/web3.js';

/** Domain separator for asset ID derivation */
const ASSET_ID_DOMAIN = new TextEncoder().encode('white:asset_id:v1');

/**
 * Compute keccak256 hash of data
 * 
 * @param data - Input data to hash
 * @returns 32-byte keccak256 hash
 */
export function keccak256(data: Uint8Array): Uint8Array {
  return keccak_256(data);
}

/**
 * Compute keccak256 hash of multiple inputs (concatenated)
 * 
 * @param inputs - Array of inputs to concatenate and hash
 * @returns 32-byte keccak256 hash
 */
export function keccak256Concat(inputs: Uint8Array[]): Uint8Array {
  const combined = Buffer.concat(inputs.map((i) => Buffer.from(i)));
  return keccak_256(combined);
}

/**
 * Derive asset ID from mint address (canonical on-chain derivation)
 * 
 * CANONICAL DERIVATION (matches on-chain exactly):
 * asset_id = 0x00 || Keccak256("white:asset_id:v1" || mint_bytes)[0..31]
 * 
 * This ensures the asset_id fits in BN254 scalar field by:
 * 1. Using domain separator to prevent collisions
 * 2. Prefixing with 0x00 and taking first 31 bytes of hash
 * 
 * @param mint - Token mint public key
 * @returns Asset ID as 32-byte Uint8Array
 */
export function deriveAssetId(mint: PublicKey): Uint8Array {
  const hash = keccak256Concat([ASSET_ID_DOMAIN, mint.toBuffer()]);
  const out = new Uint8Array(32);
  // 0x00 prefix + first 31 bytes of hash
  out.set(hash.slice(0, 31), 1);
  return out;
}

/**
 * Compute verification key hash
 * 
 * @param vkData - Verification key data
 * @returns 32-byte hash
 */
export function hashVerificationKey(vkData: Uint8Array): Uint8Array {
  return keccak256(vkData);
}

/**
 * Compute commitment hash (for deterministic IDs)
 * 
 * @param commitment - Commitment bytes
 * @returns 32-byte hash
 */
export function hashCommitment(commitment: Uint8Array): Uint8Array {
  return keccak256(commitment);
}

/**
 * Convert hex string to Uint8Array
 */
export function hexToBytes(hex: string): Uint8Array {
  if (hex.startsWith('0x')) hex = hex.slice(2);
  return Uint8Array.from(Buffer.from(hex, 'hex'));
}

/**
 * Convert Uint8Array to hex string
 */
export function bytesToHex(bytes: Uint8Array): string {
  return '0x' + Buffer.from(bytes).toString('hex');
}
