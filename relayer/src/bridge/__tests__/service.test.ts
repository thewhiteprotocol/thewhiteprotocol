/**
 * Bridge Relayer Service Tests — PR-010F
 */

import * as os from 'os';
import * as path from 'path';
import { BridgeRelayerService } from '../index';
import { BridgeMessageStatus, type BridgeEventObservation } from '../types';
import { BridgeMessageType, encodeBridgeMessageV1, hashBridgeMessageV1 } from '@thewhiteprotocol/core';
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

function makeBaseToSolanaBridgeOutMessage(amount = 1_000_000_000_000_000n): BridgeMessageV1 {
  const now = Math.floor(Date.now() / 1000);
  return {
    protocolVersion: 1,
    messageType: BridgeMessageType.BridgeOut,
    sourceDomain: 0x02000002,
    destinationDomain: 0x01000002,
    sourceChainId: 84532,
    destinationChainId: 0,
    canonicalAssetId: '00fb58d8ea79c42a023685014b8281e7508bd5ca5f570f336f5852a291d54a70',
    sourceLocalAssetId: '00fb58d8ea79c42a023685014b8281e7508bd5ca5f570f336f5852a291d54a70',
    destinationLocalAssetId: '004a067d98373879008ada3415ad678dcd5354c0b29b52233a604774c94a82e0',
    amount,
    sourceNullifierHash: '050caaf379f71b871b696b19218423e6cb10c1d6f2d727dfab3dea42d14e0ddd',
    destinationCommitment: '12df7d83bf11de32035547b40563fe277a0a69111907b0971bd35223cb051c67',
    sourceRoot: '2e033d72f3f8500ae9a5c487e8f47eb80cc21fca004fbbbd683e27968b0f8671',
    sourceLeafIndex: 24,
    sourceTxHash: '0'.repeat(63) + '5',
    sourceBlockNumber: 41116285,
    sourceFinalityBlock: 41116295,
    nonce: 5,
    deadline: now + 86400,
    relayerFee: 0n,
    recipientStealthMetadataHash: '0'.repeat(64),
    memoHash: '0'.repeat(64),
    reserved0: '0'.repeat(64),
    reserved1: '0'.repeat(64),
  };
}

function makeEvent(message: BridgeMessageV1): BridgeEventObservation {
  const encoded = encodeBridgeMessageV1(message);
  return {
    messageHash: hashBridgeMessageV1(message),
    destinationDomain: message.destinationDomain,
    canonicalAssetId: message.canonicalAssetId,
    amount: message.amount,
    nonce: message.nonce,
    encodedMessage: '0x' + Array.from(encoded)
      .map(b => b.toString(16).padStart(2, '0'))
      .join(''),
    txHash: '0xsourceTx',
    blockNumber: message.sourceBlockNumber,
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

  test('processEvent transforms Base BridgeOut to Solana BridgeMint before signing', async () => {
    const bridgeOut = makeBaseToSolanaBridgeOutMessage();
    const event = makeEvent(bridgeOut);
    service = new BridgeRelayerService({
      pollIntervalMs: 1000,
      signer: { threshold: 2, privateKeys: TEST_KEYS },
      finality: {
        'base-sepolia': { confirmations: 2, maxAgeSeconds: 86400 },
      },
      routes: [
        {
          source: 'base-sepolia',
          destination: 'solana-devnet',
          enabled: true,
          signerSetVersion: 1,
          assets: [
            {
              canonicalAssetId: bridgeOut.canonicalAssetId,
              sourceDecimals: 18,
              destinationDecimals: 9,
              normalizationMode: 'exact-decimal',
              maxMessageAmount: 2_000_000_000n,
              dailyCap: 10_000_000_000n,
            },
          ],
        },
      ],
      stateDir: tmpDir,
    });

    const sourceAdapter = {
      watch: async function* () {},
      getBlockNumber: async () => 200,
      isFinalized: async () => true,
    };

    let consumedHash: string | undefined;
    let submittedMessage: BridgeMessageV1 | undefined;
    let submittedSignatures: string[] = [];
    const destinationAdapter = {
      isMessageConsumed: async (messageHash: string) => {
        consumedHash = messageHash;
        return false;
      },
      submitAcceptBridgeMint: async (
        message: BridgeMessageV1,
        signatures: string[]
      ) => {
        submittedMessage = message;
        submittedSignatures = signatures;
        return 'solanaTx';
      },
    };

    const result = await service.processEvent(event, sourceAdapter, destinationAdapter, {
      source: 'base-sepolia',
      destination: 'solana-devnet',
      signerSetVersion: 1,
    });

    expect(result).toBe(true);
    expect(submittedMessage).toBeDefined();
    expect(submittedMessage?.messageType).toBe(BridgeMessageType.BridgeMint);
    expect(submittedMessage?.amount).toBe(1_000_000n);
    expect(submittedMessage?.sourceNullifierHash).toBe(bridgeOut.sourceNullifierHash);
    expect(submittedMessage?.sourceRoot).toBe(bridgeOut.sourceRoot);
    expect(submittedMessage?.sourceLeafIndex).toBe(bridgeOut.sourceLeafIndex);

    const sourceHash = event.messageHash.toLowerCase();
    const destinationHash = hashBridgeMessageV1(submittedMessage!).toLowerCase();
    expect(destinationHash).not.toBe(sourceHash);
    expect(consumedHash).toBe(destinationHash);

    const state = service.getState().get(destinationHash);
    expect(state?.status).toBe(BridgeMessageStatus.CONFIRMED);
    expect(state?.amount).toBe('1000000');
    expect(service.getState().get(sourceHash)).toBeUndefined();

    expect(submittedSignatures).toHaveLength(2);
    const recovered = await Promise.all(
      submittedSignatures.map((signature) =>
        service.getSigner().recoverSigner(destinationHash as any, signature as any)
      )
    );
    expect(new Set(recovered.map((address) => address.toLowerCase())).size).toBe(2);
  });

  test('processEvent rejects non-divisible Base to Solana conversion', async () => {
    const bridgeOut = makeBaseToSolanaBridgeOutMessage(1n);
    const event = makeEvent(bridgeOut);
    service = new BridgeRelayerService({
      pollIntervalMs: 1000,
      signer: { threshold: 2, privateKeys: TEST_KEYS },
      finality: {
        'base-sepolia': { confirmations: 2, maxAgeSeconds: 86400 },
      },
      routes: [
        {
          source: 'base-sepolia',
          destination: 'solana-devnet',
          enabled: true,
          signerSetVersion: 1,
          assets: [
            {
              canonicalAssetId: bridgeOut.canonicalAssetId,
              sourceDecimals: 18,
              destinationDecimals: 9,
              normalizationMode: 'exact-decimal',
              maxMessageAmount: 2_000_000_000n,
              dailyCap: 10_000_000_000n,
            },
          ],
        },
      ],
      stateDir: tmpDir,
    });

    const sourceAdapter = {
      watch: async function* () {},
      getBlockNumber: async () => 200,
      isFinalized: async () => true,
    };
    let submitted = false;
    const destinationAdapter = {
      isMessageConsumed: async () => false,
      submitAcceptBridgeMint: async () => {
        submitted = true;
        return 'solanaTx';
      },
    };

    const result = await service.processEvent(event, sourceAdapter, destinationAdapter, {
      source: 'base-sepolia',
      destination: 'solana-devnet',
      signerSetVersion: 1,
    });

    expect(result).toBe(false);
    expect(submitted).toBe(false);
  });

  test('processEvent enforces destination-local max amount', async () => {
    const bridgeOut = makeBaseToSolanaBridgeOutMessage(2_000_000_000_000_000_000n);
    const event = makeEvent(bridgeOut);
    service = new BridgeRelayerService({
      pollIntervalMs: 1000,
      signer: { threshold: 2, privateKeys: TEST_KEYS },
      finality: {
        'base-sepolia': { confirmations: 2, maxAgeSeconds: 86400 },
      },
      routes: [
        {
          source: 'base-sepolia',
          destination: 'solana-devnet',
          enabled: true,
          signerSetVersion: 1,
          assets: [
            {
              canonicalAssetId: bridgeOut.canonicalAssetId,
              sourceDecimals: 18,
              destinationDecimals: 9,
              normalizationMode: 'exact-decimal',
              maxMessageAmount: 1_000_000_000n,
              dailyCap: 10_000_000_000n,
            },
          ],
        },
      ],
      stateDir: tmpDir,
    });

    const sourceAdapter = {
      watch: async function* () {},
      getBlockNumber: async () => 200,
      isFinalized: async () => true,
    };
    let submitted = false;
    const destinationAdapter = {
      isMessageConsumed: async () => false,
      submitAcceptBridgeMint: async () => {
        submitted = true;
        return 'solanaTx';
      },
    };

    const result = await service.processEvent(event, sourceAdapter, destinationAdapter, {
      source: 'base-sepolia',
      destination: 'solana-devnet',
      signerSetVersion: 1,
    });

    expect(result).toBe(false);
    expect(submitted).toBe(false);
  });
});
