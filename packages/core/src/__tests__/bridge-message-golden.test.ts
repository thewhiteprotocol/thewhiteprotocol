/**
 * Bridge Message V1 — Golden vector cross-language parity tests.
 *
 * These tests assert that TypeScript produces the EXACT same keccak256 hashes
 * as the golden vectors, which are shared with Solidity and Rust tests.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import {
  hashBridgeMessageV1,
  BridgeMessageV1,
  BridgeMessageType,
  BRIDGE_MESSAGE_ENCODED_LENGTH,
} from '../bridge-message.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const raw = readFileSync(join(__dirname, 'bridge-message-golden.json'), 'utf-8');
const golden = JSON.parse(raw);

describe('BridgeMessageV1 golden vectors', () => {
  it('has correct metadata', () => {
    expect(golden.domainSeparator).toBe('WHITE_PRIVATE_BRIDGE_MESSAGE_V1');
    expect(golden.encodedLength).toBe(BRIDGE_MESSAGE_ENCODED_LENGTH);
  });

  for (const v of golden.vectors) {
    it(`${v.name}: hash matches golden vector`, () => {
      const m = v.message;
      const msg: BridgeMessageV1 = {
        protocolVersion: m.protocolVersion,
        messageType: m.messageType as BridgeMessageType,
        sourceDomain: m.sourceDomain,
        destinationDomain: m.destinationDomain,
        sourceChainId: m.sourceChainId,
        destinationChainId: m.destinationChainId,
        canonicalAssetId: m.canonicalAssetId,
        sourceLocalAssetId: m.sourceLocalAssetId,
        destinationLocalAssetId: m.destinationLocalAssetId,
        amount: BigInt(m.amount),
        sourceNullifierHash: m.sourceNullifierHash,
        destinationCommitment: m.destinationCommitment,
        sourceRoot: m.sourceRoot,
        sourceLeafIndex: m.sourceLeafIndex,
        sourceTxHash: m.sourceTxHash,
        sourceBlockNumber: m.sourceBlockNumber,
        sourceFinalityBlock: m.sourceFinalityBlock,
        nonce: m.nonce,
        deadline: m.deadline,
        relayerFee: BigInt(m.relayerFee),
        recipientStealthMetadataHash: m.recipientStealthMetadataHash,
        memoHash: m.memoHash,
        reserved0: m.reserved0,
        reserved1: m.reserved1,
      };
      const hash = hashBridgeMessageV1(msg);
      expect(hash).toBe(v.expectedHash);
    });
  }
});
