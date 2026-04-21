/**
 * Meta-address generation, serialization, and parsing.
 *
 * Meta-address = base58(chain_tag || Spend_pub || View_pub || checksum)
 * where checksum = first 4 bytes of SHA256(chain_tag || Spend_pub || View_pub)
 */

import { sha256 } from "@noble/hashes/sha256";
import { hkdf } from "@noble/hashes/hkdf";
import { ed25519 } from "@noble/curves/ed25519";
import { secp256k1 } from "@noble/curves/secp256k1";
import { numberToBytesBE, bytesToNumberBE } from "@noble/curves/abstract/utils";
import { mod } from "@noble/curves/abstract/modular";
import bs58 from "bs58";
import {
  ChainTag,
  type MetaAddress,
  type CurveKeypair,
} from "./types";

const SALT = new TextEncoder().encode("whiteprotocol-stealth-v1");
const HKDF_INFO_META = new TextEncoder().encode("meta");
const HKDF_INFO_SPEND_ED25519 = new TextEncoder().encode("spend-ed25519");
const HKDF_INFO_VIEW_ED25519 = new TextEncoder().encode("view-ed25519");
const HKDF_INFO_SPEND_SECP256K1 = new TextEncoder().encode("spend-secp256k1");
const HKDF_INFO_VIEW_SECP256K1 = new TextEncoder().encode("view-secp256k1");

const ED25519_ORDER = ed25519.CURVE.n;
const SECP256K1_ORDER = secp256k1.CURVE.n;

/** Reduce a 32-byte seed to an ed25519 scalar modulo ℓ */
function reduceToEd25519Scalar(seed: Uint8Array): Uint8Array {
  const scalar = mod(bytesToNumberBE(seed), ED25519_ORDER);
  return numberToBytesBE(scalar, 32);
}

/** Reduce a 32-byte seed to a secp256k1 scalar modulo n */
function reduceToSecp256k1Scalar(seed: Uint8Array): Uint8Array {
  const scalar = mod(bytesToNumberBE(seed), SECP256K1_ORDER);
  return numberToBytesBE(scalar, 32);
}

/**
 * Derive a deterministic seed from an IKM (e.g. wallet signature bytes) using HKDF-SHA256.
 */
export function deriveStealthSeed(ikm: Uint8Array): Uint8Array {
  return hkdf(sha256, ikm, SALT, HKDF_INFO_META, 32);
}

/**
 * Generate a Solana meta-address from a seed.
 * Returns both the meta-address and the underlying keypairs (for storage by the user).
 */
export function generateSolanaMetaAddressFromSeed(
  seed: Uint8Array
): {
  metaAddress: MetaAddress;
  spendKeypair: CurveKeypair;
  viewKeypair: CurveKeypair;
} {
  const spendPriv = reduceToEd25519Scalar(
    hkdf(sha256, seed, undefined, HKDF_INFO_SPEND_ED25519, 32)
  );
  const viewPriv = reduceToEd25519Scalar(
    hkdf(sha256, seed, undefined, HKDF_INFO_VIEW_ED25519, 32)
  );

  const spendScalar = bytesToNumberBE(spendPriv);
  const viewScalar = bytesToNumberBE(viewPriv);
  const spendPub = ed25519.ExtendedPoint.BASE.multiply(spendScalar).toRawBytes();
  const viewPub = ed25519.ExtendedPoint.BASE.multiply(viewScalar).toRawBytes();

  return {
    metaAddress: {
      chainTag: ChainTag.Solana,
      spendPubEd25519: spendPub,
      viewPubEd25519: viewPub,
    },
    spendKeypair: { privateKey: spendPriv, publicKey: spendPub },
    viewKeypair: { privateKey: viewPriv, publicKey: viewPub },
  };
}

/**
 * Generate a Base meta-address from a seed.
 */
export function generateBaseMetaAddressFromSeed(
  seed: Uint8Array
): {
  metaAddress: MetaAddress;
  spendKeypair: CurveKeypair;
  viewKeypair: CurveKeypair;
} {
  const spendPriv = reduceToSecp256k1Scalar(
    hkdf(sha256, seed, undefined, HKDF_INFO_SPEND_SECP256K1, 32)
  );
  const viewPriv = reduceToSecp256k1Scalar(
    hkdf(sha256, seed, undefined, HKDF_INFO_VIEW_SECP256K1, 32)
  );

  const spendPub = secp256k1.getPublicKey(spendPriv, true);
  const viewPub = secp256k1.getPublicKey(viewPriv, true);

  return {
    metaAddress: {
      chainTag: ChainTag.Base,
      spendPubSecp256k1: spendPub,
      viewPubSecp256k1: viewPub,
    },
    spendKeypair: { privateKey: spendPriv, publicKey: spendPub },
    viewKeypair: { privateKey: viewPriv, publicKey: viewPub },
  };
}

/**
 * Generate a universal cross-chain meta-address from a seed.
 */
export function generateUniversalMetaAddressFromSeed(
  seed: Uint8Array
): {
  metaAddress: MetaAddress;
  solanaSpendKeypair: CurveKeypair;
  solanaViewKeypair: CurveKeypair;
  baseSpendKeypair: CurveKeypair;
  baseViewKeypair: CurveKeypair;
} {
  const solanaSpendPriv = reduceToEd25519Scalar(
    hkdf(sha256, seed, undefined, HKDF_INFO_SPEND_ED25519, 32)
  );
  const solanaViewPriv = reduceToEd25519Scalar(
    hkdf(sha256, seed, undefined, HKDF_INFO_VIEW_ED25519, 32)
  );
  const baseSpendPriv = reduceToSecp256k1Scalar(
    hkdf(sha256, seed, undefined, HKDF_INFO_SPEND_SECP256K1, 32)
  );
  const baseViewPriv = reduceToSecp256k1Scalar(
    hkdf(sha256, seed, undefined, HKDF_INFO_VIEW_SECP256K1, 32)
  );

  const solanaSpendScalar = bytesToNumberBE(solanaSpendPriv);
  const solanaViewScalar = bytesToNumberBE(solanaViewPriv);
  const solanaSpendPub = ed25519.ExtendedPoint.BASE.multiply(solanaSpendScalar).toRawBytes();
  const solanaViewPub = ed25519.ExtendedPoint.BASE.multiply(solanaViewScalar).toRawBytes();
  const baseSpendPub = secp256k1.getPublicKey(baseSpendPriv, true);
  const baseViewPub = secp256k1.getPublicKey(baseViewPriv, true);

  return {
    metaAddress: {
      chainTag: ChainTag.Universal,
      spendPubEd25519: solanaSpendPub,
      viewPubEd25519: solanaViewPub,
      spendPubSecp256k1: baseSpendPub,
      viewPubSecp256k1: baseViewPub,
    },
    solanaSpendKeypair: { privateKey: solanaSpendPriv, publicKey: solanaSpendPub },
    solanaViewKeypair: { privateKey: solanaViewPriv, publicKey: solanaViewPub },
    baseSpendKeypair: { privateKey: baseSpendPriv, publicKey: baseSpendPub },
    baseViewKeypair: { privateKey: baseViewPriv, publicKey: baseViewPub },
  };
}

/**
 * Serialize a meta-address to its base58-encoded string form.
 */
export function serializeMetaAddress(meta: MetaAddress): string {
  let payload: Uint8Array;

  if (meta.chainTag === ChainTag.Solana) {
    if (!meta.spendPubEd25519 || !meta.viewPubEd25519) {
      throw new Error("Solana meta-address requires ed25519 public keys");
    }
    payload = new Uint8Array(1 + 32 + 32 + 4);
    payload[0] = meta.chainTag;
    payload.set(meta.spendPubEd25519, 1);
    payload.set(meta.viewPubEd25519, 33);
    const hash = sha256(payload.slice(0, 65));
    payload.set(hash.slice(0, 4), 65);
  } else if (meta.chainTag === ChainTag.Base) {
    if (!meta.spendPubSecp256k1 || !meta.viewPubSecp256k1) {
      throw new Error("Base meta-address requires secp256k1 public keys");
    }
    payload = new Uint8Array(1 + 33 + 33 + 4);
    payload[0] = meta.chainTag;
    payload.set(meta.spendPubSecp256k1, 1);
    payload.set(meta.viewPubSecp256k1, 34);
    const hash = sha256(payload.slice(0, 67));
    payload.set(hash.slice(0, 4), 67);
  } else if (meta.chainTag === ChainTag.Universal) {
    if (
      !meta.spendPubEd25519 ||
      !meta.viewPubEd25519 ||
      !meta.spendPubSecp256k1 ||
      !meta.viewPubSecp256k1
    ) {
      throw new Error("Universal meta-address requires all four public keys");
    }
    payload = new Uint8Array(1 + 32 + 32 + 33 + 33 + 4);
    payload[0] = meta.chainTag;
    payload.set(meta.spendPubEd25519, 1);
    payload.set(meta.viewPubEd25519, 33);
    payload.set(meta.spendPubSecp256k1, 65);
    payload.set(meta.viewPubSecp256k1, 98);
    const hash = sha256(payload.slice(0, 131));
    payload.set(hash.slice(0, 4), 131);
  } else {
    throw new Error(`Invalid chain tag: ${meta.chainTag}`);
  }

  return bs58.encode(payload);
}

/**
 * Parse a base58-encoded meta-address string.
 * Validates the checksum.
 */
export function parseMetaAddress(serialized: string): MetaAddress {
  let payload: Uint8Array;
  try {
    payload = bs58.decode(serialized);
  } catch {
    throw new Error("Invalid base58 encoding");
  }

  if (payload.length < 5) {
    throw new Error("Meta-address too short");
  }

  const chainTag = payload[0] as ChainTag;
  let dataLen: number;
  let checksumOffset: number;

  if (chainTag === ChainTag.Solana) {
    dataLen = 65;
    checksumOffset = 65;
  } else if (chainTag === ChainTag.Base) {
    dataLen = 67;
    checksumOffset = 67;
  } else if (chainTag === ChainTag.Universal) {
    dataLen = 131;
    checksumOffset = 131;
  } else {
    throw new Error(`Unknown chain tag: ${chainTag}`);
  }

  if (payload.length !== dataLen + 4) {
    throw new Error(
      `Invalid meta-address length for chain tag ${chainTag}: expected ${dataLen + 4}, got ${payload.length}`
    );
  }

  const data = payload.slice(0, dataLen);
  const checksum = payload.slice(checksumOffset, checksumOffset + 4);
  const computed = sha256(data).slice(0, 4);

  if (!constantTimeEqual(checksum, computed)) {
    throw new Error("Meta-address checksum invalid");
  }

  if (chainTag === ChainTag.Solana) {
    return {
      chainTag,
      spendPubEd25519: data.slice(1, 33),
      viewPubEd25519: data.slice(33, 65),
    };
  } else if (chainTag === ChainTag.Base) {
    return {
      chainTag,
      spendPubSecp256k1: data.slice(1, 34),
      viewPubSecp256k1: data.slice(34, 67),
    };
  } else {
    return {
      chainTag,
      spendPubEd25519: data.slice(1, 33),
      viewPubEd25519: data.slice(33, 65),
      spendPubSecp256k1: data.slice(65, 98),
      viewPubSecp256k1: data.slice(98, 131),
    };
  }
}

/** Constant-time comparison to avoid timing attacks on checksum validation */
function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}
