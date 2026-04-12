/**
 * Keccak256 Hashing - Production Implementation
 *
 * Uses @noble/hashes for production-grade keccak256
 * Outputs match Solana program keccak exactly
 */
import { PublicKey } from '@solana/web3.js';
/**
 * Compute keccak256 hash of data
 *
 * @param data - Input data to hash
 * @returns 32-byte keccak256 hash
 */
export declare function keccak256(data: Uint8Array): Uint8Array;
/**
 * Compute keccak256 hash of multiple inputs (concatenated)
 *
 * @param inputs - Array of inputs to concatenate and hash
 * @returns 32-byte keccak256 hash
 */
export declare function keccak256Concat(inputs: Uint8Array[]): Uint8Array;
/**
 * Derive asset ID from mint address (canonical on-chain derivation)
 *
 * CANONICAL DERIVATION (matches on-chain exactly):
 * asset_id = 0x00 || Keccak256("psol:asset_id:v1" || mint_bytes)[0..31]
 *
 * This ensures the asset_id fits in BN254 scalar field by:
 * 1. Using domain separator to prevent collisions
 * 2. Prefixing with 0x00 and taking first 31 bytes of hash
 *
 * @param mint - Token mint public key
 * @returns Asset ID as 32-byte Uint8Array
 */
export declare function deriveAssetId(mint: PublicKey): Uint8Array;
/**
 * Compute verification key hash
 *
 * @param vkData - Verification key data
 * @returns 32-byte hash
 */
export declare function hashVerificationKey(vkData: Uint8Array): Uint8Array;
/**
 * Compute commitment hash (for deterministic IDs)
 *
 * @param commitment - Commitment bytes
 * @returns 32-byte hash
 */
export declare function hashCommitment(commitment: Uint8Array): Uint8Array;
/**
 * Convert hex string to Uint8Array
 */
export declare function hexToBytes(hex: string): Uint8Array;
/**
 * Convert Uint8Array to hex string
 */
export declare function bytesToHex(bytes: Uint8Array): string;
//# sourceMappingURL=keccak.d.ts.map