/**
 * Bridge daemon tests — PR-011G.
 */

import * as os from 'os';
import * as path from 'path';
import express from 'express';
import { PassThrough } from 'stream';
import {
  BridgeDaemon,
  buildEvmSubmitPreview,
  buildSolanaSubmitPreview,
  loadBridgeDaemonConfigFromEnv,
} from '../daemon';
import { BridgeStateStore } from '../state';
import { BridgeWatcherFindingStore } from '../watcher-store';
import { createBridgeStatusRouter } from '../status-api';
import { LocalDevSignerAdapter, BridgeSignerService } from '../signer';
import {
  BridgeMessageStatus,
  type BridgeDestinationAdapter,
  type BridgeEventObservation,
  type BridgeRouteConfig,
} from '../types';
import {
  BridgeMessageType,
  buildDestinationBridgeMintMessageFromSourceBridgeOut,
  encodeBridgeMessageV1,
  hashBridgeMessageV1,
  type BridgeMessageV1,
} from '@thewhiteprotocol/core';
import { BASE_SEPOLIA_TO_SOLANA_DEVNET_ROUTE } from '../base-to-solana-route';

const TEST_PRIVATE_KEY =
  '0x0000000000000000000000000000000000000000000000000000000000000001';

function tmpDir(name: string): string {
  return path.join(os.tmpdir(), `${name}-${Date.now()}-${Math.random()}`);
}

function hex(byte: string): string {
  return byte.repeat(32);
}

function makeEvmMessage(overrides: Partial<BridgeMessageV1> = {}): BridgeMessageV1 {
  const now = Math.floor(Date.now() / 1000);
  return {
    protocolVersion: 1,
    messageType: BridgeMessageType.BridgeOut,
    sourceDomain: 0x02000002,
    destinationDomain: 0x02000003,
    sourceChainId: 84532,
    destinationChainId: 11155111,
    canonicalAssetId: hex('01'),
    sourceLocalAssetId: hex('02'),
    destinationLocalAssetId: hex('03'),
    amount: 1_000_000n,
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

function makeBaseToSolanaMessage(amount = 1_000_000_000_000_000n): BridgeMessageV1 {
  return makeEvmMessage({
    destinationDomain: 0x01000002,
    destinationChainId: 0,
    canonicalAssetId: '00fb58d8ea79c42a023685014b8281e7508bd5ca5f570f336f5852a291d54a70',
    sourceLocalAssetId: '00fb58d8ea79c42a023685014b8281e7508bd5ca5f570f336f5852a291d54a70',
    destinationLocalAssetId: '004a067d98373879008ada3415ad678dcd5354c0b29b52233a604774c94a82e0',
    amount,
  });
}

function makeSolanaMessage(overrides: Partial<BridgeMessageV1> = {}): BridgeMessageV1 {
  const now = Math.floor(Date.now() / 1000);
  return {
    protocolVersion: 1,
    messageType: BridgeMessageType.BridgeOut,
    sourceDomain: 0x01000002,
    destinationDomain: 0x02000002,
    sourceChainId: 0,
    destinationChainId: 84532,
    canonicalAssetId: hex('11'),
    sourceLocalAssetId: hex('12'),
    destinationLocalAssetId: hex('13'),
    amount: 1000n,
    sourceNullifierHash: hex('14'),
    destinationCommitment: hex('15'),
    sourceRoot: hex('16'),
    sourceLeafIndex: 1,
    sourceTxHash: hex('17'),
    sourceBlockNumber: 200,
    sourceFinalityBlock: 232,
    nonce: 5,
    deadline: now + 86_400,
    relayerFee: 0n,
    recipientStealthMetadataHash: hex('00'),
    memoHash: hex('00'),
    reserved0: hex('00'),
    reserved1: hex('00'),
    ...overrides,
  };
}

function makeEvent(
  message: BridgeMessageV1,
  overrides: Partial<BridgeEventObservation> = {}
): BridgeEventObservation {
  const encoded = encodeBridgeMessageV1(message);
  return {
    messageHash: hashBridgeMessageV1(message),
    destinationDomain: message.destinationDomain,
    canonicalAssetId: message.canonicalAssetId,
    amount: message.amount,
    nonce: message.nonce,
    encodedMessage: `0x${Array.from(encoded)
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('')}`,
    txHash: '0xsourceTx',
    blockNumber: message.sourceBlockNumber,
    confirmations: 10,
    sourceTxSucceeded: true,
    sourceEventKind: 'evm_bridge_out_v1',
    ...overrides,
  };
}

function evmRoute(destination = 'ethereum-sepolia'): BridgeRouteConfig {
  return {
    source: 'base-sepolia',
    destination,
    enabled: true,
    signerSetVersion: 1,
  };
}

function baseToSolanaRoute(): BridgeRouteConfig {
  return BASE_SEPOLIA_TO_SOLANA_DEVNET_ROUTE;
}

function solanaRoute(): BridgeRouteConfig {
  return {
    source: 'solana-devnet',
    destination: 'base-sepolia',
    enabled: true,
    signerSetVersion: 1,
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

function makeDaemon(options: {
  stateDir?: string;
  mode?: 'disabled' | 'paper' | 'live-testnet';
  allowLiveTestnetSubmit?: boolean;
  allowLocalDevSignerInLiveTestnet?: boolean;
  routes?: BridgeRouteConfig[];
  findingStore?: BridgeWatcherFindingStore;
  destinationAdapters?: Record<string, BridgeDestinationAdapter>;
} = {}) {
  const stateDir = options.stateDir ?? tmpDir('bridge-daemon-test');
  const stateStore = new BridgeStateStore(stateDir);
  const findingStore = options.findingStore ?? new BridgeWatcherFindingStore(stateDir);
  const daemon = new BridgeDaemon({
    config: {
      mode: options.mode ?? 'paper',
      intervalMs: 10_000,
      allowLiveTestnetSubmit: options.allowLiveTestnetSubmit ?? false,
      allowLocalDevSignerInLiveTestnet: options.allowLocalDevSignerInLiveTestnet ?? false,
      routes: options.routes ?? [evmRoute()],
      stateDir,
      signerThreshold: 1,
      signerSetVersion: 1,
      submitTargets: {
        'ethereum-sepolia': '0x1111111111111111111111111111111111111111',
        'base-sepolia': '0x2222222222222222222222222222222222222222',
        'solana-devnet': 'DAoezX29ingBicFfrqboD7xBeLro2b6RL77dhEbXivVD',
      },
    },
    stateStore,
    findingStore,
    signer: signer(),
    destinationAdapters: options.destinationAdapters,
  });
  return { daemon, stateStore, findingStore };
}

async function invokeApp(
  app: express.Application,
  pathName: string,
  init: { method?: string; headers?: Record<string, string> } = {}
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const req = new PassThrough() as any;
    req.method = init.method ?? 'GET';
    req.url = pathName;
    req.headers = Object.fromEntries(
      Object.entries(init.headers ?? {}).map(([key, value]) => [key.toLowerCase(), value])
    );
    req.connection = { encrypted: false };

    const res = new PassThrough() as any;
    res.statusCode = 200;
    res.headers = {};
    res.setHeader = (key: string, value: string) => {
      res.headers[key.toLowerCase()] = value;
    };
    res.getHeader = (key: string) => res.headers[key.toLowerCase()];
    res.removeHeader = (key: string) => {
      delete res.headers[key.toLowerCase()];
    };
    res.status = (code: number) => {
      res.statusCode = code;
      return res;
    };
    res.json = (body: unknown) => {
      resolve({ status: res.statusCode, body });
      return res;
    };
    res.send = (body: unknown) => {
      resolve({ status: res.statusCode, body });
      return res;
    };
    res.end = () => {
      resolve({ status: res.statusCode, body: undefined });
      return res;
    };

    req.push(null);
    (app as any).handle(req, res, (err: unknown) => {
      if (err) reject(err);
      else resolve({ status: res.statusCode, body: undefined });
    });
  });
}

describe('BridgeDaemon', () => {
  test('daemon is disabled by default', () => {
    const config = loadBridgeDaemonConfigFromEnv({});
    expect(config.mode).toBe('disabled');
    expect(config.allowLiveTestnetSubmit).toBe(false);
    expect(config.intervalMs).toBe(30_000);
  });

  test('paper mode observes valid event and reaches paper_ready_to_submit without submit', async () => {
    let submitted = false;
    const { daemon, stateStore } = makeDaemon({
      destinationAdapters: {
        'ethereum-sepolia': {
          isMessageConsumed: async () => false,
          submitAcceptBridgeMint: async () => {
            submitted = true;
            return '0xsubmitted';
          },
        },
      },
    });
    const message = makeEvmMessage();
    daemon.recordObservation({
      event: makeEvent(message),
      sourceChain: 'base-sepolia',
      destinationChain: 'ethereum-sepolia',
    });

    const result = await daemon.tick();
    const state = stateStore.get(hashBridgeMessageV1(message));

    expect(result.signed).toBe(1);
    expect(result.previews).toBe(1);
    expect(result.submitted).toBe(0);
    expect(submitted).toBe(false);
    expect(state?.status).toBe(BridgeMessageStatus.PAPER_READY_TO_SUBMIT);
    expect(state?.wouldSubmit).toBe(true);
    expect(state?.submitTxHash).toBeUndefined();
  });

  test('live-testnet mode does not submit unless explicit flag is set', async () => {
    let submitted = false;
    const { daemon, stateStore } = makeDaemon({
      mode: 'live-testnet',
      allowLiveTestnetSubmit: false,
      allowLocalDevSignerInLiveTestnet: true,
      destinationAdapters: {
        'ethereum-sepolia': {
          isMessageConsumed: async () => false,
          submitAcceptBridgeMint: async () => {
            submitted = true;
            return '0xsubmitted';
          },
        },
      },
    });
    const message = makeEvmMessage();
    daemon.recordObservation({
      event: makeEvent(message),
      sourceChain: 'base-sepolia',
      destinationChain: 'ethereum-sepolia',
    });

    await daemon.tick();
    const state = stateStore.get(hashBridgeMessageV1(message));
    expect(submitted).toBe(false);
    expect(state?.status).toBe(BridgeMessageStatus.PAPER_READY_TO_SUBMIT);
    expect(state?.lastError).toBe('live_testnet_submit_flag_disabled');
  });

  test('live-testnet mode submits only with explicit flag and test override', async () => {
    let submittedSignatures = 0;
    const { daemon, stateStore } = makeDaemon({
      mode: 'live-testnet',
      allowLiveTestnetSubmit: true,
      allowLocalDevSignerInLiveTestnet: true,
      destinationAdapters: {
        'ethereum-sepolia': {
          isMessageConsumed: async () => false,
          submitAcceptBridgeMint: async (_message, signatures) => {
            submittedSignatures = signatures.length;
            return '0xliveTestnetTx';
          },
        },
      },
    });
    const message = makeEvmMessage();
    daemon.recordObservation({
      event: makeEvent(message),
      sourceChain: 'base-sepolia',
      destinationChain: 'ethereum-sepolia',
    });

    const result = await daemon.tick();
    const state = stateStore.get(hashBridgeMessageV1(message));
    expect(result.submitted).toBe(1);
    expect(submittedSignatures).toBe(1);
    expect(state?.status).toBe(BridgeMessageStatus.CONFIRMED);
    expect(state?.submitTxHash).toBe('0xliveTestnetTx');
  });

  test('mainnet or unknown chains are blocked in live-testnet mode', async () => {
    const message = makeEvmMessage({ destinationDomain: 1, destinationChainId: 1 });
    const { daemon, stateStore } = makeDaemon({
      mode: 'live-testnet',
      allowLiveTestnetSubmit: true,
      allowLocalDevSignerInLiveTestnet: true,
      routes: [evmRoute('ethereum')],
    });
    daemon.recordObservation({
      event: makeEvent(message),
      sourceChain: 'base-sepolia',
      destinationChain: 'ethereum',
    });

    await daemon.tick();
    const state = stateStore.list()[0];
    expect(state.status).toBe(BridgeMessageStatus.PAPER_READY_TO_SUBMIT);
    expect(state.lastError).toBe('mainnet_or_unknown_route_blocked');
    expect(daemon.getStatus().routes[0].testnetOnly).toBe(false);
  });

  test('unsafe Solana init_bridge_v1_out is ignored', async () => {
    const { daemon, stateStore } = makeDaemon({ routes: [solanaRoute()] });
    const message = makeSolanaMessage();
    daemon.recordObservation({
      event: makeEvent(message, {
        sourceEventKind: 'solana_init_bridge_v1_out',
        confirmations: 40,
      }),
      sourceChain: 'solana-devnet',
      destinationChain: 'base-sepolia',
    });

    await daemon.tick();
    const state = stateStore.get(hashBridgeMessageV1(message));
    expect(state?.status).toBe(BridgeMessageStatus.IGNORED);
    expect(state?.lastError).toContain('unsafe_solana_init_bridge_v1_out');
  });

  test('Solana bridge_out_v1_with_proof is accepted', async () => {
    const { daemon, stateStore } = makeDaemon({ routes: [solanaRoute()] });
    const message = makeSolanaMessage();
    daemon.recordObservation({
      event: makeEvent(message, {
        sourceEventKind: 'solana_bridge_out_v1_with_proof',
        sourceBoundProofMarker: 'bridge_out_v1_with_proof',
        confirmations: 40,
      }),
      sourceChain: 'solana-devnet',
      destinationChain: 'base-sepolia',
    });

    await daemon.tick();
    const state = stateStore.get(hashBridgeMessageV1(message));
    expect(state?.status).toBe(BridgeMessageStatus.PAPER_READY_TO_SUBMIT);
    expect(state?.signatures).toHaveLength(1);
  });

  test('EVM bridgeOutV1 is accepted', async () => {
    const { daemon, stateStore } = makeDaemon();
    const message = makeEvmMessage();
    daemon.recordObservation({
      event: makeEvent(message, { sourceEventKind: 'evm_bridge_out_v1' }),
      sourceChain: 'base-sepolia',
      destinationChain: 'ethereum-sepolia',
    });

    await daemon.tick();
    const state = stateStore.get(hashBridgeMessageV1(message));
    expect(state?.status).toBe(BridgeMessageStatus.PAPER_READY_TO_SUBMIT);
  });

  test('finality not reached waits without signing', async () => {
    const { daemon, stateStore } = makeDaemon();
    const message = makeEvmMessage();
    daemon.recordObservation({
      event: makeEvent(message, { confirmations: 1 }),
      sourceChain: 'base-sepolia',
      destinationChain: 'ethereum-sepolia',
    });

    await daemon.tick();
    const state = stateStore.get(hashBridgeMessageV1(message));
    expect(state?.status).toBe(BridgeMessageStatus.FINALITY_WAIT);
    expect(state?.signatures).toHaveLength(0);
  });

  test('watcher critical finding blocks signing and submission', async () => {
    const stateDir = tmpDir('bridge-daemon-critical-finding');
    const findingStore = new BridgeWatcherFindingStore(stateDir);
    const message = makeEvmMessage();
    findingStore.upsert({
      messageHash: hashBridgeMessageV1(message),
      sourceChain: 'base-sepolia',
      destinationChain: 'ethereum-sepolia',
      severity: 'critical',
      code: 'test_critical',
      reason: 'critical test finding',
      recommendedAction: 'freeze',
      evidence: { safe: true },
      dryRun: true,
    });
    const { daemon, stateStore } = makeDaemon({ stateDir, findingStore });
    daemon.recordObservation({
      event: makeEvent(message),
      sourceChain: 'base-sepolia',
      destinationChain: 'ethereum-sepolia',
    });

    await daemon.tick();
    const state = stateStore.get(hashBridgeMessageV1(message));
    expect(state?.status).toBe(BridgeMessageStatus.FROZEN_OR_BLOCKED);
    expect(state?.lastError).toBe('open_critical_watcher_finding');
    expect(state?.signatures).toHaveLength(0);
  });

  test('unsupported route is blocked before signing', async () => {
    const { daemon, stateStore } = makeDaemon({ routes: [] });
    const message = makeEvmMessage();
    daemon.recordObservation({
      event: makeEvent(message),
      sourceChain: 'base-sepolia',
      destinationChain: 'ethereum-sepolia',
    });

    const result = await daemon.tick();
    expect(result.blocked).toBe(1);
    expect(stateStore.list()).toHaveLength(0);
  });

  test('signer adapter signs only after policy pass', async () => {
    const { daemon, stateStore } = makeDaemon();
    const valid = makeEvmMessage({ nonce: 100 });
    const notFinal = makeEvmMessage({ nonce: 101 });
    daemon.recordObservation({
      event: makeEvent(valid),
      sourceChain: 'base-sepolia',
      destinationChain: 'ethereum-sepolia',
    });
    daemon.recordObservation({
      event: makeEvent(notFinal, { confirmations: 0 }),
      sourceChain: 'base-sepolia',
      destinationChain: 'ethereum-sepolia',
    });

    await daemon.tick();
    const states = stateStore.list();
    expect(states.filter((state) => state.signatures.length === 1)).toHaveLength(1);
    expect(states.filter((state) => state.status === BridgeMessageStatus.FINALITY_WAIT)).toHaveLength(1);
  });

  test('EVM submit preview is created', () => {
    const preview = buildEvmSubmitPreview({
      destinationChain: 'ethereum-sepolia',
      target: '0x1111111111111111111111111111111111111111',
      messageHash: `0x${hex('aa')}`,
      signerSetVersion: 1,
      signatureCount: 2,
      route: 'base-sepolia->ethereum-sepolia',
      dryRun: true,
      wouldSubmit: true,
    });
    expect(preview.family).toBe('evm');
    expect(preview.method).toBe('acceptBridgeMint');
    expect(preview.evm?.calldataPreview).toContain('acceptBridgeMint');
  });

  test('Solana submit preview is created for Base to Solana paper route', async () => {
    const { daemon, stateStore } = makeDaemon({ routes: [baseToSolanaRoute()] });
    const message = makeBaseToSolanaMessage();
    const sourceHash = hashBridgeMessageV1(message);
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
    const destinationHash = hashBridgeMessageV1(destinationMessage);
    daemon.recordObservation({
      event: makeEvent(message),
      sourceChain: 'base-sepolia',
      destinationChain: 'solana-devnet',
    });

    await daemon.tick();
    const state = stateStore.list()[0];
    expect(state.status).toBe(BridgeMessageStatus.PAPER_READY_TO_SUBMIT);
    expect(sourceHash).not.toBe(destinationHash);
    expect(state.messageHash).toBe(destinationHash);
    expect(state.sourceMessageHash).toBe(sourceHash);
    expect(state.destinationMessageHash).toBe(destinationHash);
    expect(state.submissionPreview?.family).toBe('solana');
    expect(state.submissionPreview?.messageHash).toBe(destinationHash);
    expect(state.submissionPreview?.sourceMessageHash).toBe(sourceHash);
    expect(state.signatureMetadata?.signerSetVersion).toBe(2);
    expect(state.submissionPreview?.signerSetVersion).toBe(2);
    expect((state.submissionPreview?.solana as any).instruction).toBe('accept_bridge_v1_mint');
    expect((state.submissionPreview?.solana as any).destinationMessageHash).toBe(destinationHash);
    expect((state.submissionPreview?.solana as any).sourceMessageHash).toBe(sourceHash);
    expect((state.submissionPreview?.solana as any).accounts.signerSet).toBe('7Emf7vYUY9mpkzBfnzWKJ4B9PNqqrMzr5wyuUc8ap4XK');
    expect((state.submissionPreview?.solana as any).accounts.poolConfig).toBe('DZLJU6MAeWZ7aGLyt2j7Jq2XnNq2ch6jUAVgKmki9HaF');
    expect((state.submissionPreview?.solana as any).accounts.merkleTree).toBe('7rNj4NVMyaNFSL9ius2hej2rpzk88d7spXrbYFchhnPi');
    expect((state.submissionPreview?.solana as any).accounts.assetVault).toBe('4Wb17Qbxm74i4BNLZ6CejXtaijLFRSre5wWKAzwWkaXD');
    expect((state.submissionPreview?.solana as any).accounts.pendingBuffer).toBe('9oEKYL8iD7mBdvPzrgtv8Q15QqAWUL9ycSGAkt5QT42s');
    const nonSystemAccounts = Object.entries((state.submissionPreview?.solana as any).accounts)
      .filter(([name]) => name !== 'systemProgram')
      .map(([, value]) => value);
    expect(nonSystemAccounts).not.toContain('11111111111111111111111111111111');
    expect((state.submissionPreview?.solana as any).transactionAssemblyImplemented).toBe(true);
    expect((state.submissionPreview?.solana as any).computeBudgetIncluded).toBe(true);
    expect((state.submissionPreview?.solana as any).serializedLength).toBeGreaterThan(0);
    expect((state.submissionPreview?.solana as any).accountMetaValidation.valid).toBe(true);
    expect((state.submissionPreview?.solana as any).liveSubmissionImplemented).toBe(false);
    expect((state.submissionPreview?.solana as any).readiness.status).toBe('blocked_live_submit_not_implemented');
  });

  test('Solana submit preview helper includes expected accounts', () => {
    const message = makeBaseToSolanaMessage();
    const preview = buildSolanaSubmitPreview({
      destinationChain: 'solana-devnet',
      message,
      messageHash: hashBridgeMessageV1(message),
      signerSetVersion: 2,
      signatureCount: 2,
      route: 'base-sepolia->solana-devnet',
      dryRun: true,
      wouldSubmit: true,
      solanaDestination: BASE_SEPOLIA_TO_SOLANA_DEVNET_ROUTE.solanaDestination,
    });
    expect(preview.solana?.accounts.consumedMessage).toBeTruthy();
    expect(preview.solana?.accounts.frozenMessage).toBeTruthy();
    expect(preview.solana?.accounts.signerSet).toBe('7Emf7vYUY9mpkzBfnzWKJ4B9PNqqrMzr5wyuUc8ap4XK');
  });

  test('env route loads Base to Solana signer set and deployed account metadata', () => {
    const config = loadBridgeDaemonConfigFromEnv({
      BRIDGE_DAEMON_MODE: 'paper',
      BRIDGE_DAEMON_ROUTES: 'base-sepolia:solana-devnet',
    });
    expect(config.routes[0].signerSetVersion).toBe(2);
    expect(config.routes[0].assets?.[0].destinationDecimals).toBe(9);
    expect(config.routes[0].solanaDestination?.poolConfig).toBe('DZLJU6MAeWZ7aGLyt2j7Jq2XnNq2ch6jUAVgKmki9HaF');
  });

  test('state persists transitions', async () => {
    const stateDir = tmpDir('bridge-daemon-state');
    const { daemon } = makeDaemon({ stateDir });
    const message = makeEvmMessage();
    daemon.recordObservation({
      event: makeEvent(message),
      sourceChain: 'base-sepolia',
      destinationChain: 'ethereum-sepolia',
    });

    await daemon.tick();
    const reloaded = new BridgeStateStore(stateDir).get(hashBridgeMessageV1(message));
    expect(reloaded?.daemonTransitions?.map((item) => item.status)).toEqual(
      expect.arrayContaining([
        BridgeMessageStatus.OBSERVED,
        BridgeMessageStatus.POLICY_CHECKED,
        BridgeMessageStatus.READY_TO_SIGN,
        BridgeMessageStatus.SIGNED,
        BridgeMessageStatus.PAPER_READY_TO_SUBMIT,
      ])
    );
  });

  test('operator tick endpoint requires auth', async () => {
    const { daemon, stateStore } = makeDaemon();
    const app = express();
    app.use(express.json());
    app.use(
      createBridgeStatusRouter({
        stateStore,
        routes: [evmRoute()],
        bridgeDaemon: daemon,
        operatorApiToken: 'operator-token',
      })
    );

    const unauthorized = await invokeApp(app, '/bridge/daemon/tick', { method: 'POST' });
    const authorized = await invokeApp(app, '/bridge/daemon/tick', {
      method: 'POST',
      headers: { authorization: 'Bearer operator-token' },
    });
    expect(unauthorized.status).toBe(401);
    expect(authorized.status).toBe(200);
    expect(authorized.body.enabled).toBe(true);
  });

  test('status endpoint redacts secrets', async () => {
    const { daemon, stateStore } = makeDaemon();
    const app = express();
    app.use(express.json());
    app.use(
      createBridgeStatusRouter({
        stateStore,
        routes: [evmRoute()],
        bridgeDaemon: daemon,
        operatorApiToken: 'operator-token',
      })
    );

    const response = await invokeApp(app, '/bridge/daemon/status');
    const serialized = JSON.stringify(response.body);
    expect(response.status).toBe(200);
    expect(serialized).not.toContain('operator-token');
    expect(serialized).not.toContain(TEST_PRIVATE_KEY);
    expect(serialized).not.toContain('BRIDGE_SIGNER_PRIVATE_KEYS');
  });
});
