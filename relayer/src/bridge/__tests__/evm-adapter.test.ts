/**
 * EVM Bridge Adapter Tests — PR-010F
 */

import { decodeBridgeMessageV1 } from '../evm-adapter';
import { encodeBridgeMessageV1, BridgeMessageType } from '@thewhiteprotocol/core';
import type { BridgeMessageV1 } from '@thewhiteprotocol/core';

function makeTestMessage(): BridgeMessageV1 {
  const now = Math.floor(Date.now() / 1000);
  return {
    protocolVersion: 1,
    messageType: BridgeMessageType.BridgeOut,
    sourceDomain: 33554434,
    destinationDomain: 33554435,
    sourceChainId: 84532,
    destinationChainId: 11155111,
    canonicalAssetId: '0'.repeat(63) + '1',
    sourceLocalAssetId: '0'.repeat(63) + '1',
    destinationLocalAssetId: '0'.repeat(63) + '1',
    amount: 1000000000000000000n,
    sourceNullifierHash: '0'.repeat(63) + '2',
    destinationCommitment: '0'.repeat(63) + '3',
    sourceRoot: '0'.repeat(63) + '4',
    sourceLeafIndex: 7,
    sourceTxHash: '0'.repeat(63) + '5',
    sourceBlockNumber: 100,
    sourceFinalityBlock: 110,
    nonce: 1,
    deadline: now + 86400,
    relayerFee: 10000000000000000n,
    recipientStealthMetadataHash: '0'.repeat(64),
    memoHash: '0'.repeat(64),
    reserved0: '0'.repeat(64),
    reserved1: '0'.repeat(64),
  };
}

describe('decodeBridgeMessageV1', () => {
  test('round-trip encode -> decode produces identical message', () => {
    const original = makeTestMessage();
    const encoded = encodeBridgeMessageV1(original);
    expect(encoded.length).toBe(451);

    const decoded = decodeBridgeMessageV1(encoded);

    expect(decoded.protocolVersion).toBe(original.protocolVersion);
    expect(decoded.messageType).toBe(original.messageType);
    expect(decoded.sourceDomain).toBe(original.sourceDomain);
    expect(decoded.destinationDomain).toBe(original.destinationDomain);
    expect(decoded.sourceChainId).toBe(original.sourceChainId);
    expect(decoded.destinationChainId).toBe(original.destinationChainId);
    expect(decoded.canonicalAssetId).toBe(original.canonicalAssetId);
    expect(decoded.sourceLocalAssetId).toBe(original.sourceLocalAssetId);
    expect(decoded.destinationLocalAssetId).toBe(original.destinationLocalAssetId);
    expect(decoded.amount).toBe(original.amount);
    expect(decoded.sourceNullifierHash).toBe(original.sourceNullifierHash);
    expect(decoded.destinationCommitment).toBe(original.destinationCommitment);
    expect(decoded.sourceRoot).toBe(original.sourceRoot);
    expect(decoded.sourceLeafIndex).toBe(original.sourceLeafIndex);
    expect(decoded.sourceTxHash).toBe(original.sourceTxHash);
    expect(decoded.sourceBlockNumber).toBe(original.sourceBlockNumber);
    expect(decoded.sourceFinalityBlock).toBe(original.sourceFinalityBlock);
    expect(decoded.nonce).toBe(original.nonce);
    expect(decoded.deadline).toBe(original.deadline);
    expect(decoded.relayerFee).toBe(original.relayerFee);
    expect(decoded.recipientStealthMetadataHash).toBe(original.recipientStealthMetadataHash);
    expect(decoded.memoHash).toBe(original.memoHash);
    expect(decoded.reserved0).toBe(original.reserved0);
    expect(decoded.reserved1).toBe(original.reserved1);
  });

  test('rejects invalid length', () => {
    expect(() => decodeBridgeMessageV1(new Uint8Array(450))).toThrow('Invalid encoded length');
    expect(() => decodeBridgeMessageV1(new Uint8Array(452))).toThrow('Invalid encoded length');
  });
});
