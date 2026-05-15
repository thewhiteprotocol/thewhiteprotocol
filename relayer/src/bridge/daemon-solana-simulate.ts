/**
 * Hosted Solana simulation runner for an approved daemon paper-mode message.
 *
 * This command is read-only. It never sends Solana transactions and never
 * prints RPC URLs, signer material, operator tokens, or env values.
 */

import { Connection, PublicKey, Transaction, VersionedTransaction } from '@solana/web3.js';
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
  simulateSolanaAcceptBridgeMintTransactionWithGates,
  type SolanaSimulationConnectionLike,
} from './solana-adapter';
import { BridgeStateStore } from './state';

export const PR011N_SOURCE_BRIDGE_OUT_HASH =
  '0x78db644c282399fb04d304752cd492ca12e31982e50e78bb382eb836905384bc';
export const PR011N_DESTINATION_BRIDGE_MINT_HASH =
  '0xcd745c98e78eed6667f9655efa2f4725d052a9c06c4419c1c2dd8a05727f8f56';
export const PR011N_ROUTE = 'base-sepolia->solana-devnet';
export const BRIDGE_SIMULATION_DESTINATION_MESSAGE_HASH_ENV =
  'BRIDGE_SIMULATION_DESTINATION_MESSAGE_HASH';

export interface SolanaSimulationEnvCheck {
  ok: boolean;
  present: string[];
  missing: string[];
  warnings: string[];
  mode: string;
  liveSubmitEnabled: boolean;
  approvedDestinationHashPresent: boolean;
}

function hasAny(env: Record<string, string | undefined>, names: string[]): boolean {
  return names.some((name) => Boolean(env[name]));
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

export function targetDestinationHashFromEnv(
  env: Record<string, string | undefined> = process.env
): string {
  const explicit = env[BRIDGE_SIMULATION_DESTINATION_MESSAGE_HASH_ENV];
  if (explicit && /^0x[0-9a-fA-F]{64}$/.test(explicit)) {
    return normalizeHash(explicit);
  }
  const approved = approvedHashes(env)
    .map(approvalHash)
    .filter((hash) => hash !== PR011N_SOURCE_BRIDGE_OUT_HASH)
    .find(Boolean);
  return approved ?? PR011N_DESTINATION_BRIDGE_MINT_HASH;
}

export function checkSolanaSimulationEnv(
  env: Record<string, string | undefined> = process.env
): SolanaSimulationEnvCheck {
  const present: string[] = [];
  const missing: string[] = [];
  const warnings: string[] = [];

  if (hasAny(env, ['SOLANA_DEVNET_RPC_URL', 'RPC_ENDPOINT'])) {
    if (env.SOLANA_DEVNET_RPC_URL) present.push('SOLANA_DEVNET_RPC_URL');
    if (env.RPC_ENDPOINT) present.push('RPC_ENDPOINT');
  } else {
    missing.push('SOLANA_DEVNET_RPC_URL or RPC_ENDPOINT');
  }

  if (hasAny(env, ['BRIDGE_DAEMON_STATE_PATH', 'STATE_DIR'])) {
    if (env.BRIDGE_DAEMON_STATE_PATH) present.push('BRIDGE_DAEMON_STATE_PATH');
    if (env.STATE_DIR) present.push('STATE_DIR');
  } else {
    missing.push('BRIDGE_DAEMON_STATE_PATH or STATE_DIR');
  }

  if (env.BRIDGE_APPROVED_MESSAGE_HASHES) {
    present.push('BRIDGE_APPROVED_MESSAGE_HASHES');
  } else {
    missing.push('BRIDGE_APPROVED_MESSAGE_HASHES');
  }

  const targetDestinationHash = targetDestinationHashFromEnv(env);
  if (env[BRIDGE_SIMULATION_DESTINATION_MESSAGE_HASH_ENV]) {
    present.push(BRIDGE_SIMULATION_DESTINATION_MESSAGE_HASH_ENV);
  }

  const approval = evaluateSolanaOperatorApproval({
    destinationMessageHash: targetDestinationHash,
    sourceMessageHash: PR011N_SOURCE_BRIDGE_OUT_HASH,
    route: PR011N_ROUTE,
    approvedMessageHashes: approvedHashes(env),
  });
  if (!approval.approved) {
    missing.push('BRIDGE_APPROVED_MESSAGE_HASHES(destination BridgeMint hash)');
  }

  const mode = env.BRIDGE_DAEMON_MODE || 'disabled';
  if (env.BRIDGE_DAEMON_MODE) present.push('BRIDGE_DAEMON_MODE');
  else warnings.push('BRIDGE_DAEMON_MODE unset; command remains non-submitting');
  if (mode !== 'paper' && mode !== 'disabled') {
    warnings.push('BRIDGE_DAEMON_MODE must be paper or disabled for hosted simulation');
  }

  const liveSubmitEnabled = env.BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT === 'true' ||
    env.BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT === '1';
  if (env.BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT) {
    present.push('BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT');
  } else {
    present.push('BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT(unset=false)');
  }
  if (liveSubmitEnabled) {
    warnings.push('BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT must remain false');
  }

  if (env.BRIDGE_OPERATOR_API_TOKEN) present.push('BRIDGE_OPERATOR_API_TOKEN');
  if (env.BRIDGE_SIGNER_MODE) present.push('BRIDGE_SIGNER_MODE');
  if (env.BRIDGE_SIGNER_KEY_FILE) present.push('BRIDGE_SIGNER_KEY_FILE');
  if (env.BRIDGE_SIGNER_PRIVATE_KEYS_TESTNET) present.push('BRIDGE_SIGNER_PRIVATE_KEYS_TESTNET');

  return {
    ok: missing.length === 0 && warnings.length === 0,
    present: [...new Set(present)].sort(),
    missing: [...new Set(missing)].sort(),
    warnings,
    mode,
    liveSubmitEnabled,
    approvedDestinationHashPresent: approval.approved,
  };
}

function loadApprovedMessage(
  stateDir: string,
  targetDestinationHash = PR011N_DESTINATION_BRIDGE_MINT_HASH
): {
  message: BridgeMessageV1;
  signatures: string[];
  sourceMessageHash?: string;
} {
  const store = new BridgeStateStore(stateDir);
  const normalizedTarget = normalizeHash(targetDestinationHash);
  const state = store.get(normalizedTarget) ??
    store.list().find((candidate) =>
      normalizeHash(candidate.destinationMessageHash ?? candidate.messageHash) === normalizedTarget
    );
  if (!state) {
    throw new Error('approved_message_not_found_in_bridge_daemon_state');
  }
  const destinationHash = normalizeHash(state.destinationMessageHash ?? state.messageHash);
  if (destinationHash !== normalizedTarget) {
    throw new Error('destination_message_hash_mismatch');
  }
  if (state.signatureMetadata?.signerSetVersion !== 2) {
    throw new Error('signer_set_version_mismatch');
  }
  if (state.signatures.length < 2) {
    throw new Error('threshold_signatures_missing');
  }
  const message = parseBridgeMessageV1Json(state.message as unknown as Record<string, unknown>);
  const computedHash = normalizeHash(hashBridgeMessageV1(message));
  if (computedHash !== normalizedTarget) {
    throw new Error('persisted_message_hash_mismatch');
  }
  return {
    message,
    signatures: state.signatures.slice(0, 2).map((signature) => signature.signature),
    sourceMessageHash: state.sourceMessageHash,
  };
}

async function main(): Promise<void> {
  const envCheck = checkSolanaSimulationEnv(process.env);
  const stateDir = process.env.BRIDGE_DAEMON_STATE_PATH || process.env.STATE_DIR;
  const rpcUrl = process.env.SOLANA_DEVNET_RPC_URL || process.env.RPC_ENDPOINT;
  const targetDestinationHash = targetDestinationHashFromEnv(process.env);

  if (!envCheck.ok || !stateDir || !rpcUrl) {
    console.log(JSON.stringify({
      ok: false,
      status: 'blocked_env_or_approval',
      route: PR011N_ROUTE,
      approvedDestinationHash: targetDestinationHash,
      envCheck,
      destinationTxSubmitted: false,
      submitTxHash: null,
    }, null, 2));
    return;
  }

  let loaded: ReturnType<typeof loadApprovedMessage>;
  try {
    loaded = loadApprovedMessage(stateDir, targetDestinationHash);
  } catch (err) {
    console.log(JSON.stringify({
      ok: false,
      status: 'blocked_message_load',
      route: PR011N_ROUTE,
      approvedDestinationHash: targetDestinationHash,
      error: err instanceof Error ? err.message : String(err),
      destinationTxSubmitted: false,
      submitTxHash: null,
    }, null, 2));
    return;
  }

  const destinationConfig = BASE_SEPOLIA_TO_SOLANA_DEVNET_ROUTE.solanaDestination!;
  const programId = new PublicKey(destinationConfig.programId);
  const poolConfig = new PublicKey(destinationConfig.poolConfig);
  const accounts = buildAcceptBridgeV1MintAccounts(loaded.message, poolConfig, programId, {
    signerSetVersion: 2,
    destinationConfig,
    messageHash: targetDestinationHash,
  });
  const preview = buildSolanaAcceptBridgeMintTransactionPreview({
    message: loaded.message,
    messageHash: targetDestinationHash,
    sourceMessageHash: loaded.sourceMessageHash ?? PR011N_SOURCE_BRIDGE_OUT_HASH,
    signatures: loaded.signatures,
    signerSetVersion: 2,
    destinationConfig,
    programId,
  });
  const approval = evaluateSolanaOperatorApproval({
    destinationMessageHash: targetDestinationHash,
    sourceMessageHash: loaded.sourceMessageHash ?? PR011N_SOURCE_BRIDGE_OUT_HASH,
    route: PR011N_ROUTE,
    approvedMessageHashes: approvedHashes(process.env),
  });
  const connection = new Connection(rpcUrl, 'confirmed');
  const simulationConnection: SolanaSimulationConnectionLike = {
    getLatestBlockhash: () => connection.getLatestBlockhash('confirmed'),
    simulateTransaction: (transaction: Transaction | VersionedTransaction) =>
      (connection as any).simulateTransaction(transaction, {
        sigVerify: false,
        replaceRecentBlockhash: false,
      }),
  };
  const simulation = await simulateSolanaAcceptBridgeMintTransactionWithGates({
    preview,
    connection: simulationConnection,
    accounts,
    accountProvider: connection,
    approval,
  });
  const postConsumed = await connection.getAccountInfo(accounts.consumedMessage);

  console.log(JSON.stringify({
    ok: simulation.simulationOk,
    status: simulation.simulationStatus,
    route: PR011N_ROUTE,
    approvedDestinationHash: targetDestinationHash,
    sourceMessageHash: loaded.sourceMessageHash ?? PR011N_SOURCE_BRIDGE_OUT_HASH,
    preSubmitChecks: simulation.preSubmitReadiness.status,
    preSubmitReasons: simulation.preSubmitReadiness.reasons,
    simulationAttempted: simulation.simulationAttempted,
    simulationOk: simulation.simulationOk,
    simulationResult: simulation.simulationResult,
    simulationError: simulation.error ?? null,
    sigVerify: simulation.sigVerify,
    computeUnits: simulation.unitsConsumed ?? null,
    slot: simulation.slot ?? null,
    logsPreview: simulation.logsPreview,
    readyForLiveSubmit: simulation.readyForLiveSubmit,
    destinationTxSubmitted: false,
    submitTxHash: null,
    stateMutationObserved: Boolean(postConsumed),
  }, null, 2));
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
