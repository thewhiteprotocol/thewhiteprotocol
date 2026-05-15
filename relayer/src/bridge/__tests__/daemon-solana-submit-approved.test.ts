import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Keypair, PublicKey } from '@solana/web3.js';
import { BridgeMessageType, hashBridgeMessageV1, type BridgeMessageV1 } from '@thewhiteprotocol/core';
import { BASE_SEPOLIA_TO_SOLANA_DEVNET_ROUTE } from '../base-to-solana-route';
import {
  BRIDGE_SUBMIT_DESTINATION_MESSAGE_HASH_ENV,
  BRIDGE_SUBMIT_SOURCE_MESSAGE_HASH_ENV,
  checkGuardedSolanaSubmitEnv,
  submitSolanaAcceptBridgeMintApprovedMessage,
} from '../daemon-solana-submit-approved';
import { buildAcceptBridgeV1MintAccounts, WHITE_PROTOCOL_PROGRAM_ID } from '../solana-adapter';
import { BridgeStateStore } from '../state';
import { BridgeMessageStatus, type BridgeMessageState } from '../types';

function hex(byte: string): string {
  return byte.repeat(32);
}

function bridgeV1ConfigData(signerSetVersion: number): Buffer {
  const data = Buffer.alloc(66);
  data.writeUInt32LE(signerSetVersion, 44);
  return data;
}

function signerSetData(signerSetVersion: number): Buffer {
  const data = Buffer.alloc(235);
  data.writeUInt32LE(signerSetVersion, 8);
  data[12] = 2;
  data[13] = 3;
  return data;
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

function tempState(): { dir: string; store: BridgeStateStore } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pr012a-submit-'));
  return { dir, store: new BridgeStateStore(dir) };
}

function makeState(message: BridgeMessageV1, sourceHash = `0x${hex('12')}`): BridgeMessageState {
  const destinationHash = hashBridgeMessageV1(message);
  return {
    messageHash: destinationHash,
    sourceMessageHash: sourceHash,
    destinationMessageHash: destinationHash,
    sourceChain: 'base-sepolia',
    destinationChain: 'solana-devnet',
    sourceDomain: message.sourceDomain,
    destinationDomain: message.destinationDomain,
    sourceTxHash: `0x${hex('aa')}`,
    sourceBlockNumber: 100,
    sourceFinalityBlock: 103,
    nonce: message.nonce,
    destinationCommitment: message.destinationCommitment,
    canonicalAssetId: message.canonicalAssetId,
    amount: message.amount.toString(),
    signatures: [
      { signature: `0x${'11'.repeat(65)}`, signerAddress: '0x1111111111111111111111111111111111111111' },
      { signature: `0x${'22'.repeat(65)}`, signerAddress: '0x2222222222222222222222222222222222222222' },
    ],
    status: BridgeMessageStatus.PAPER_READY_TO_SUBMIT,
    attempts: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    message,
    policyDecision: { accepted: true, action: 'accept', severity: 'info', reasons: [] },
    finalitySatisfied: true,
    signatureMetadata: {
      signerSetVersion: BASE_SEPOLIA_TO_SOLANA_DEVNET_ROUTE.signerSetVersion,
      signerCount: 3,
      threshold: 2,
      signerAddresses: [
        '0x1111111111111111111111111111111111111111',
        '0x2222222222222222222222222222222222222222',
      ],
    },
    submissionPreview: {},
    wouldSubmit: true,
  };
}

function makeEnv(stateDir: string, destinationHash: string, sourceHash = `0x${hex('12')}`) {
  return {
    BRIDGE_DAEMON_MODE: 'live-testnet',
    BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT: 'true',
    BRIDGE_DAEMON_ROUTES: 'base-sepolia:solana-devnet:3',
    BRIDGE_DAEMON_STATE_PATH: stateDir,
    SOLANA_DEVNET_RPC_URL: 'present',
    RELAYER_KEYPAIR: JSON.stringify(Array.from(Keypair.generate().secretKey)),
    BRIDGE_APPROVED_MESSAGE_HASHES: `base-sepolia->solana-devnet|${destinationHash}`,
    [BRIDGE_SUBMIT_DESTINATION_MESSAGE_HASH_ENV]: destinationHash,
    [BRIDGE_SUBMIT_SOURCE_MESSAGE_HASH_ENV]: sourceHash,
  };
}

function makeConnection(message: BridgeMessageV1, options: {
  consumedExistsBefore?: boolean;
  simulationErr?: unknown;
} = {}) {
  const signerSetVersion = BASE_SEPOLIA_TO_SOLANA_DEVNET_ROUTE.signerSetVersion;
  const accounts = buildAcceptBridgeV1MintAccounts(
    message,
    new PublicKey(BASE_SEPOLIA_TO_SOLANA_DEVNET_ROUTE.solanaDestination!.poolConfig),
    WHITE_PROTOCOL_PROGRAM_ID,
    {
      signerSetVersion,
      destinationConfig: BASE_SEPOLIA_TO_SOLANA_DEVNET_ROUTE.solanaDestination!,
      messageHash: hashBridgeMessageV1(message),
    }
  );
  let sent = false;
  const sendRawTransaction = jest.fn(async () => {
    sent = true;
    return '5'.repeat(88);
  });
  return {
    sendRawTransaction,
    getLatestBlockhash: jest.fn(async () => ({
      blockhash: '11111111111111111111111111111111',
      lastValidBlockHeight: 123,
    })),
    simulateTransaction: jest.fn(async () => ({
      context: { slot: 55 },
      value: {
        err: options.simulationErr ?? null,
        logs: options.simulationErr ? ['failed'] : ['ok'],
        unitsConsumed: 310625,
      },
    })),
    confirmTransaction: jest.fn(async () => ({ value: { err: null } })),
    getAccountInfo: jest.fn(async (pubkey: PublicKey) => {
      if (pubkey.equals(WHITE_PROTOCOL_PROGRAM_ID)) return { executable: true, data: Buffer.alloc(0) };
      if (pubkey.equals(accounts.bridgeV1Config)) return { executable: false, data: bridgeV1ConfigData(signerSetVersion) };
      if (pubkey.equals(accounts.signerSet)) return { executable: false, data: signerSetData(signerSetVersion) };
      if (pubkey.equals(accounts.consumedMessage)) {
        return (options.consumedExistsBefore || sent) ? { executable: false, data: Buffer.alloc(8) } : null;
      }
      if (pubkey.equals(accounts.frozenMessage)) return null;
      if (pubkey.equals(accounts.commitmentIndex)) {
        return sent ? { executable: false, data: Buffer.alloc(8) } : null;
      }
      return { executable: false, data: Buffer.alloc(8) };
    }),
  };
}

describe('guarded Solana submit command', () => {
  test('submit env blocks paper mode and disabled live submit', () => {
    const result = checkGuardedSolanaSubmitEnv({
      BRIDGE_DAEMON_MODE: 'paper',
      BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT: 'false',
      BRIDGE_DAEMON_ROUTES: 'base-sepolia:solana-devnet:3',
      BRIDGE_DAEMON_STATE_PATH: '/tmp/state',
      SOLANA_DEVNET_RPC_URL: 'present',
      RELAYER_KEYPAIR: JSON.stringify(Array.from(Keypair.generate().secretKey)),
      BRIDGE_APPROVED_MESSAGE_HASHES: `base-sepolia->solana-devnet|0x${hex('33')}`,
    });
    expect(result.ok).toBe(false);
    expect(result.warnings).toEqual(expect.arrayContaining([
      'BRIDGE_DAEMON_MODE must be live-testnet',
      'BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT must be true',
    ]));
  });

  test('source hash approval alone is rejected', () => {
    const sourceHash = `0x${hex('12')}`;
    const result = checkGuardedSolanaSubmitEnv({
      BRIDGE_DAEMON_MODE: 'live-testnet',
      BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT: 'true',
      BRIDGE_DAEMON_ROUTES: 'base-sepolia:solana-devnet:3',
      BRIDGE_DAEMON_STATE_PATH: '/tmp/state',
      SOLANA_DEVNET_RPC_URL: 'present',
      RELAYER_KEYPAIR: JSON.stringify(Array.from(Keypair.generate().secretKey)),
      BRIDGE_APPROVED_MESSAGE_HASHES: sourceHash,
      [BRIDGE_SUBMIT_DESTINATION_MESSAGE_HASH_ENV]: `0x${hex('33')}`,
      [BRIDGE_SUBMIT_SOURCE_MESSAGE_HASH_ENV]: sourceHash,
    });
    expect(result.ok).toBe(false);
    expect(result.approvedDestinationHashPresent).toBe(false);
  });

  test('successful mocked send persists tx hash', async () => {
    const message = makeDestinationMessage();
    const sourceHash = `0x${hex('12')}`;
    const destinationHash = hashBridgeMessageV1(message);
    const { dir, store } = tempState();
    store.set(makeState(message, sourceHash));
    const connection = makeConnection(message);
    const env = makeEnv(dir, destinationHash, sourceHash);
    const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(env.RELAYER_KEYPAIR)));

    const result = await submitSolanaAcceptBridgeMintApprovedMessage({
      env,
      stateDir: dir,
      connection: connection as any,
      stateStore: store,
      payer,
      now: () => 1,
    });

    expect(result.status).toBe('success');
    expect(result.destinationTxSubmitted).toBe(true);
    expect(result.consumedPdaCreated).toBe(true);
    expect(result.pendingBufferUpdated).toBe(true);
    expect(connection.sendRawTransaction).toHaveBeenCalledTimes(1);
    expect(store.get(destinationHash)?.submitTxHash).toBe(result.submitTxHash);
  });

  test('consumed PDA blocks submit before send', async () => {
    const message = makeDestinationMessage();
    const sourceHash = `0x${hex('12')}`;
    const destinationHash = hashBridgeMessageV1(message);
    const { dir, store } = tempState();
    store.set(makeState(message, sourceHash));
    const connection = makeConnection(message, { consumedExistsBefore: true });
    const env = makeEnv(dir, destinationHash, sourceHash);
    const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(env.RELAYER_KEYPAIR)));

    const result = await submitSolanaAcceptBridgeMintApprovedMessage({
      env,
      stateDir: dir,
      connection: connection as any,
      stateStore: store,
      payer,
    });

    expect(result.status).toBe('blocked_pre_submit_checks');
    expect(result.error).toContain('consumedMessage_already_exists');
    expect(connection.sendRawTransaction).not.toHaveBeenCalled();
  });

  test('simulation failure blocks submit', async () => {
    const message = makeDestinationMessage();
    const sourceHash = `0x${hex('12')}`;
    const destinationHash = hashBridgeMessageV1(message);
    const { dir, store } = tempState();
    store.set(makeState(message, sourceHash));
    const connection = makeConnection(message, { simulationErr: { InstructionError: [2, 'x'] } });
    const env = makeEnv(dir, destinationHash, sourceHash);
    const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(env.RELAYER_KEYPAIR)));

    const result = await submitSolanaAcceptBridgeMintApprovedMessage({
      env,
      stateDir: dir,
      connection: connection as any,
      stateStore: store,
      payer,
    });

    expect(result.status).toBe('blocked_simulation');
    expect(connection.sendRawTransaction).not.toHaveBeenCalled();
  });

  test('duplicate retry after tx hash does not send again', async () => {
    const message = makeDestinationMessage();
    const sourceHash = `0x${hex('12')}`;
    const destinationHash = hashBridgeMessageV1(message);
    const { dir, store } = tempState();
    store.set({ ...makeState(message, sourceHash), submitTxHash: 'existingTx' });
    const connection = makeConnection(message);
    const env = makeEnv(dir, destinationHash, sourceHash);
    const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(env.RELAYER_KEYPAIR)));

    const result = await submitSolanaAcceptBridgeMintApprovedMessage({
      env,
      stateDir: dir,
      connection: connection as any,
      stateStore: store,
      payer,
    });

    expect(result.status).toBe('already_submitted');
    expect(result.duplicateSubmitBlocked).toBe(true);
    expect(connection.sendRawTransaction).not.toHaveBeenCalled();
  });
});
