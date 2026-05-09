import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { PassThrough } from 'stream';
import express from 'express';
import {
  BridgeMessageType,
  encodeBridgeMessageV1,
  hashBridgeMessageV1,
  type BridgeMessageV1,
} from '@thewhiteprotocol/core';
import { BridgeStateStore } from '../state';
import { BridgeMessageStatus, type BridgeEventObservation, type BridgeMessageState, type BridgeRouteAssetConfig, type BridgeRouteConfig } from '../types';
import { BridgeWatcherFindingStore } from '../watcher-store';
import {
  BridgeWatcherDaemon,
  loadBridgeWatcherDaemonConfigFromEnv,
} from '../watcher-daemon';
import { BridgeFreezeActionBuilder, type BridgeFreezePreview } from '../freeze-actions';
import { createBridgeStatusRouter } from '../status-api';
import {
  BridgeAlerter,
  buildBridgeAlertPayload,
  loadBridgeAlertConfigFromEnv,
  type BridgeAlertPayload,
  type BridgeAlertSink,
} from '../alerts';

const BASE_DOMAIN = 0x02000002;
const ETHEREUM_DOMAIN = 0x02000003;
const SOLANA_DOMAIN = 0x01000002;
const BASE_CHAIN_ID = 84532;
const ETHEREUM_CHAIN_ID = 11155111;
const SOLANA_CHAIN_ID = 0;
const SOLANA_PROGRAM_ID = 'DAoezX29ingBicFfrqboD7xBeLro2b6RL77dhEbXivVD';
const BASE_ASSET =
  '00fb58d8ea79c42a023685014b8281e7508bd5ca5f570f336f5852a291d54a70';
const SOLANA_ASSET =
  '004a067d98373879008ada3415ad678dcd5354c0b29b52233a604774c94a82e0';

const SAME_DECIMAL_ASSET: BridgeRouteAssetConfig = {
  canonicalAssetId: BASE_ASSET,
  sourceDecimals: 18,
  destinationDecimals: 18,
  normalizationMode: 'exact-decimal',
  maxMessageAmount: 5_000_000_000_000_000_000n,
  dailyCap: 10_000_000_000_000_000_000n,
  capAmountUnits: 'source',
};

const BASE_TO_SOLANA_ASSET: BridgeRouteAssetConfig = {
  canonicalAssetId: BASE_ASSET,
  sourceDecimals: 18,
  destinationDecimals: 9,
  normalizationMode: 'exact-decimal',
  maxMessageAmount: 10_000_000_000_000n,
  dailyCap: 100_000_000_000_000n,
  capAmountUnits: 'destination',
};

const SOLANA_TO_BASE_ASSET: BridgeRouteAssetConfig = {
  canonicalAssetId: SOLANA_ASSET,
  sourceDecimals: 9,
  destinationDecimals: 18,
  normalizationMode: 'exact-decimal',
  maxMessageAmount: 10_000_000n,
  dailyCap: 100_000_000n,
  capAmountUnits: 'source',
};

class CountingFreezeActions extends BridgeFreezeActionBuilder {
  submitCount = 0;

  async submitFreeze(preview: BridgeFreezePreview): Promise<{ txHash: string }> {
    this.submitCount += 1;
    return { txHash: `${preview.messageHash}:submitted` };
  }
}

class RecordingAlertSink implements BridgeAlertSink {
  payloads: BridgeAlertPayload[] = [];

  async send(payload: BridgeAlertPayload): Promise<void> {
    this.payloads.push(payload);
  }
}

function routes(asset = SAME_DECIMAL_ASSET): BridgeRouteConfig[] {
  return [
    {
      source: 'base-sepolia',
      destination: 'ethereum-sepolia',
      enabled: true,
      signerSetVersion: 1,
      assets: [asset],
    },
    {
      source: 'base-sepolia',
      destination: 'solana-devnet',
      enabled: true,
      signerSetVersion: 1,
      assets: [BASE_TO_SOLANA_ASSET],
    },
    {
      source: 'solana-devnet',
      destination: 'base-sepolia',
      enabled: true,
      signerSetVersion: 1,
      assets: [SOLANA_TO_BASE_ASSET],
    },
  ];
}

function finality() {
  return {
    'base-sepolia': { confirmations: 3, maxAgeSeconds: 86_400 },
    'solana-devnet': { confirmations: 32, maxAgeSeconds: 86_400 },
  };
}

function makeMessage(overrides: Partial<BridgeMessageV1> = {}): BridgeMessageV1 {
  return {
    protocolVersion: 1,
    messageType: BridgeMessageType.BridgeOut,
    sourceDomain: BASE_DOMAIN,
    destinationDomain: ETHEREUM_DOMAIN,
    sourceChainId: BASE_CHAIN_ID,
    destinationChainId: ETHEREUM_CHAIN_ID,
    canonicalAssetId: BASE_ASSET,
    sourceLocalAssetId: BASE_ASSET,
    destinationLocalAssetId: BASE_ASSET,
    amount: 1_000_000_000_000_000n,
    sourceNullifierHash: '0'.repeat(63) + '2',
    destinationCommitment: '0'.repeat(63) + '3',
    sourceRoot: '0'.repeat(63) + '4',
    sourceLeafIndex: 7,
    sourceTxHash: '0'.repeat(63) + '5',
    sourceBlockNumber: 100,
    sourceFinalityBlock: 103,
    nonce: 42,
    deadline: 1_800_086_400,
    relayerFee: 0n,
    recipientStealthMetadataHash: '0'.repeat(64),
    memoHash: '0'.repeat(64),
    reserved0: '0'.repeat(64),
    reserved1: '0'.repeat(64),
    ...overrides,
  };
}

function makeSolanaMessage(overrides: Partial<BridgeMessageV1> = {}): BridgeMessageV1 {
  return makeMessage({
    sourceDomain: SOLANA_DOMAIN,
    destinationDomain: BASE_DOMAIN,
    sourceChainId: SOLANA_CHAIN_ID,
    destinationChainId: BASE_CHAIN_ID,
    canonicalAssetId: SOLANA_ASSET,
    sourceLocalAssetId: SOLANA_ASSET,
    destinationLocalAssetId: BASE_ASSET,
    amount: 1_000_000n,
    sourceFinalityBlock: 132,
    ...overrides,
  });
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
    encodedMessage:
      '0x' + Array.from(encoded).map((b) => b.toString(16).padStart(2, '0')).join(''),
    txHash: '0xsourceTx',
    blockNumber: message.sourceBlockNumber,
    sourceEventKind: 'evm_bridge_out_v1',
    confirmations: 5,
    sourceTxSucceeded: true,
    ...overrides,
  };
}

function makeState(
  message: BridgeMessageV1,
  sourceChain = 'base-sepolia',
  destinationChain = 'ethereum-sepolia'
): BridgeMessageState {
  return {
    messageHash: hashBridgeMessageV1(message),
    sourceChain,
    destinationChain,
    sourceDomain: message.sourceDomain,
    destinationDomain: message.destinationDomain,
    sourceTxHash: '0xsourceTx',
    sourceBlockNumber: message.sourceBlockNumber,
    sourceFinalityBlock: message.sourceFinalityBlock,
    nonce: message.nonce,
    destinationCommitment: message.destinationCommitment,
    canonicalAssetId: message.canonicalAssetId,
    amount: message.amount.toString(),
    signatures: [],
    status: BridgeMessageStatus.OBSERVED,
    attempts: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    message,
  };
}

function makeDaemon(
  tmpDir: string,
  options: {
    enabled?: boolean;
    dryRun?: boolean;
    autoFreeze?: boolean;
    routeConfig?: BridgeRouteConfig[];
    freezeActions?: CountingFreezeActions;
    alerter?: BridgeAlerter;
    findingRetentionDays?: number;
  } = {}
) {
  const stateStore = new BridgeStateStore(tmpDir);
  const findingStore = new BridgeWatcherFindingStore(tmpDir);
  const freezeActions = options.freezeActions ?? new CountingFreezeActions();
  const daemon = new BridgeWatcherDaemon({
    stateStore,
    findingStore,
    routes: options.routeConfig ?? routes(),
    finality: finality(),
    context: { nowSeconds: 1_800_000_000 },
    config: {
      enabled: options.enabled ?? true,
      dryRun: options.dryRun ?? true,
      autoFreeze: options.autoFreeze ?? false,
      intervalMs: 10_000,
      maxFindingsPerTick: 50,
      findingRetentionDays: options.findingRetentionDays ?? 30,
    },
    freezeActions,
    alerter: options.alerter,
  });
  return { daemon, stateStore, findingStore, freezeActions };
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

describe('BridgeWatcherDaemon', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), `bridge-watcher-daemon-${Date.now()}-${Math.random()}`);
  });

  test('daemon is disabled by default and dry-run defaults to true', () => {
    const config = loadBridgeWatcherDaemonConfigFromEnv({});
    expect(config.enabled).toBe(false);
    expect(config.dryRun).toBe(true);
    expect(config.autoFreeze).toBe(false);
  });

  test('hosted watcher config parsing keeps safe defaults explicit', () => {
    const daemonConfig = loadBridgeWatcherDaemonConfigFromEnv({
      BRIDGE_WATCHER_ENABLED: 'true',
      BRIDGE_WATCHER_DRY_RUN: 'true',
      BRIDGE_WATCHER_INTERVAL_MS: '45000',
      BRIDGE_WATCHER_MAX_FINDINGS_PER_TICK: '25',
      BRIDGE_WATCHER_AUTO_FREEZE: 'false',
      BRIDGE_WATCHER_MIN_SEVERITY_TO_FREEZE: 'high',
      BRIDGE_WATCHER_FINDING_RETENTION_DAYS: '14',
    });
    const alertConfig = loadBridgeAlertConfigFromEnv({
      BRIDGE_ALERT_WEBHOOK_URL: 'mock-webhook-url',
      BRIDGE_ALERT_MIN_SEVERITY: 'critical',
      BRIDGE_ALERT_DRY_RUN: 'true',
    });

    expect(daemonConfig.enabled).toBe(true);
    expect(daemonConfig.dryRun).toBe(true);
    expect(daemonConfig.intervalMs).toBe(45_000);
    expect(daemonConfig.maxFindingsPerTick).toBe(25);
    expect(daemonConfig.autoFreeze).toBe(false);
    expect(daemonConfig.minSeverityToFreeze).toBe('high');
    expect(daemonConfig.findingRetentionDays).toBe(14);
    expect(alertConfig.webhookUrl).toBe('mock-webhook-url');
    expect(alertConfig.minSeverity).toBe('critical');
    expect(alertConfig.dryRun).toBe(true);
  });

  test('disabled daemon tick is a no-op', async () => {
    const { daemon } = makeDaemon(tmpDir, { enabled: false });
    const result = await daemon.tick();
    expect(result.enabled).toBe(false);
    expect(result.skipped).toContain('watcher_disabled');
  });

  test('tick evaluates messages and persists findings', async () => {
    const { daemon, stateStore, findingStore } = makeDaemon(tmpDir);
    const message = makeSolanaMessage();
    stateStore.set(makeState(message, 'solana-devnet', 'base-sepolia'));
    daemon.recordObservation({
      event: makeEvent(message, {
        sourceEventKind: 'solana_init_bridge_v1_out',
        confirmations: 40,
      }),
      message,
      sourceChain: 'solana-devnet',
      destinationChain: 'base-sepolia',
      context: { routes: routes(), finality: finality(), nowSeconds: 1_800_000_000 },
    });

    const result = await daemon.tick();
    expect(result.evaluated).toBe(1);
    expect(result.findingsPersisted).toBe(1);

    const reloaded = new BridgeWatcherFindingStore(tmpDir);
    expect(reloaded.list()).toHaveLength(1);
    expect(findingStore.list()[0].code).toBe('unsafe_solana_init_bridge_v1_out');
  });

  test('dry-run freeze recommendation does not submit transaction', async () => {
    const freezeActions = new CountingFreezeActions();
    const { daemon, stateStore } = makeDaemon(tmpDir, {
      autoFreeze: true,
      dryRun: true,
      freezeActions,
    });
    const message = makeSolanaMessage();
    stateStore.set(makeState(message, 'solana-devnet', 'base-sepolia'));
    daemon.recordObservation({
      event: makeEvent(message, {
        sourceEventKind: 'solana_init_bridge_v1_out',
        confirmations: 40,
      }),
      message,
      sourceChain: 'solana-devnet',
      destinationChain: 'base-sepolia',
      context: { routes: routes(), finality: finality(), nowSeconds: 1_800_000_000 },
    });

    const result = await daemon.tick();
    expect(result.freezePreviews).toHaveLength(1);
    expect(result.freezeSubmissions).toHaveLength(0);
    expect(freezeActions.submitCount).toBe(0);
  });

  test('auto-freeze false prevents transaction submission', async () => {
    const freezeActions = new CountingFreezeActions();
    const { daemon, stateStore } = makeDaemon(tmpDir, {
      autoFreeze: false,
      dryRun: false,
      freezeActions,
    });
    const message = makeSolanaMessage();
    stateStore.set(makeState(message, 'solana-devnet', 'base-sepolia'));
    daemon.recordObservation({
      event: makeEvent(message, {
        sourceEventKind: 'solana_init_bridge_v1_out',
        confirmations: 40,
      }),
      message,
      sourceChain: 'solana-devnet',
      destinationChain: 'base-sepolia',
      context: { routes: routes(), finality: finality(), nowSeconds: 1_800_000_000 },
    });

    await daemon.tick();
    expect(freezeActions.submitCount).toBe(0);
  });

  test('critical finding produces freeze recommendation', async () => {
    const { daemon, stateStore, findingStore } = makeDaemon(tmpDir);
    const message = makeSolanaMessage();
    stateStore.set(makeState(message, 'solana-devnet', 'base-sepolia'));
    daemon.recordObservation({
      event: makeEvent(message, {
        sourceEventKind: 'solana_init_bridge_v1_out',
        confirmations: 40,
      }),
      message,
      sourceChain: 'solana-devnet',
      destinationChain: 'base-sepolia',
      context: { routes: routes(), finality: finality(), nowSeconds: 1_800_000_000 },
    });
    await daemon.tick();
    expect(findingStore.list()[0].severity).toBe('critical');
    expect(findingStore.list()[0].recommendedAction).toBe('freeze');
  });

  test('duplicate finding is idempotent', async () => {
    const { daemon, stateStore, findingStore } = makeDaemon(tmpDir);
    const message = makeSolanaMessage();
    stateStore.set(makeState(message, 'solana-devnet', 'base-sepolia'));
    daemon.recordObservation({
      event: makeEvent(message, {
        sourceEventKind: 'solana_init_bridge_v1_out',
        confirmations: 40,
      }),
      message,
      sourceChain: 'solana-devnet',
      destinationChain: 'base-sepolia',
      context: { routes: routes(), finality: finality(), nowSeconds: 1_800_000_000 },
    });
    await daemon.tick();
    await daemon.tick();
    expect(findingStore.list()).toHaveLength(1);
  });

  test('acknowledged finding is not re-opened unless evidence changes', async () => {
    const { daemon, stateStore, findingStore } = makeDaemon(tmpDir);
    const message = makeSolanaMessage();
    stateStore.set(makeState(message, 'solana-devnet', 'base-sepolia'));
    daemon.recordObservation({
      event: makeEvent(message, {
        sourceEventKind: 'solana_init_bridge_v1_out',
        confirmations: 40,
      }),
      message,
      sourceChain: 'solana-devnet',
      destinationChain: 'base-sepolia',
      context: { routes: routes(), finality: finality(), nowSeconds: 1_800_000_000 },
    });
    await daemon.tick();
    const finding = findingStore.list()[0];
    findingStore.acknowledge(finding.findingId);
    await daemon.tick();
    expect(findingStore.get(finding.findingId)?.status).toBe('acknowledged');
  });

  test('retention cleanup removes old resolved and ignored findings', () => {
    const findingStore = new BridgeWatcherFindingStore(tmpDir);
    const old = Date.now() - 31 * 24 * 60 * 60 * 1000;
    const messageHash = hashBridgeMessageV1(makeMessage());
    const ignored = findingStore.upsert({
      messageHash,
      sourceChain: 'base-sepolia',
      destinationChain: 'ethereum-sepolia',
      severity: 'medium',
      code: 'old_ignored',
      reason: 'old ignored finding',
      recommendedAction: 'manual_review',
      dryRun: true,
      now: old,
      evidence: { reason: 'old' },
    });
    const resolved = findingStore.upsert({
      messageHash,
      sourceChain: 'base-sepolia',
      destinationChain: 'ethereum-sepolia',
      severity: 'low',
      code: 'old_resolved',
      reason: 'old resolved finding',
      recommendedAction: 'alert',
      dryRun: true,
      now: old,
      evidence: { reason: 'old' },
    });
    findingStore.updateStatus(ignored.findingId, 'ignored', { now: old });
    findingStore.updateStatus(resolved.findingId, 'resolved', { now: old });

    const cleanup = findingStore.cleanup(30, Date.now());
    expect(cleanup.deleted).toBe(2);
    expect(findingStore.list()).toHaveLength(0);
  });

  test('retention cleanup does not remove open critical findings', () => {
    const findingStore = new BridgeWatcherFindingStore(tmpDir);
    const old = Date.now() - 365 * 24 * 60 * 60 * 1000;
    findingStore.upsert({
      messageHash: hashBridgeMessageV1(makeSolanaMessage()),
      sourceChain: 'solana-devnet',
      destinationChain: 'base-sepolia',
      severity: 'critical',
      code: 'unsafe_solana_init_bridge_v1_out',
      reason: 'unsafe Solana event',
      recommendedAction: 'freeze',
      dryRun: true,
      now: old,
      evidence: { reason: 'unsafe' },
    });

    const cleanup = findingStore.cleanup(30, Date.now());
    expect(cleanup.deleted).toBe(0);
    expect(cleanup.retainedOpenCritical).toBe(1);
    expect(findingStore.list()).toHaveLength(1);
  });

  test('unsafe Solana init_bridge_v1_out creates finding', async () => {
    const { daemon, stateStore, findingStore } = makeDaemon(tmpDir);
    const message = makeSolanaMessage();
    stateStore.set(makeState(message, 'solana-devnet', 'base-sepolia'));
    daemon.recordObservation({
      event: makeEvent(message, {
        sourceEventKind: 'solana_init_bridge_v1_out',
        confirmations: 40,
      }),
      message,
      sourceChain: 'solana-devnet',
      destinationChain: 'base-sepolia',
      context: { routes: routes(), finality: finality(), nowSeconds: 1_800_000_000 },
    });
    await daemon.tick();
    expect(findingStore.list()[0].code).toBe('unsafe_solana_init_bridge_v1_out');
  });

  test('valid Solana bridge_out_v1_with_proof creates no finding', async () => {
    const { daemon, stateStore, findingStore } = makeDaemon(tmpDir);
    const message = makeSolanaMessage();
    stateStore.set(makeState(message, 'solana-devnet', 'base-sepolia'));
    daemon.recordObservation({
      event: makeEvent(message, {
        sourceEventKind: 'solana_bridge_out_v1_with_proof',
        sourceBoundProofMarker: 'bridge_out_v1_with_proof',
        sourceAddress: SOLANA_PROGRAM_ID,
        confirmations: 40,
      }),
      message,
      sourceChain: 'solana-devnet',
      destinationChain: 'base-sepolia',
      context: { routes: routes(), finality: finality(), nowSeconds: 1_800_000_000 },
    });
    await daemon.tick();
    expect(findingStore.list()).toHaveLength(0);
  });

  test('valid EVM bridgeOutV1 creates no finding', async () => {
    const { daemon, stateStore, findingStore } = makeDaemon(tmpDir);
    const message = makeMessage();
    stateStore.set(makeState(message));
    daemon.recordObservation({
      event: makeEvent(message, { sourceEventKind: 'evm_bridge_out_v1', confirmations: 5 }),
      message,
      sourceChain: 'base-sepolia',
      destinationChain: 'ethereum-sepolia',
      context: { routes: routes(), finality: finality(), nowSeconds: 1_800_000_000 },
    });
    await daemon.tick();
    expect(findingStore.list()).toHaveLength(0);
  });

  test('over-cap message creates finding', async () => {
    const cappedAsset = { ...SAME_DECIMAL_ASSET, maxMessageAmount: 100n, dailyCap: 1000n };
    const { daemon, stateStore, findingStore } = makeDaemon(tmpDir, {
      routeConfig: routes(cappedAsset),
    });
    const message = makeMessage({ amount: 10_000n });
    stateStore.set(makeState(message));
    daemon.recordObservation({
      event: makeEvent(message),
      message,
      sourceChain: 'base-sepolia',
      destinationChain: 'ethereum-sepolia',
      context: { routes: routes(cappedAsset), finality: finality(), nowSeconds: 1_800_000_000 },
    });
    await daemon.tick();
    expect(findingStore.list()[0].code).toBe('amount_over_max_message_amount');
  });

  test('finality-not-met message creates delay finding', async () => {
    const { daemon, stateStore, findingStore } = makeDaemon(tmpDir);
    const message = makeMessage();
    stateStore.set(makeState(message));
    daemon.recordObservation({
      event: makeEvent(message, { confirmations: 1 }),
      message,
      sourceChain: 'base-sepolia',
      destinationChain: 'ethereum-sepolia',
      context: { routes: routes(), finality: finality(), nowSeconds: 1_800_000_000 },
    });
    await daemon.tick();
    expect(findingStore.list()[0].code).toBe('source_not_final');
    expect(findingStore.list()[0].recommendedAction).toBe('delay');
  });

  test('cross-decimal mismatch creates finding', async () => {
    const { daemon, stateStore, findingStore } = makeDaemon(tmpDir);
    const message = makeMessage({
      destinationDomain: SOLANA_DOMAIN,
      destinationChainId: SOLANA_CHAIN_ID,
      destinationLocalAssetId: SOLANA_ASSET,
      amount: 1_000_000_000_000_000n,
    });
    const destinationMessage = {
      ...message,
      messageType: BridgeMessageType.BridgeMint,
      amount: 2_000_000n,
    };
    stateStore.set(makeState(message, 'base-sepolia', 'solana-devnet'));
    daemon.recordObservation({
      event: makeEvent(message),
      message,
      destinationMessage,
      sourceChain: 'base-sepolia',
      destinationChain: 'solana-devnet',
      context: { routes: routes(), finality: finality(), nowSeconds: 1_800_000_000 },
    });
    await daemon.tick();
    expect(findingStore.list()[0].code).toBe('cross_decimal_mismatch');
  });
});

describe('Bridge watcher alerting', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), `bridge-watcher-alerts-${Date.now()}-${Math.random()}`);
  });

  function createAlertFinding(severity: 'medium' | 'high' | 'critical' = 'high') {
    const store = new BridgeWatcherFindingStore(tmpDir);
    return store.upsert({
      messageHash: hashBridgeMessageV1(makeMessage()),
      sourceChain: 'base-sepolia',
      destinationChain: 'ethereum-sepolia',
      severity,
      code: 'amount_over_max_message_amount',
      reason: 'amount over cap',
      recommendedAction: 'freeze',
      dryRun: true,
      evidence: {
        rpcUrl: 'https://rpc.example/secret',
        privateKey: '[redacted-test-private-key]',
        event: { txHash: '0xabc', blockNumber: 100, confirmations: 5 },
        message: { sourceDomain: BASE_DOMAIN, destinationDomain: ETHEREUM_DOMAIN, amount: 1n },
        policyDecision: { action: 'reject', severity, reasons: ['amount_over_max_message_amount'] },
      },
    });
  }

  test('alert is no-op when URL is missing', async () => {
    const alerter = new BridgeAlerter(loadBridgeAlertConfigFromEnv({}));
    const result = await alerter.sendFindingAlert(createAlertFinding('high'));
    expect(result.sent).toBe(false);
    expect(result.reason).toBe('no_alert_sink');
    expect(alerter.getStatus().enabled).toBe(false);
  });

  test('webhook alert sends sanitized payload when configured', async () => {
    const originalFetch = (global as any).fetch;
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200 });
    (global as any).fetch = fetchMock;
    try {
      const finding = createAlertFinding('critical');
      const alerter = new BridgeAlerter(
        { webhookUrl: 'mock-webhook-url', minSeverity: 'high', dryRun: false },
      );
      const result = await alerter.sendFindingAlert(finding);
      expect(result.sent).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      const serialized = JSON.stringify(body);
      expect(body.findingId).toBe(finding.findingId);
      expect(body.severity).toBe('critical');
      expect(serialized).not.toContain('privateKey');
      expect(serialized).not.toContain('rpc.example');
      expect(serialized).not.toContain('mock-webhook-url');
    } finally {
      (global as any).fetch = originalFetch;
    }
  });

  test('alert severity threshold works', async () => {
    const sink = new RecordingAlertSink();
    const alerter = new BridgeAlerter({ minSeverity: 'high', dryRun: false }, sink);
    const result = await alerter.sendFindingAlert(createAlertFinding('medium'));
    expect(result.sent).toBe(false);
    expect(result.reason).toBe('below_severity_threshold');
    expect(sink.payloads).toHaveLength(0);
  });

  test('duplicate finding alert dedup works across ticks', async () => {
    const sink = new RecordingAlertSink();
    const alerter = new BridgeAlerter({ minSeverity: 'high', dryRun: false }, sink);
    const { daemon, stateStore } = makeDaemon(tmpDir, { alerter });
    const message = makeSolanaMessage();
    stateStore.set(makeState(message, 'solana-devnet', 'base-sepolia'));
    daemon.recordObservation({
      event: makeEvent(message, {
        sourceEventKind: 'solana_init_bridge_v1_out',
        confirmations: 40,
      }),
      message,
      sourceChain: 'solana-devnet',
      destinationChain: 'base-sepolia',
      context: { routes: routes(), finality: finality(), nowSeconds: 1_800_000_000 },
    });

    const first = await daemon.tick();
    const second = await daemon.tick();

    expect(first.alertsSent).toBe(1);
    expect(second.alertsSent).toBe(0);
    expect(sink.payloads).toHaveLength(1);
  });

  test('alert payload builder returns sanitized evidence summary', () => {
    const payload = buildBridgeAlertPayload(createAlertFinding('high'));
    const serialized = JSON.stringify(payload);
    expect(payload.evidenceSummary.txHash).toBe('0xabc');
    expect(serialized).not.toContain('privateKey');
    expect(serialized).not.toContain('rpc.example');
  });
});

describe('Bridge watcher operator API', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), `bridge-watcher-api-${Date.now()}-${Math.random()}`);
  });

  async function buildApiWithFinding() {
    const { daemon, stateStore, findingStore } = makeDaemon(tmpDir);
    const message = makeSolanaMessage();
    stateStore.set(makeState(message, 'solana-devnet', 'base-sepolia'));
    daemon.recordObservation({
      event: makeEvent(message, {
        sourceEventKind: 'solana_init_bridge_v1_out',
        confirmations: 40,
      }),
      message,
      sourceChain: 'solana-devnet',
      destinationChain: 'base-sepolia',
      context: { routes: routes(), finality: finality(), nowSeconds: 1_800_000_000 },
    });
    await daemon.tick();

    const app = express();
    app.use(express.json());
    app.use(
      createBridgeStatusRouter({
        stateStore,
        routes: routes(),
        watcherDaemon: daemon,
        operatorApiToken: 'test-token',
      })
    );
    return { app, daemon, findingStore };
  }

  test('operator API requires auth', async () => {
    const { app } = await buildApiWithFinding();
    const response = await invokeApp(app, '/bridge/watcher/findings');
    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe('UNAUTHORIZED');
  });

  test('operator API lists findings', async () => {
    const { app } = await buildApiWithFinding();
    const response = await invokeApp(app, '/bridge/watcher/findings', {
      headers: { authorization: 'Bearer test-token' },
    });
    expect(response.status).toBe(200);
    expect(response.body.findings).toHaveLength(1);
  });

  test('operator API ack works', async () => {
    const { app, findingStore } = await buildApiWithFinding();
    const findingId = findingStore.list()[0].findingId;
    const response = await invokeApp(app, `/bridge/watcher/findings/${findingId}/ack`, {
      method: 'POST',
      headers: { 'x-bridge-operator-token': 'test-token' },
    });
    expect(response.status).toBe(200);
    expect(response.body.status).toBe('acknowledged');
  });

  test('operator API freeze dry-run returns preview', async () => {
    const { app, findingStore } = await buildApiWithFinding();
    const findingId = findingStore.list()[0].findingId;
    const response = await invokeApp(app, `/bridge/watcher/findings/${findingId}/freeze-dry-run`, {
      method: 'POST',
      headers: { authorization: 'Bearer test-token' },
    });
    expect(response.status).toBe(200);
    expect(response.body.dryRun).toBe(true);
    expect(response.body.preview.action).toBe('freeze_message');
    expect(response.body.preview.evm?.calldata || response.body.preview.solana).toBeTruthy();
  });

  test('operator API manual tick works', async () => {
    const { app, daemon } = await buildApiWithFinding();
    const response = await invokeApp(app, '/bridge/watcher/tick', {
      method: 'POST',
      headers: { authorization: 'Bearer test-token' },
    });
    expect(response.status).toBe(200);
    expect(response.body.enabled).toBe(true);
    expect(daemon.getStatus().totalFindings).toBe(1);
  });

  test('watcher status endpoint hides alert secrets', async () => {
    const sink = new RecordingAlertSink();
    const alerter = new BridgeAlerter(
      { webhookUrl: 'mock-webhook-url', minSeverity: 'high', dryRun: false },
      sink
    );
    const { daemon, stateStore } = makeDaemon(tmpDir, { alerter });
    const message = makeSolanaMessage();
    stateStore.set(makeState(message, 'solana-devnet', 'base-sepolia'));
    daemon.recordObservation({
      event: makeEvent(message, {
        sourceEventKind: 'solana_init_bridge_v1_out',
        confirmations: 40,
      }),
      message,
      sourceChain: 'solana-devnet',
      destinationChain: 'base-sepolia',
      context: { routes: routes(), finality: finality(), nowSeconds: 1_800_000_000 },
    });
    await daemon.tick();

    const app = express();
    app.use(express.json());
    app.use(
      createBridgeStatusRouter({
        stateStore,
        routes: routes(),
        watcherDaemon: daemon,
        operatorApiToken: 'test-token',
      })
    );

    const response = await invokeApp(app, '/bridge/watcher/status', {
      headers: { authorization: 'Bearer test-token' },
    });
    const serialized = JSON.stringify(response.body);
    expect(response.status).toBe(200);
    expect(response.body.alerting.enabled).toBe(true);
    expect(response.body.alerting.sink).toBe('webhook');
    expect(response.body.findingsBySeverity.critical).toBe(1);
    expect(response.body.findingsByStatus.open).toBe(1);
    expect(response.body.lastTickDurationMs).toEqual(expect.any(Number));
    expect(serialized).not.toContain('mock-webhook-url');
  });
});

describe('Bridge watcher hosted env examples', () => {
  test('relayer env example contains hosted watcher keys without real alert secrets', () => {
    const envExample = fs.readFileSync(
      path.resolve(__dirname, '../../../.env.example'),
      'utf8'
    );
    for (const key of [
      'BRIDGE_WATCHER_ENABLED=false',
      'BRIDGE_WATCHER_DRY_RUN=true',
      'BRIDGE_WATCHER_FINDINGS_PATH=',
      'BRIDGE_WATCHER_FINDING_RETENTION_DAYS=30',
      'BRIDGE_WATCHER_AUTO_FREEZE=false',
      'BRIDGE_OPERATOR_API_TOKEN=<random',
      'BRIDGE_ALERT_WEBHOOK_URL=<optional',
      'BRIDGE_ALERT_MIN_SEVERITY=high',
      'BRIDGE_ALERT_DRY_RUN=true',
    ]) {
      expect(envExample).toContain(key);
    }
    expect(envExample).not.toContain('hooks.slack.com/services/');
    expect(envExample).not.toContain('discord.com/api/webhooks/');
  });

  test('render yaml contains safe watcher placeholders without webhook secret values', () => {
    const renderYaml = fs.readFileSync(
      path.resolve(__dirname, '../../../../render.yaml'),
      'utf8'
    );
    for (const key of [
      'BRIDGE_WATCHER_ENABLED',
      'BRIDGE_WATCHER_DRY_RUN',
      'BRIDGE_WATCHER_FINDINGS_PATH',
      'BRIDGE_WATCHER_FINDING_RETENTION_DAYS',
      'BRIDGE_ALERT_MIN_SEVERITY',
      'BRIDGE_ALERT_DRY_RUN',
      'BRIDGE_OPERATOR_API_TOKEN',
      'BRIDGE_ALERT_WEBHOOK_URL',
    ]) {
      expect(renderYaml).toContain(key);
    }
    expect(renderYaml).not.toContain('hooks.slack.com/services/');
    expect(renderYaml).not.toContain('discord.com/api/webhooks/');
  });
});
