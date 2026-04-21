/**
 * Stealth address types for The White Protocol.
 *
 * Dual-key stealth scheme supporting ed25519 (Solana) and secp256k1 (Base/EVM).
 */

export enum ChainTag {
  Solana = 0x01,
  Base = 0x02,
  Universal = 0x03,
}

/** Compressed public key bytes (32 for ed25519, 33 for secp256k1) */
export type CompressedPubkey = Uint8Array;

export interface CurveKeypair {
  privateKey: Uint8Array;
  publicKey: Uint8Array;
}

export interface MetaAddress {
  chainTag: ChainTag;
  /** ed25519 spend public key (32 bytes). Always present for Solana/Universal. */
  spendPubEd25519?: Uint8Array;
  /** ed25519 view public key (32 bytes). Always present for Solana/Universal. */
  viewPubEd25519?: Uint8Array;
  /** secp256k1 spend public key (33 bytes compressed). Always present for Base/Universal. */
  spendPubSecp256k1?: Uint8Array;
  /** secp256k1 view public key (33 bytes compressed). Always present for Base/Universal. */
  viewPubSecp256k1?: Uint8Array;
}

export interface StealthAddress {
  /** The stealth public key / address */
  address: Uint8Array;
  /** Chain-specific formatted address (base58 for Solana, checksummed hex for Base) */
  formattedAddress: string;
}

export interface StealthPayment {
  /** Ephemeral public key R */
  ephemeralPubkey: Uint8Array;
  /** Destination stealth address */
  destination: Uint8Array;
  /** Amount in smallest denomination */
  amount: bigint;
  /** Token/asset identifier */
  assetId: string;
  /** Chain identifier */
  chain: "solana" | "base";
  /** Block height / slot */
  blockHeight: number;
  /** Transaction hash / signature */
  txHash: string;
}

export interface DetectedPayment extends StealthPayment {
  /** Matching stealth private key (raw scalar bytes) */
  stealthPrivateKey: Uint8Array;
}

export interface ScannerEvent {
  ephemeralPubkey: Uint8Array;
  destination: Uint8Array;
  txHash: string;
  blockHeight: number;
}
