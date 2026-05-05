/**
 * Bridge Signer Service — PR-010F
 *
 * Signs raw BridgeMessageV1 hashes with secp256k1 test keys.
 * Produces 65-byte signatures (r||s||v) with v ∈ {27, 28}.
 * Sorts signatures by recovered Ethereum address ascending.
 *
 * SECURITY WARNING:
 * - This service is for TESTNET/LOCAL USE ONLY.
 * - Production MUST use HSM/KMS/MPC.
 * - Never commit real private keys.
 */

import { privateKeyToAccount } from 'viem/accounts';
import { recoverAddress, type Hex } from 'viem';
import {
  hashBridgeMessageV1,
  type BridgeMessageV1,
} from '@thewhiteprotocol/core';
import type { BridgeSignature, BridgeSignerConfig } from './types';

export class BridgeSignerService {
  private readonly threshold: number;
  private readonly accounts: ReturnType<typeof privateKeyToAccount>[];

  constructor(config: BridgeSignerConfig) {
    this.threshold = config.threshold;
    this.accounts = config.privateKeys.map((pk) => {
      const normalized = pk.startsWith('0x') ? (pk as Hex) : (`0x${pk}` as Hex);
      return privateKeyToAccount(normalized);
    });
  }

  /**
   * Sign a BridgeMessageV1 hash with all configured signers.
   * Returns signatures sorted by recovered Ethereum address ascending.
   */
  async signMessage(message: BridgeMessageV1): Promise<BridgeSignature[]> {
    const messageHash = hashBridgeMessageV1(message) as Hex;
    const signatures: BridgeSignature[] = [];

    for (const account of this.accounts) {
      const sigHex = await account.sign({ hash: messageHash });
      const recovered = await recoverAddress({ hash: messageHash, signature: sigHex });

      signatures.push({
        signature: sigHex,
        signerAddress: recovered,
      });
    }

    // Sort by recovered Ethereum address ascending (strictly increasing)
    signatures.sort((a, b) => {
      const addrA = a.signerAddress.toLowerCase();
      const addrB = b.signerAddress.toLowerCase();
      if (addrA < addrB) return -1;
      if (addrA > addrB) return 1;
      return 0;
    });

    return signatures;
  }

  /**
   * Take exactly `threshold` signatures from the sorted list.
   * Useful when only a subset is needed for submission.
   */
  takeThreshold(signatures: BridgeSignature[]): BridgeSignature[] {
    if (signatures.length < this.threshold) {
      throw new Error(
        `Insufficient signatures: have ${signatures.length}, need ${this.threshold}`
      );
    }
    return signatures.slice(0, this.threshold);
  }

  /**
   * Verify that a set of signatures are sorted and have no duplicates.
   */
  validateSignatureOrder(signatures: BridgeSignature[]): void {
    for (let i = 1; i < signatures.length; i++) {
      const prev = signatures[i - 1].signerAddress.toLowerCase();
      const curr = signatures[i].signerAddress.toLowerCase();
      if (curr <= prev) {
        throw new Error(
          `Signatures not sorted by signer address at index ${i}: ${curr} <= ${prev}`
        );
      }
    }
  }

  /**
   * Extract raw 65-byte hex signatures for contract submission.
   */
  extractRawSignatures(signatures: BridgeSignature[]): string[] {
    return signatures.map((s) => s.signature);
  }

  /**
   * Recover the Ethereum address from a signature and message hash.
   */
  async recoverSigner(messageHash: Hex, signature: Hex): Promise<string> {
    return recoverAddress({ hash: messageHash, signature });
  }

  getThreshold(): number {
    return this.threshold;
  }

  getSignerCount(): number {
    return this.accounts.length;
  }
}
