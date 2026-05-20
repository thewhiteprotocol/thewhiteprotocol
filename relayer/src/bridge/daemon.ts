/**
 * Bridge daemon paper/live-testnet orchestrator — PR-011G.
 *
 * This module wires policy, watcher findings, signer adapters, state
 * persistence, and destination submission previews. Defaults are disabled and
 * non-submitting. Live submission is testnet-only and requires explicit flags.
 */

import { PublicKey } from '@solana/web3.js';
import {
  buildDestinationBridgeMintMessageFromSourceBridgeOut,
  hashBridgeMessageV1,
  parseBridgeMessageV1Json,
  type BridgeMessageV1,
} from '@thewhiteprotocol/core';
import {
  BridgeMessageStatus,
  type BridgeDestinationAdapter,
  type BridgeEventObservation,
  type BridgeFinalityConfig,
  type BridgeMessageState,
  type BridgePolicyDecision,
  type BridgeRouteAssetConfig,
  type BridgeRouteConfig,
  type BridgeSignature,
  type BridgeSolanaDestinationConfig,
  type BridgeSourceAdapter,
} from './types';
import { BridgeStateStore } from './state';
import { BridgeWatcherFindingStore } from './watcher-store';
import {
  DEFAULT_BRIDGE_CHAINS,
  DEFAULT_BRIDGE_FINALITY,
  findBridgeRoutePolicy,
  validateBridgeSourceEvent,
} from './policy';
import {
  BridgeSignerService,
  createBridgeSignerAdapterFromEnv,
  type BridgeSignerAdapter,
  type SignerPolicyDecision,
} from './signer';
import { decodeBridgeMessageV1 } from './evm-adapter';
import {
  WHITE_PROTOCOL_PROGRAM_ID,
  buildSolanaAcceptBridgeMintTransactionPreview,
  evaluateSolanaOperatorApproval,
  evaluateSolanaSubmitReadiness,
  buildAcceptBridgeV1MintAccounts,
  buildAcceptBridgeV1MintAccountMetas,
} from './solana-adapter';
import {
  BASE_SEPOLIA_TO_SOLANA_DEVNET_ROUTE,
  SOLANA_DEVNET_TO_BASE_SEPOLIA_ROUTE,
} from './base-to-solana-route';

export type BridgeDaemonMode = 'disabled' | 'paper' | 'live-testnet';

export interface BridgeDaemonConfig {
  mode: BridgeDaemonMode;
  intervalMs: number;
  allowLiveTestnetSubmit: boolean;
  allowLocalDevSignerInLiveTestnet: boolean;
  routes: BridgeRouteConfig[];
  stateDir: string;
  signerThreshold: number;
  signerSetVersion: number;
  operatorApiToken?: string;
  solanaPoolConfig?: string;
  solanaDestinations?: Record<string, BridgeSolanaDestinationConfig>;
  submitTargets?: Record<string, string>;
  approvedMessageHashes?: string[];
}

export interface BridgeDaemonObservation {
  event: BridgeEventObservation;
  sourceChain: string;
  destinationChain: string;
}

export interface BridgeDaemonSubmitPreview {
  destinationChain: string;
  target: string;
  family: 'evm' | 'solana' | 'unknown';
  method: 'acceptBridgeMint' | 'accept_bridge_v1_mint';
  messageHash: string;
  sourceMessageHash?: string;
  signerSetVersion: number;
  signatureCount: number;
  route: string;
  dryRun: boolean;
  wouldSubmit: boolean;
  evm?: {
    contract: string;
    function: 'acceptBridgeMint';
    calldataPreview: string;
  };
  solana?: {
    programId: string;
    instruction: 'accept_bridge_v1_mint';
    accounts: Record<string, string>;
    accountMetas?: Array<Record<string, unknown>>;
    sourceMessageHash?: string;
    destinationMessageHash?: string;
    destinationCommitment?: string;
    computeBudget: string;
    transactionAssemblyImplemented?: boolean;
    serializedLength?: number;
    accountMetaCount?: number;
    computeBudgetIncluded?: boolean;
    simulationStatus?: string;
    simulationResult?: string;
    approvalStatus?: string;
    approvedMessageHash?: string;
    readyForLiveSubmit?: boolean;
    preSubmitChecksAt?: number | null;
    idempotencyStatus?: string;
    liveSubmissionImplemented: boolean;
    readiness?: Record<string, unknown>;
    accountMetaValidation?: Record<string, unknown>;
  };
}

export interface BridgeDaemonMessageView {
  messageHash: string;
  sourceMessageHash?: string;
  destinationMessageHash?: string;
  sourceChain: string;
  destinationChain: string;
  status: BridgeMessageStatus;
  sourceTxHash: string;
  sourceBlockNumber: number;
  sourceFinalityBlock: number;
  amount: string;
  canonicalAssetId: string;
  signatures: number;
  submitTxHash: string | null;
  wouldSubmit: boolean;
  lastError?: string;
  policyDecision?: BridgePolicyDecision;
  signingDecision?: BridgeMessageState['signingDecision'];
  submissionPreview?: Record<string, unknown>;
  updatedAt: number;
}

export interface BridgeDaemonStatus {
  mode: BridgeDaemonMode;
  enabled: boolean;
  running: boolean;
  intervalMs: number;
  allowLiveTestnetSubmit: boolean;
  allowLocalDevSignerInLiveTestnet: boolean;
  routes: Array<{
    source: string;
    destination: string;
    enabled: boolean;
    signerSetVersion: number;
    testnetOnly: boolean;
  }>;
  lastTickAt?: number;
  lastTickDurationMs?: number;
  tickCount: number;
  lastError?: string;
  messagesByStatus: Record<string, number>;
  signer: {
    adapterType: string;
    threshold: number;
  };
}

export interface BridgeDaemonTickResult {
  enabled: boolean;
  mode: BridgeDaemonMode;
  observed: number;
  signed: number;
  previews: number;
  submitted: number;
  blocked: number;
  skipped: string[];
}

export interface BridgeDaemonOptions {
  config: BridgeDaemonConfig;
  stateStore?: BridgeStateStore;
  findingStore?: BridgeWatcherFindingStore;
  signer?: BridgeSignerService;
  sourceAdapters?: Record<string, BridgeSourceAdapter>;
  destinationAdapters?: Record<string, BridgeDestinationAdapter>;
  finality?: Record<string, BridgeFinalityConfig>;
  now?: () => number;
}

const DEFAULT_CONFIG: BridgeDaemonConfig = {
  mode: 'disabled',
  intervalMs: 30_000,
  allowLiveTestnetSubmit: false,
  allowLocalDevSignerInLiveTestnet: false,
  routes: [],
  stateDir: process.env.STATE_DIR || '/tmp/thewhiteprotocol-bridge-daemon',
  signerThreshold: 2,
  signerSetVersion: 1,
  approvedMessageHashes: [],
};

const TESTNET_CHAIN_KEYS = new Set([
  'base-sepolia',
  'ethereum-sepolia',
  'bsc-testnet',
  'polygon-amoy',
  'solana-devnet',
]);

function parseBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  const normalized = value.toLowerCase().trim();
  if (normalized === 'true' || normalized === '1' || normalized === 'yes') return true;
  if (normalized === 'false' || normalized === '0' || normalized === 'no') return false;
  return fallback;
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function cleanHex(value: string): string {
  return value.replace(/^0x/i, '').toLowerCase();
}

function normalizeHash(value: string): string {
  return `0x${cleanHex(value)}`;
}

function hexToUint8Array(hex: string): Uint8Array {
  const clean = cleanHex(hex);
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function sanitizeError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return message
    .replace(/0x[0-9a-fA-F]{64,}/g, '[redacted-hex]')
    .replace(/https?:\/\/\S+/g, '[redacted-url]');
}

function parseRoutes(raw: string | undefined, signerSetVersion: number): BridgeRouteConfig[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((segment) => segment.trim())
    .filter(Boolean)
    .map((segment) => {
      const [source, destination, version] = segment.split(':');
      const defaultRoute = getDefaultDaemonRoute(source, destination);
      const routeSignerSetVersion = version
        ? parseInt(version, 10)
        : defaultRoute?.signerSetVersion ?? signerSetVersion;
      return {
        ...defaultRoute,
        source,
        destination,
        enabled: true,
        signerSetVersion: routeSignerSetVersion,
        solanaDestination: defaultRoute?.solanaDestination,
      };
    });
}

function getDefaultDaemonRoute(source: string, destination: string): BridgeRouteConfig | undefined {
  if (source === 'base-sepolia' && destination === 'solana-devnet') {
    return BASE_SEPOLIA_TO_SOLANA_DEVNET_ROUTE;
  }
  if (source === 'solana-devnet' && destination === 'base-sepolia') {
    return SOLANA_DEVNET_TO_BASE_SEPOLIA_ROUTE;
  }
  return undefined;
}

function parseSubmitTargets(raw: string | undefined): Record<string, string> {
  if (!raw) return {};
  const targets: Record<string, string> = {};
  for (const segment of raw.split(',')) {
    const [chain, target] = segment.split('=').map((item) => item.trim());
    if (chain && target) targets[chain] = target;
  }
  return targets;
}

function parseList(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function isTestnetChain(chainKey: string): boolean {
  return TESTNET_CHAIN_KEYS.has(chainKey);
}

function routeIsTestnet(route: Pick<BridgeRouteConfig, 'source' | 'destination'>): boolean {
  return isTestnetChain(route.source) && isTestnetChain(route.destination);
}

function routeKey(source: string, destination: string): string {
  return `${source}->${destination}`;
}

function routeAsset(route: BridgeRouteConfig | undefined, canonicalAssetId: string): BridgeRouteAssetConfig | undefined {
  return route?.assets?.find((asset) => cleanHex(asset.canonicalAssetId) === cleanHex(canonicalAssetId));
}

function assertDestinationAmountWithinCaps(amount: bigint, assetConfig: BridgeRouteAssetConfig): void {
  if (assetConfig.maxMessageAmount > 0n && amount > assetConfig.maxMessageAmount) {
    throw new Error(`destination amount exceeds max message amount`);
  }
  if (assetConfig.dailyCap > 0n && amount > assetConfig.dailyCap) {
    throw new Error(`destination amount exceeds daily cap`);
  }
}

function appendTransition(
  state: BridgeMessageState,
  status: BridgeMessageStatus,
  now: number,
  reason?: string
): BridgeMessageState {
  return {
    ...state,
    status,
    updatedAt: now,
    daemonTransitions: [
      ...(state.daemonTransitions ?? []),
      { status, at: now, reason },
    ],
  };
}

function makeMessageView(message: BridgeMessageState): BridgeDaemonMessageView {
  return {
    messageHash: message.messageHash,
    sourceMessageHash: message.sourceMessageHash,
    destinationMessageHash: message.destinationMessageHash,
    sourceChain: message.sourceChain,
    destinationChain: message.destinationChain,
    status: message.status,
    sourceTxHash: message.sourceTxHash,
    sourceBlockNumber: message.sourceBlockNumber,
    sourceFinalityBlock: message.sourceFinalityBlock,
    amount: message.amount,
    canonicalAssetId: message.canonicalAssetId,
    signatures: message.signatures.length,
    submitTxHash: message.submitTxHash ?? null,
    wouldSubmit: message.wouldSubmit ?? false,
    lastError: message.lastError,
    policyDecision: message.policyDecision,
    signingDecision: message.signingDecision,
    submissionPreview: message.submissionPreview,
    updatedAt: message.updatedAt,
  };
}

export function loadBridgeDaemonConfigFromEnv(
  env: Record<string, string | undefined> = process.env
): BridgeDaemonConfig {
  const signerSetVersion = parsePositiveInt(env.BRIDGE_SIGNER_SET_VERSION, DEFAULT_CONFIG.signerSetVersion);
  return {
    ...DEFAULT_CONFIG,
    mode: (env.BRIDGE_DAEMON_MODE as BridgeDaemonMode) || DEFAULT_CONFIG.mode,
    intervalMs: parsePositiveInt(env.BRIDGE_DAEMON_INTERVAL_MS, DEFAULT_CONFIG.intervalMs),
    allowLiveTestnetSubmit: parseBool(
      env.BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT,
      DEFAULT_CONFIG.allowLiveTestnetSubmit
    ),
    allowLocalDevSignerInLiveTestnet: parseBool(
      env.BRIDGE_ALLOW_LOCAL_DEV_SIGNER_IN_LIVE_TESTNET,
      DEFAULT_CONFIG.allowLocalDevSignerInLiveTestnet
    ),
    routes: parseRoutes(env.BRIDGE_DAEMON_ROUTES || env.BRIDGE_ROUTES, signerSetVersion),
    stateDir: env.BRIDGE_DAEMON_STATE_PATH || env.STATE_DIR || DEFAULT_CONFIG.stateDir,
    signerThreshold: parsePositiveInt(env.BRIDGE_SIGNER_THRESHOLD, DEFAULT_CONFIG.signerThreshold),
    signerSetVersion,
    operatorApiToken: env.BRIDGE_OPERATOR_API_TOKEN,
    solanaPoolConfig: env.BRIDGE_SOLANA_POOL_CONFIG,
    solanaDestinations: {},
    submitTargets: parseSubmitTargets(env.BRIDGE_DAEMON_SUBMIT_TARGETS),
    approvedMessageHashes: parseList(env.BRIDGE_APPROVED_MESSAGE_HASHES),
  };
}

export function buildEvmSubmitPreview(input: {
  destinationChain: string;
  target?: string;
  messageHash: string;
  signerSetVersion: number;
  signatureCount: number;
  route: string;
  dryRun: boolean;
  wouldSubmit: boolean;
}): BridgeDaemonSubmitPreview {
  const target = input.target || 'configured-evm-bridge-inbox';
  return {
    destinationChain: input.destinationChain,
    target,
    family: 'evm',
    method: 'acceptBridgeMint',
    messageHash: input.messageHash,
    signerSetVersion: input.signerSetVersion,
    signatureCount: input.signatureCount,
    route: input.route,
    dryRun: input.dryRun,
    wouldSubmit: input.wouldSubmit,
    evm: {
      contract: target,
      function: 'acceptBridgeMint',
      calldataPreview:
        `acceptBridgeMint(messageHash=${input.messageHash}, signatures=${input.signatureCount}, signerSetVersion=${input.signerSetVersion})`,
    },
  };
}

export function buildSolanaSubmitPreview(input: {
  destinationChain: string;
  target?: string;
  message: BridgeMessageV1;
  messageHash: string;
  sourceMessageHash?: string;
  signerSetVersion: number;
  signatureCount: number;
  route: string;
  dryRun: boolean;
  wouldSubmit: boolean;
  poolConfig?: string;
  solanaDestination?: BridgeSolanaDestinationConfig;
  signatures?: string[];
  approvedMessageHashes?: string[];
  nowSeconds?: number;
}): BridgeDaemonSubmitPreview {
  const programId = input.target ? new PublicKey(input.target) : WHITE_PROTOCOL_PROGRAM_ID;
  const destinationConfig = input.solanaDestination;
  const poolConfig = new PublicKey(destinationConfig?.poolConfig || input.poolConfig || '11111111111111111111111111111111');
  const accounts = buildAcceptBridgeV1MintAccounts(input.message, poolConfig, programId, {
    signerSetVersion: input.signerSetVersion,
    destinationConfig,
    messageHash: input.messageHash,
  });
  const accountMap = Object.fromEntries(
    Object.entries(accounts).map(([key, value]) => [key, value.toBase58()])
  ) as Record<string, string>;
  const liveSubmissionImplemented = false;
  const route = input.route;
  const approval = evaluateSolanaOperatorApproval({
    destinationMessageHash: input.messageHash,
    sourceMessageHash: input.sourceMessageHash,
    route,
    approvedMessageHashes: input.approvedMessageHashes,
    nowSeconds: input.nowSeconds,
  });
  const transactionPreview = destinationConfig && input.signatures
    ? buildSolanaAcceptBridgeMintTransactionPreview({
      message: input.message,
      messageHash: input.messageHash,
      sourceMessageHash: input.sourceMessageHash,
      signatures: input.signatures,
      signerSetVersion: input.signerSetVersion,
      destinationConfig,
      programId,
    })
    : undefined;
  const readiness = evaluateSolanaSubmitReadiness({
    accounts: accountMap,
    sourceMessageHash: input.sourceMessageHash,
    destinationMessageHash: input.messageHash,
    previewMessageHash: input.messageHash,
    signerSetVersion: input.signerSetVersion,
    expectedSignerSetVersion: destinationConfig?.signerSetVersion,
    liveSubmissionImplemented,
    approval,
  });
  return {
    destinationChain: input.destinationChain,
    target: programId.toBase58(),
    family: 'solana',
    method: 'accept_bridge_v1_mint',
    messageHash: input.messageHash,
    sourceMessageHash: input.sourceMessageHash,
    signerSetVersion: input.signerSetVersion,
    signatureCount: input.signatureCount,
    route: input.route,
    dryRun: input.dryRun,
    wouldSubmit: input.wouldSubmit,
    solana: {
      programId: programId.toBase58(),
      instruction: 'accept_bridge_v1_mint',
      accounts: accountMap,
      accountMetas: buildAcceptBridgeV1MintAccountMetas(accounts) as unknown as Array<Record<string, unknown>>,
      sourceMessageHash: input.sourceMessageHash,
      destinationMessageHash: input.messageHash,
      destinationCommitment: input.message.destinationCommitment,
      computeBudget: 'recommended: compute-unit limit and price set by future live Solana submitter',
      transactionAssemblyImplemented: transactionPreview?.transactionAssemblyImplemented ?? false,
      serializedLength: transactionPreview?.serializedLength,
      accountMetaCount: transactionPreview?.accountMetaValidation.accountMetaCount,
      computeBudgetIncluded: transactionPreview?.computeBudgetIncluded ?? false,
      simulationStatus: transactionPreview?.simulationStatus ?? 'skipped',
      simulationResult: transactionPreview
        ? (approval.approved ? transactionPreview.simulationResult : approval.status)
        : 'not_attempted_no_transaction_assembly',
      approvalStatus: approval.status,
      approvedMessageHash: approval.approvedMessageHash,
      readyForLiveSubmit: false,
      preSubmitChecksAt: null,
      idempotencyStatus: 'not_run_without_rpc_provider',
      liveSubmissionImplemented,
      readiness: readiness as unknown as Record<string, unknown>,
      accountMetaValidation: transactionPreview?.accountMetaValidation as unknown as Record<string, unknown> | undefined,
    },
  };
}

export class BridgeDaemon {
  private readonly config: BridgeDaemonConfig;
  private readonly stateStore: BridgeStateStore;
  private readonly findingStore?: BridgeWatcherFindingStore;
  private readonly signer: BridgeSignerService;
  private readonly sourceAdapters: Record<string, BridgeSourceAdapter>;
  private readonly destinationAdapters: Record<string, BridgeDestinationAdapter>;
  private readonly finality: Record<string, BridgeFinalityConfig>;
  private readonly now: () => number;
  private readonly observations: BridgeDaemonObservation[] = [];
  private timer?: NodeJS.Timeout;
  private lastTickAt?: number;
  private lastTickDurationMs?: number;
  private tickCount = 0;
  private lastError?: string;

  constructor(options: BridgeDaemonOptions) {
    this.config = { ...DEFAULT_CONFIG, ...options.config };
    this.stateStore = options.stateStore ?? new BridgeStateStore(this.config.stateDir);
    this.findingStore = options.findingStore;
    this.signer = options.signer ?? new BridgeSignerService({
      threshold: this.config.signerThreshold,
      privateKeys: [],
      adapter: createBridgeSignerAdapterFromEnv(process.env),
    });
    this.sourceAdapters = options.sourceAdapters ?? {};
    this.destinationAdapters = options.destinationAdapters ?? {};
    this.finality = options.finality ?? DEFAULT_BRIDGE_FINALITY;
    this.now = options.now ?? Date.now;
  }

  isEnabled(): boolean {
    return this.config.mode !== 'disabled';
  }

  isRunning(): boolean {
    return this.timer !== undefined;
  }

  start(): void {
    if (!this.isEnabled() || this.timer) return;
    this.timer = setInterval(() => {
      this.tick().catch((err) => {
        this.lastError = sanitizeError(err);
      });
    }, this.config.intervalMs);
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = undefined;
  }

  recordObservation(observation: BridgeDaemonObservation): void {
    this.observations.push(observation);
  }

  getStateStore(): BridgeStateStore {
    return this.stateStore;
  }

  getStatus(): BridgeDaemonStatus {
    const messages = this.stateStore.list();
    const messagesByStatus = messages.reduce<Record<string, number>>((acc, message) => {
      acc[message.status] = (acc[message.status] ?? 0) + 1;
      return acc;
    }, {});
    return {
      mode: this.config.mode,
      enabled: this.isEnabled(),
      running: this.isRunning(),
      intervalMs: this.config.intervalMs,
      allowLiveTestnetSubmit: this.config.allowLiveTestnetSubmit,
      allowLocalDevSignerInLiveTestnet: this.config.allowLocalDevSignerInLiveTestnet,
      routes: this.config.routes.map((route) => ({
        source: route.source,
        destination: route.destination,
        enabled: route.enabled,
        signerSetVersion: route.signerSetVersion,
        testnetOnly: routeIsTestnet(route),
      })),
      lastTickAt: this.lastTickAt,
      lastTickDurationMs: this.lastTickDurationMs,
      tickCount: this.tickCount,
      lastError: this.lastError,
      messagesByStatus,
      signer: {
        adapterType: this.signer.getAdapterType(),
        threshold: this.signer.getThreshold(),
      },
    };
  }

  listMessages(): BridgeDaemonMessageView[] {
    return this.stateStore.list().map(makeMessageView);
  }

  getMessage(messageHash: string): BridgeDaemonMessageView | undefined {
    const message = this.stateStore.get(messageHash);
    return message ? makeMessageView(message) : undefined;
  }

  retryMessage(messageHash: string): BridgeDaemonMessageView {
    const existing = this.stateStore.get(messageHash);
    if (!existing) throw new Error(`Daemon message not found: ${messageHash}`);
    const updated = appendTransition(
      { ...existing, attempts: existing.attempts + 1, lastError: undefined },
      BridgeMessageStatus.OBSERVED,
      this.now(),
      'operator_retry'
    );
    this.stateStore.set(updated);
    return makeMessageView(updated);
  }

  private async collectSourceAdapterObservations(): Promise<BridgeDaemonObservation[]> {
    const observations: BridgeDaemonObservation[] = [];
    for (const route of this.config.routes) {
      const sourceAdapter = this.sourceAdapters[route.source];
      if (!sourceAdapter) continue;
      for await (const event of sourceAdapter.watch()) {
        observations.push({
          event,
          sourceChain: route.source,
          destinationChain: route.destination,
        });
      }
    }
    return observations;
  }

  private buildInitialState(
    messageHash: string,
    message: BridgeMessageV1,
    observation: BridgeDaemonObservation
  ): BridgeMessageState {
    const now = this.now();
    return {
      messageHash,
      sourceChain: observation.sourceChain,
      destinationChain: observation.destinationChain,
      sourceDomain: message.sourceDomain,
      destinationDomain: message.destinationDomain,
      sourceTxHash: observation.event.txHash,
      sourceBlockNumber: observation.event.blockNumber,
      sourceFinalityBlock: message.sourceFinalityBlock,
      nonce: message.nonce,
      destinationCommitment: message.destinationCommitment,
      canonicalAssetId: message.canonicalAssetId,
      amount: message.amount.toString(),
      signatures: [],
      status: BridgeMessageStatus.OBSERVED,
      attempts: 0,
      createdAt: now,
      updatedAt: now,
      message,
      daemonTransitions: [{ status: BridgeMessageStatus.OBSERVED, at: now }],
    };
  }

  private persistStatus(
    state: BridgeMessageState,
    status: BridgeMessageStatus,
    patch: Partial<BridgeMessageState> = {},
    reason?: string
  ): BridgeMessageState {
    const updated = appendTransition({ ...state, ...patch }, status, this.now(), reason);
    this.stateStore.set(updated);
    return updated;
  }

  private transformDestinationMessage(
    sourceMessage: BridgeMessageV1,
    route: BridgeRouteConfig | undefined
  ): BridgeMessageV1 {
    const assetConfig = routeAsset(route, sourceMessage.canonicalAssetId);
    if (!assetConfig) return sourceMessage;
    const message = buildDestinationBridgeMintMessageFromSourceBridgeOut({
      sourceMessage,
      destinationDomain: sourceMessage.destinationDomain,
      destinationChainId: sourceMessage.destinationChainId,
      destinationLocalAssetId: sourceMessage.destinationLocalAssetId,
      destinationCommitment: sourceMessage.destinationCommitment,
      sourceDecimals: assetConfig.sourceDecimals,
      destinationDecimals: assetConfig.destinationDecimals,
      normalizationMode: assetConfig.normalizationMode,
      rateNumerator: assetConfig.rateNumerator,
      rateDenominator: assetConfig.rateDenominator,
    });
    assertDestinationAmountWithinCaps(message.amount, assetConfig);
    return message;
  }

  private hasOpenCriticalFinding(messageHash?: string): boolean {
    if (!this.findingStore) return false;
    return this.findingStore.list({ status: 'open', severity: 'critical' }).some((finding) => {
      if (!messageHash) return true;
      return normalizeHash(finding.messageHash) === normalizeHash(messageHash);
    });
  }

  private buildSigningContext(input: {
    message: BridgeMessageV1;
    messageHash: string;
    route: BridgeRouteConfig;
    policyDecision: BridgePolicyDecision;
  }) {
    return {
      messageHash: input.messageHash,
      sourceChain: input.route.source,
      destinationChain: input.route.destination,
      sourceDomain: input.message.sourceDomain,
      destinationDomain: input.message.destinationDomain,
      canonicalAssetId: input.message.canonicalAssetId,
      amount: input.message.amount,
      route: routeKey(input.route.source, input.route.destination),
      riskLevel: input.policyDecision.severity,
      dryRun: false,
      signerSetVersion: input.route.signerSetVersion,
      purpose: 'bridge-attestation' as const,
      messageFormat: 'BridgeMessageV1' as const,
      bridgePolicyAccepted: input.policyDecision.accepted,
      finalitySatisfied: true,
      routeAllowed: true,
      assetSupported: true,
      amountWithinCap: true,
      openCriticalFindings: this.hasOpenCriticalFinding(input.messageHash) ? 1 : 0,
    };
  }

  private async signMessage(input: {
    state: BridgeMessageState;
    message: BridgeMessageV1;
    messageHash: string;
    route: BridgeRouteConfig;
    policyDecision: BridgePolicyDecision;
  }): Promise<{ state: BridgeMessageState; signatures: BridgeSignature[]; decision: SignerPolicyDecision }> {
    const context = this.buildSigningContext(input);
    const decision = await this.signer.canSign(context);
    let state = this.persistStatus(
      input.state,
      BridgeMessageStatus.READY_TO_SIGN,
      {
        signingDecision: {
          accepted: decision.accepted,
          action: decision.action,
          reasons: decision.reasons,
          adapterType: this.signer.getAdapterType(),
        },
      },
      decision.accepted ? undefined : decision.reasons[0]
    );
    if (!decision.accepted) {
      state = this.persistStatus(
        state,
        BridgeMessageStatus.FROZEN_OR_BLOCKED,
        { lastError: `signing_blocked: ${decision.reasons.join(', ')}` },
        'signing_policy_blocked'
      );
      return { state, signatures: [], decision };
    }

    const allSignatures = await this.signer.signMessage(input.message, context);
    const thresholdSignatures = this.signer.takeThreshold(allSignatures);
    this.signer.validateSignatureOrder(thresholdSignatures);
    state = this.persistStatus(state, BridgeMessageStatus.SIGNED, {
      signatures: thresholdSignatures,
      signingDecision: {
        accepted: true,
        action: decision.action,
        reasons: [],
        adapterType: this.signer.getAdapterType(),
      },
      signatureMetadata: {
        signerSetVersion: input.route.signerSetVersion,
        signerCount: allSignatures.length,
        threshold: this.signer.getThreshold(),
        signerAddresses: thresholdSignatures.map((signature) => signature.signerAddress),
      },
    });
    return { state, signatures: thresholdSignatures, decision };
  }

  private buildSubmitPreview(input: {
    route: BridgeRouteConfig;
    message: BridgeMessageV1;
    messageHash: string;
    sourceMessageHash?: string;
    signatures: BridgeSignature[];
    dryRun: boolean;
    wouldSubmit: boolean;
  }): BridgeDaemonSubmitPreview {
    const family = DEFAULT_BRIDGE_CHAINS[input.route.destination]?.family;
    const target = this.config.submitTargets?.[input.route.destination];
    const common = {
      destinationChain: input.route.destination,
      target,
      messageHash: input.messageHash,
      sourceMessageHash: input.sourceMessageHash,
      signerSetVersion: input.route.signerSetVersion,
      signatureCount: input.signatures.length,
      route: routeKey(input.route.source, input.route.destination),
      dryRun: input.dryRun,
      wouldSubmit: input.wouldSubmit,
    };
    if (family === 'solana') {
      return buildSolanaSubmitPreview({
        ...common,
        message: input.message,
        poolConfig: this.config.solanaPoolConfig,
        solanaDestination: input.route.solanaDestination ??
          this.config.solanaDestinations?.[routeKey(input.route.source, input.route.destination)],
        signatures: input.signatures.map((signature) => signature.signature),
        approvedMessageHashes: this.config.approvedMessageHashes,
        nowSeconds: Math.floor(this.now() / 1000),
      });
    }
    return buildEvmSubmitPreview(common);
  }

  private liveModeBlockReason(route: BridgeRouteConfig): string | undefined {
    if (this.config.mode !== 'live-testnet') return undefined;
    if (!this.config.allowLiveTestnetSubmit) return 'live_testnet_submit_flag_disabled';
    if (!routeIsTestnet(route)) return 'mainnet_or_unknown_route_blocked';
    if (this.hasOpenCriticalFinding()) return 'open_critical_watcher_finding';
    if (
      this.signer.getAdapterType() === 'local-dev' &&
      !this.config.allowLocalDevSignerInLiveTestnet
    ) {
      return 'local_dev_signer_blocked_in_live_testnet';
    }
    return undefined;
  }

  private async maybeSubmit(input: {
    state: BridgeMessageState;
    route: BridgeRouteConfig;
    message: BridgeMessageV1;
    messageHash: string;
    signatures: BridgeSignature[];
    result: BridgeDaemonTickResult;
  }): Promise<void> {
    const liveBlockReason = this.liveModeBlockReason(input.route);
    const willSubmit = this.config.mode === 'live-testnet' && !liveBlockReason;
    const preview = this.buildSubmitPreview({
      route: input.route,
      message: input.message,
      messageHash: input.messageHash,
      sourceMessageHash: input.state.sourceMessageHash,
      signatures: input.signatures,
      dryRun: !willSubmit,
      wouldSubmit: true,
    });

    let state = this.persistStatus(input.state, BridgeMessageStatus.PAPER_READY_TO_SUBMIT, {
      submissionPreview: preview as unknown as Record<string, unknown>,
      wouldSubmit: true,
      lastError: liveBlockReason,
    }, liveBlockReason);
    input.result.previews += 1;

    if (!willSubmit) return;
    const destinationAdapter = this.destinationAdapters[input.route.destination];
    if (!destinationAdapter) {
      this.persistStatus(
        state,
        BridgeMessageStatus.FAILED,
        { lastError: 'destination_adapter_not_configured' },
        'destination_adapter_not_configured'
      );
      input.result.blocked += 1;
      return;
    }

    state = this.persistStatus(state, BridgeMessageStatus.SUBMITTED, {
      attempts: state.attempts + 1,
    });
    const txHash = await destinationAdapter.submitAcceptBridgeMint(
      input.message,
      this.signer.extractRawSignatures(input.signatures),
      input.route.signerSetVersion
    );
    this.persistStatus(state, BridgeMessageStatus.CONFIRMED, {
      submitTxHash: txHash,
      lastError: undefined,
    });
    input.result.submitted += 1;
  }

  private async processObservation(
    observation: BridgeDaemonObservation,
    result: BridgeDaemonTickResult
  ): Promise<void> {
    const sourceMessage = decodeBridgeMessageV1(hexToUint8Array(observation.event.encodedMessage));
    const sourceMessageHash = normalizeHash(hashBridgeMessageV1(sourceMessage));
    const route = findBridgeRoutePolicy(
      this.config.routes,
      observation.sourceChain,
      observation.destinationChain
    );
    if (!route) {
      result.blocked += 1;
      return;
    }

    let state = this.buildInitialState(sourceMessageHash, sourceMessage, observation);
    const existing = this.stateStore.get(sourceMessageHash);
    if (existing && existing.status === BridgeMessageStatus.CONFIRMED) {
      result.skipped.push(`already_confirmed:${sourceMessageHash}`);
      return;
    }
    this.stateStore.set(existing ?? state);
    state = existing ?? state;

    const policyDecision = validateBridgeSourceEvent({
      event: observation.event,
      message: sourceMessage,
      sourceChain: observation.sourceChain,
      destinationChain: observation.destinationChain,
      context: {
        routes: this.config.routes,
        finality: this.finality,
        nowSeconds: Math.floor(this.now() / 1000),
      },
    });

    state = this.persistStatus(state, BridgeMessageStatus.POLICY_CHECKED, {
      policyDecision,
      finalitySatisfied: policyDecision.accepted,
    });

    if (!policyDecision.accepted) {
      const primaryReason = policyDecision.reasons[0] ?? policyDecision.action;
      if (policyDecision.action === 'delay') {
        this.persistStatus(
          state,
          BridgeMessageStatus.FINALITY_WAIT,
          { finalitySatisfied: false, lastError: primaryReason },
          primaryReason
        );
        result.blocked += 1;
        return;
      }
      const status = policyDecision.action === 'ignore'
        ? BridgeMessageStatus.IGNORED
        : BridgeMessageStatus.REJECTED;
      this.persistStatus(state, status, { lastError: primaryReason }, primaryReason);
      result.blocked += 1;
      return;
    }

    let destinationMessage: BridgeMessageV1;
    try {
      destinationMessage = this.transformDestinationMessage(sourceMessage, route);
    } catch (err) {
      this.persistStatus(
        state,
        BridgeMessageStatus.REJECTED,
        { lastError: sanitizeError(err) },
        'message_transformation_failed'
      );
      result.blocked += 1;
      return;
    }

    const destinationMessageHash = normalizeHash(hashBridgeMessageV1(destinationMessage));
    if (destinationMessageHash !== sourceMessageHash) {
      state = {
        ...state,
        messageHash: destinationMessageHash,
        sourceMessageHash,
        destinationMessageHash,
        message: destinationMessage,
        amount: destinationMessage.amount.toString(),
      };
      this.stateStore.delete(sourceMessageHash);
      this.stateStore.set(state);
    }

    if (this.hasOpenCriticalFinding(destinationMessageHash)) {
      this.persistStatus(
        state,
        BridgeMessageStatus.FROZEN_OR_BLOCKED,
        { lastError: 'open_critical_watcher_finding' },
        'open_critical_watcher_finding'
      );
      result.blocked += 1;
      return;
    }

    const signing = await this.signMessage({
      state,
      message: destinationMessage,
      messageHash: destinationMessageHash,
      route,
      policyDecision,
    });
    if (!signing.decision.accepted) {
      result.blocked += 1;
      return;
    }

    result.signed += 1;
    await this.maybeSubmit({
      state: signing.state,
      route,
      message: destinationMessage,
      messageHash: destinationMessageHash,
      signatures: signing.signatures,
      result,
    });
  }

  async tick(): Promise<BridgeDaemonTickResult> {
    const result: BridgeDaemonTickResult = {
      enabled: this.isEnabled(),
      mode: this.config.mode,
      observed: 0,
      signed: 0,
      previews: 0,
      submitted: 0,
      blocked: 0,
      skipped: [],
    };

    if (!this.isEnabled()) {
      result.skipped.push('daemon_disabled');
      return result;
    }

    const startedAt = this.now();
    try {
      const queued = this.observations.splice(0);
      const adapterObservations = await this.collectSourceAdapterObservations();
      const observations = [...queued, ...adapterObservations];
      result.observed = observations.length;
      for (const observation of observations) {
        await this.processObservation(observation, result);
      }
      this.lastTickAt = this.now();
      this.lastTickDurationMs = this.lastTickAt - startedAt;
      this.tickCount += 1;
      this.lastError = undefined;
      return result;
    } catch (err) {
      this.lastError = sanitizeError(err);
      throw err;
    }
  }

  static messageFromState(state: BridgeMessageState): BridgeMessageV1 {
    return parseBridgeMessageV1Json(state.message);
  }
}

export function createBridgeDaemonFromEnv(options: {
  stateStore?: BridgeStateStore;
  findingStore?: BridgeWatcherFindingStore;
  destinationAdapters?: Record<string, BridgeDestinationAdapter>;
  sourceAdapters?: Record<string, BridgeSourceAdapter>;
  env?: Record<string, string | undefined>;
} = {}): BridgeDaemon {
  const env = options.env ?? process.env;
  const config = loadBridgeDaemonConfigFromEnv(env);
  const adapter: BridgeSignerAdapter = createBridgeSignerAdapterFromEnv(env);
  return new BridgeDaemon({
    config,
    stateStore: options.stateStore,
    findingStore: options.findingStore,
    sourceAdapters: options.sourceAdapters,
    destinationAdapters: options.destinationAdapters,
    signer: new BridgeSignerService({
      threshold: config.signerThreshold,
      privateKeys: [],
      adapter,
    }),
  });
}
