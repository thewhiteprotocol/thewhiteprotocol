import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  BridgeMessageType,
  buildDestinationBridgeMintMessageFromSourceBridgeOut,
  hashBridgeMessageV1,
  type BridgeMessageV1,
} from '@thewhiteprotocol/core';
import type { Hex } from 'viem';
import { BridgeMessageStatus, type BridgeMessageState } from '../types';
import {
  DEFAULT_BASE_BRIDGE_INBOX,
  runSolanaToBaseApproval,
  type BaseApprovalClient,
} from '../solana-to-base-approval';
import { runSolanaToBaseResignApproval } from '../solana-to-base-resign-approval';
import {
  BRIDGE_EVM_SUBMIT_CHECK_ONLY_ENV,
  BRIDGE_EVM_SUBMIT_DESTINATION_MESSAGE_HASH_ENV,
  BRIDGE_EVM_SUBMIT_SOURCE_MESSAGE_HASH_ENV,
  checkGuardedEvmSubmitEnv,
  submitSolanaToBaseApprovedMessage,
  validateBaseDestinationNoteStateGate,
  type EvmSubmitClient,
} from '../solana-to-base-submit-approved';

function hex(byte: string): string {
  return byte.repeat(32);
}

function tmpStateDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'solana-to-base-approval-'));
}

function durableTestDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'solana-to-base-note-state-'));
}

function sourceMessage(overrides: Partial<BridgeMessageV1> = {}): BridgeMessageV1 {
  const now = Math.floor(Date.now() / 1000);
  return {
    protocolVersion: 1,
    messageType: BridgeMessageType.BridgeOut,
    sourceDomain: 0x01000002,
    destinationDomain: 0x02000002,
    sourceChainId: 0,
    destinationChainId: 84532,
    canonicalAssetId: '004a067d98373879008ada3415ad678dcd5354c0b29b52233a604774c94a82e0',
    sourceLocalAssetId: '004a067d98373879008ada3415ad678dcd5354c0b29b52233a604774c94a82e0',
    destinationLocalAssetId: '00fb58d8ea79c42a023685014b8281e7508bd5ca5f570f336f5852a291d54a70',
    amount: 1_000_000n,
    sourceNullifierHash: hex('14'),
    destinationCommitment: hex('15'),
    sourceRoot: hex('16'),
    sourceLeafIndex: 5,
    sourceTxHash: hex('17'),
    sourceBlockNumber: 463_688_066,
    sourceFinalityBlock: 463_688_098,
    nonce: now,
    deadline: now + 86_400,
    relayerFee: 0n,
    recipientStealthMetadataHash: hex('00'),
    memoHash: hex('00'),
    reserved0: hex('00'),
    reserved1: hex('00'),
    ...overrides,
  };
}

function destinationMessage(overrides: Partial<BridgeMessageV1> = {}): BridgeMessageV1 {
  return {
    ...buildDestinationBridgeMintMessageFromSourceBridgeOut({
      sourceMessage: sourceMessage(),
      destinationDomain: 0x02000002,
      destinationChainId: 84532,
      destinationLocalAssetId: '00fb58d8ea79c42a023685014b8281e7508bd5ca5f570f336f5852a291d54a70',
      destinationCommitment: hex('15'),
      sourceDecimals: 9,
      destinationDecimals: 18,
      normalizationMode: 'exact-decimal',
    }),
    ...overrides,
  };
}

function state(overrides: Partial<BridgeMessageState> = {}): BridgeMessageState {
  const source = sourceMessage();
  const dest = destinationMessage();
  const sourceHash = hashBridgeMessageV1(source);
  const destHash = hashBridgeMessageV1(dest);
  return {
    messageHash: destHash,
    sourceMessageHash: sourceHash,
    destinationMessageHash: destHash,
    sourceChain: 'solana-devnet',
    destinationChain: 'base-sepolia',
    sourceDomain: source.sourceDomain,
    destinationDomain: dest.destinationDomain,
    sourceTxHash: 'source-solana-tx',
    sourceBlockNumber: 463_688_066,
    sourceFinalityBlock: 463_688_098,
    nonce: dest.nonce,
    destinationCommitment: dest.destinationCommitment,
    canonicalAssetId: dest.canonicalAssetId,
    amount: dest.amount.toString(),
    signatures: [
      { signature: `0x${'11'.repeat(65)}`, signerAddress: '0x1111111111111111111111111111111111111111' },
      { signature: `0x${'22'.repeat(65)}`, signerAddress: '0x2222222222222222222222222222222222222222' },
    ],
    status: BridgeMessageStatus.PAPER_READY_TO_SUBMIT,
    attempts: 0,
    createdAt: 1,
    updatedAt: 2,
    message: dest,
    policyDecision: { accepted: true, action: 'accept', severity: 'info', reasons: [] },
    finalitySatisfied: true,
    signingDecision: { accepted: true, action: 'allow', reasons: [], adapterType: 'local-dev' },
    signatureMetadata: {
      signerSetVersion: 1,
      signerCount: 3,
      threshold: 2,
      signerAddresses: ['0x1111111111111111111111111111111111111111', '0x2222222222222222222222222222222222222222'],
    },
    submissionPreview: {
      destinationChain: 'base-sepolia',
      target: DEFAULT_BASE_BRIDGE_INBOX,
      family: 'evm',
      method: 'acceptBridgeMint',
      messageHash: destHash,
      sourceMessageHash: sourceHash,
      signerSetVersion: 1,
      signatureCount: 2,
      dryRun: true,
      wouldSubmit: true,
    },
    wouldSubmit: true,
    ...overrides,
  };
}

function writeState(message: BridgeMessageState): string {
  const dir = tmpStateDir();
  fs.writeFileSync(
    path.join(dir, 'bridge-messages.json'),
    JSON.stringify(
      [message],
      (_key, value) => typeof value === 'bigint' ? value.toString() : value,
      2
    )
  );
  return dir;
}

function writeStateFile(message: BridgeMessageState): string {
  const dir = tmpStateDir();
  const filePath = path.join(dir, 'bridge-messages.json');
  fs.writeFileSync(
    filePath,
    JSON.stringify([message], (_key, value) => typeof value === 'bigint' ? value.toString() : value, 2)
  );
  return dir;
}

function writeBaseNoteState(message: BridgeMessageState, overrides: Record<string, unknown> = {}): string {
  const dir = durableTestDir();
  const filePath = path.join(dir, `${message.destinationMessageHash}.json`);
  fs.writeFileSync(filePath, JSON.stringify({
    sourceMessageHash: message.sourceMessageHash,
    destinationBridgeMintHash: message.destinationMessageHash,
    destinationCommitment: message.destinationCommitment,
    destinationAmount: message.amount,
    destinationAssetId: message.message.destinationLocalAssetId,
    destSecret: 'secret-sentinel',
    destNullifier: 'nullifier-sentinel',
    ...overrides,
  }, null, 2));
  return dir;
}

function client(overrides: {
  consumed?: boolean;
  frozen?: boolean;
  assetSupported?: boolean;
  routeEnabled?: boolean;
  routePaused?: boolean;
  maxMessageAmount?: bigint;
  simulationError?: Error;
} = {}): BaseApprovalClient {
  return {
    getBytecode: jest.fn(async () => '0x1234'),
    readContract: jest.fn(async ({ functionName }) => {
      switch (functionName) {
        case 'currentSignerSetVersion':
          return 1n;
        case 'globalPaused':
          return false;
        case 'isRouteEnabled':
          return overrides.routeEnabled ?? true;
        case 'isRoutePaused':
          return overrides.routePaused ?? false;
        case 'isAssetSupported':
          return overrides.assetSupported ?? true;
        case 'isLocalAssetSet':
          return true;
        case 'canonicalToLocalAsset':
          return '0x0000000000000000000000000000000000000000';
        case 'isMessageConsumed':
          return overrides.consumed ?? false;
        case 'isMessageFrozen':
          return overrides.frozen ?? false;
        case 'maxMessageAmount':
          return overrides.maxMessageAmount ?? 2_000_000_000_000_000n;
        default:
          throw new Error(`unexpected read ${functionName}`);
      }
    }),
    simulateContract: jest.fn(async () => {
      if (overrides.simulationError) throw overrides.simulationError;
      return {};
    }),
    estimateContractGas: jest.fn(async () => 750_000n),
  };
}

function submitClient(overrides: {
  consumedBefore?: boolean;
  simulationError?: Error;
  writeError?: Error;
  receiptStatus?: 'success' | 'reverted';
} = {}): EvmSubmitClient {
  let sent = false;
  const txHash = `0x${'33'.repeat(32)}` as Hex;
  const base = client({
    consumed: false,
    simulationError: overrides.simulationError,
  });
  return {
    ...base,
    readContract: jest.fn(async (args) => {
      if (args.functionName === 'isMessageConsumed') {
        if (!sent) return overrides.consumedBefore ?? false;
        return true;
      }
      return base.readContract(args);
    }),
    writeContract: jest.fn(async () => {
      if (overrides.writeError) throw overrides.writeError;
      sent = true;
      return txHash;
    }),
    waitForTransactionReceipt: jest.fn(async () => ({
      status: overrides.receiptStatus ?? 'success',
      transactionHash: txHash,
      blockNumber: 123n,
      gasUsed: 986_309n,
    })),
  };
}

async function approve(
  message: BridgeMessageState,
  mockClient: BaseApprovalClient = client()
) {
  return runSolanaToBaseApproval({
    config: {
      statePath: writeState(message),
      expectedSourceHash: message.sourceMessageHash!,
      expectedDestinationHash: message.destinationMessageHash!,
      bridgeInbox: DEFAULT_BASE_BRIDGE_INBOX,
    },
    client: mockClient,
    now: () => new Date('2026-05-20T13:30:00.000Z'),
  });
}

function submitEnv(statePath: string, message: BridgeMessageState, overrides: Record<string, string> = {}) {
  const noteStateDir = overrides.BRIDGE_BASE_NOTE_STATE_BACKUP_DIR !== undefined
    ? overrides.BRIDGE_BASE_NOTE_STATE_BACKUP_DIR
    : writeBaseNoteState(message);
  return {
    BRIDGE_DAEMON_MODE: 'live-testnet',
    BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT: 'true',
    BRIDGE_DAEMON_ROUTES: 'solana-devnet:base-sepolia:1',
    BRIDGE_SOLANA_TO_BASE_APPROVAL_STATE_PATH: statePath,
    BRIDGE_APPROVED_MESSAGE_HASHES: `solana-devnet->base-sepolia|${message.destinationMessageHash}`,
    [BRIDGE_EVM_SUBMIT_SOURCE_MESSAGE_HASH_ENV]: message.sourceMessageHash!,
    [BRIDGE_EVM_SUBMIT_DESTINATION_MESSAGE_HASH_ENV]: message.destinationMessageHash!,
    BRIDGE_DEPLOYED_SIGNER_SET_VERSION: '1',
    BRIDGE_DEPLOYED_SIGNER_THRESHOLD: '2',
    BRIDGE_DEPLOYED_SIGNER_ADDRESSES: [
      '0x1111111111111111111111111111111111111111',
      '0x2222222222222222222222222222222222222222',
      '0x3333333333333333333333333333333333333333',
    ].join(','),
    BASE_SUBMITTER_PRIVATE_KEY: '0x0000000000000000000000000000000000000000000000000000000000000001',
    BRIDGE_BASE_NOTE_STATE_BACKUP_DIR: noteStateDir,
    NODE_ENV: 'test',
    BRIDGE_ALLOW_TMP_BASE_NOTE_STATE_FOR_TESTS: 'true',
    ...overrides,
  };
}

describe('Solana to Base approval readiness', () => {
  const originalLiveSubmit = process.env.BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT;

  afterEach(() => {
    process.env.BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT = originalLiveSubmit;
  });

  test('requires destination BridgeMint hash and marks simulation success ready', async () => {
    const msg = state();
    const report = await approve(msg);
    expect(report.ok).toBe(true);
    expect(report.readiness).toBe('approval_ready');
    expect(report.destinationBridgeMintHash).toBe(msg.destinationMessageHash);
    expect(report.simulation.ok).toBe(true);
    expect(report.destinationTxSubmitted).toBe(false);
  });

  test('local-dev signatures are rejected when deployed signer set is required', async () => {
    const msg = state();
    const report = await runSolanaToBaseApproval({
      config: {
        statePath: writeState(msg),
        expectedSourceHash: msg.sourceMessageHash!,
        expectedDestinationHash: msg.destinationMessageHash!,
        bridgeInbox: DEFAULT_BASE_BRIDGE_INBOX,
        deployedSignerSetVersion: 1,
        deployedThreshold: 2,
        deployedSignerAddresses: [
          '0x9A34F10F5b9AD7770C30A3B41d95C4Dcb0B88820',
          '0xbd7d34e42352BCe888394263A84CF21c85608beC',
          '0xEa4A68F39630C5145f1840D754B470a9fa5F2c19',
        ],
      },
      client: client(),
    });
    expect(report.ok).toBe(false);
    expect(report.errors).toContain('signatures_do_not_match_deployed_signer_set');
  });

  test('source hash alone is rejected', async () => {
    const msg = state();
    const report = await runSolanaToBaseApproval({
      config: {
        statePath: writeState(msg),
        expectedSourceHash: msg.sourceMessageHash!,
        expectedDestinationHash: msg.sourceMessageHash!,
        bridgeInbox: DEFAULT_BASE_BRIDGE_INBOX,
      },
      client: client(),
    });
    expect(report.ok).toBe(false);
    expect(report.errors).toContain('paper_message_not_found');
  });

  test('consumed message blocks approval', async () => {
    const report = await approve(state(), client({ consumed: true }));
    expect(report.ok).toBe(false);
    expect(report.errors).toContain('base_message_consumed');
  });

  test('unsupported asset blocks approval', async () => {
    const report = await approve(state(), client({ assetSupported: false }));
    expect(report.ok).toBe(false);
    expect(report.errors).toContain('base_asset_not_supported');
  });

  test('paused route blocks approval', async () => {
    const report = await approve(state(), client({ routePaused: true }));
    expect(report.ok).toBe(false);
    expect(report.errors).toContain('base_route_paused');
  });

  test('over-cap amount blocks approval', async () => {
    const report = await approve(state(), client({ maxMessageAmount: 1n }));
    expect(report.ok).toBe(false);
    expect(report.errors).toContain('base_amount_over_cap');
  });

  test('simulation failure blocks approval', async () => {
    const report = await approve(state(), client({ simulationError: new Error('InvalidSigner') }));
    expect(report.ok).toBe(false);
    expect(report.errors).toContain('base_simulation_failed');
    expect(report.simulation.ok).toBe(false);
  });

  test('live submit env blocks approval mode', async () => {
    process.env.BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT = 'true';
    const report = await approve(state());
    expect(report.ok).toBe(false);
    expect(report.errors).toContain('live_submit_enabled');
  });

  test('redacts secret-like simulation errors', async () => {
    const report = await approve(
      state(),
      client({ simulationError: new Error('privateKey=abc https://rpc.example/key witness=value') })
    );
    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain('privateKey=abc');
    expect(serialized).not.toContain('https://rpc.example/key');
    expect(serialized).not.toContain('witness=value');
  });

  test('destination preview must remain dry-run', async () => {
    const report = await approve(state({
      submissionPreview: {
        destinationChain: 'base-sepolia',
        target: DEFAULT_BASE_BRIDGE_INBOX,
        method: 'acceptBridgeMint',
        dryRun: false,
        wouldSubmit: true,
      },
    }));
    expect(report.ok).toBe(false);
    expect(report.errors).toContain('preview_not_dry_run');
  });

  test('re-signs existing destination hash with configured deployed signer keys', async () => {
    const msg = state();
    const statePath = writeStateFile(msg);
    const deployedSigners = [
      '0x2B5AD5c4795c026514f8317c7a215E218DccD6cf',
      '0x6813Eb9362372EEF6200f3b1dbC3f819671cBA69',
      '0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf',
    ];
    const report = await runSolanaToBaseResignApproval({
      env: {
        NODE_ENV: 'test',
        BRIDGE_SIGNER_MODE: 'env-file',
        BRIDGE_SIGNER_PRIVATE_KEYS_TESTNET: [
          '0x0000000000000000000000000000000000000000000000000000000000000001',
          '0x0000000000000000000000000000000000000000000000000000000000000002',
          '0x0000000000000000000000000000000000000000000000000000000000000003',
        ].join(','),
        BRIDGE_SOLANA_TO_BASE_APPROVAL_STATE_PATH: statePath,
        BRIDGE_EXPECTED_SOURCE_MESSAGE_HASH: msg.sourceMessageHash!,
        BRIDGE_EXPECTED_DESTINATION_MESSAGE_HASH: msg.destinationMessageHash!,
        BRIDGE_DEPLOYED_SIGNER_SET_VERSION: '1',
        BRIDGE_DEPLOYED_SIGNER_THRESHOLD: '2',
        BRIDGE_DEPLOYED_SIGNER_ADDRESSES: deployedSigners.join(','),
        BRIDGE_DAEMON_MODE: 'paper',
        BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT: 'false',
      },
      client: client(),
      now: () => new Date('2026-05-20T13:40:00.000Z'),
    });
    expect(report.ok).toBe(true);
    expect(report.destinationHashSigned).toBe(true);
    expect(report.sourceHashPreserved).toBe(true);
    expect(report.recoveredSignerAddressesAfter).toHaveLength(2);
    expect(report.signersMatchDeployedSet).toBe(true);
    expect(report.approval?.simulation.ok).toBe(true);
  });

  test('re-sign blocks when deployed signer keys are unavailable', async () => {
    const msg = state();
    const report = await runSolanaToBaseResignApproval({
      env: {
        NODE_ENV: 'test',
        BRIDGE_SIGNER_MODE: 'env-file',
        BRIDGE_SIGNER_PRIVATE_KEYS_TESTNET: '0x0000000000000000000000000000000000000000000000000000000000000001',
        BRIDGE_SOLANA_TO_BASE_APPROVAL_STATE_PATH: writeStateFile(msg),
        BRIDGE_EXPECTED_SOURCE_MESSAGE_HASH: msg.sourceMessageHash!,
        BRIDGE_EXPECTED_DESTINATION_MESSAGE_HASH: msg.destinationMessageHash!,
        BRIDGE_DEPLOYED_SIGNER_SET_VERSION: '1',
        BRIDGE_DEPLOYED_SIGNER_THRESHOLD: '2',
        BRIDGE_DEPLOYED_SIGNER_ADDRESSES: [
          '0x9A34F10F5b9AD7770C30A3B41d95C4Dcb0B88820',
          '0xbd7d34e42352BCe888394263A84CF21c85608beC',
        ].join(','),
        BRIDGE_DAEMON_MODE: 'paper',
        BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT: 'false',
      },
      client: client(),
    });
    expect(report.ok).toBe(false);
    expect(report.errors).toContain('deployed_signer_keys_unavailable');
    expect(report.destinationTxSubmitted).toBe(false);
  });

  test('submit env check blocks paper mode and live submit false', () => {
    const msg = state();
    const check = checkGuardedEvmSubmitEnv({
      env: submitEnv('/tmp/state', msg, {
        BRIDGE_DAEMON_MODE: 'paper',
        BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT: 'false',
      }),
      sourceHash: msg.sourceMessageHash!,
      destinationHash: msg.destinationMessageHash!,
    });
    expect(check.ok).toBe(false);
    expect(check.warnings).toContain('BRIDGE_DAEMON_MODE_must_be_live-testnet');
    expect(check.warnings).toContain('BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT_must_be_true');
  });

  test('submit env check allows paper check-only mode without submitter key', () => {
    const msg = state();
    const check = checkGuardedEvmSubmitEnv({
      env: submitEnv('/tmp/state', msg, {
        BRIDGE_DAEMON_MODE: 'paper',
        BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT: 'false',
        [BRIDGE_EVM_SUBMIT_CHECK_ONLY_ENV]: 'true',
        BASE_SUBMITTER_PRIVATE_KEY: '',
      }),
      sourceHash: msg.sourceMessageHash!,
      destinationHash: msg.destinationMessageHash!,
    });
    expect(check.ok).toBe(true);
    expect(check.checkOnly).toBe(true);
    expect(check.submitterKeyPresent).toBe(false);
  });

  test('submit blocks if approved hash is missing', async () => {
    const msg = state();
    const report = await submitSolanaToBaseApprovedMessage({
      env: submitEnv(writeStateFile(msg), msg, { BRIDGE_APPROVED_MESSAGE_HASHES: '' }),
      client: submitClient(),
      account: '0x000000000000000000000000000000000000dEaD',
    });
    expect(report.ok).toBe(false);
    expect(report.errors).toContain('BRIDGE_APPROVED_MESSAGE_HASHES_route_scoped_destination_hash');
    expect(report.destinationTxSubmitted).toBe(false);
  });

  test('base destination note-state gate passes with exact durable fixture', () => {
    const msg = state();
    const env = submitEnv(writeStateFile(msg), msg);
    const gate = validateBaseDestinationNoteStateGate({
      env,
      sourceHash: msg.sourceMessageHash!,
      destinationHash: msg.destinationMessageHash!,
      message: msg.message,
    });
    expect(gate.ok).toBe(true);
    expect(gate.summary.hasDestSecret).toBe(true);
    expect(gate.summary.hasDestNullifier).toBe(true);
    expect(JSON.stringify(gate)).not.toContain('secret-sentinel');
    expect(JSON.stringify(gate)).not.toContain('nullifier-sentinel');
  });

  test('base destination note-state gate rejects mismatches and missing secret material', () => {
    const msg = state();
    for (const override of [
      { sourceMessageHash: `0x${'44'.repeat(32)}` },
      { destinationBridgeMintHash: `0x${'45'.repeat(32)}` },
      { destinationCommitment: `0x${'46'.repeat(32)}` },
      { destSecret: '' },
      { destNullifier: '' },
    ]) {
      const env = submitEnv(writeStateFile(msg), msg, {
        BRIDGE_BASE_NOTE_STATE_BACKUP_DIR: writeBaseNoteState(msg, override),
      });
      const gate = validateBaseDestinationNoteStateGate({
        env,
        sourceHash: msg.sourceMessageHash!,
        destinationHash: msg.destinationMessageHash!,
        message: msg.message,
      });
      expect(gate.ok).toBe(false);
    }
  });

  test('base destination note-state gate rejects tmp backup path', () => {
    const msg = state();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'base-note-state-'));
    const filePath = path.join(tmpDir, `${msg.destinationMessageHash}.json`);
    fs.writeFileSync(filePath, JSON.stringify({
      sourceMessageHash: msg.sourceMessageHash,
      destinationBridgeMintHash: msg.destinationMessageHash,
      destinationCommitment: msg.destinationCommitment,
      destinationAmount: msg.amount,
      destinationAssetId: msg.message.destinationLocalAssetId,
      destSecret: 'secret-sentinel',
      destNullifier: 'nullifier-sentinel',
    }));
    const gate = validateBaseDestinationNoteStateGate({
      env: submitEnv(writeStateFile(msg), msg, {
        BRIDGE_BASE_NOTE_STATE_BACKUP_DIR: tmpDir,
        BRIDGE_ALLOW_TMP_BASE_NOTE_STATE_FOR_TESTS: 'false',
      }),
      sourceHash: msg.sourceMessageHash!,
      destinationHash: msg.destinationMessageHash!,
      message: msg.message,
    });
    expect(gate.ok).toBe(false);
    expect(gate.errors).toContain('base_destination_note_state_not_durable');
  });

  test('submit-approved blocks when base destination note-state is missing', async () => {
    const msg = state();
    const missingDir = durableTestDir();
    const report = await submitSolanaToBaseApprovedMessage({
      env: submitEnv(writeStateFile(msg), msg, { BRIDGE_BASE_NOTE_STATE_BACKUP_DIR: missingDir }),
      client: submitClient(),
      account: '0x000000000000000000000000000000000000dEaD',
    });
    expect(report.ok).toBe(false);
    expect(report.status).toBe('blocked_pre_submit_checks');
    expect(report.errors).toContain('base_destination_note_state_missing');
    expect(report.destinationTxSubmitted).toBe(false);
  });

  test('submit-approved check-only mode proves missing backup gate before writeContract', async () => {
    const msg = state();
    const missingDir = durableTestDir();
    const mockClient = submitClient();
    const report = await submitSolanaToBaseApprovedMessage({
      env: submitEnv(writeStateFile(msg), msg, {
        BRIDGE_BASE_NOTE_STATE_BACKUP_DIR: missingDir,
        BRIDGE_DAEMON_MODE: 'paper',
        BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT: 'false',
        [BRIDGE_EVM_SUBMIT_CHECK_ONLY_ENV]: 'true',
        BASE_SUBMITTER_PRIVATE_KEY: '',
      }),
      client: mockClient,
    });
    expect(report.ok).toBe(false);
    expect(report.status).toBe('blocked_pre_submit_checks');
    expect(report.errors).toContain('base_destination_note_state_missing');
    expect(report.submitAttempted).toBe(false);
    expect(report.destinationTxSubmitted).toBe(false);
    expect(mockClient.writeContract).not.toHaveBeenCalled();
  });

  test('submit-approved check-only mode passes backup gate without sending', async () => {
    const msg = state();
    const mockClient = submitClient();
    const report = await submitSolanaToBaseApprovedMessage({
      env: submitEnv(writeStateFile(msg), msg, {
        BRIDGE_DAEMON_MODE: 'paper',
        BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT: 'false',
        [BRIDGE_EVM_SUBMIT_CHECK_ONLY_ENV]: 'true',
        BASE_SUBMITTER_PRIVATE_KEY: '',
      }),
      client: mockClient,
    });
    expect(report.ok).toBe(true);
    expect(report.status).toBe('check_ready');
    expect(report.baseDestinationNoteStateValid).toBe(true);
    expect(report.submitAttempted).toBe(false);
    expect(report.destinationTxSubmitted).toBe(false);
    expect(mockClient.writeContract).not.toHaveBeenCalled();
  });

  test('submit blocks source and destination hash mismatch', async () => {
    const msg = state();
    const report = await submitSolanaToBaseApprovedMessage({
      env: submitEnv(writeStateFile(msg), msg, {
        [BRIDGE_EVM_SUBMIT_SOURCE_MESSAGE_HASH_ENV]: `0x${'44'.repeat(32)}`,
      }),
      client: submitClient(),
      account: '0x000000000000000000000000000000000000dEaD',
    });
    expect(report.ok).toBe(false);
    expect(report.errors).toContain('source_hash_mismatch');
  });

  test('submit blocks already consumed message', async () => {
    const msg = state();
    const report = await submitSolanaToBaseApprovedMessage({
      env: submitEnv(writeStateFile(msg), msg),
      client: submitClient({ consumedBefore: true }),
      account: '0x000000000000000000000000000000000000dEaD',
    });
    expect(report.ok).toBe(false);
    expect(report.status).toBe('already_consumed');
    expect(report.duplicateSubmitBlocked).toBe(true);
  });

  test('submit blocks duplicate when state already has tx hash', async () => {
    const msg = {
      ...state(),
      submitTxHash: `0x${'77'.repeat(32)}`,
    };
    const report = await submitSolanaToBaseApprovedMessage({
      env: submitEnv(writeStateFile(msg), msg),
      client: submitClient(),
      account: '0x000000000000000000000000000000000000dEaD',
    });
    expect(report.ok).toBe(false);
    expect(report.status).toBe('already_submitted');
    expect(report.submitAttempted).toBe(false);
    expect(report.duplicateSubmitBlocked).toBe(true);
    expect(report.submitTx).toBe(msg.submitTxHash);
  });

  test('submit blocks when final simulation fails', async () => {
    const msg = state();
    const report = await submitSolanaToBaseApprovedMessage({
      env: submitEnv(writeStateFile(msg), msg),
      client: submitClient({ simulationError: new Error('InvalidSigner') }),
      account: '0x000000000000000000000000000000000000dEaD',
    });
    expect(report.ok).toBe(false);
    expect(report.status).toBe('blocked_simulation');
    expect(report.submitAttempted).toBe(false);
  });

  test('successful mocked submit persists tx hash and duplicate state', async () => {
    const msg = state();
    const statePath = writeStateFile(msg);
    const report = await submitSolanaToBaseApprovedMessage({
      env: submitEnv(statePath, msg),
      client: submitClient(),
      account: '0x000000000000000000000000000000000000dEaD',
    });
    expect(report.ok).toBe(true);
    expect(report.status).toBe('success');
    expect(report.submitAttempted).toBe(true);
    expect(report.submitTx).toMatch(/^0x/);
    expect(report.messageConsumed).toBe(true);
    expect(report.duplicateSubmitBlocked).toBe(true);
    expect(report.destinationTxSubmitted).toBe(true);
    const persisted = JSON.parse(fs.readFileSync(path.join(statePath, 'bridge-messages.json'), 'utf8'))[0];
    expect(persisted.submitTxHash).toBe(report.submitTx);
  });

  test('submit blocks mainnet or broad route', async () => {
    const msg = state();
    const report = await submitSolanaToBaseApprovedMessage({
      env: submitEnv(writeStateFile(msg), msg, {
        BRIDGE_DAEMON_ROUTES: 'solana:base:1',
      }),
      client: submitClient(),
      account: '0x000000000000000000000000000000000000dEaD',
    });
    expect(report.ok).toBe(false);
    expect(report.errors).toContain('BRIDGE_DAEMON_ROUTES_must_be_exact_solana_to_base_route');
  });
});
