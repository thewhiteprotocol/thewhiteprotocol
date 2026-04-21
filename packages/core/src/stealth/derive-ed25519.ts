/**
 * Solana (ed25519) stealth address derivation.
 *
 * Sender:   P = Spend_pub + s·G   where s = H(r·View_pub)
 * Recipient: s' = H(view_priv·R)  where R = r·G
 *           P' = Spend_pub + s'·G
 *           match if P == P'
 * Private key: stealth_priv = spend_priv + s (mod ℓ)
 *
 * Important: Ed25519's standard getPublicKey() hashes the seed with SHA-512.
 * For stealth addresses we need raw scalar arithmetic, so we use
 * ExtendedPoint.BASE.multiply(scalar) directly.
 */

import { sha256 } from "@noble/hashes/sha256";
import { ed25519 } from "@noble/curves/ed25519";
import { numberToBytesBE, bytesToNumberBE } from "@noble/curves/abstract/utils";
import { mod } from "@noble/curves/abstract/modular";
import { randomBytes } from "@noble/hashes/utils";
import { bytesToHex } from "./hex";
import type { MetaAddress, StealthAddress, StealthPayment, DetectedPayment } from "./types";

const ED25519_ORDER = ed25519.CURVE.n;

function toValidScalar(bytes: Uint8Array): bigint {
  const s = mod(bytesToNumberBE(bytes), ED25519_ORDER);
  if (s === 0n) throw new Error("Derived scalar is zero");
  return s;
}

/** Generate a random ed25519 scalar (already reduced mod ℓ) from CSPRNG */
export function randomEd25519Scalar(): Uint8Array {
  // Sample 64 bytes and reduce modulo ℓ for uniform distribution
  const rand = randomBytes(64);
  const scalar = mod(bytesToNumberBE(rand), ED25519_ORDER);
  return numberToBytesBE(scalar, 32);
}

/**
 * Derive a shared secret scalar from an ephemeral private key and a view public key.
 * s = H(r · View_pub) reduced mod ℓ
 */
function deriveSharedSecretEd25519(
  ephemeralPriv: Uint8Array,
  viewPub: Uint8Array
): bigint {
  const rScalar = toValidScalar(ephemeralPriv);
  const viewPoint = ed25519.ExtendedPoint.fromHex(viewPub);
  const sharedPoint = viewPoint.multiply(rScalar);
  const hash = sha256(sharedPoint.toRawBytes());
  return mod(bytesToNumberBE(hash), ED25519_ORDER);
}

/**
 * Derive a shared secret scalar from a view private key and an ephemeral public key.
 * s' = H(view_priv · R) reduced mod ℓ
 */
export function deriveSharedSecretFromViewPrivEd25519(
  viewPriv: Uint8Array,
  ephemeralPub: Uint8Array
): bigint {
  const viewScalar = toValidScalar(viewPriv);
  const rPoint = ed25519.ExtendedPoint.fromHex(ephemeralPub);
  const sharedPoint = rPoint.multiply(viewScalar);
  const hash = sha256(sharedPoint.toRawBytes());
  return mod(bytesToNumberBE(hash), ED25519_ORDER);
}

/**
 * Sender-side: derive a stealth address for a recipient.
 *
 * If `ephemeralPriv` is not provided, a random one is generated.
 * Returns the stealth address and the ephemeral public key R that must be emitted on-chain.
 */
export function deriveStealthAddressEd25519(
  metaAddress: MetaAddress,
  ephemeralPriv?: Uint8Array
): StealthAddress & { ephemeralPubkey: Uint8Array; ephemeralPrivateKey: Uint8Array } {
  if (!metaAddress.spendPubEd25519 || !metaAddress.viewPubEd25519) {
    throw new Error("Meta-address missing ed25519 keys");
  }

  const r = ephemeralPriv ?? randomEd25519Scalar();
  const rScalar = toValidScalar(r);
  const R = ed25519.ExtendedPoint.BASE.multiply(rScalar).toRawBytes();

  const s = deriveSharedSecretEd25519(r, metaAddress.viewPubEd25519);
  const spendPubPoint = ed25519.ExtendedPoint.fromHex(metaAddress.spendPubEd25519);
  const stealthPubPoint = spendPubPoint.add(ed25519.ExtendedPoint.BASE.multiply(s));
  const stealthPub = stealthPubPoint.toRawBytes();

  return {
    address: stealthPub,
    formattedAddress: bytesToHex(stealthPub),
    ephemeralPubkey: R,
    ephemeralPrivateKey: r,
  };
}

/**
 * Recipient-side: attempt to detect whether a stealth payment belongs to us.
 *
 * @returns The detected payment with derived private key, or null if no match.
 */
export function tryDecryptStealthPaymentEd25519(
  payment: StealthPayment,
  viewPriv: Uint8Array,
  spendPub: Uint8Array
): DetectedPayment | null {
  let s: bigint;
  try {
    s = deriveSharedSecretFromViewPrivEd25519(viewPriv, payment.ephemeralPubkey);
  } catch {
    // Invalid ephemeral pubkey or scalar
    return null;
  }

  const spendPubPoint = ed25519.ExtendedPoint.fromHex(spendPub);
  const expectedPubPoint = spendPubPoint.add(ed25519.ExtendedPoint.BASE.multiply(s));
  const expectedPub = expectedPubPoint.toRawBytes();

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
export function computeStealthPrivateKeyEd25519(
  spendPriv: Uint8Array,
  s: bigint
): Uint8Array {
  const spendScalar = toValidScalar(spendPriv);
  const stealthScalar = mod(spendScalar + s, ED25519_ORDER);
  return numberToBytesBE(stealthScalar, 32);
}

/** Derive the stealth public key from the stealth private key (for verification). */
export function stealthPubkeyFromPrivateKeyEd25519(stealthPriv: Uint8Array): Uint8Array {
  const scalar = toValidScalar(stealthPriv);
  return ed25519.ExtendedPoint.BASE.multiply(scalar).toRawBytes();
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}
