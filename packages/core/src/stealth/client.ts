/**
 * Stealth Address Client SDK for The White Protocol
 *
 * High-level API for:
 * - Generating meta-addresses from wallet signatures
 * - Sending to stealth addresses
 * - Scanning for incoming stealth payments
 */

/// <reference lib="dom" />

import {
  ChainTag,
  type MetaAddress,
  type StealthPayment,
  type DetectedPayment,
  type ScannerEvent,
} from "./types";
import {
  deriveStealthSeed,
  generateSolanaMetaAddressFromSeed,
  generateBaseMetaAddressFromSeed,
  generateUniversalMetaAddressFromSeed,
  serializeMetaAddress,
  parseMetaAddress,
} from "./meta-address";
import {
  deriveStealthAddressEd25519,
  deriveSharedSecretFromViewPrivEd25519,
  computeStealthPrivateKeyEd25519,
  stealthPubkeyFromPrivateKeyEd25519,
} from "./derive-ed25519";
import {
  deriveStealthAddressSecp256k1,
  deriveSharedSecretFromViewPrivSecp256k1,
  computeStealthPrivateKeySecp256k1,
  stealthPubkeyFromPrivateKeySecp256k1,
} from "./derive-secp256k1";
import { scanForPayments, getScannerKeyMaterial } from "./scanner";
import { bytesToHex, hexToBytes } from "./hex";

const META_ADDRESS_STORAGE_KEY = "white_protocol_meta_address_v1";
const STEALTH_PAYMENTS_STORAGE_KEY = "white_protocol_stealth_payments_v1";
const SCANNER_STATE_STORAGE_KEY = "white_protocol_scanner_state_v1";

/**
 * Generate a meta-address from a wallet signature.
 *
 * The wallet must sign a deterministic message. The signature bytes are used
 * as the IKM for HKDF-SHA256 to derive the stealth seed.
 *
 * @param signMessage - Function that signs a message and returns signature bytes
 * @param chainTag - Which chain tag to generate (Solana, Base, or Universal)
 * @returns The generated meta-address and keypairs
 */
export async function generateMetaAddressFromWallet(
  signMessage: (message: Uint8Array) => Promise<Uint8Array>,
  chainTag: ChainTag
): Promise<{
  metaAddress: MetaAddress;
  serialized: string;
}> {
  const message = new TextEncoder().encode(
    "Generate White Protocol stealth address. Signing this message creates a deterministic stealth meta-address."
  );
  const signature = await signMessage(message);

  if (signature.length < 32) {
    throw new Error(
      `Signature too short for stealth seed derivation: got ${signature.length} bytes, need at least 32`
    );
  }

  // Use first 64 bytes of signature as IKM (or pad/truncate to 64)
  const ikm = signature.slice(0, 64);
  const seed = deriveStealthSeed(ikm);

  let metaAddress: MetaAddress;

  if (chainTag === ChainTag.Solana) {
    const result = generateSolanaMetaAddressFromSeed(seed);
    metaAddress = result.metaAddress;
  } else if (chainTag === ChainTag.Base) {
    const result = generateBaseMetaAddressFromSeed(seed);
    metaAddress = result.metaAddress;
  } else {
    const result = generateUniversalMetaAddressFromSeed(seed);
    metaAddress = result.metaAddress;
  }

  const serialized = serializeMetaAddress(metaAddress);
  return { metaAddress, serialized };
}

/**
 * Derive a stealth address to send funds to, given a recipient's meta-address.
 *
 * @param metaAddress - Recipient's parsed meta-address
 * @param chain - Target chain
 * @returns Stealth address info including ephemeral pubkey to include in withdrawal
 */
export function sendToStealthAddress(
  metaAddress: MetaAddress,
  chain: "solana" | "base"
): {
  address: Uint8Array;
  formattedAddress: string;
  ephemeralPubkey: Uint8Array;
} {
  if (chain === "solana") {
    if (!metaAddress.spendPubEd25519 || !metaAddress.viewPubEd25519) {
      throw new Error("Solana stealth send requires ed25519 public keys in meta-address");
    }
    const stealth = deriveStealthAddressEd25519(metaAddress);
    return {
      address: stealth.address,
      formattedAddress: bytesToHex(stealth.address),
      ephemeralPubkey: stealth.ephemeralPubkey,
    };
  } else {
    if (!metaAddress.spendPubSecp256k1 || !metaAddress.viewPubSecp256k1) {
      throw new Error("Base stealth send requires secp256k1 public keys in meta-address");
    }
    const stealth = deriveStealthAddressSecp256k1(metaAddress);
    return {
      address: stealth.address,
      formattedAddress: stealth.formattedAddress,
      ephemeralPubkey: stealth.ephemeralPubkey,
    };
  }
}

/**
 * Local storage schema for a detected stealth payment.
 * NEVER stores private keys — only public data needed for scanning and display.
 */
export interface StoredStealthPayment {
  /** Unique ID for local storage */
  id: string;
  /** Chain where payment was received */
  chain: "solana" | "base";
  /** Transaction hash */
  txHash: string;
  /** Ephemeral pubkey as hex (no 0x prefix) */
  ephemeralPubkeyHex: string;
  /** Destination stealth address as hex (no 0x prefix) */
  destinationHex: string;
  /** Amount received */
  amount: bigint;
  /** Block height / slot where detected */
  blockHeight: bigint;
  /** When the payment was first detected locally */
  detectedAt: number;
  /** Whether the payment has been withdrawn to the main wallet */
  withdrawn: boolean;
}

/**
 * Scanner state persisted to localStorage / IndexedDB.
 */
interface ScannerState {
  version: number;
  lastScannedSlot: number;
  lastScannedBlock: number;
}

const SCANNER_STATE_VERSION = 1;

/**
 * Stealth payment scanner for a single user.
 *
 * Scans on-chain events, detects payments belonging to the user's meta-address,
 * and persists them to local storage.
 */
export class StealthScanner {
  private metaAddress: MetaAddress;
  private spendPriv: Uint8Array;
  private viewPriv: Uint8Array;
  private chain: "solana" | "base";

  constructor(
    metaAddress: MetaAddress,
    spendPriv: Uint8Array,
    viewPriv: Uint8Array,
    chain: "solana" | "base"
  ) {
    this.metaAddress = metaAddress;
    this.spendPriv = spendPriv;
    this.viewPriv = viewPriv;
    this.chain = chain;
  }

  /**
   * Scan a batch of on-chain events for stealth payments.
   *
   * @param events - On-chain events to scan
   * @returns Newly detected payments (already persisted)
   */
  scan(events: ScannerEvent[]): StoredStealthPayment[] {
    const keyMaterial = getScannerKeyMaterial(
      this.metaAddress,
      this.spendPriv,
      this.viewPriv,
      this.chain
    );

    const detected = scanForPayments(events, keyMaterial);

    const stored: StoredStealthPayment[] = detected.map((payment) => ({
      id: `${payment.chain}-${payment.txHash}-${bytesToHex(payment.ephemeralPubkey).slice(0, 16)}`,
      chain: payment.chain,
      txHash: payment.txHash,
      ephemeralPubkeyHex: bytesToHex(payment.ephemeralPubkey),
      destinationHex: bytesToHex(payment.destination),
      amount: payment.amount,
      blockHeight: BigInt(payment.blockHeight),
      detectedAt: Date.now(),
      withdrawn: false,
    }));

    // Update scanner state to highest block seen
    if (events.length > 0) {
      const maxBlock = Math.max(...events.map((e) => Number(e.blockHeight)));
      const currentState = loadScannerState();
      if (this.chain === "solana") {
        currentState.lastScannedSlot = Math.max(currentState.lastScannedSlot, maxBlock);
      } else {
        currentState.lastScannedBlock = Math.max(currentState.lastScannedBlock, maxBlock);
      }
      saveScannerState(currentState);
    }

    // Persist new payments
    if (stored.length > 0) {
      this.persistPayments(stored);
    }

    return stored;
  }

  /**
   * Get all detected payments from local storage.
   */
  getPayments(): StoredStealthPayment[] {
    return this.loadPayments();
  }

  /**
   * Get total balance of all unwithdrawn detected payments.
   */
  getBalance(): bigint {
    return this.loadPayments()
      .filter((p) => !p.withdrawn)
      .reduce((sum, p) => sum + p.amount, 0n);
  }

  /**
   * Get list of received payments.
   */
  listReceivedPayments(): StoredStealthPayment[] {
    return this.loadPayments().filter((p) => !p.withdrawn);
  }

  /**
   * Mark a payment as withdrawn.
   */
  markWithdrawn(paymentId: string): void {
    const payments = this.loadPayments();
    const idx = payments.findIndex((p) => p.id === paymentId);
    if (idx >= 0) {
      payments[idx].withdrawn = true;
      this.savePayments(payments);
    }
  }

  /**
   * Derive the stealth private key for a specific payment.
   * Recomputes `s` from the ephemeral pubkey on demand — private keys are never persisted.
   */
  deriveStealthPrivateKey(payment: StoredStealthPayment): Uint8Array {
    const ephemeralPubkey = hexToBytes(payment.ephemeralPubkeyHex);
    const s = this.recomputeS(ephemeralPubkey);

    if (this.chain === "solana") {
      return computeStealthPrivateKeyEd25519(this.spendPriv, s);
    } else {
      return computeStealthPrivateKeySecp256k1(this.spendPriv, s);
    }
  }

  /**
   * Verify that a derived stealth private key produces the expected public key.
   */
  verifyStealthPrivateKey(
    payment: StoredStealthPayment,
    stealthPriv: Uint8Array
  ): boolean {
    const destination = hexToBytes(payment.destinationHex);

    if (this.chain === "solana") {
      const derivedPub = stealthPubkeyFromPrivateKeyEd25519(stealthPriv);
      return constantTimeEqual(derivedPub, destination);
    } else {
      const derivedPub = stealthPubkeyFromPrivateKeySecp256k1(stealthPriv);
      return constantTimeEqual(derivedPub, destination);
    }
  }

  /**
   * Recompute the shared secret `s` from an ephemeral pubkey.
   * This is what the scanner does during detection; we redo it here
   * so private keys never need to be stored.
   */
  private recomputeS(ephemeralPubkey: Uint8Array): bigint {
    try {
      if (this.chain === "solana") {
        return deriveSharedSecretFromViewPrivEd25519(this.viewPriv, ephemeralPubkey);
      } else {
        return deriveSharedSecretFromViewPrivSecp256k1(this.viewPriv, ephemeralPubkey);
      }
    } catch {
      return 0n;
    }
  }

  // ---------------------------------------------------------------------------
  // Persistence helpers (localStorage for browser, in-memory fallback)
  // ---------------------------------------------------------------------------

  private loadPayments(): StoredStealthPayment[] {
    if (typeof localStorage === "undefined") return [];
    const raw = localStorage.getItem(STEALTH_PAYMENTS_STORAGE_KEY);
    if (!raw) return [];
    try {
      return JSON.parse(raw, (key, value) => {
        if (key === "amount" || key === "blockHeight") {
          return typeof value === "string" ? BigInt(value) : value;
        }
        return value;
      });
    } catch {
      return [];
    }
  }

  private savePayments(payments: StoredStealthPayment[]): void {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(
      STEALTH_PAYMENTS_STORAGE_KEY,
      JSON.stringify(payments, (_key, value) => {
        if (typeof value === "bigint") return value.toString();
        return value;
      })
    );
  }

  private persistPayments(newPayments: StoredStealthPayment[]): void {
    const existing = this.loadPayments();
    const existingIds = new Set(existing.map((p) => p.id));
    const toAdd = newPayments.filter((p) => !existingIds.has(p.id));
    if (toAdd.length > 0) {
      this.savePayments([...existing, ...toAdd]);
    }
  }
}

/**
 * Load scanner state from localStorage.
 */
export function loadScannerState(): ScannerState {
  if (typeof localStorage === "undefined") {
    return { version: SCANNER_STATE_VERSION, lastScannedSlot: 0, lastScannedBlock: 0 };
  }
  const raw = localStorage.getItem(SCANNER_STATE_STORAGE_KEY);
  if (!raw) {
    return { version: SCANNER_STATE_VERSION, lastScannedSlot: 0, lastScannedBlock: 0 };
  }
  try {
    const parsed = JSON.parse(raw);
    if (parsed.version !== SCANNER_STATE_VERSION) {
      return { version: SCANNER_STATE_VERSION, lastScannedSlot: 0, lastScannedBlock: 0 };
    }
    return parsed;
  } catch {
    return { version: SCANNER_STATE_VERSION, lastScannedSlot: 0, lastScannedBlock: 0 };
  }
}

/**
 * Save scanner state to localStorage.
 */
export function saveScannerState(state: ScannerState): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(SCANNER_STATE_STORAGE_KEY, JSON.stringify(state));
}

/**
 * Save a generated meta-address to localStorage.
 */
export function saveMetaAddress(serialized: string): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(META_ADDRESS_STORAGE_KEY, serialized);
}

/**
 * Load the saved meta-address from localStorage.
 */
export function loadMetaAddress(): MetaAddress | null {
  if (typeof localStorage === "undefined") return null;
  const raw = localStorage.getItem(META_ADDRESS_STORAGE_KEY);
  if (!raw) return null;
  try {
    return parseMetaAddress(raw);
  } catch {
    return null;
  }
}

/**
 * Clear all stealth-related local storage.
 */
export function clearStealthStorage(): void {
  if (typeof localStorage === "undefined") return;
  localStorage.removeItem(META_ADDRESS_STORAGE_KEY);
  localStorage.removeItem(STEALTH_PAYMENTS_STORAGE_KEY);
  localStorage.removeItem(SCANNER_STATE_STORAGE_KEY);
}

/** Constant-time comparison to avoid timing attacks */
function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}
