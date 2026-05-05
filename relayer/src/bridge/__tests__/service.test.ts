/**
 * Bridge Relayer Service Tests — PR-010F
 */

import * as os from 'os';
import * as path from 'path';
import { BridgeRelayerService } from '../index';
import { BridgeMessageStatus, type BridgeEventObservation } from '../types';
import { BridgeMessageType } from '@thewhiteprotocol/core';
import type { BridgeMessageV1 } from '@thewhiteprotocol/core';

const TEST_KEYS = [
  '0x0000000000000000000000000000000000000000000000000000000000000001',
  '0x0000000000000000000000000000000000000000000000000000000000000002',
  '0x0000000000000000000000000000000000000000000000000000000000000003',
];

function makeTestMessage(): BridgeMessageV1 {
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
  };
}

describe('BridgeRelayerService', () => {
  let tmpDir: string;
  let service: BridgeRelayerService;

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), `bridge-service-test-${Date.now()}`);
    service = new BridgeRelayerService({
      pollIntervalMs: 1000,
      signer: { threshold: 2, privateKeys: TEST_KEYS },
      finality: {
        'base-sepolia': { confirmations: 2, maxAgeSeconds: 86400 },
      },
      routes: [
        {
          source: 'base-sepolia',
          destination: 'ethereum-sepolia',
          enabled: true,
          signerSetVersion: 1,
        },
      ],
      stateDir: tmpDir,
    });
  });

  afterEach(() => {
    service.getState().clear();
  });

  test('processEvent creates new message state', async () => {
    const message = makeTestMessage();
    const { encodeBridgeMessageV1, hashBridgeMessageV1 } = await import('@thewhiteprotocol/core');
    const encoded = encodeBridgeMessageV1(message);
    const messageHash = hashBridgeMessageV1(message);

    const event: BridgeEventObservation = {
      messageHash,
      destinationDomain: message.destinationDomain,
      canonicalAssetId: message.canonicalAssetId,
      amount: message.amount,
      nonce: message.nonce,
      encodedMessage: '0x' + Array.from(encoded)
        .map(b => b.toString(16).padStart(2, '0'))
        .join(''),
      txHash: '0xsourceTx',
      blockNumber: 100,
    };

    const sourceAdapter = {
      watch: async function* () {},
      getBlockNumber: async () => 200,
      isFinalized: async () => true,
    };

    const destinationAdapter = {
      isMessageConsumed: async () => false,
      submitAcceptBridgeMint: async () => '0xdestTx',
    };

    const result = await service.processEvent(event, sourceAdapter, destinationAdapter, {
      source: 'base-sepolia',
      destination: 'ethereum-sepolia',
      signerSetVersion: 1,
    });

    expect(result).toBe(true);

    const state = service.getState().get(messageHash);
    expect(state).toBeDefined();
    expect(state?.status).toBe(BridgeMessageStatus.CONFIRMED);
    expect(state?.submitTxHash).toBe('0xdestTx');
    expect(state?.signatures).toHaveLength(2);
  });

  test('processEvent is idempotent for already tracked messages', async () => {
    const message = makeTestMessage();
    const { encodeBridgeMessageV1, hashBridgeMessageV1 } = await import('@thewhiteprotocol/core');
    const encoded = encodeBridgeMessageV1(message);
    const messageHash = hashBridgeMessageV1(message);

    service.getState().set({
      messageHash,
      sourceChain: 'base-sepolia',
      destinationChain: 'ethereum-sepolia',
      sourceDomain: message.sourceDomain,
      destinationDomain: message.destinationDomain,
      sourceTxHash: '0xold',
      sourceBlockNumber: 100,
      sourceFinalityBlock: 110,
      nonce: 1,
      destinationCommitment: message.destinationCommitment,
      canonicalAssetId: message.canonicalAssetId,
      amount: message.amount.toString(),
      signatures: [],
      status: BridgeMessageStatus.CONFIRMED,
      attempts: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      message,
    });

    const event: BridgeEventObservation = {
      messageHash,
      destinationDomain: message.destinationDomain,
      canonicalAssetId: message.canonicalAssetId,
      amount: message.amount,
      nonce: message.nonce,
      encodedMessage: '0x' + Array.from(encoded)
        .map(b => b.toString(16).padStart(2, '0'))
        .join(''),
      txHash: '0xsourceTx',
      blockNumber: 100,
    };

    const sourceAdapter = {
      watch: async function* () {},
      getBlockNumber: async () => 200,
      isFinalized: async () => true,
    };

    const destinationAdapter = {
      isMessageConsumed: async () => false,
      submitAcceptBridgeMint: async () => '0xdestTx',
    };

    const result = await service.processEvent(event, sourceAdapter, destinationAdapter, {
      source: 'base-sepolia',
      destination: 'ethereum-sepolia',
      signerSetVersion: 1,
    });

    expect(result).toBe(true);
    // Should not have called submit
  });

  test('processEvent marks expired messages', async () => {
    const message = makeTestMessage();
    message.deadline = Math.floor(Date.now() / 1000) - 1; // expired

    const { encodeBridgeMessageV1, hashBridgeMessageV1 } = await import('@thewhiteprotocol/core');
    const encoded = encodeBridgeMessageV1(message);
    const messageHash = hashBridgeMessageV1(message);

    const event: BridgeEventObservation = {
      messageHash,
      destinationDomain: message.destinationDomain,
      canonicalAssetId: message.canonicalAssetId,
      amount: message.amount,
      nonce: message.nonce,
      encodedMessage: '0x' + Array.from(encoded)
        .map(b => b.toString(16).padStart(2, '0'))
        .join(''),
      txHash: '0xsourceTx',
      blockNumber: 100,
    };

    const sourceAdapter = {
      watch: async function* () {},
      getBlockNumber: async () => 200,
      isFinalized: async () => true,
    };

    const destinationAdapter = {
      isMessageConsumed: async () => false,
      submitAcceptBridgeMint: async () => '0xdestTx',
    };

    const result = await service.processEvent(event, sourceAdapter, destinationAdapter, {
      source: 'base-sepolia',
      destination: 'ethereum-sepolia',
      signerSetVersion: 1,
    });

    expect(result).toBe(false);
    const state = service.getState().get(messageHash);
    expect(state?.status).toBe(BridgeMessageStatus.EXPIRED);
  });

  test('processEvent handles destination submission failure', async () => {
    const message = makeTestMessage();
    const { encodeBridgeMessageV1, hashBridgeMessageV1 } = await import('@thewhiteprotocol/core');
    const encoded = encodeBridgeMessageV1(message);
    const messageHash = hashBridgeMessageV1(message);

    const event: BridgeEventObservation = {
      messageHash,
      destinationDomain: message.destinationDomain,
      canonicalAssetId: message.canonicalAssetId,
      amount: message.amount,
      nonce: message.nonce,
      encodedMessage: '0x' + Array.from(encoded)
        .map(b => b.toString(16).padStart(2, '0'))
        .join(''),
      txHash: '0xsourceTx',
      blockNumber: 100,
    };

    const sourceAdapter = {
      watch: async function* () {},
      getBlockNumber: async () => 200,
      isFinalized: async () => true,
    };

    const destinationAdapter = {
      isMessageConsumed: async () => false,
      submitAcceptBridgeMint: async () => {
        throw new Error('revert: OnlyBridge');
      },
    };

    const result = await service.processEvent(event, sourceAdapter, destinationAdapter, {
      source: 'base-sepolia',
      destination: 'ethereum-sepolia',
      signerSetVersion: 1,
    });

    expect(result).toBe(false);
    const state = service.getState().get(messageHash);
    expect(state?.status).toBe(BridgeMessageStatus.FAILED);
    expect(state?.lastError).toContain('OnlyBridge');
  });
});
