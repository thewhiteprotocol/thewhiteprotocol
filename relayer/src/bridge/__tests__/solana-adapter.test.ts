/**
 * Solana Bridge Adapter Tests — PR-010F
 */

import { PublicKey } from '@solana/web3.js';
import {
  WHITE_PROTOCOL_PROGRAM_ID,
  buildAcceptBridgeV1MintAccounts,
  evaluateSolanaSubmitReadiness,
  deriveBridgeV1ConfigPDA,
  deriveBridgeSignerSetPDA,
  deriveConsumedMessagePDA,
  deriveFrozenMessagePDA,
  deriveBridgeRoutePDA,
  deriveBridgeAssetPDA,
  derivePendingBufferPDA,
  deriveCommitmentIndexPDA,
  runSolanaPreSubmitReadinessChecks,
} from '../solana-adapter';
import { BASE_SEPOLIA_TO_SOLANA_DEVNET_ROUTE } from '../base-to-solana-route';
import { BridgeMessageType, type BridgeMessageV1 } from '@thewhiteprotocol/core';

function hex(byte: string): string {
  return byte.repeat(32);
}

function makeDestinationMessage(): BridgeMessageV1 {
  return {
    protocolVersion: 1,
    messageType: BridgeMessageType.BridgeMint,
    sourceDomain: 0x02000002,
    destinationDomain: 0x01000002,
    sourceChainId: 84532,
    destinationChainId: 0,
    canonicalAssetId: '00fb58d8ea79c42a023685014b8281e7508bd5ca5f570f336f5852a291d54a70',
    sourceLocalAssetId: '00fb58d8ea79c42a023685014b8281e7508bd5ca5f570f336f5852a291d54a70',
    destinationLocalAssetId: '004a067d98373879008ada3415ad678dcd5354c0b29b52233a604774c94a82e0',
    amount: 1_000_000n,
    sourceNullifierHash: hex('04'),
    destinationCommitment: hex('05'),
    sourceRoot: hex('06'),
    sourceLeafIndex: 7,
    sourceTxHash: hex('07'),
    sourceBlockNumber: 100,
    sourceFinalityBlock: 103,
    nonce: 11,
    deadline: Math.floor(Date.now() / 1000) + 86_400,
    relayerFee: 0n,
    recipientStealthMetadataHash: hex('00'),
    memoHash: hex('00'),
    reserved0: hex('00'),
    reserved1: hex('00'),
  };
}

describe('Solana Bridge PDA Derivation', () => {
  test('deriveBridgeV1ConfigPDA is deterministic', () => {
    const pda1 = deriveBridgeV1ConfigPDA();
    const pda2 = deriveBridgeV1ConfigPDA();
    expect(pda1.toBase58()).toBe(pda2.toBase58());
    expect(pda1.toBase58()).not.toBe(WHITE_PROTOCOL_PROGRAM_ID.toBase58());
  });

  test('deriveBridgeSignerSetPDA varies by version', () => {
    const pda1 = deriveBridgeSignerSetPDA(1);
    const pda2 = deriveBridgeSignerSetPDA(2);
    expect(pda1.toBase58()).not.toBe(pda2.toBase58());
  });

  test('deriveConsumedMessagePDA varies by hash', () => {
    const hash1 = new Uint8Array(32).fill(1);
    const hash2 = new Uint8Array(32).fill(2);
    const pda1 = deriveConsumedMessagePDA(hash1);
    const pda2 = deriveConsumedMessagePDA(hash2);
    expect(pda1.toBase58()).not.toBe(pda2.toBase58());
  });

  test('deriveBridgeRoutePDA varies by domains', () => {
    const pda1 = deriveBridgeRoutePDA(33554434, 33554435);
    const pda2 = deriveBridgeRoutePDA(33554434, 33554436);
    expect(pda1.toBase58()).not.toBe(pda2.toBase58());
  });

  test('derivePendingBufferPDA varies by pool', () => {
    // Use valid base58-encoded public keys
    const pool1 = new PublicKey('5oNDL3swdJJF1g9DzJiZ4ynHXgszjpmunRaFsXq3VyhM');
    const pool2 = new PublicKey('7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU');
    const pda1 = derivePendingBufferPDA(pool1);
    const pda2 = derivePendingBufferPDA(pool2);
    expect(pda1.toBase58()).not.toBe(pda2.toBase58());
  });

  test('deriveCommitmentIndexPDA varies by commitment', () => {
    const pool = new PublicKey('11111111111111111111111111111111');
    const c1 = new Uint8Array(32).fill(1);
    const c2 = new Uint8Array(32).fill(2);
    const pda1 = deriveCommitmentIndexPDA(pool, c1);
    const pda2 = deriveCommitmentIndexPDA(pool, c2);
    expect(pda1.toBase58()).not.toBe(pda2.toBase58());
  });

  test('all PDAs are valid program addresses', () => {
    const pda = deriveBridgeV1ConfigPDA();
    expect(PublicKey.isOnCurve(pda.toBytes())).toBe(false);
  });

  test('Base to Solana deployed config derives destination-hash PDAs with signer set v2', () => {
    const message = makeDestinationMessage();
    const accounts = buildAcceptBridgeV1MintAccounts(
      message,
      new PublicKey(BASE_SEPOLIA_TO_SOLANA_DEVNET_ROUTE.solanaDestination!.poolConfig),
      WHITE_PROTOCOL_PROGRAM_ID,
      {
        signerSetVersion: 2,
        destinationConfig: BASE_SEPOLIA_TO_SOLANA_DEVNET_ROUTE.solanaDestination,
        messageHash: '0xcd745c98e78eed6667f9655efa2f4725d052a9c06c4419c1c2dd8a05727f8f56',
      }
    );
    expect(accounts.signerSet.toBase58()).toBe('7Emf7vYUY9mpkzBfnzWKJ4B9PNqqrMzr5wyuUc8ap4XK');
    expect(accounts.consumedMessage.toBase58()).toBe('FFms6Q7BHHPsVnWMEmL3gFiyZCu9pBMoog3Gfsp7Qodr');
    expect(accounts.frozenMessage.toBase58()).toBe('B5kc9gKjy4LpGYX8yAoAeHzL81eGAh3DGerL2KdeKpJe');
    expect(accounts.pendingBuffer.toBase58()).toBe('9oEKYL8iD7mBdvPzrgtv8Q15QqAWUL9ycSGAkt5QT42s');
    expect(accounts.poolConfig.toBase58()).toBe('DZLJU6MAeWZ7aGLyt2j7Jq2XnNq2ch6jUAVgKmki9HaF');
    expect(accounts.merkleTree.toBase58()).toBe('7rNj4NVMyaNFSL9ius2hej2rpzk88d7spXrbYFchhnPi');
    expect(accounts.assetVault.toBase58()).toBe('4Wb17Qbxm74i4BNLZ6CejXtaijLFRSre5wWKAzwWkaXD');
  });

  test('readiness blocks hash, signer-set, and placeholder mismatches', () => {
    const readyBase = {
      accounts: {
        bridgeV1Config: '5ZiC1A8NTS1pc1Rp1mQEnPERzJA1viJZYqW7MX9QhH9s',
        signerSet: '7Emf7vYUY9mpkzBfnzWKJ4B9PNqqrMzr5wyuUc8ap4XK',
        consumedMessage: 'FFms6Q7BHHPsVnWMEmL3gFiyZCu9pBMoog3Gfsp7Qodr',
        routeConfig: 'Bp6dhddL1pRRacMYGfKqFyN6azEujbphzH8xmnpKzEWt',
        assetConfig: 'CByfLtYcZcVWJoihhzTaKGeVEbqL9b9b1qgVdNLHEpdV',
        frozenMessage: 'B5kc9gKjy4LpGYX8yAoAeHzL81eGAh3DGerL2KdeKpJe',
        poolConfig: 'DZLJU6MAeWZ7aGLyt2j7Jq2XnNq2ch6jUAVgKmki9HaF',
        merkleTree: '7rNj4NVMyaNFSL9ius2hej2rpzk88d7spXrbYFchhnPi',
        pendingBuffer: '9oEKYL8iD7mBdvPzrgtv8Q15QqAWUL9ycSGAkt5QT42s',
        assetVault: '4Wb17Qbxm74i4BNLZ6CejXtaijLFRSre5wWKAzwWkaXD',
        commitmentIndex: 'EyZbhYhv2BRgJ3vaiyDgWHri3r2SVJRNa5qUnUcugwf3',
      },
      sourceMessageHash: '0x78db644c282399fb04d304752cd492ca12e31982e50e78bb382eb836905384bc',
      destinationMessageHash: '0xcd745c98e78eed6667f9655efa2f4725d052a9c06c4419c1c2dd8a05727f8f56',
      previewMessageHash: '0xcd745c98e78eed6667f9655efa2f4725d052a9c06c4419c1c2dd8a05727f8f56',
      signerSetVersion: 2,
      expectedSignerSetVersion: 2,
      liveSubmissionImplemented: true,
    };
    expect(evaluateSolanaSubmitReadiness(readyBase).status).toBe('ready_for_operator_approval');
    expect(evaluateSolanaSubmitReadiness({
      ...readyBase,
      previewMessageHash: readyBase.sourceMessageHash,
    }).status).toBe('blocked_hash_mismatch');
    expect(evaluateSolanaSubmitReadiness({
      ...readyBase,
      signerSetVersion: 1,
    }).status).toBe('blocked_signer_set_mismatch');
    expect(evaluateSolanaSubmitReadiness({
      ...readyBase,
      accounts: { ...readyBase.accounts, poolConfig: '11111111111111111111111111111111' },
    }).status).toBe('blocked_placeholder_accounts');
  });

  test('read-only checker handles expected exists and absent accounts', async () => {
    const message = makeDestinationMessage();
    const accounts = buildAcceptBridgeV1MintAccounts(
      message,
      new PublicKey(BASE_SEPOLIA_TO_SOLANA_DEVNET_ROUTE.solanaDestination!.poolConfig),
      WHITE_PROTOCOL_PROGRAM_ID,
      {
        signerSetVersion: 2,
        destinationConfig: BASE_SEPOLIA_TO_SOLANA_DEVNET_ROUTE.solanaDestination,
        messageHash: '0xcd745c98e78eed6667f9655efa2f4725d052a9c06c4419c1c2dd8a05727f8f56',
      }
    );
    const existing = new Set([
      WHITE_PROTOCOL_PROGRAM_ID.toBase58(),
      accounts.bridgeV1Config.toBase58(),
      accounts.signerSet.toBase58(),
      accounts.routeConfig.toBase58(),
      accounts.assetConfig.toBase58(),
      accounts.pendingBuffer.toBase58(),
      accounts.poolConfig.toBase58(),
      accounts.merkleTree.toBase58(),
      accounts.assetVault.toBase58(),
    ]);
    const result = await runSolanaPreSubmitReadinessChecks(accounts, {
      async getAccountInfo(pubkey) {
        if (!existing.has(pubkey.toBase58())) return null;
        return { executable: pubkey.equals(WHITE_PROTOCOL_PROGRAM_ID) };
      },
    });
    expect(result.status).toBe('ready_for_operator_approval');
  });
});

describe('SolanaDestinationAdapter', () => {
  test('isMessageConsumed returns false (skeleton)', async () => {
    const { SolanaDestinationAdapter } = await import('../solana-adapter');
    const adapter = new SolanaDestinationAdapter();
    const result = await adapter.isMessageConsumed('0xabc');
    expect(result).toBe(false);
  });

  test('submitAcceptBridgeMint throws not implemented', async () => {
    const { SolanaDestinationAdapter } = await import('../solana-adapter');
    const adapter = new SolanaDestinationAdapter();
    await expect(
      adapter.submitAcceptBridgeMint({} as any, [], 1)
    ).rejects.toThrow('Solana bridge submission is not yet implemented');
  });
});
