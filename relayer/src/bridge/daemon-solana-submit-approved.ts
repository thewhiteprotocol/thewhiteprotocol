/**
 * Guarded Solana destination submit command for one approved live-testnet message.
 *
 * This command is intentionally narrow: it submits only a destination BridgeMint
 * message that is already persisted in daemon state and explicitly approved by
 * destination hash.
 */

import { Connection, Keypair, PublicKey, Transaction, VersionedTransaction } from '@solana/web3.js';
import {
  hashBridgeMessageV1,
  parseBridgeMessageV1Json,
  type BridgeMessageV1,
} from '@thewhiteprotocol/core';
import { BASE_SEPOLIA_TO_SOLANA_DEVNET_ROUTE } from './base-to-solana-route';
import {
  buildAcceptBridgeV1MintAccounts,
  buildSolanaAcceptBridgeMintTransactionPreview,
  evaluateSolanaOperatorApproval,
  runSolanaPreSubmitReadinessChecks,
  simulateSolanaAcceptBridgeMintTransactionWithGates,
  type SolanaReadOnlyAccountProvider,
  type SolanaSimulationConnectionLike,
} from './solana-adapter';
import { BridgeStateStore } from './state';
import { BridgeMessageStatus, type BridgeMessageState } from './types';

export const BRIDGE_SUBMIT_DESTINATION_MESSAGE_HASH_ENV =
  'BRIDGE_SUBMIT_DESTINATION_MESSAGE_HASH';
export const BRIDGE_SUBMIT_SOURCE_MESSAGE_HASH_ENV =
  'BRIDGE_SUBMIT_SOURCE_MESSAGE_HASH';
export const BRIDGE_SUBMIT_ROUTE = 'base-sepolia->solana-devnet';

interface SolanaSubmitEnvCheck {
  ok: boolean;
  present: string[];
  missing: string[];
  warnings: string[];
  mode: string;
  liveSubmitEnabled: boolean;
  routeAllowed: boolean;
  approvedDestinationHashPresent: boolean;
}

interface LoadedApprovedMessage {
  state: BridgeMessageState;
  message: BridgeMessageV1;
  signatures: string[];
  sourceMessageHash: string;
  destinationMessageHash: string;
}

interface SubmitConnectionLike extends SolanaSimulationConnectionLike, SolanaReadOnlyAccountProvider {
  getLatestBlockhash(): Promise<{ blockhash: string; lastValidBlockHeight: number }>;
  sendRawTransaction(
    rawTransaction: Buffer | Uint8Array,
    options?: { skipPreflight?: boolean; maxRetries?: number }
  ): Promise<string>;
  confirmTransaction(
    strategy: { signature: string; blockhash: string; lastValidBlockHeight: number },
    commitment?: string
  ): Promise<{ value: { err: unknown } }>;
}

export interface GuardedSolanaSubmitResult {
  ok: boolean;
  status:
    | 'success'
    | 'blocked_env_or_approval'
    | 'blocked_message_load'
    | 'blocked_pre_submit_checks'
    | 'blocked_simulation'
    | 'already_submitted'
    | 'already_consumed'
    | 'failed';
  approvedDestinationHash: string;
  sourceMessageHash?: string;
  preSubmitChecks?: string;
  preSubmitReasons?: string[];
  simulationAttempted: boolean;
  simulationOk: boolean;
  submitAttempted: boolean;
  submitTxHash: string | null;
  confirmationStatus?: string;
  consumedPdaCreated?: boolean;
  pendingBufferUpdated?: boolean;
  duplicateSubmitBlocked: boolean;
  destinationTxSubmitted: boolean;
  stateMutationObserved?: boolean;
  error?: string;
}

function normalizeHash(value: string): string {
  return `0x${value.replace(/^0x/i, '').toLowerCase()}`;
}

function approvedHashes(env: Record<string, string | undefined>): string[] {
  return (env.BRIDGE_APPROVED_MESSAGE_HASHES ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function approvalHash(entry: string): string | undefined {
  let hash = entry.trim();
  if (!hash) return undefined;
  if (hash.includes('|')) {
    hash = hash.split('|').map((part) => part.trim())[1] ?? '';
  } else if (hash.includes('=')) {
    hash = hash.split('=').map((part) => part.trim())[1] ?? '';
  }
  return /^0x[0-9a-fA-F]{64}$/.test(hash) ? normalizeHash(hash) : undefined;
}

function routeAllowlisted(env: Record<string, string | undefined>): boolean {
  const routes = (env.BRIDGE_DAEMON_ROUTES || env.BRIDGE_ROUTES || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => entry.split(':').slice(0, 2).join(':'));
  return routes.includes('base-sepolia:solana-devnet');
}

function targetDestinationHashFromEnv(env: Record<string, string | undefined>): string {
  const explicit = env[BRIDGE_SUBMIT_DESTINATION_MESSAGE_HASH_ENV];
  if (explicit && /^0x[0-9a-fA-F]{64}$/.test(explicit)) {
    return normalizeHash(explicit);
  }
  const approved = approvedHashes(env).map(approvalHash).find(Boolean);
  if (!approved) throw new Error('approved_destination_hash_required');
  return approved;
}

function parseRelayerKeypair(env: Record<string, string | undefined>): Keypair {
  const raw = env.RELAYER_KEYPAIR;
  if (!raw) throw new Error('RELAYER_KEYPAIR required for live-testnet submit');
  const parsed = JSON.parse(raw) as number[];
  if (!Array.isArray(parsed) || parsed.length !== 64) {
    throw new Error('RELAYER_KEYPAIR must be a JSON array of 64 numbers');
  }
  return Keypair.fromSecretKey(Uint8Array.from(parsed));
}

export function checkGuardedSolanaSubmitEnv(
  env: Record<string, string | undefined> = process.env
): SolanaSubmitEnvCheck {
  const present: string[] = [];
  const missing: string[] = [];
  const warnings: string[] = [];
  const mode = env.BRIDGE_DAEMON_MODE || 'disabled';
  const liveSubmitEnabled = env.BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT === 'true' ||
    env.BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT === '1';
  const routeAllowed = routeAllowlisted(env);

  if (env.BRIDGE_DAEMON_MODE) present.push('BRIDGE_DAEMON_MODE');
  else missing.push('BRIDGE_DAEMON_MODE');
  if (mode !== 'live-testnet') warnings.push('BRIDGE_DAEMON_MODE must be live-testnet');

  if (env.BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT) present.push('BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT');
  else missing.push('BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT');
  if (!liveSubmitEnabled) warnings.push('BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT must be true');

  if (env.BRIDGE_DAEMON_ROUTES || env.BRIDGE_ROUTES) present.push('BRIDGE_DAEMON_ROUTES');
  else missing.push('BRIDGE_DAEMON_ROUTES');
  if (!routeAllowed) warnings.push('route allowlist must include base-sepolia:solana-devnet');

  if (env.BRIDGE_DAEMON_STATE_PATH || env.STATE_DIR) present.push('BRIDGE_DAEMON_STATE_PATH');
  else missing.push('BRIDGE_DAEMON_STATE_PATH or STATE_DIR');
  if (env.SOLANA_DEVNET_RPC_URL || env.RPC_ENDPOINT) present.push('SOLANA_DEVNET_RPC_URL');
  else missing.push('SOLANA_DEVNET_RPC_URL or RPC_ENDPOINT');
  if (env.RELAYER_KEYPAIR) present.push('RELAYER_KEYPAIR(public-key-derived)');
  else missing.push('RELAYER_KEYPAIR');
  if (env.BRIDGE_APPROVED_MESSAGE_HASHES) present.push('BRIDGE_APPROVED_MESSAGE_HASHES');
  else missing.push('BRIDGE_APPROVED_MESSAGE_HASHES');

  let approvedDestinationHashPresent = false;
  try {
    const target = targetDestinationHashFromEnv(env);
    const approval = evaluateSolanaOperatorApproval({
      destinationMessageHash: target,
      sourceMessageHash: env[BRIDGE_SUBMIT_SOURCE_MESSAGE_HASH_ENV],
      route: BRIDGE_SUBMIT_ROUTE,
      approvedMessageHashes: approvedHashes(env),
    });
    approvedDestinationHashPresent = approval.approved;
    if (!approval.approved) missing.push('BRIDGE_APPROVED_MESSAGE_HASHES(destination BridgeMint hash)');
  } catch {
    missing.push('BRIDGE_APPROVED_MESSAGE_HASHES(destination BridgeMint hash)');
  }

  return {
    ok: missing.length === 0 && warnings.length === 0,
    present: [...new Set(present)].sort(),
    missing: [...new Set(missing)].sort(),
    warnings,
    mode,
    liveSubmitEnabled,
    routeAllowed,
    approvedDestinationHashPresent,
  };
}

export function loadApprovedMessageForSubmit(
  stateDir: string,
  targetDestinationHash: string,
  expectedSignerSetVersion = BASE_SEPOLIA_TO_SOLANA_DEVNET_ROUTE.signerSetVersion,
  expectedSourceMessageHash?: string
): LoadedApprovedMessage {
  const store = new BridgeStateStore(stateDir);
  const normalizedTarget = normalizeHash(targetDestinationHash);
  const state = store.get(normalizedTarget) ??
    store.list().find((candidate) =>
      normalizeHash(candidate.destinationMessageHash ?? candidate.messageHash) === normalizedTarget
    );
  if (!state) throw new Error('approved_message_not_found_in_bridge_daemon_state');
  if (state.submitTxHash) throw new Error('message_already_has_submit_tx');
  if (state.status !== BridgeMessageStatus.PAPER_READY_TO_SUBMIT) {
    throw new Error(`message_not_ready:${state.status}`);
  }

  const destinationMessageHash = normalizeHash(state.destinationMessageHash ?? state.messageHash);
  const sourceMessageHash = state.sourceMessageHash ? normalizeHash(state.sourceMessageHash) : undefined;
  if (destinationMessageHash !== normalizedTarget) throw new Error('destination_message_hash_mismatch');
  if (!sourceMessageHash) throw new Error('source_message_hash_missing');
  if (expectedSourceMessageHash && sourceMessageHash !== normalizeHash(expectedSourceMessageHash)) {
    throw new Error('source_message_hash_mismatch');
  }
  if (state.signatureMetadata?.signerSetVersion !== expectedSignerSetVersion) {
    throw new Error('signer_set_version_mismatch');
  }
  if (state.signatures.length < 2) throw new Error('threshold_signatures_missing');

  const message = parseBridgeMessageV1Json(state.message as unknown as Record<string, unknown>);
  if (normalizeHash(hashBridgeMessageV1(message)) !== normalizedTarget) {
    throw new Error('persisted_message_hash_mismatch');
  }
  return {
    state,
    message,
    signatures: state.signatures.slice(0, 2).map((signature) => signature.signature),
    sourceMessageHash,
    destinationMessageHash,
  };
}

export async function submitSolanaAcceptBridgeMintApprovedMessage(input: {
  env: Record<string, string | undefined>;
  stateDir: string;
  connection: SubmitConnectionLike;
  stateStore: BridgeStateStore;
  payer: Keypair;
  now?: () => number;
}): Promise<GuardedSolanaSubmitResult> {
  const targetDestinationHash = targetDestinationHashFromEnv(input.env);
  const envCheck = checkGuardedSolanaSubmitEnv(input.env);
  if (!envCheck.ok) {
    return {
      ok: false,
      status: 'blocked_env_or_approval',
      approvedDestinationHash: targetDestinationHash,
      simulationAttempted: false,
      simulationOk: false,
      submitAttempted: false,
      submitTxHash: null,
      duplicateSubmitBlocked: false,
      destinationTxSubmitted: false,
      error: [...envCheck.missing, ...envCheck.warnings].join(', '),
    };
  }

  let loaded: LoadedApprovedMessage;
  const signerSetVersion = BASE_SEPOLIA_TO_SOLANA_DEVNET_ROUTE.signerSetVersion;
  try {
    loaded = loadApprovedMessageForSubmit(
      input.stateDir,
      targetDestinationHash,
      signerSetVersion,
      input.env[BRIDGE_SUBMIT_SOURCE_MESSAGE_HASH_ENV]
    );
  } catch (err) {
    if (err instanceof Error && err.message === 'message_already_has_submit_tx') {
      return {
        ok: true,
        status: 'already_submitted',
        approvedDestinationHash: targetDestinationHash,
        simulationAttempted: false,
        simulationOk: false,
        submitAttempted: false,
        submitTxHash: null,
        duplicateSubmitBlocked: true,
        destinationTxSubmitted: false,
        error: err.message,
      };
    }
    return {
      ok: false,
      status: 'blocked_message_load',
      approvedDestinationHash: targetDestinationHash,
      simulationAttempted: false,
      simulationOk: false,
      submitAttempted: false,
      submitTxHash: null,
      duplicateSubmitBlocked: false,
      destinationTxSubmitted: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  const destinationConfig = {
    ...BASE_SEPOLIA_TO_SOLANA_DEVNET_ROUTE.solanaDestination!,
    caller: input.payer.publicKey.toBase58(),
  };
  const programId = new PublicKey(destinationConfig.programId);
  const poolConfig = new PublicKey(destinationConfig.poolConfig);
  const accounts = buildAcceptBridgeV1MintAccounts(loaded.message, poolConfig, programId, {
    signerSetVersion,
    destinationConfig,
    messageHash: targetDestinationHash,
  });
  const approval = evaluateSolanaOperatorApproval({
    destinationMessageHash: targetDestinationHash,
    sourceMessageHash: loaded.sourceMessageHash,
    route: BRIDGE_SUBMIT_ROUTE,
    approvedMessageHashes: approvedHashes(input.env),
  });
  const preview = buildSolanaAcceptBridgeMintTransactionPreview({
    message: loaded.message,
    messageHash: targetDestinationHash,
    sourceMessageHash: loaded.sourceMessageHash,
    signatures: loaded.signatures,
    signerSetVersion,
    destinationConfig,
    programId,
  });

  const simulation = await simulateSolanaAcceptBridgeMintTransactionWithGates({
    preview,
    connection: input.connection,
    accountProvider: input.connection,
    accounts,
    approval,
  });
  if (!simulation.preSubmitReadiness.readyForOperatorApproval) {
    return {
      ok: false,
      status: 'blocked_pre_submit_checks',
      approvedDestinationHash: targetDestinationHash,
      sourceMessageHash: loaded.sourceMessageHash,
      preSubmitChecks: simulation.preSubmitReadiness.status,
      preSubmitReasons: simulation.preSubmitReadiness.reasons,
      simulationAttempted: simulation.simulationAttempted,
      simulationOk: simulation.simulationOk,
      submitAttempted: false,
      submitTxHash: null,
      duplicateSubmitBlocked: false,
      destinationTxSubmitted: false,
      stateMutationObserved: false,
      error: simulation.preSubmitReadiness.reasons.join(', '),
    };
  }
  if (!simulation.simulationOk) {
    return {
      ok: false,
      status: 'blocked_simulation',
      approvedDestinationHash: targetDestinationHash,
      sourceMessageHash: loaded.sourceMessageHash,
      preSubmitChecks: simulation.preSubmitReadiness.status,
      preSubmitReasons: simulation.preSubmitReadiness.reasons,
      simulationAttempted: simulation.simulationAttempted,
      simulationOk: simulation.simulationOk,
      submitAttempted: false,
      submitTxHash: null,
      duplicateSubmitBlocked: false,
      destinationTxSubmitted: false,
      stateMutationObserved: false,
      error: simulation.error,
    };
  }

  const latest = await input.connection.getLatestBlockhash();
  preview.transaction.recentBlockhash = latest.blockhash;
  preview.transaction.feePayer = input.payer.publicKey;
  preview.transaction.partialSign(input.payer);

  try {
    input.stateStore.update(targetDestinationHash, {
      status: BridgeMessageStatus.SUBMITTED,
      attempts: loaded.state.attempts + 1,
      lastError: undefined,
    });
    const raw = preview.transaction.serialize();
    const txHash = await input.connection.sendRawTransaction(raw, {
      skipPreflight: false,
      maxRetries: 3,
    });
    const confirmation = await input.connection.confirmTransaction({
      signature: txHash,
      blockhash: latest.blockhash,
      lastValidBlockHeight: latest.lastValidBlockHeight,
    }, 'confirmed');
    if (confirmation.value.err) {
      throw new Error(`confirmation_failed:${JSON.stringify(confirmation.value.err)}`);
    }
    const consumed = await input.connection.getAccountInfo(accounts.consumedMessage);
    const commitmentIndex = await input.connection.getAccountInfo(accounts.commitmentIndex);
    input.stateStore.update(targetDestinationHash, {
      status: BridgeMessageStatus.CONFIRMED,
      submitTxHash: txHash,
      lastError: undefined,
      submittedAt: input.now?.() ?? Date.now(),
      confirmationStatus: 'confirmed',
      confirmationSlot: simulation.slot,
    });
    return {
      ok: true,
      status: 'success',
      approvedDestinationHash: targetDestinationHash,
      sourceMessageHash: loaded.sourceMessageHash,
      preSubmitChecks: simulation.preSubmitReadiness.status,
      preSubmitReasons: simulation.preSubmitReadiness.reasons,
      simulationAttempted: true,
      simulationOk: true,
      submitAttempted: true,
      submitTxHash: txHash,
      confirmationStatus: 'confirmed',
      consumedPdaCreated: Boolean(consumed),
      pendingBufferUpdated: Boolean(commitmentIndex),
      duplicateSubmitBlocked: false,
      destinationTxSubmitted: true,
      stateMutationObserved: Boolean(consumed || commitmentIndex),
    };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    input.stateStore.update(targetDestinationHash, {
      status: BridgeMessageStatus.FAILED,
      lastError: error.slice(0, 500),
    });
    return {
      ok: false,
      status: 'failed',
      approvedDestinationHash: targetDestinationHash,
      sourceMessageHash: loaded.sourceMessageHash,
      preSubmitChecks: simulation.preSubmitReadiness.status,
      preSubmitReasons: simulation.preSubmitReadiness.reasons,
      simulationAttempted: true,
      simulationOk: true,
      submitAttempted: true,
      submitTxHash: null,
      confirmationStatus: 'failed',
      duplicateSubmitBlocked: false,
      destinationTxSubmitted: false,
      stateMutationObserved: false,
      error: error.slice(0, 500),
    };
  }
}

async function main(): Promise<void> {
  const env = process.env;
  const stateDir = env.BRIDGE_DAEMON_STATE_PATH || env.STATE_DIR;
  const rpcUrl = env.SOLANA_DEVNET_RPC_URL || env.RPC_ENDPOINT;
  let targetDestinationHash = 'unknown';
  try {
    targetDestinationHash = targetDestinationHashFromEnv(env);
  } catch {
    // Reported by the env check below.
  }
  const envCheck = checkGuardedSolanaSubmitEnv(env);
  if (!envCheck.ok || !stateDir || !rpcUrl) {
    console.log(JSON.stringify({
      ok: false,
      status: 'blocked_env_or_approval',
      approvedDestinationHash: targetDestinationHash,
      envCheck,
      destinationTxSubmitted: false,
      submitTxHash: null,
    }, null, 2));
    return;
  }
  const payer = parseRelayerKeypair(env);
  const connection = new Connection(rpcUrl, 'confirmed') as unknown as SubmitConnectionLike;
  const result = await submitSolanaAcceptBridgeMintApprovedMessage({
    env,
    stateDir,
    connection,
    stateStore: new BridgeStateStore(stateDir),
    payer,
  });
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exit(1);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(JSON.stringify({
      ok: false,
      status: 'failed',
      error: err instanceof Error ? err.message : String(err),
      destinationTxSubmitted: false,
      submitTxHash: null,
    }, null, 2));
    process.exit(1);
  });
}
