/**
 * Base / EVM (secp256k1) stealth address derivation.
 *
 * Sender:   P = Spend_pub + s·G   where s = H(r·View_pub)
 * Recipient: s' = H(view_priv·R)  where R = r·G
 *           P' = Spend_pub + s'·G
 *           match if P == P'
 * Private key: stealth_priv = spend_priv + s (mod n)
 * Ethereum address: keccak256(P_uncompressed[1:])[12:]
 */

import { sha256 } from "@noble/hashes/sha256";
import { secp256k1 } from "@noble/curves/secp256k1";
import { keccak_256 } from "@noble/hashes/sha3";
import { numberToBytesBE, bytesToNumberBE } from "@noble/curves/abstract/utils";
import { mod } from "@noble/curves/abstract/modular";
import { randomBytes } from "@noble/hashes/utils";
import { bytesToHex } from "./hex";
import type { MetaAddress, StealthAddress, StealthPayment, DetectedPayment } from "./types";

const SECP256K1_ORDER = secp256k1.CURVE.n;

function toValidScalar(bytes: Uint8Array): bigint {
  const s = mod(bytesToNumberBE(bytes), SECP256K1_ORDER);
  if (s === 0n) throw new Error("Derived scalar is zero");
  return s;
}

/** Generate a random secp256k1 scalar (already reduced mod n) from CSPRNG.
 *  Samples 64 bytes to eliminate bias from modulo reduction. */
export function randomSecp256k1Scalar(): Uint8Array {
  const rand = randomBytes(64);
  const scalar = mod(bytesToNumberBE(rand), SECP256K1_ORDER);
  return numberToBytesBE(scalar, 32);
}

/**
 * Derive a shared secret scalar from an ephemeral private key and a view public key.
 * s = H(r · View_pub) reduced mod n
 */
function deriveSharedSecretSecp256k1(
  ephemeralPriv: Uint8Array,
  viewPub: Uint8Array
): bigint {
  const rScalar = toValidScalar(ephemeralPriv);
  const viewPoint = secp256k1.ProjectivePoint.fromHex(viewPub);
  const sharedPoint = viewPoint.multiply(rScalar);
  const hash = sha256(sharedPoint.toRawBytes(true));
  return mod(bytesToNumberBE(hash), SECP256K1_ORDER);
}

/**
 * Derive a shared secret scalar from a view private key and an ephemeral public key.
 * s' = H(view_priv · R) reduced mod n
 */
export function deriveSharedSecretFromViewPrivSecp256k1(
  viewPriv: Uint8Array,
  ephemeralPub: Uint8Array
): bigint {
  const viewScalar = toValidScalar(viewPriv);
  const rPoint = secp256k1.ProjectivePoint.fromHex(ephemeralPub);
  const sharedPoint = rPoint.multiply(viewScalar);
  const hash = sha256(sharedPoint.toRawBytes(true));
  return mod(bytesToNumberBE(hash), SECP256K1_ORDER);
}

/**
 * Convert a secp256k1 public key to an Ethereum address.
 */
function pubkeyToEthereumAddress(pubkey: Uint8Array): string {
  const uncompressed =
    pubkey.length === 33
      ? secp256k1.ProjectivePoint.fromHex(pubkey).toRawBytes(false)
      : pubkey;
  const hash = keccak_256(uncompressed.slice(1));
  return "0x" + bytesToHex(hash.slice(12));
}

/**
 * Sender-side: derive a stealth address for a recipient.
 *
 * If `ephemeralPriv` is not provided, a random one is generated.
 * Returns the stealth address and the ephemeral public key R that must be emitted on-chain.
 */
export function deriveStealthAddressSecp256k1(
  metaAddress: MetaAddress,
  ephemeralPriv?: Uint8Array
): StealthAddress & { ephemeralPubkey: Uint8Array; ephemeralPrivateKey: Uint8Array } {
  if (!metaAddress.spendPubSecp256k1 || !metaAddress.viewPubSecp256k1) {
    throw new Error("Meta-address missing secp256k1 keys");
  }

  const r = ephemeralPriv ?? randomSecp256k1Scalar();
  const rScalar = toValidScalar(r);
  const R = secp256k1.ProjectivePoint.BASE.multiply(rScalar).toRawBytes(true);

  const s = deriveSharedSecretSecp256k1(r, metaAddress.viewPubSecp256k1);
  const spendPubPoint = secp256k1.ProjectivePoint.fromHex(metaAddress.spendPubSecp256k1);
  const stealthPubPoint = spendPubPoint.add(secp256k1.ProjectivePoint.BASE.multiply(s));
  const stealthPub = stealthPubPoint.toRawBytes(true);

  return {
    address: stealthPub,
    formattedAddress: pubkeyToEthereumAddress(stealthPub),
    ephemeralPubkey: R,
    ephemeralPrivateKey: r,
  };
}

/**
 * Recipient-side: attempt to detect whether a stealth payment belongs to us.
 *
 * @returns The detected payment with derived private key, or null if no match.
 */
export function tryDecryptStealthPaymentSecp256k1(
  payment: StealthPayment,
  viewPriv: Uint8Array,
  spendPub: Uint8Array
): DetectedPayment | null {
  let s: bigint;
  try {
    s = deriveSharedSecretFromViewPrivSecp256k1(viewPriv, payment.ephemeralPubkey);
  } catch {
    return null;
  }

  const spendPubPoint = secp256k1.ProjectivePoint.fromHex(spendPub);
  const expectedPubPoint = spendPubPoint.add(secp256k1.ProjectivePoint.BASE.multiply(s));
  const expectedPub = expectedPubPoint.toRawBytes(true);

  if (!constantTimeEqual(expectedPub, payment.destination)) {
    return null;
  }

  return {
    ...payment,
    stealthPrivateKey: numberToBytesBE(s, 32),
  };
}

/**
 * Recipient-side: derive the stealth private key for a known payment.
 *
 * @param spendPriv  The meta-address spend private key (raw scalar, 32 bytes)
 * @param s          The shared secret scalar (from tryDecryptStealthPayment)
 * @returns The stealth private key as a raw scalar (32 bytes, big-endian)
 */
export function computeStealthPrivateKeySecp256k1(
  spendPriv: Uint8Array,
  s: bigint
): Uint8Array {
  const spendScalar = toValidScalar(spendPriv);
  const stealthScalar = mod(spendScalar + s, SECP256K1_ORDER);
  return numberToBytesBE(stealthScalar, 32);
}

/** Derive the stealth public key from the stealth private key (for verification). */
export function stealthPubkeyFromPrivateKeySecp256k1(stealthPriv: Uint8Array): Uint8Array {
  const scalar = toValidScalar(stealthPriv);
  return secp256k1.ProjectivePoint.BASE.multiply(scalar).toRawBytes(true);
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}
