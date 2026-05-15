/**
 * Bounded hosted paper replay job.
 *
 * Replays source BridgeOut logs into daemon paper state for a configured
 * testnet route. It never submits destination transactions.
 */

import * as fs from 'fs';
import * as path from 'path';
import { EvmSourceAdapter } from './evm-adapter';
import {
  BridgeDaemon,
  loadBridgeDaemonConfigFromEnv,
  type BridgeDaemonConfig,
  type BridgeDaemonTickResult,
} from './daemon';
import { BridgeStateStore } from './state';
import { BridgeWatcherFindingStore } from './watcher-store';
import { BridgeSignerService, createBridgeSignerAdapterFromEnv } from './signer';
import { BASE_SEPOLIA_TO_SOLANA_DEVNET_ROUTE } from './base-to-solana-route';
import {
  BridgeMessageStatus,
  type BridgeMessageState,
  type BridgeRouteConfig,
  type BridgeSourceAdapter,
} from './types';

const MAX_REPLAY_BLOCK_RANGE = 500n;

export interface BridgeDaemonReplayCheck {
  ok: boolean;
  present: string[];
  missing: string[];
  warnings: string[];
  route: string;
  fromBlock?: string;
  toBlock?: string;
  liveSubmitEnabled: boolean;
}

export interface BridgeDaemonReplayResult {
  ok: boolean;
  status: 'replayed' | 'rejected' | 'blocked';
  route: string;
  fromBlock: string;
  toBlock: string;
  tick?: BridgeDaemonTickResult;
  sourceEventParsed: boolean;
  policyPassed: boolean;
  expiredDeadline: boolean;
  signaturesProduced: number;
  submitPreviewCreated: boolean;
  messagePersisted: boolean;
  destinationTxSubmitted: false;
  expectedSourceMessageHash?: string;
  expectedDestinationMessageHash?: string;
  message?: BridgeMessageState;
  blocker?: string;
}

function repoRoot(): string {
  return path.resolve(__dirname, '../../..');
}

function normalizeHash(value: string): string {
  return `0x${value.replace(/^0x/i, '').toLowerCase()}`;
}

function parseBigIntEnv(value: string | undefined): bigint | undefined {
  if (!value) return undefined;
  return BigInt(value);
}

function configuredReplayRoute(env: Record<string, string | undefined>): string | undefined {
  return env.BRIDGE_DAEMON_REPLAY_ROUTE || env.BRIDGE_DAEMON_ROUTES?.split(',')[0];
}

function parseRoute(raw: string | undefined): { source: string; destination: string; route: string } {
  const route = raw || 'base-sepolia:solana-devnet';
  const [source, destination] = route.split(':');
  if (!source || !destination) {
    throw new Error('BRIDGE_DAEMON_REPLAY_ROUTE must use source:destination format');
  }
  return { source, destination, route: `${source}->${destination}` };
}

function hasAny(env: Record<string, string | undefined>, names: string[]): boolean {
  return names.some((name) => Boolean(env[name]));
}

function loadBaseBridgeOutbox(): `0x${string}` {
  const deploymentPath = path.join(repoRoot(), 'chains/evm/deployments/base-sepolia.json');
  const deployment = JSON.parse(fs.readFileSync(deploymentPath, 'utf8')) as any;
  const address = process.env.BRIDGE_BASE_SEPOLIA_OUTBOX_ADDRESS ||
    deployment.bridgeV1?.BridgeOutbox;
  if (!address || !/^0x[0-9a-fA-F]{40}$/.test(address)) {
    throw new Error('Missing Base Sepolia BridgeOutbox address');
  }
  return address;
}

function routeIsTestnet(route: Pick<BridgeRouteConfig, 'source' | 'destination'>): boolean {
  const testnets = new Set([
    'base-sepolia',
    'ethereum-sepolia',
    'bsc-testnet',
    'polygon-amoy',
    'solana-devnet',
  ]);
  return testnets.has(route.source) && testnets.has(route.destination);
}

function defaultRoute(source: string, destination: string): BridgeRouteConfig | undefined {
  if (source === 'base-sepolia' && destination === 'solana-devnet') {
    return BASE_SEPOLIA_TO_SOLANA_DEVNET_ROUTE;
  }
  return undefined;
}

export function checkBridgeDaemonReplayEnv(
  env: Record<string, string | undefined> = process.env
): BridgeDaemonReplayCheck {
  const present: string[] = [];
  const missing: string[] = [];
  const warnings: string[] = [];
  const routeInfo = parseRoute(configuredReplayRoute(env));
  const fromBlock = parseBigIntEnv(env.BRIDGE_DAEMON_SCAN_FROM_BLOCK);
  const toBlock = parseBigIntEnv(env.BRIDGE_DAEMON_SCAN_TO_BLOCK);

  for (const name of [
    'BRIDGE_DAEMON_MODE',
    'BRIDGE_DAEMON_STATE_PATH',
    'BRIDGE_SIGNER_MODE',
  ]) {
    if (env[name]) present.push(name);
    else missing.push(name);
  }
  if (env.BRIDGE_DAEMON_REPLAY_ROUTE || env.BRIDGE_DAEMON_ROUTES) {
    if (env.BRIDGE_DAEMON_REPLAY_ROUTE) present.push('BRIDGE_DAEMON_REPLAY_ROUTE');
    if (env.BRIDGE_DAEMON_ROUTES) present.push('BRIDGE_DAEMON_ROUTES');
  } else {
    missing.push('BRIDGE_DAEMON_REPLAY_ROUTE or BRIDGE_DAEMON_ROUTES');
  }
  if (env.BRIDGE_DAEMON_SCAN_FROM_BLOCK) present.push('BRIDGE_DAEMON_SCAN_FROM_BLOCK');
  else missing.push('BRIDGE_DAEMON_SCAN_FROM_BLOCK');
  if (env.BRIDGE_DAEMON_SCAN_TO_BLOCK) present.push('BRIDGE_DAEMON_SCAN_TO_BLOCK');
  else missing.push('BRIDGE_DAEMON_SCAN_TO_BLOCK');
  if (hasAny(env, ['BASE_SEPOLIA_RPC_URL', 'BASE_RPC_URL'])) {
    if (env.BASE_SEPOLIA_RPC_URL) present.push('BASE_SEPOLIA_RPC_URL');
    if (env.BASE_RPC_URL) present.push('BASE_RPC_URL');
  } else {
    missing.push('BASE_SEPOLIA_RPC_URL or BASE_RPC_URL');
  }
  if (hasAny(env, ['BRIDGE_SIGNER_KEY_FILE', 'BRIDGE_SIGNER_PRIVATE_KEYS_TESTNET'])) {
    if (env.BRIDGE_SIGNER_KEY_FILE) present.push('BRIDGE_SIGNER_KEY_FILE');
    if (env.BRIDGE_SIGNER_PRIVATE_KEYS_TESTNET) present.push('BRIDGE_SIGNER_PRIVATE_KEYS_TESTNET');
  } else {
    missing.push('BRIDGE_SIGNER_KEY_FILE or BRIDGE_SIGNER_PRIVATE_KEYS_TESTNET');
  }

  const liveSubmitEnabled = env.BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT === 'true' ||
    env.BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT === '1';
  if (env.BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT) present.push('BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT');
  else present.push('BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT(unset=false)');
  if (liveSubmitEnabled) warnings.push('BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT must remain false');
  if (env.BRIDGE_DAEMON_MODE !== 'paper') warnings.push('BRIDGE_DAEMON_MODE must be paper');
  if (fromBlock === undefined || toBlock === undefined) {
    warnings.push('replay requires explicit from/to block range');
  } else if (toBlock < fromBlock) {
    warnings.push('BRIDGE_DAEMON_SCAN_TO_BLOCK must be >= BRIDGE_DAEMON_SCAN_FROM_BLOCK');
  } else if (toBlock - fromBlock > MAX_REPLAY_BLOCK_RANGE) {
    warnings.push(`replay block range must be <= ${MAX_REPLAY_BLOCK_RANGE.toString()} blocks`);
  }

  return {
    ok: missing.length === 0 && warnings.length === 0,
    present: [...new Set(present)].sort(),
    missing: [...new Set(missing)].sort(),
    warnings,
    route: routeInfo.route,
    fromBlock: fromBlock?.toString(),
    toBlock: toBlock?.toString(),
    liveSubmitEnabled,
  };
}

function sanitizedMessageSummary(message: BridgeMessageState | undefined): object | undefined {
  if (!message) return undefined;
  const preview = message.submissionPreview;
  return {
    messageHash: message.messageHash,
    sourceMessageHash: message.sourceMessageHash,
    destinationMessageHash: message.destinationMessageHash,
    status: message.status,
    policyAccepted: message.policyDecision?.accepted ?? false,
    finalitySatisfied: message.finalitySatisfied ?? false,
    signaturesProduced: message.signatures.length,
    submitPreviewCreated: Boolean(preview),
    submitPreview: preview ? {
      family: preview.family,
      method: preview.method,
      instruction: preview.instruction,
      messageHash: preview.messageHash,
      sourceMessageHash: preview.sourceMessageHash,
      destinationMessageHash: preview.destinationMessageHash,
      signerSetVersion: preview.signerSetVersion,
      signatureCount: preview.signatureCount,
      dryRun: preview.dryRun,
      wouldSubmit: preview.wouldSubmit,
      liveSubmissionImplemented: preview.liveSubmissionImplemented,
      transactionAssemblyImplemented: preview.transactionAssemblyImplemented,
    } : undefined,
    destinationTxSubmitted: Boolean(message.submitTxHash),
    submitTxHash: message.submitTxHash ?? null,
    lastError: message.lastError,
  };
}

function sanitizedReplayResult(result: BridgeDaemonReplayResult): object {
  return {
    ok: result.ok,
    status: result.status,
    route: result.route,
    fromBlock: result.fromBlock,
    toBlock: result.toBlock,
    tick: result.tick,
    sourceEventParsed: result.sourceEventParsed,
    policyPassed: result.policyPassed,
    expiredDeadline: result.expiredDeadline,
    signaturesProduced: result.signaturesProduced,
    submitPreviewCreated: result.submitPreviewCreated,
    messagePersisted: result.messagePersisted,
    destinationTxSubmitted: result.destinationTxSubmitted,
    expectedSourceMessageHash: result.expectedSourceMessageHash,
    expectedDestinationMessageHash: result.expectedDestinationMessageHash,
    message: sanitizedMessageSummary(result.message),
    blocker: result.blocker,
  };
}

function findMessage(
  messages: BridgeMessageState[],
  expectedSourceHash?: string,
  expectedDestinationHash?: string
): BridgeMessageState | undefined {
  const source = expectedSourceHash ? normalizeHash(expectedSourceHash) : undefined;
  const destination = expectedDestinationHash ? normalizeHash(expectedDestinationHash) : undefined;
  return messages.find((message) => {
    const hashes = [
      message.messageHash,
      message.sourceMessageHash,
      message.destinationMessageHash,
    ].filter(Boolean).map((hash) => normalizeHash(hash as string));
    return (!source || hashes.includes(source)) && (!destination || hashes.includes(destination));
  });
}

export async function runBridgeDaemonPaperReplay(input: {
  config: BridgeDaemonConfig;
  stateStore: BridgeStateStore;
  sourceAdapter: BridgeSourceAdapter;
  signer: BridgeSignerService;
  route: BridgeRouteConfig;
  fromBlock: bigint;
  toBlock: bigint;
  expectedSourceMessageHash?: string;
  expectedDestinationMessageHash?: string;
  findingStore?: BridgeWatcherFindingStore;
  now?: () => number;
}): Promise<BridgeDaemonReplayResult> {
  const route = `${input.route.source}->${input.route.destination}`;
  if (input.config.mode !== 'paper') {
    return {
      ok: false,
      status: 'blocked',
      route,
      fromBlock: input.fromBlock.toString(),
      toBlock: input.toBlock.toString(),
      sourceEventParsed: false,
      policyPassed: false,
      expiredDeadline: false,
      signaturesProduced: 0,
      submitPreviewCreated: false,
      messagePersisted: false,
      destinationTxSubmitted: false,
      blocker: 'daemon_mode_must_be_paper',
    };
  }
  if (input.config.allowLiveTestnetSubmit) {
    return {
      ok: false,
      status: 'blocked',
      route,
      fromBlock: input.fromBlock.toString(),
      toBlock: input.toBlock.toString(),
      sourceEventParsed: false,
      policyPassed: false,
      expiredDeadline: false,
      signaturesProduced: 0,
      submitPreviewCreated: false,
      messagePersisted: false,
      destinationTxSubmitted: false,
      blocker: 'live_submit_must_be_disabled',
    };
  }
  if (input.toBlock < input.fromBlock || input.toBlock - input.fromBlock > MAX_REPLAY_BLOCK_RANGE) {
    return {
      ok: false,
      status: 'blocked',
      route,
      fromBlock: input.fromBlock.toString(),
      toBlock: input.toBlock.toString(),
      sourceEventParsed: false,
      policyPassed: false,
      expiredDeadline: false,
      signaturesProduced: 0,
      submitPreviewCreated: false,
      messagePersisted: false,
      destinationTxSubmitted: false,
      blocker: 'replay_range_not_bounded',
    };
  }
  if (!routeIsTestnet(input.route)) {
    return {
      ok: false,
      status: 'blocked',
      route,
      fromBlock: input.fromBlock.toString(),
      toBlock: input.toBlock.toString(),
      sourceEventParsed: false,
      policyPassed: false,
      expiredDeadline: false,
      signaturesProduced: 0,
      submitPreviewCreated: false,
      messagePersisted: false,
      destinationTxSubmitted: false,
      blocker: 'route_must_be_testnet',
    };
  }

  const daemon = new BridgeDaemon({
    config: {
      ...input.config,
      mode: 'paper',
      allowLiveTestnetSubmit: false,
      routes: [input.route],
    },
    stateStore: input.stateStore,
    findingStore: input.findingStore,
    signer: input.signer,
    sourceAdapters: { [input.route.source]: input.sourceAdapter },
    now: input.now,
  });
  const tick = await daemon.tick();
  const messages = input.stateStore.list();
  const message = findMessage(
    messages,
    input.expectedSourceMessageHash,
    input.expectedDestinationMessageHash
  );
  if ((input.expectedSourceMessageHash || input.expectedDestinationMessageHash) && !message) {
    return {
      ok: false,
      status: 'blocked',
      route,
      fromBlock: input.fromBlock.toString(),
      toBlock: input.toBlock.toString(),
      tick,
      sourceEventParsed: tick.observed > 0,
      policyPassed: false,
      expiredDeadline: false,
      signaturesProduced: 0,
      submitPreviewCreated: false,
      messagePersisted: messages.length > 0,
      destinationTxSubmitted: false,
      expectedSourceMessageHash: input.expectedSourceMessageHash,
      expectedDestinationMessageHash: input.expectedDestinationMessageHash,
      blocker: 'expected_message_hash_not_found',
    };
  }

  const selected = message ?? messages[0];
  const expiredDeadline = selected?.lastError?.includes('expired_deadline') ||
    selected?.policyDecision?.reasons?.some((reason) => reason.includes('expired_deadline')) ||
    false;
  const policyPassed = Boolean(selected?.policyDecision?.accepted);
  const submitPreviewCreated = Boolean(selected?.submissionPreview);
  return {
    ok: Boolean(selected && tick.submitted === 0 && (policyPassed || expiredDeadline)),
    status: policyPassed ? 'replayed' : (selected ? 'rejected' : 'blocked'),
    route,
    fromBlock: input.fromBlock.toString(),
    toBlock: input.toBlock.toString(),
    tick,
    sourceEventParsed: tick.observed > 0,
    policyPassed,
    expiredDeadline,
    signaturesProduced: selected?.signatures.length ?? 0,
    submitPreviewCreated,
    messagePersisted: Boolean(selected),
    destinationTxSubmitted: false,
    expectedSourceMessageHash: input.expectedSourceMessageHash,
    expectedDestinationMessageHash: input.expectedDestinationMessageHash,
    message: selected,
    blocker: selected ? selected.lastError : 'no_messages_persisted',
  };
}

async function main(): Promise<void> {
  const envCheck = checkBridgeDaemonReplayEnv(process.env);
  if (!envCheck.ok) {
    console.log(JSON.stringify({
      ok: false,
      status: 'blocked_env',
      envCheck,
      destinationTxSubmitted: false,
    }, null, 2));
    return;
  }
  const envConfig = loadBridgeDaemonConfigFromEnv(process.env);
  const routeInfo = parseRoute(configuredReplayRoute(process.env));
  const route = envConfig.routes.find((candidate) =>
    candidate.source === routeInfo.source && candidate.destination === routeInfo.destination
  ) ?? defaultRoute(routeInfo.source, routeInfo.destination);
  if (!route) throw new Error('Replay route is not configured');
  const fromBlock = BigInt(process.env.BRIDGE_DAEMON_SCAN_FROM_BLOCK!);
  const toBlock = BigInt(process.env.BRIDGE_DAEMON_SCAN_TO_BLOCK!);
  const baseRpcUrl = process.env.BASE_SEPOLIA_RPC_URL || process.env.BASE_RPC_URL!;
  const sourceAdapter = new EvmSourceAdapter({
    rpcUrl: baseRpcUrl,
    bridgeOutboxAddress: loadBaseBridgeOutbox(),
    chainId: 84532,
    fromBlock,
    toBlock,
  });
  const result = await runBridgeDaemonPaperReplay({
    config: {
      ...envConfig,
      mode: 'paper',
      allowLiveTestnetSubmit: false,
      routes: [route],
    },
    stateStore: new BridgeStateStore(envConfig.stateDir),
    findingStore: new BridgeWatcherFindingStore(envConfig.stateDir, {
      findingsPath: process.env.BRIDGE_WATCHER_FINDINGS_PATH,
    }),
    sourceAdapter,
    signer: new BridgeSignerService({
      threshold: envConfig.signerThreshold,
      privateKeys: [],
      adapter: createBridgeSignerAdapterFromEnv(process.env),
    }),
    route,
    fromBlock,
    toBlock,
    expectedSourceMessageHash: process.env.BRIDGE_DAEMON_EXPECTED_SOURCE_MESSAGE_HASH,
    expectedDestinationMessageHash: process.env.BRIDGE_DAEMON_EXPECTED_DESTINATION_MESSAGE_HASH,
  });
  console.log(JSON.stringify(sanitizedReplayResult(result), (_key, value) => {
    if (typeof value === 'bigint') return value.toString();
    return value;
  }, 2));
}

if (require.main === module) {
  main().catch((err) => {
    console.error(JSON.stringify({
      ok: false,
      status: 'failed',
      error: err instanceof Error ? err.message : String(err),
      destinationTxSubmitted: false,
    }, null, 2));
    process.exit(1);
  });
}
