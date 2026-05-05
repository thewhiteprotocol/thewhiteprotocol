/**
 * Generic asset ID computation helpers for Solana and EVM chains.
 *
 * These mirror the on-chain formulas and support both v1 (legacy)
 * and v2 (domain-separated) asset IDs.
 */

import { PublicKey } from '@solana/web3.js';
import { keccak_256 } from '@noble/hashes/sha3';

/** Convert a Uint8Array asset ID to a bigint */
export function assetIdToBigInt(assetId: Uint8Array): bigint {
  let result = 0n;
  for (let i = 0; i < assetId.length; i++) {
    result = (result << 8n) | BigInt(assetId[i]);
  }
  return result;
}

/** Convert a Uint8Array to lowercase hex string */
export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// =============================================================================
// SOLANA (v1 only — uses mint pubkey bytes)
// =============================================================================

/**
 * Compute v1 asset ID from Solana mint address.
 * Matches on-chain: 0x00 || keccak256("white:asset_id:v1" || mint)[0..31]
 */
export function computeSolanaAssetIdV1(mint: PublicKey): Uint8Array {
  const prefix = new TextEncoder().encode('white:asset_id:v1');
  const mintBytes = mint.toBytes();
  const combined = new Uint8Array(prefix.length + mintBytes.length);
  combined.set(prefix);
  combined.set(mintBytes, prefix.length);

  const hash = keccak_256(combined);
  const assetId = new Uint8Array(32);
  assetId[0] = 0x00;
  assetId.set(hash.slice(0, 31), 1);

  return assetId;
}

// =============================================================================
// EVM (v2 with domain separation)
// =============================================================================

/**
 * Compute v2 asset ID from EVM token address with protocol-scoped domain separation.
 * Matches on-chain: 0x00 || keccak256("white:asset_id:v2" || uint32BE(domainId) || tokenAddress)[0..31]
 *
 * @param tokenAddress - Checksummed or lowercase 0x-prefixed Ethereum address
 * @param domainId - Chain domain ID (e.g. 33554434 for Base Sepolia)
 */
export function computeEvmAssetIdV2(tokenAddress: string, domainId: number): Uint8Array {
  const prefix = new TextEncoder().encode('white:asset_id:v2');
  const domainBytes = new Uint8Array(4);
  domainBytes[0] = (domainId >>> 24) & 0xff;
  domainBytes[1] = (domainId >>> 16) & 0xff;
  domainBytes[2] = (domainId >>> 8) & 0xff;
  domainBytes[3] = domainId & 0xff;

  // Normalize address: lowercase, strip 0x prefix
  const clean = tokenAddress.toLowerCase().replace(/^0x/, '');
  if (!/^[0-9a-f]{40}$/.test(clean)) {
    throw new Error(`Invalid EVM token address: ${tokenAddress}`);
  }

  const addrBytes = hexToBytes(clean);
  const combined = new Uint8Array(prefix.length + domainBytes.length + addrBytes.length);
  combined.set(prefix);
  combined.set(domainBytes, prefix.length);
  combined.set(addrBytes, prefix.length + domainBytes.length);

  const hash = keccak_256(combined);
  const assetId = new Uint8Array(32);
  assetId[0] = 0x00;
  assetId.set(hash.slice(0, 31), 1);

  return assetId;
}

/**
 * Compute v1 asset ID from EVM token address (legacy, no domain separation).
 * Matches on-chain: 0x00 || keccak256("white:asset_id:v1" || tokenAddress)[0..31]
 */
export function computeEvmAssetIdV1(tokenAddress: string): Uint8Array {
  const prefix = new TextEncoder().encode('white:asset_id:v1');
  const clean = tokenAddress.toLowerCase().replace(/^0x/, '');
  if (!/^[0-9a-f]{40}$/.test(clean)) {
    throw new Error(`Invalid EVM token address: ${tokenAddress}`);
  }
  const addrBytes = hexToBytes(clean);
  const combined = new Uint8Array(prefix.length + addrBytes.length);
  combined.set(prefix);
  combined.set(addrBytes, prefix.length);

  const hash = keccak_256(combined);
  const assetId = new Uint8Array(32);
  assetId[0] = 0x00;
  assetId.set(hash.slice(0, 31), 1);

  return assetId;
}

// =============================================================================
// UNIFIED INTERFACE
// =============================================================================

export interface AssetIdResult {
  assetId: string; // hex
  assetIdBigInt: string;
  formula: string;
  version: number;
  domainId: number;
  fieldSafe: boolean;
}

/**
 * Compute asset ID for any supported chain family.
 */
export function computeAssetId(
  chainFamily: 'solana' | 'evm',
  token: string,
  version: number,
  domainId: number
): AssetIdResult {
  if (chainFamily === 'solana') {
    if (version !== 1) {
      throw new Error('Solana only supports asset ID version 1');
    }
    const mint = new PublicKey(token.trim());
    const assetId = computeSolanaAssetIdV1(mint);
    return {
      assetId: bytesToHex(assetId),
      assetIdBigInt: assetIdToBigInt(assetId).toString(),
      formula: '0x00 || keccak256("white:asset_id:v1" || mint)[0..31]',
      version: 1,
      domainId,
      fieldSafe: true,
    };
  }

  if (chainFamily === 'evm') {
    if (version === 1) {
      const assetId = computeEvmAssetIdV1(token);
      return {
        assetId: bytesToHex(assetId),
        assetIdBigInt: assetIdToBigInt(assetId).toString(),
        formula: '0x00 || keccak256("white:asset_id:v1" || tokenAddress)[0..31]',
        version: 1,
        domainId,
        fieldSafe: true,
      };
    }
    if (version === 2) {
      const assetId = computeEvmAssetIdV2(token, domainId);
      return {
        assetId: bytesToHex(assetId),
        assetIdBigInt: assetIdToBigInt(assetId).toString(),
        formula: '0x00 || keccak256("white:asset_id:v2" || uint32BE(domainId) || tokenAddress)[0..31]',
        version: 2,
        domainId,
        fieldSafe: true,
      };
    }
    throw new Error(`Unsupported asset ID version: ${version}`);
  }

  throw new Error(`Unsupported chain family: ${chainFamily}`);
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.replace(/^0x/, '');
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

// =============================================================================
// VALIDATION
// =============================================================================

export function isValidSolanaPubkey(value: string): boolean {
  try {
    new PublicKey(value.trim());
    return true;
  } catch {
    return false;
  }
}

export function isValidEvmAddress(value: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(value.trim());
}
