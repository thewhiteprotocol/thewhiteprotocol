/**
 * EVM stealth withdrawal helper utilities.
 */

/**
 * Validate a 66-character hex string as a compressed secp256k1 public key.
 * Must be 33 bytes (66 hex chars) and start with 0x02 or 0x03.
 */
export function isValidCompressedSecp256k1Pubkey(hex: string): boolean {
  if (!/^[0-9a-fA-F]{66}$/.test(hex)) {
    return false;
  }
  const prefix = parseInt(hex.slice(0, 2), 16);
  if (prefix !== 0x02 && prefix !== 0x03) {
    return false;
  }
  if (hex === '0'.repeat(66)) {
    return false;
  }
  return true;
}

/**
 * Determine whether an EVM withdrawal should use the stealth variant.
 */
export function shouldUseEvmStealthWithdrawal(ephemeralPubkey?: string): boolean {
  return !!ephemeralPubkey && isValidCompressedSecp256k1Pubkey(ephemeralPubkey);
}
