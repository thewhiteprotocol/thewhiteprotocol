/**
 * Bridge Signer Service Tests — PR-010F
 *
 * Uses deterministic test private keys. NEVER USE IN PRODUCTION.
 */

import { BridgeSignerService } from '../signer';
import { BridgeMessageType, hashBridgeMessageV1 } from '@thewhiteprotocol/core';
import type { BridgeMessageV1 } from '@thewhiteprotocol/core';

// Deterministic test keys — UNSAFE FOR PRODUCTION
const TEST_KEYS = [
  '0x0000000000000000000000000000000000000000000000000000000000000001',
  '0x0000000000000000000000000000000000000000000000000000000000000002',
  '0x0000000000000000000000000000000000000000000000000000000000000003',
];

function makeTestMessage(overrides: Partial<BridgeMessageV1> = {}): BridgeMessageV1 {
  const now = Math.floor(Date.now() / 1000);
  return {
    protocolVersion: 1,
    messageType: BridgeMessageType.BridgeMint,
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
    sourceLeafIndex: 0,
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
    ...overrides,
  };
}

describe('BridgeSignerService', () => {
  const service = new BridgeSignerService({
    threshold: 2,
    privateKeys: TEST_KEYS,
  });

  test('signs message with all signers', async () => {
    const message = makeTestMessage();
    const signatures = await service.signMessage(message);

    expect(signatures).toHaveLength(3);
    for (const sig of signatures) {
      expect(sig.signature).toMatch(/^0x[a-f0-9]{130}$/);
      expect(sig.signerAddress).toMatch(/^0x[a-f0-9]{40}$/i);
    }
  });

  test('signatures are sorted by recovered address ascending', async () => {
    const message = makeTestMessage();
    const signatures = await service.signMessage(message);

    for (let i = 1; i < signatures.length; i++) {
      const prev = signatures[i - 1].signerAddress.toLowerCase();
      const curr = signatures[i].signerAddress.toLowerCase();
      expect(curr > prev).toBe(true);
    }
  });

  test('recovered addresses match expected test addresses', async () => {
    const message = makeTestMessage();
    const messageHash = hashBridgeMessageV1(message) as `0x${string}`;
    const signatures = await service.signMessage(message);

    for (const sig of signatures) {
      const recovered = await service.recoverSigner(messageHash, sig.signature as `0x${string}`);
      expect(recovered.toLowerCase()).toBe(sig.signerAddress.toLowerCase());
    }
  });

  test('takeThreshold returns exactly threshold signatures', async () => {
    const message = makeTestMessage();
    const signatures = await service.signMessage(message);
    const threshold = service.takeThreshold(signatures);

    expect(threshold).toHaveLength(2);
    expect(threshold[0].signerAddress).toBe(signatures[0].signerAddress);
    expect(threshold[1].signerAddress).toBe(signatures[1].signerAddress);
  });

  test('takeThreshold throws if insufficient signatures', async () => {
    const singleSig = [
      {
        signature: '0x' + '00'.repeat(65),
        signerAddress: '0x0000000000000000000000000000000000000000',
      },
    ];
    expect(() => service.takeThreshold(singleSig)).toThrow('Insufficient signatures');
  });

  test('validateSignatureOrder accepts sorted signatures', async () => {
    const message = makeTestMessage();
    const signatures = await service.signMessage(message);
    expect(() => service.validateSignatureOrder(signatures)).not.toThrow();
  });

  test('validateSignatureOrder rejects duplicate signers', async () => {
    const message = makeTestMessage();
    const signatures = await service.signMessage(message);
    const duped = [...signatures, signatures[0]];
    expect(() => service.validateSignatureOrder(duped)).toThrow('Signatures not sorted');
  });

  test('validateSignatureOrder rejects unsorted signatures', async () => {
    const message = makeTestMessage();
    const signatures = await service.signMessage(message);
    const reversed = [...signatures].reverse();
    expect(() => service.validateSignatureOrder(reversed)).toThrow('Signatures not sorted');
  });

  test('5-of-7 threshold works', async () => {
    const keys7 = Array.from({ length: 7 }, (_, i) =>
      `0x${(i + 1).toString(16).padStart(64, '0')}`
    );
    const svc7 = new BridgeSignerService({ threshold: 5, privateKeys: keys7 });
    const message = makeTestMessage();
    const signatures = await svc7.signMessage(message);

    expect(signatures).toHaveLength(7);
    const threshold = svc7.takeThreshold(signatures);
    expect(threshold).toHaveLength(5);

    for (let i = 1; i < signatures.length; i++) {
      expect(
        signatures[i].signerAddress.toLowerCase() >
        signatures[i - 1].signerAddress.toLowerCase()
      ).toBe(true);
    }
  });

  test('extractRawSignatures returns hex strings', async () => {
    const message = makeTestMessage();
    const signatures = await service.signMessage(message);
    const raw = service.extractRawSignatures(signatures);

    expect(raw).toHaveLength(3);
    for (const r of raw) {
      expect(r).toMatch(/^0x[a-f0-9]{130}$/);
    }
  });
});
