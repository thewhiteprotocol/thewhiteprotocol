/**
 * Keccak256 Hashing - Production Implementation
 * 
 * Uses @noble/hashes for production-grade keccak256
 * Outputs match Solana program keccak exactly
 */

import { keccak_256 } from '@noble/hashes/sha3';
import { PublicKey } from '@solana/web3.js';

/** Domain separator for v1 asset ID derivation */
const ASSET_ID_DOMAIN_V1 = new TextEncoder().encode('white:asset_id:v1');

/** Domain separator for v2 asset ID derivation */
const ASSET_ID_DOMAIN_V2 = new TextEncoder().encode('white:asset_id:v2');

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
 * Derive v1 asset ID from mint address (legacy, for existing pools).
 * CANONICAL DERIVATION (matches on-chain exactly):
 * asset_id = 0x00 || Keccak256("white:asset_id:v1" || mint_bytes)[0..31]
 *
 * @deprecated Use deriveAssetIdV2 for new deployments.
 */
export function deriveAssetId(mint: PublicKey): Uint8Array {
  return deriveAssetIdV1(mint);
}

/**
 * Derive v1 asset ID from mint address.
 */
export function deriveAssetIdV1(mint: PublicKey): Uint8Array {
  const hash = keccak256Concat([ASSET_ID_DOMAIN_V1, mint.toBuffer()]);
  const out = new Uint8Array(32);
  out.set(hash.slice(0, 31), 1);
  return out;
}

/**
 * Derive v2 asset ID from mint address with protocol-scoped domain separation.
 * CANONICAL DERIVATION:
 * asset_id = 0x00 || Keccak256("white:asset_id:v2" || uint32BE(domainId) || mint_bytes)[0..31]
 *
 * @param mint - Token mint public key
 * @param domainId - Protocol domain ID (uint32)
 * @returns Asset ID as 32-byte Uint8Array
 */
export function deriveAssetIdV2(mint: PublicKey, domainId: number): Uint8Array {
  const domainBytes = new Uint8Array(4);
  domainBytes[0] = (domainId >>> 24) & 0xff;
  domainBytes[1] = (domainId >>> 16) & 0xff;
  domainBytes[2] = (domainId >>> 8) & 0xff;
  domainBytes[3] = domainId & 0xff;

  const hash = keccak256Concat([ASSET_ID_DOMAIN_V2, domainBytes, mint.toBuffer()]);
  const out = new Uint8Array(32);
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
