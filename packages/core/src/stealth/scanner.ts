/**
 * Stealth payment scanner.
 *
 * Takes a list of on-chain events (each with ephemeral pubkey + destination)
 * and a viewing key, returns matched payments.
 */

import {
  tryDecryptStealthPaymentEd25519,
  tryDecryptStealthPaymentSecp256k1,
} from "./derive";
import type {
  MetaAddress,
  StealthPayment,
  DetectedPayment,
  ScannerEvent,
} from "./types";

export interface ScannerKeyMaterial {
  viewPriv: Uint8Array;
  spendPub: Uint8Array;
  chain: "solana" | "base";
}

/**
 * Scan a list of events for payments belonging to the given meta-address.
 *
 * @param events        On-chain events containing (ephemeralPubkey, destination)
 * @param keyMaterial   Viewing private key + spend public key + chain
 * @param basePayments  Optional base payment data (amount, assetId, etc.) keyed by txHash
 * @returns             List of detected payments with derived stealth private keys
 */
export function scanForPayments(
  events: ScannerEvent[],
  keyMaterial: ScannerKeyMaterial,
  basePayments?: Map<string, Omit<StealthPayment, "ephemeralPubkey" | "destination">>
): DetectedPayment[] {
  const detected: DetectedPayment[] = [];

  for (const event of events) {
    const base = basePayments?.get(event.txHash);

    const payment: StealthPayment = {
      ephemeralPubkey: event.ephemeralPubkey,
      destination: event.destination,
      amount: base?.amount ?? 0n,
      assetId: base?.assetId ?? "0",
      chain: keyMaterial.chain,
      blockHeight: base?.blockHeight ?? event.blockHeight,
      txHash: event.txHash,
    };

    const result =
      keyMaterial.chain === "solana"
        ? tryDecryptStealthPaymentEd25519(payment, keyMaterial.viewPriv, keyMaterial.spendPub)
        : tryDecryptStealthPaymentSecp256k1(payment, keyMaterial.viewPriv, keyMaterial.spendPub);

    if (result) {
      detected.push(result);
    }
  }

  return detected;
}

/**
 * Extract scanner key material from a meta-address and the corresponding private keys.
 *
 * @param metaAddress   Parsed meta-address
 * @param spendPriv     Spend private key (raw scalar)
 * @param viewPriv      View private key (raw scalar)
 * @param chain         Which chain to scan (required for Universal meta-addresses)
 * @returns             Scanner key material for the appropriate chain
 */
export function getScannerKeyMaterial(
  metaAddress: MetaAddress,
  spendPriv: Uint8Array,
  viewPriv: Uint8Array,
  chain: "solana" | "base" = "solana"
): ScannerKeyMaterial {
  if (metaAddress.chainTag === 0x01) {
    if (!metaAddress.spendPubEd25519 || !metaAddress.viewPubEd25519) {
      throw new Error("Invalid Solana meta-address");
    }
    return {
      viewPriv,
      spendPub: metaAddress.spendPubEd25519,
      chain: "solana",
    };
  } else if (metaAddress.chainTag === 0x02) {
    if (!metaAddress.spendPubSecp256k1 || !metaAddress.viewPubSecp256k1) {
      throw new Error("Invalid Base meta-address");
    }
    return {
      viewPriv,
      spendPub: metaAddress.spendPubSecp256k1,
      chain: "base",
    };
  } else if (metaAddress.chainTag === 0x03) {
    if (chain === "solana") {
      if (!metaAddress.spendPubEd25519 || !metaAddress.viewPubEd25519) {
        throw new Error("Invalid universal meta-address: missing ed25519 keys");
      }
      return {
        viewPriv,
        spendPub: metaAddress.spendPubEd25519,
        chain: "solana",
      };
    } else {
      if (!metaAddress.spendPubSecp256k1 || !metaAddress.viewPubSecp256k1) {
        throw new Error("Invalid universal meta-address: missing secp256k1 keys");
      }
      return {
        viewPriv,
        spendPub: metaAddress.spendPubSecp256k1,
        chain: "base",
      };
    }
  }
  throw new Error(`Unsupported chain tag: ${metaAddress.chainTag}`);
}
