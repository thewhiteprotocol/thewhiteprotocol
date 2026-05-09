import { describe, it, expect } from 'vitest';
import {
  BridgeMessageType,
  BRIDGE_MESSAGE_DOMAIN_SEPARATOR,
  BRIDGE_MESSAGE_ENCODED_LENGTH,
  encodeBridgeMessageV1,
  hashBridgeMessageV1,
  hashEncodedBridgeMessageV1,
  validateBridgeMessageV1,
  assertValidBridgeMessageV1,
  parseBridgeMessageV1Json,
  bridgeMessageV1JsonReplacer,
} from '../bridge-message.js';
import vectorsJson from '../../../../docs/bridge/bridge-message-vectors.json';

function makeValidMessage(): any {
  return {
    protocolVersion: 1,
    messageType: BridgeMessageType.BridgeOut,
    sourceDomain: 33554434,
    destinationDomain: 33554435,
    sourceChainId: 84532,
    destinationChainId: 11155111,
    canonicalAssetId: '0000000000000000000000000000000000000000000000000000000000000001',
    sourceLocalAssetId: '0000000000000000000000000000000000000000000000000000000000000001',
    destinationLocalAssetId: '0000000000000000000000000000000000000000000000000000000000000001',
    amount: 1000000000000000000n,
    sourceNullifierHash: '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
    destinationCommitment: 'fedcba0987654321fedcba0987654321fedcba0987654321fedcba0987654321',
    sourceRoot: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    sourceLeafIndex: 7,
    sourceTxHash: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    sourceBlockNumber: 12345678,
    sourceFinalityBlock: 12345688,
    nonce: 1,
    deadline: 1770000000,
    relayerFee: 5000000000000000n,
    recipientStealthMetadataHash: '0000000000000000000000000000000000000000000000000000000000000000',
    memoHash: '0000000000000000000000000000000000000000000000000000000000000000',
    reserved0: '0000000000000000000000000000000000000000000000000000000000000000',
    reserved1: '0000000000000000000000000000000000000000000000000000000000000000',
  };
}

describe('bridge-message', () => {
  it('domain separator is correct ASCII', () => {
    expect(BRIDGE_MESSAGE_DOMAIN_SEPARATOR).toBe('WHITE_PRIVATE_BRIDGE_MESSAGE_V1');
  });

  it('fixed encoded length is 451', () => {
    expect(BRIDGE_MESSAGE_ENCODED_LENGTH).toBe(451);
  });

  it('encodes to exactly 451 bytes', () => {
    const msg = makeValidMessage();
    const encoded = encodeBridgeMessageV1(msg);
    expect(encoded.length).toBe(451);
  });

  it('deterministic encoding: same input yields same bytes', () => {
    const msg = makeValidMessage();
    const e1 = encodeBridgeMessageV1(msg);
    const e2 = encodeBridgeMessageV1(msg);
    expect(e1).toEqual(e2);
  });

  it('deterministic hash: same input yields same hash', () => {
    const msg = makeValidMessage();
    const h1 = hashBridgeMessageV1(msg);
    const h2 = hashBridgeMessageV1(msg);
    expect(h1).toBe(h2);
  });

  it('different inputs yield different hashes', () => {
    const msg1 = makeValidMessage();
    const msg2 = { ...makeValidMessage(), amount: 999n };
    const h1 = hashBridgeMessageV1(msg1);
    const h2 = hashBridgeMessageV1(msg2);
    expect(h1).not.toBe(h2);
  });

  it('hash matches hashEncoded for same bytes', () => {
    const msg = makeValidMessage();
    const encoded = encodeBridgeMessageV1(msg);
    const h1 = hashBridgeMessageV1(msg);
    const h2 = hashEncodedBridgeMessageV1(encoded);
    expect(h1).toBe(h2);
  });

  describe('golden vectors', () => {
    const vectors = (vectorsJson as any).vectors;

    it.each(vectors)('produces consistent hash for "$name"', (vector: any) => {
      const msg = {
        protocolVersion: vector.message.protocolVersion,
        messageType: vector.message.messageType,
        sourceDomain: vector.message.sourceDomain,
        destinationDomain: vector.message.destinationDomain,
        sourceChainId: vector.message.sourceChainId,
        destinationChainId: vector.message.destinationChainId,
        canonicalAssetId: vector.message.canonicalAssetId,
        sourceLocalAssetId: vector.message.sourceLocalAssetId,
        destinationLocalAssetId: vector.message.destinationLocalAssetId,
        amount: BigInt(vector.message.amount),
        sourceNullifierHash: vector.message.sourceNullifierHash,
        destinationCommitment: vector.message.destinationCommitment,
        sourceRoot: vector.message.sourceRoot,
        sourceLeafIndex: vector.message.sourceLeafIndex,
        sourceTxHash: vector.message.sourceTxHash,
        sourceBlockNumber: vector.message.sourceBlockNumber,
        sourceFinalityBlock: vector.message.sourceFinalityBlock,
        nonce: vector.message.nonce,
        deadline: vector.message.deadline,
        relayerFee: BigInt(vector.message.relayerFee),
        recipientStealthMetadataHash: vector.message.recipientStealthMetadataHash,
        memoHash: vector.message.memoHash,
        reserved0: vector.message.reserved0,
        reserved1: vector.message.reserved1,
      };

      const encoded = encodeBridgeMessageV1(msg);
      expect(encoded.length).toBe(451);

      const hash = hashBridgeMessageV1(msg);
      expect(hash).toMatch(/^0x[0-9a-f]{64}$/);
    });
  });

  describe('validation', () => {
    it('accepts valid message', () => {
      const errors = validateBridgeMessageV1(makeValidMessage());
      expect(errors).toHaveLength(0);
    });

    it('rejects protocolVersion != 1', () => {
      const msg = { ...makeValidMessage(), protocolVersion: 2 };
      const errors = validateBridgeMessageV1(msg);
      expect(errors.some(e => e.field === 'protocolVersion')).toBe(true);
    });

    it('rejects invalid messageType', () => {
      const msg = { ...makeValidMessage(), messageType: 99 };
      const errors = validateBridgeMessageV1(msg);
      expect(errors.some(e => e.field === 'messageType')).toBe(true);
    });

    it('rejects sourceDomain == 0', () => {
      const msg = { ...makeValidMessage(), sourceDomain: 0 };
      const errors = validateBridgeMessageV1(msg);
      expect(errors.some(e => e.field === 'sourceDomain')).toBe(true);
    });

    it('rejects destinationDomain == 0', () => {
      const msg = { ...makeValidMessage(), destinationDomain: 0 };
      const errors = validateBridgeMessageV1(msg);
      expect(errors.some(e => e.field === 'destinationDomain')).toBe(true);
    });

    it('rejects sourceDomain == destinationDomain', () => {
      const base = makeValidMessage();
      const msg = { ...base, destinationDomain: base.sourceDomain };
      const errors = validateBridgeMessageV1(msg);
      expect(errors.some(e => e.code === 'SAME_DOMAIN')).toBe(true);
    });

    it('rejects amount == 0', () => {
      const msg = { ...makeValidMessage(), amount: 0n };
      const errors = validateBridgeMessageV1(msg);
      expect(errors.some(e => e.field === 'amount')).toBe(true);
    });

    it('rejects amount > uint128 max', () => {
      const msg = { ...makeValidMessage(), amount: (1n << 128n) };
      const errors = validateBridgeMessageV1(msg);
      expect(errors.some(e => e.field === 'amount' && e.code === 'UINT128_OVERFLOW')).toBe(true);
    });

    it('rejects deadline == 0', () => {
      const msg = { ...makeValidMessage(), deadline: 0 };
      const errors = validateBridgeMessageV1(msg);
      expect(errors.some(e => e.field === 'deadline')).toBe(true);
    });

    it('rejects canonicalAssetId == 0', () => {
      const msg = { ...makeValidMessage(), canonicalAssetId: '0'.repeat(64) };
      const errors = validateBridgeMessageV1(msg);
      expect(errors.some(e => e.field === 'canonicalAssetId')).toBe(true);
    });

    it('rejects zero destinationCommitment for BridgeOut', () => {
      const msg = { ...makeValidMessage(), destinationCommitment: '0'.repeat(64) };
      const errors = validateBridgeMessageV1(msg);
      expect(errors.some(e => e.field === 'destinationCommitment')).toBe(true);
    });

    it('rejects zero sourceNullifierHash for BridgeOut', () => {
      const msg = { ...makeValidMessage(), sourceNullifierHash: '0'.repeat(64) };
      const errors = validateBridgeMessageV1(msg);
      expect(errors.some(e => e.field === 'sourceNullifierHash')).toBe(true);
    });

    it('rejects invalid bytes32 length', () => {
      const msg = { ...makeValidMessage(), memoHash: 'dead' };
      const errors = validateBridgeMessageV1(msg);
      expect(errors.some(e => e.field === 'memoHash')).toBe(true);
    });

    it('rejects sourceFinalityBlock < sourceBlockNumber', () => {
      const base = makeValidMessage();
      const msg = { ...base, sourceFinalityBlock: base.sourceBlockNumber - 1 };
      const errors = validateBridgeMessageV1(msg);
      expect(errors.some(e => e.field === 'sourceFinalityBlock')).toBe(true);
    });

    it('assertValidBridgeMessageV1 throws on invalid', () => {
      const msg = { ...makeValidMessage(), amount: 0n };
      expect(() => assertValidBridgeMessageV1(msg)).toThrow('Invalid BridgeMessageV1');
    });
  });

  describe('JSON parsing', () => {
    it('parses decimal string integers without precision loss and normalizes bytes32 as 0x-prefixed hex', () => {
      const json = JSON.parse(JSON.stringify(makeValidMessage(), bridgeMessageV1JsonReplacer));
      json.sourceChainId = '84532';
      json.destinationChainId = '0';
      json.amount = '1000000000000000';
      json.sourceLeafIndex = '24';
      json.sourceBlockNumber = '41116285';
      json.sourceFinalityBlock = '41116295';
      json.nonce = '3';
      json.deadline = '1778004486';
      json.relayerFee = '0';
      json.canonicalAssetId = '0x' + json.canonicalAssetId;

      const parsed = parseBridgeMessageV1Json(json);

      expect(parsed.sourceChainId).toBe(84532);
      expect(parsed.destinationChainId).toBe(0);
      expect(parsed.amount).toBe(1_000_000_000_000_000n);
      expect(parsed.sourceLeafIndex).toBe(24);
      expect(parsed.sourceBlockNumber).toBe(41116285);
      expect(parsed.sourceFinalityBlock).toBe(41116295);
      expect(parsed.nonce).toBe(3);
      expect(parsed.deadline).toBe(1778004486);
      expect(parsed.relayerFee).toBe(0n);
      expect(parsed.canonicalAssetId).toMatch(/^0x[0-9a-f]{64}$/);
      expect(hashBridgeMessageV1(parsed)).toMatch(/^0x[0-9a-f]{64}$/);
    });

    it('accepts JSON numbers only when they are safe integers', () => {
      const json = JSON.parse(JSON.stringify(makeValidMessage(), bridgeMessageV1JsonReplacer));
      json.sourceLeafIndex = 24;

      const parsed = parseBridgeMessageV1Json(json);
      expect(parsed.sourceLeafIndex).toBe(24);

      json.sourceLeafIndex = Number.MAX_SAFE_INTEGER + 1;
      expect(() => parseBridgeMessageV1Json(json)).toThrow('safe integer');
    });

    it('rejects unsafe decimal strings that cannot fit the current BridgeMessageV1 number fields', () => {
      const json = JSON.parse(JSON.stringify(makeValidMessage(), bridgeMessageV1JsonReplacer));
      json.sourceBlockNumber = '9007199254740992';

      expect(() => parseBridgeMessageV1Json(json)).toThrow('Number.MAX_SAFE_INTEGER');
    });

    it('rejects malformed decimal strings', () => {
      const json = JSON.parse(JSON.stringify(makeValidMessage(), bridgeMessageV1JsonReplacer));
      json.nonce = '1.5';

      expect(() => parseBridgeMessageV1Json(json)).toThrow('decimal integer string');
    });
  });
});
