"use client";

/**
 * App-level stealth address helpers.
 * Re-exports from @thewhiteprotocol/core with browser-friendly wrappers.
 */

export {
  generateMetaAddressFromWallet,
  sendToStealthAddress,
  StealthScanner,
  loadScannerState,
  saveScannerState,
  saveMetaAddress,
  loadMetaAddress,
  clearStealthStorage,
} from "@thewhiteprotocol/core";

export type { StoredStealthPayment } from "@thewhiteprotocol/core";

/**
 * Detect whether a string is a meta-address (base58 encoded with valid checksum).
 */
export async function isMetaAddress(str: string): Promise<boolean> {
  try {
    const { parseMetaAddress } = await import("@thewhiteprotocol/core");
    parseMetaAddress(str);
    return true;
  } catch {
    return false;
  }
}
