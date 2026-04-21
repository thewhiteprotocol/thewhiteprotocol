/**
 * The White Protocol — Stealth Address Layer
 *
 * Dual-key stealth scheme for ed25519 (Solana) and secp256k1 (Base/EVM).
 * All derivation happens off-chain; on-chain only emits ephemeral pubkeys.
 */

export {
  ChainTag,
  type MetaAddress,
  type StealthAddress,
  type StealthPayment,
  type DetectedPayment,
  type ScannerEvent,
  type CurveKeypair,
} from "./types";

export {
  deriveStealthSeed,
  generateSolanaMetaAddressFromSeed,
  generateBaseMetaAddressFromSeed,
  generateUniversalMetaAddressFromSeed,
  serializeMetaAddress,
  parseMetaAddress,
} from "./meta-address";

export {
  deriveStealthAddressEd25519,
  tryDecryptStealthPaymentEd25519,
  computeStealthPrivateKeyEd25519,
  stealthPubkeyFromPrivateKeyEd25519,
  randomEd25519Scalar,
  deriveStealthAddressSecp256k1,
  tryDecryptStealthPaymentSecp256k1,
  computeStealthPrivateKeySecp256k1,
  stealthPubkeyFromPrivateKeySecp256k1,
  randomSecp256k1Scalar,
} from "./derive";

export {
  scanForPayments,
  getScannerKeyMaterial,
  type ScannerKeyMaterial,
} from "./scanner";

export {
  generateMetaAddressFromWallet,
  sendToStealthAddress,
  StealthScanner,
  loadScannerState,
  saveScannerState,
  saveMetaAddress,
  loadMetaAddress,
  clearStealthStorage,
  type StoredStealthPayment,
} from "./client";

export { bytesToHex, hexToBytes } from "./hex";

import { parseMetaAddress } from "./meta-address";

/** Detect whether a string is a valid meta-address (base58 encoded with valid checksum). */
export function isMetaAddress(str: string): boolean {
  try {
    parseMetaAddress(str);
    return true;
  } catch {
    return false;
  }
}
