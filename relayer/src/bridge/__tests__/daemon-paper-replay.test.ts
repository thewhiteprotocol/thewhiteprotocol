import * as os from 'os';
import * as path from 'path';
import {
  BridgeMessageType,
  buildDestinationBridgeMintMessageFromSourceBridgeOut,
  encodeBridgeMessageV1,
  hashBridgeMessageV1,
  type BridgeMessageV1,
} from '@thewhiteprotocol/core';
import {
  checkBridgeDaemonReplayEnv,
  runBridgeDaemonPaperReplay,
} from '../daemon-paper-replay';
import { BridgeStateStore } from '../state';
import { BridgeSignerService, LocalDevSignerAdapter } from '../signer';
import { BASE_SEPOLIA_TO_SOLANA_DEVNET_ROUTE } from '../base-to-solana-route';
import type { BridgeEventObservation, BridgeRouteConfig, BridgeSourceAdapter } from '../types';

const TEST_PRIVATE_KEY =
  '0x0000000000000000000000000000000000000000000000000000000000000001';

function tmpDir(name: string): string {
  return path.join(os.tmpdir(), `${name}-${Date.now()}-${Math.random()}`);
}

function hex(byte: string): string {
  return byte.repeat(32);
}

function makeBaseToSolanaMessage(overrides: Partial<BridgeMessageV1> = {}): BridgeMessageV1 {
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
    amount: 1_000_000_000_000_000n,
    sourceNullifierHash: hex('04'),
    destinationCommitment: hex('05'),
    sourceRoot: hex('06'),
    sourceLeafIndex: 7,
    sourceTxHash: hex('07'),
    sourceBlockNumber: 100,
    sourceFinalityBlock: 103,
    nonce: 11,
    deadline: now + 86_400,
    relayerFee: 0n,
    recipientStealthMetadataHash: hex('00'),
    memoHash: hex('00'),
    reserved0: hex('00'),
    reserved1: hex('00'),
    ...overrides,
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
    encodedMessage: `0x${Array.from(encoded).map((byte) => byte.toString(16).padStart(2, '0')).join('')}`,
    txHash: '0xsourceTx',
    blockNumber: message.sourceBlockNumber,
    confirmations: 100,
    sourceTxSucceeded: true,
    sourceEventKind: 'evm_bridge_out_v1',
  };
}

function sourceAdapter(events: BridgeEventObservation[]): BridgeSourceAdapter {
  return {
    async *watch() {
      for (const event of events) yield event;
    },
    async getBlockNumber() {
      return 120;
    },
    async isFinalized() {
      return true;
    },
  };
}

function signer(): BridgeSignerService {
  return new BridgeSignerService({
    threshold: 1,
    privateKeys: [],
    adapter: new LocalDevSignerAdapter({
      privateKeys: [TEST_PRIVATE_KEY],
      env: { NODE_ENV: 'test', BRIDGE_SIGNER_MODE: 'local-dev' },
    }),
  });
}

function baseConfig(stateDir: string, route: BridgeRouteConfig = BASE_SEPOLIA_TO_SOLANA_DEVNET_ROUTE) {
  return {
    mode: 'paper' as const,
    intervalMs: 30_000,
    allowLiveTestnetSubmit: false,
    allowLocalDevSignerInLiveTestnet: false,
    routes: [route],
    stateDir,
    signerThreshold: 1,
    signerSetVersion: route.signerSetVersion,
    submitTargets: {
      'solana-devnet': 'DAoezX29ingBicFfrqboD7xBeLro2b6RL77dhEbXivVD',
    },
  };
}

describe('Bridge daemon paper replay', () => {
  test('env check requires paper mode, bounded range, and live submit disabled', () => {
    const blocked = checkBridgeDaemonReplayEnv({
      BRIDGE_DAEMON_MODE: 'live-testnet',
      BRIDGE_DAEMON_REPLAY_ROUTE: 'base-sepolia:solana-devnet',
      BRIDGE_DAEMON_STATE_PATH: '/tmp/state',
      BRIDGE_SIGNER_MODE: 'env-file',
      BRIDGE_SIGNER_PRIVATE_KEYS_TESTNET: 'present',
      BASE_SEPOLIA_RPC_URL: 'present',
      BRIDGE_DAEMON_SCAN_FROM_BLOCK: '1',
      BRIDGE_DAEMON_SCAN_TO_BLOCK: '1000',
      BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT: 'true',
    });
    expect(blocked.ok).toBe(false);
    expect(blocked.warnings).toEqual(expect.arrayContaining([
      'BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT must remain false',
      'BRIDGE_DAEMON_MODE must be paper',
      'replay block range must be <= 500 blocks',
    ]));
  });

  test('replay persists approved message and is idempotent', async () => {
    const stateDir = tmpDir('bridge-replay');
    const store = new BridgeStateStore(stateDir);
    const message = makeBaseToSolanaMessage();
    const destinationMessage = buildDestinationBridgeMintMessageFromSourceBridgeOut({
      sourceMessage: message,
      destinationDomain: message.destinationDomain,
      destinationChainId: message.destinationChainId,
      destinationLocalAssetId: message.destinationLocalAssetId,
      destinationCommitment: message.destinationCommitment,
      sourceDecimals: 18,
      destinationDecimals: 9,
      normalizationMode: 'exact-decimal',
    });
    const result = await runBridgeDaemonPaperReplay({
      config: baseConfig(stateDir),
      stateStore: store,
      sourceAdapter: sourceAdapter([makeEvent(message)]),
      signer: signer(),
      route: BASE_SEPOLIA_TO_SOLANA_DEVNET_ROUTE,
      fromBlock: 80n,
      toBlock: 120n,
      expectedSourceMessageHash: hashBridgeMessageV1(message),
      expectedDestinationMessageHash: hashBridgeMessageV1(destinationMessage),
    });
    expect(result.ok).toBe(true);
    expect(result.sourceEventParsed).toBe(true);
    expect(result.policyPassed).toBe(true);
    expect(result.signaturesProduced).toBe(1);
    expect(result.submitPreviewCreated).toBe(true);
    expect(result.destinationTxSubmitted).toBe(false);
    expect(store.list()).toHaveLength(1);

    const second = await runBridgeDaemonPaperReplay({
      config: baseConfig(stateDir),
      stateStore: store,
      sourceAdapter: sourceAdapter([makeEvent(message)]),
      signer: signer(),
      route: BASE_SEPOLIA_TO_SOLANA_DEVNET_ROUTE,
      fromBlock: 80n,
      toBlock: 120n,
      expectedSourceMessageHash: hashBridgeMessageV1(message),
      expectedDestinationMessageHash: hashBridgeMessageV1(destinationMessage),
    });
    expect(second.ok).toBe(true);
    expect(store.list()).toHaveLength(1);
  });

  test('replay rejects live submit, unbounded ranges, hash mismatch, and expired messages safely', async () => {
    const stateDir = tmpDir('bridge-replay-blocks');
    const message = makeBaseToSolanaMessage();
    const liveSubmit = await runBridgeDaemonPaperReplay({
      config: { ...baseConfig(stateDir), allowLiveTestnetSubmit: true },
      stateStore: new BridgeStateStore(stateDir),
      sourceAdapter: sourceAdapter([makeEvent(message)]),
      signer: signer(),
      route: BASE_SEPOLIA_TO_SOLANA_DEVNET_ROUTE,
      fromBlock: 1n,
      toBlock: 2n,
    });
    expect(liveSubmit.blocker).toBe('live_submit_must_be_disabled');

    const range = await runBridgeDaemonPaperReplay({
      config: baseConfig(stateDir),
      stateStore: new BridgeStateStore(stateDir),
      sourceAdapter: sourceAdapter([makeEvent(message)]),
      signer: signer(),
      route: BASE_SEPOLIA_TO_SOLANA_DEVNET_ROUTE,
      fromBlock: 1n,
      toBlock: 600n,
    });
    expect(range.blocker).toBe('replay_range_not_bounded');

    const mismatch = await runBridgeDaemonPaperReplay({
      config: baseConfig(stateDir),
      stateStore: new BridgeStateStore(stateDir),
      sourceAdapter: sourceAdapter([makeEvent(message)]),
      signer: signer(),
      route: BASE_SEPOLIA_TO_SOLANA_DEVNET_ROUTE,
      fromBlock: 80n,
      toBlock: 120n,
      expectedSourceMessageHash: `0x${hex('aa')}`,
    });
    expect(mismatch.blocker).toBe('expected_message_hash_not_found');

    const expired = makeBaseToSolanaMessage({
      deadline: Math.floor(Date.now() / 1000) - 1,
    });
    const expiredStateDir = tmpDir('bridge-replay-expired');
    const expiredResult = await runBridgeDaemonPaperReplay({
      config: baseConfig(expiredStateDir),
      stateStore: new BridgeStateStore(expiredStateDir),
      sourceAdapter: sourceAdapter([makeEvent(expired)]),
      signer: signer(),
      route: BASE_SEPOLIA_TO_SOLANA_DEVNET_ROUTE,
      fromBlock: 80n,
      toBlock: 120n,
    });
    expect(expiredResult.status).toBe('rejected');
    expect(expiredResult.expiredDeadline).toBe(true);
    expect(expiredResult.signaturesProduced).toBe(0);
    expect(expiredResult.destinationTxSubmitted).toBe(false);
  });
});
