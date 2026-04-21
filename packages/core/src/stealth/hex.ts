/**
 * Pure Uint8Array hex encoding/decoding — no Buffer dependency.
 * Safe for browsers, Web Workers, and Node.
 */

const HEX_CHARS = "0123456789abcdef";

/** Encode Uint8Array to lowercase hex string (no 0x prefix). */
export function bytesToHex(bytes: Uint8Array): string {
  let hex = "";
  for (let i = 0; i < bytes.length; i++) {
    hex += HEX_CHARS[bytes[i] >>> 4];
    hex += HEX_CHARS[bytes[i] & 0x0f];
  }
  return hex;
}

/** Decode hex string (with or without 0x prefix) to Uint8Array. */
export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") || hex.startsWith("0X") ? hex.slice(2) : hex;
  if (clean.length % 2 !== 0) throw new Error("Invalid hex string length");
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    const hi = parseInt(clean[i * 2], 16);
    const lo = parseInt(clean[i * 2 + 1], 16);
    if (Number.isNaN(hi) || Number.isNaN(lo)) throw new Error("Invalid hex character");
    bytes[i] = (hi << 4) | lo;
  }
  return bytes;
}
