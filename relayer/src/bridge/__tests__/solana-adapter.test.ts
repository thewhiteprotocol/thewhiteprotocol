/**
 * Solana Bridge Adapter Tests — PR-010F
 */

import { PublicKey, VersionedTransaction } from '@solana/web3.js';
import {
  WHITE_PROTOCOL_PROGRAM_ID,
  buildAcceptBridgeV1MintAccounts,
  buildSolanaAcceptBridgeMintTransactionPreview,
  evaluateSolanaOperatorApproval,
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
  simulateSolanaAcceptBridgeMintTransaction,
  simulateSolanaAcceptBridgeMintTransactionWithGates,
} from '../solana-adapter';
import { BASE_SEPOLIA_TO_SOLANA_DEVNET_ROUTE } from '../base-to-solana-route';
import { BridgeMessageType, hashBridgeMessageV1, type BridgeMessageV1 } from '@thewhiteprotocol/core';

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

  test('builds accept_bridge_v1_mint transaction preview without sending', () => {
    const message = makeDestinationMessage();
    const destinationHash = hashBridgeMessageV1(message);
    const preview = buildSolanaAcceptBridgeMintTransactionPreview({
      message,
      messageHash: destinationHash,
      sourceMessageHash: '0x78db644c282399fb04d304752cd492ca12e31982e50e78bb382eb836905384bc',
      signatures: [`0x${'11'.repeat(65)}`, `0x${'22'.repeat(65)}`],
      signerSetVersion: 2,
      destinationConfig: BASE_SEPOLIA_TO_SOLANA_DEVNET_ROUTE.solanaDestination!,
    });
    expect(preview.transactionAssemblyImplemented).toBe(true);
    expect(preview.liveSubmissionImplemented).toBe(false);
    expect(preview.willSubmit).toBe(false);
    expect(preview.computeBudgetIncluded).toBe(true);
    expect(preview.instructions.map((ix) => ix.name)).toEqual([
      'compute_budget_set_compute_unit_limit',
      'compute_budget_set_compute_unit_price',
      'accept_bridge_v1_mint',
    ]);
    expect(preview.accountMetaValidation.valid).toBe(true);
    expect(preview.accountMetaValidation.accountMetaCount).toBe(13);
    expect(preview.signatureCount).toBe(2);
    expect(preview.serializedLength).toBeGreaterThan(0);
    expect(preview.simulationStatus).toBe('skipped');
  });

  test('transaction preview validation rejects a source hash used as destination hash', () => {
    const message = makeDestinationMessage();
    const preview = buildSolanaAcceptBridgeMintTransactionPreview({
      message,
      messageHash: '0x78db644c282399fb04d304752cd492ca12e31982e50e78bb382eb836905384bc',
      sourceMessageHash: '0x78db644c282399fb04d304752cd492ca12e31982e50e78bb382eb836905384bc',
      signatures: [`0x${'11'.repeat(65)}`, `0x${'22'.repeat(65)}`],
      signerSetVersion: 2,
      destinationConfig: BASE_SEPOLIA_TO_SOLANA_DEVNET_ROUTE.solanaDestination!,
    });
    expect(preview.accountMetaValidation.valid).toBe(false);
    expect(preview.accountMetaValidation.reasons).toContain(
      'message_hash_does_not_match_destination_message'
    );
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

  test('approval gate requires destination hash and rejects source hash alone', () => {
    const destinationHash = '0xcd745c98e78eed6667f9655efa2f4725d052a9c06c4419c1c2dd8a05727f8f56';
    const sourceHash = '0x78db644c282399fb04d304752cd492ca12e31982e50e78bb382eb836905384bc';
    expect(evaluateSolanaOperatorApproval({
      destinationMessageHash: destinationHash,
      sourceMessageHash: sourceHash,
      approvedMessageHashes: [],
    }).status).toBe('blocked_approval_required');
    expect(evaluateSolanaOperatorApproval({
      destinationMessageHash: destinationHash,
      sourceMessageHash: sourceHash,
      approvedMessageHashes: [sourceHash],
    }).status).toBe('blocked_approval_hash_mismatch');
    expect(evaluateSolanaOperatorApproval({
      destinationMessageHash: destinationHash,
      sourceMessageHash: sourceHash,
      route: 'base-sepolia->solana-devnet',
      approvedMessageHashes: [`base-sepolia->solana-devnet|${destinationHash}`],
    }).status).toBe('approved');
    expect(evaluateSolanaOperatorApproval({
      destinationMessageHash: destinationHash,
      approvedMessageHashes: [`base-sepolia->solana-devnet|${destinationHash}|1`],
      nowSeconds: 2,
    }).status).toBe('blocked_approval_expired');
  });

  test('submit readiness blocks when destination approval is missing', () => {
    const approval = evaluateSolanaOperatorApproval({
      destinationMessageHash: '0xcd745c98e78eed6667f9655efa2f4725d052a9c06c4419c1c2dd8a05727f8f56',
      approvedMessageHashes: [],
    });
    const result = evaluateSolanaSubmitReadiness({
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
      destinationMessageHash: '0xcd745c98e78eed6667f9655efa2f4725d052a9c06c4419c1c2dd8a05727f8f56',
      previewMessageHash: '0xcd745c98e78eed6667f9655efa2f4725d052a9c06c4419c1c2dd8a05727f8f56',
      signerSetVersion: 2,
      expectedSignerSetVersion: 2,
      liveSubmissionImplemented: true,
      approval,
    });
    expect(result.status).toBe('blocked_approval_required');
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

  test('read-only checker blocks consumed, frozen, and commitment index idempotency hits', async () => {
    const message = makeDestinationMessage();
    const accounts = buildAcceptBridgeV1MintAccounts(
      message,
      new PublicKey(BASE_SEPOLIA_TO_SOLANA_DEVNET_ROUTE.solanaDestination!.poolConfig),
      WHITE_PROTOCOL_PROGRAM_ID,
      {
        signerSetVersion: 2,
        destinationConfig: BASE_SEPOLIA_TO_SOLANA_DEVNET_ROUTE.solanaDestination,
        messageHash: hashBridgeMessageV1(message),
      }
    );
    const existing = new Set(Object.values(accounts).map((account) => account.toBase58()));
    existing.add(WHITE_PROTOCOL_PROGRAM_ID.toBase58());
    const result = await runSolanaPreSubmitReadinessChecks(accounts, {
      async getAccountInfo(pubkey) {
        return existing.has(pubkey.toBase58())
          ? { executable: pubkey.equals(WHITE_PROTOCOL_PROGRAM_ID) }
          : null;
      },
    });
    expect(result.status).toBe('blocked_rpc_state');
    expect(result.reasons).toEqual(expect.arrayContaining([
      'consumedMessage_already_exists',
      'frozenMessage_already_exists',
      'commitmentIndex_already_exists',
    ]));
  });

  test('simulation uses sigVerify=false and does not send', async () => {
    const message = makeDestinationMessage();
    const destinationHash = hashBridgeMessageV1(message);
    const preview = buildSolanaAcceptBridgeMintTransactionPreview({
      message,
      messageHash: destinationHash,
      sourceMessageHash: '0x78db644c282399fb04d304752cd492ca12e31982e50e78bb382eb836905384bc',
      signatures: [`0x${'11'.repeat(65)}`, `0x${'22'.repeat(65)}`],
      signerSetVersion: 2,
      destinationConfig: BASE_SEPOLIA_TO_SOLANA_DEVNET_ROUTE.solanaDestination!,
    });
    const sendTransaction = jest.fn();
    const connection = {
      getLatestBlockhash: jest.fn(async () => ({ blockhash: '11111111111111111111111111111111' })),
      simulateTransaction: jest.fn(async () => ({
        context: { slot: 123 },
        value: { err: null, logs: ['Program log: ok'], unitsConsumed: 250000 },
      })),
      sendTransaction,
    };
    const result = await simulateSolanaAcceptBridgeMintTransaction(preview, connection, {
      approval: evaluateSolanaOperatorApproval({
        destinationMessageHash: destinationHash,
        approvedMessageHashes: [destinationHash],
      }),
      preSubmitReadiness: {
        readyForOperatorApproval: true,
        status: 'ready_for_operator_approval',
        reasons: [],
        checks: {},
      },
    });
    expect(result.simulationAttempted).toBe(true);
    expect(result.simulationOk).toBe(true);
    expect(result.readyForLiveSubmit).toBe(true);
    expect(result.sigVerify).toBe(false);
    expect(connection.simulateTransaction).toHaveBeenCalledWith(expect.any(VersionedTransaction), {
      sigVerify: false,
      replaceRecentBlockhash: false,
    });
    expect(sendTransaction).not.toHaveBeenCalled();
  });

  test('simulation failure logs are sanitized and approval block skips RPC', async () => {
    const message = makeDestinationMessage();
    const destinationHash = hashBridgeMessageV1(message);
    const preview = buildSolanaAcceptBridgeMintTransactionPreview({
      message,
      messageHash: destinationHash,
      signatures: [`0x${'11'.repeat(65)}`, `0x${'22'.repeat(65)}`],
      signerSetVersion: 2,
      destinationConfig: BASE_SEPOLIA_TO_SOLANA_DEVNET_ROUTE.solanaDestination!,
    });
    const connection = {
      getLatestBlockhash: jest.fn(async () => ({ blockhash: '11111111111111111111111111111111' })),
      simulateTransaction: jest.fn(async () => ({
        value: {
          err: { InstructionError: [2, 'Custom'] },
          logs: ['token=https://example.invalid/?api-key=secret'],
        },
      })),
    };
    const blocked = await simulateSolanaAcceptBridgeMintTransaction(preview, connection, {
      approval: evaluateSolanaOperatorApproval({
        destinationMessageHash: destinationHash,
        approvedMessageHashes: [],
      }),
    });
    expect(blocked.simulationAttempted).toBe(false);
    expect(connection.simulateTransaction).not.toHaveBeenCalled();

    const failed = await simulateSolanaAcceptBridgeMintTransaction(preview, connection, {
      approval: evaluateSolanaOperatorApproval({
        destinationMessageHash: destinationHash,
        approvedMessageHashes: [destinationHash],
      }),
    });
    expect(failed.simulationAttempted).toBe(true);
    expect(failed.simulationOk).toBe(false);
    expect(failed.logsPreview[0]).toContain('[redacted]');
  });

  test('simulation gate reruns idempotency checks before simulation', async () => {
    const message = makeDestinationMessage();
    const destinationHash = hashBridgeMessageV1(message);
    const preview = buildSolanaAcceptBridgeMintTransactionPreview({
      message,
      messageHash: destinationHash,
      signatures: [`0x${'11'.repeat(65)}`, `0x${'22'.repeat(65)}`],
      signerSetVersion: 2,
      destinationConfig: BASE_SEPOLIA_TO_SOLANA_DEVNET_ROUTE.solanaDestination!,
    });
    const accounts = buildAcceptBridgeV1MintAccounts(
      message,
      new PublicKey(BASE_SEPOLIA_TO_SOLANA_DEVNET_ROUTE.solanaDestination!.poolConfig),
      WHITE_PROTOCOL_PROGRAM_ID,
      {
        signerSetVersion: 2,
        destinationConfig: BASE_SEPOLIA_TO_SOLANA_DEVNET_ROUTE.solanaDestination,
        messageHash: destinationHash,
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
    const connection = {
      getLatestBlockhash: jest.fn(async () => ({ blockhash: '11111111111111111111111111111111' })),
      simulateTransaction: jest.fn(async () => ({ value: { err: null, logs: [] } })),
    };
    const result = await simulateSolanaAcceptBridgeMintTransactionWithGates({
      preview,
      connection,
      accounts,
      accountProvider: {
        async getAccountInfo(pubkey) {
          if (!existing.has(pubkey.toBase58())) return null;
          return { executable: pubkey.equals(WHITE_PROTOCOL_PROGRAM_ID) };
        },
      },
      approval: evaluateSolanaOperatorApproval({
        destinationMessageHash: destinationHash,
        approvedMessageHashes: [destinationHash],
      }),
    });
    expect(result.preSubmitReadiness.status).toBe('ready_for_operator_approval');
    expect(result.simulationStatus).toBe('success');
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
