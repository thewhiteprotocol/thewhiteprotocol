/**
 * Guarded one-shot Base Sepolia acceptBridgeMint submit for the approved
 * Solana Devnet -> Base Sepolia paper message.
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  createPublicClient,
  createWalletClient,
  http,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
} from 'viem';
import { privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts';
import type { BridgeMessageV1 } from '@thewhiteprotocol/core';
import { hashBridgeMessageV1 } from '@thewhiteprotocol/core';
import { getDeployerPrivateKey } from '../config';
import type { BridgeMessageState } from './types';
import {
  BRIDGE_INBOX_ABI,
  DEFAULT_BASE_BRIDGE_INBOX,
  DEFAULT_BASE_SEPOLIA_RPC_URL,
  EXPECTED_PR013A_DESTINATION_HASH,
  EXPECTED_PR013A_SOURCE_HASH,
  findApprovalMessage,
  loadApprovalConfigFromEnv,
  runSolanaToBaseApproval,
  type BaseApprovalClient,
} from './solana-to-base-approval';
import { loadDeployedBaseSignerSet } from './solana-to-base-resign-approval';

export const SOLANA_TO_BASE_SUBMIT_ROUTE = 'solana-devnet->base-sepolia';
export const BRIDGE_EVM_SUBMIT_DESTINATION_MESSAGE_HASH_ENV =
  'BRIDGE_SUBMIT_DESTINATION_MESSAGE_HASH';
export const BRIDGE_EVM_SUBMIT_SOURCE_MESSAGE_HASH_ENV =
  'BRIDGE_SUBMIT_SOURCE_MESSAGE_HASH';

export interface EvmSubmitClient extends BaseApprovalClient {
  writeContract(args: {
    address: Address;
    abi: typeof BRIDGE_INBOX_ABI;
    functionName: 'acceptBridgeMint';
    args: readonly unknown[];
    account: Address | PrivateKeyAccount;
  }): Promise<Hex>;
  waitForTransactionReceipt(args: {
    hash: Hex;
    confirmations?: number;
  }): Promise<{
    status: 'success' | 'reverted';
    transactionHash: Hex;
    blockNumber: bigint;
    gasUsed: bigint;
  }>;
}

export interface GuardedEvmSubmitEnvCheck {
  ok: boolean;
  mode: string;
  liveSubmitEnabled: boolean;
  routeAllowed: boolean;
  approvedDestinationHashPresent: boolean;
  expectedSourceHashPresent: boolean;
  expectedDestinationHashPresent: boolean;
  submitterKeyPresent: boolean;
  missing: string[];
  warnings: string[];
}

export interface GuardedEvmSubmitResult {
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
  sourceMessageHash: string;
  destinationBridgeMintHash: string;
  finalChecks: boolean;
  simulationRerun: boolean;
  simulationOk: boolean;
  submitAttempted: boolean;
  submitTx: string | null;
  confirmation: 'success' | 'reverted' | null;
  gasUsed: string | null;
  blockNumber: string | null;
  messageConsumed: boolean | null;
  commitmentInserted: boolean | null;
  duplicateSubmitBlocked: boolean;
  baseDestinationNoteStateValid: boolean;
  baseDestinationNoteStatePath: string | null;
  liveSubmitDisabledAfterWindow: boolean;
  destinationTxSubmitted: boolean;
  errors: string[];
  secretsPrinted: false;
}

function normalizeHash(value: string): string {
  return `0x${value.replace(/^0x/i, '').toLowerCase()}`;
}

function asBytes32(value: string): Hex {
  return normalizeHash(value) as Hex;
}

function truthy(value: string | undefined): boolean {
  return value === 'true' || value === '1' || value === 'yes';
}

function approvedHashPresent(env: Record<string, string | undefined>, destinationHash: string): boolean {
  const approved = env.BRIDGE_APPROVED_MESSAGE_HASHES || '';
  const normalized = normalizeHash(destinationHash);
  return approved.split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .some((item) => {
      const [route, hash] = item.split('|');
      return route === SOLANA_TO_BASE_SUBMIT_ROUTE && hash && normalizeHash(hash) === normalized;
    });
}

function isHash(value: string): boolean {
  return /^0x[0-9a-fA-F]{64}$/.test(value);
}

function normalizeBytes32(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (/^0x[0-9a-fA-F]{64}$/.test(trimmed)) return normalizeHash(trimmed);
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) return `0x${trimmed.toLowerCase()}`;
  return null;
}

function normalizeScalar(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'number') return BigInt(value).toString();
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (/^0x[0-9a-fA-F]+$/.test(trimmed)) return BigInt(trimmed).toString();
  if (/^[0-9]+$/.test(trimmed)) return BigInt(trimmed).toString();
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) return BigInt(`0x${trimmed}`).toString();
  return null;
}

function repoRoot(): string {
  let dir = process.cwd();
  while (dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, '.git'))) return dir;
    dir = path.dirname(dir);
  }
  return process.cwd();
}

function isTmpPath(filePath: string): boolean {
  const resolved = path.resolve(filePath);
  const tmpRoot = path.resolve('/tmp');
  return resolved === tmpRoot || resolved.startsWith(`${tmpRoot}${path.sep}`);
}

function isOutsideRepo(filePath: string): boolean {
  const resolved = path.resolve(filePath);
  const root = repoRoot();
  return resolved !== root && !resolved.startsWith(`${root}${path.sep}`);
}

function allowTmpBaseNoteStateForTests(env: Record<string, string | undefined>): boolean {
  return env.NODE_ENV === 'test' && env.BRIDGE_ALLOW_TMP_BASE_NOTE_STATE_FOR_TESTS === 'true';
}

function candidateBaseNoteStatePaths(
  env: Record<string, string | undefined>,
  destinationHash: string
): string[] {
  if (env.BRIDGE_BASE_NOTE_STATE_INPUT) return [path.resolve(env.BRIDGE_BASE_NOTE_STATE_INPUT)];
  const dir = env.BRIDGE_BASE_NOTE_STATE_BACKUP_DIR;
  if (!dir) return [];
  const cleanHash = normalizeHash(destinationHash);
  return [
    path.join(path.resolve(dir), `${cleanHash}.json`),
    path.join(path.resolve(dir), `${cleanHash.slice(2)}.json`),
    path.join(path.resolve(dir), `${cleanHash}.bridge-note-state.json`),
    path.join(path.resolve(dir), `${cleanHash.slice(2)}.bridge-note-state.json`),
  ];
}

export interface BaseDestinationNoteStateGate {
  ok: boolean;
  path: string | null;
  errors: string[];
  summary: {
    exists: boolean;
    sourceHashMatches: boolean;
    destinationHashMatches: boolean;
    destinationCommitmentMatches: boolean;
    amountMatches: boolean;
    assetMatches: boolean;
    hasDestSecret: boolean;
    hasDestNullifier: boolean;
    durablePath: boolean;
    outsideRepo: boolean;
  };
}

export function validateBaseDestinationNoteStateGate(input: {
  env: Record<string, string | undefined>;
  sourceHash: string;
  destinationHash: string;
  message: BridgeMessageV1;
}): BaseDestinationNoteStateGate {
  const errors: string[] = [];
  const emptySummary = {
    exists: false,
    sourceHashMatches: false,
    destinationHashMatches: false,
    destinationCommitmentMatches: false,
    amountMatches: false,
    assetMatches: false,
    hasDestSecret: false,
    hasDestNullifier: false,
    durablePath: false,
    outsideRepo: false,
  };
  const candidates = candidateBaseNoteStatePaths(input.env, input.destinationHash);
  if (candidates.length === 0) {
    return {
      ok: false,
      path: null,
      errors: ['BRIDGE_BASE_NOTE_STATE_BACKUP_DIR_or_BRIDGE_BASE_NOTE_STATE_INPUT_required'],
      summary: emptySummary,
    };
  }

  let firstSummary: BaseDestinationNoteStateGate['summary'] | null = null;
  for (const candidate of candidates) {
    const outsideRepo = isOutsideRepo(candidate);
    const durablePath = outsideRepo && (!isTmpPath(candidate) || allowTmpBaseNoteStateForTests(input.env));
    if (!fs.existsSync(candidate)) {
      if (!firstSummary) firstSummary = { ...emptySummary, outsideRepo, durablePath };
      continue;
    }

    const parsed = JSON.parse(fs.readFileSync(candidate, 'utf8')) as Record<string, unknown>;
    const sourceHash =
      normalizeBytes32(parsed.sourceMessageHash) ||
      normalizeBytes32(parsed.sourceBridgeOutHash) ||
      normalizeBytes32(parsed.sourceHash);
    const destinationHash =
      normalizeBytes32(parsed.destinationBridgeMintHash) ||
      normalizeBytes32(parsed.destinationMessageHash) ||
      normalizeBytes32(parsed.bridgeMintMessageHash);
    const commitment =
      normalizeBytes32(parsed.destinationCommitment) ||
      normalizeBytes32(parsed.destCommitment) ||
      normalizeBytes32((parsed.bridgeMintMessage as Record<string, unknown> | undefined)?.destinationCommitment) ||
      normalizeBytes32((parsed.message as Record<string, unknown> | undefined)?.destinationCommitment);
    const amount =
      normalizeScalar(parsed.destinationAmount) ||
      normalizeScalar(parsed.destAmount) ||
      normalizeScalar(parsed.amount) ||
      normalizeScalar((parsed.bridgeMintMessage as Record<string, unknown> | undefined)?.amount) ||
      normalizeScalar((parsed.message as Record<string, unknown> | undefined)?.amount);
    const asset =
      normalizeBytes32(parsed.destinationAssetId) ||
      normalizeBytes32(parsed.assetId) ||
      normalizeBytes32((parsed.bridgeMintMessage as Record<string, unknown> | undefined)?.destinationLocalAssetId) ||
      normalizeBytes32((parsed.message as Record<string, unknown> | undefined)?.destinationLocalAssetId);
    const summary = {
      exists: true,
      sourceHashMatches: sourceHash === normalizeHash(input.sourceHash),
      destinationHashMatches: destinationHash === normalizeHash(input.destinationHash),
      destinationCommitmentMatches: commitment === normalizeBytes32(input.message.destinationCommitment),
      amountMatches: amount === BigInt(input.message.amount).toString(),
      assetMatches:
        asset === normalizeBytes32(input.message.destinationLocalAssetId) ||
        asset === normalizeBytes32(input.message.canonicalAssetId),
      hasDestSecret: parsed.destSecret !== undefined && parsed.destSecret !== null && parsed.destSecret !== '',
      hasDestNullifier: parsed.destNullifier !== undefined && parsed.destNullifier !== null && parsed.destNullifier !== '',
      durablePath,
      outsideRepo,
    };
    firstSummary = summary;
    const ok = Object.values(summary).every(Boolean);
    if (ok) return { ok, path: candidate, errors: [], summary };
  }

  const summary = firstSummary || emptySummary;
  if (!summary.exists) errors.push('base_destination_note_state_missing');
  if (!summary.sourceHashMatches) errors.push('base_destination_note_state_source_hash_mismatch');
  if (!summary.destinationHashMatches) errors.push('base_destination_note_state_destination_hash_mismatch');
  if (!summary.destinationCommitmentMatches) errors.push('base_destination_note_state_commitment_mismatch');
  if (!summary.amountMatches) errors.push('base_destination_note_state_amount_mismatch');
  if (!summary.assetMatches) errors.push('base_destination_note_state_asset_mismatch');
  if (!summary.hasDestSecret) errors.push('base_destination_note_state_dest_secret_missing');
  if (!summary.hasDestNullifier) errors.push('base_destination_note_state_dest_nullifier_missing');
  if (!summary.durablePath) errors.push('base_destination_note_state_not_durable');
  return { ok: false, path: null, errors, summary };
}

function routeAllowed(env: Record<string, string | undefined>): boolean {
  return env.BRIDGE_DAEMON_ROUTES === 'solana-devnet:base-sepolia:1' ||
    env.BRIDGE_DAEMON_ROUTES === SOLANA_TO_BASE_SUBMIT_ROUTE;
}

function submitterKey(env: Record<string, string | undefined>): string | undefined {
  return env.BASE_SUBMITTER_PRIVATE_KEY ||
    getDeployerPrivateKey('base-sepolia') ||
    env.DEPLOYER_PRIVATE_KEY;
}

export function checkGuardedEvmSubmitEnv(input: {
  env?: Record<string, string | undefined>;
  sourceHash?: string;
  destinationHash?: string;
} = {}): GuardedEvmSubmitEnvCheck {
  const env = input.env ?? process.env;
  const sourceHash = normalizeHash(input.sourceHash ?? env[BRIDGE_EVM_SUBMIT_SOURCE_MESSAGE_HASH_ENV] ?? '');
  const destinationHash = normalizeHash(input.destinationHash ?? env[BRIDGE_EVM_SUBMIT_DESTINATION_MESSAGE_HASH_ENV] ?? '');
  const missing: string[] = [];
  const warnings: string[] = [];
  const mode = env.BRIDGE_DAEMON_MODE || '';
  const liveSubmitEnabled = truthy(env.BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT);
  const approvedDestinationHashPresent = approvedHashPresent(env, destinationHash);
  const expectedSourceHashPresent = isHash(sourceHash);
  const expectedDestinationHashPresent = isHash(destinationHash);
  const submitterKeyPresent = Boolean(submitterKey(env));
  const allowedRoute = routeAllowed(env);

  if (mode !== 'live-testnet') warnings.push('BRIDGE_DAEMON_MODE_must_be_live-testnet');
  if (!liveSubmitEnabled) warnings.push('BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT_must_be_true');
  if (!allowedRoute) warnings.push('BRIDGE_DAEMON_ROUTES_must_be_exact_solana_to_base_route');
  if (!approvedDestinationHashPresent) missing.push('BRIDGE_APPROVED_MESSAGE_HASHES_route_scoped_destination_hash');
  if (!expectedSourceHashPresent) missing.push(BRIDGE_EVM_SUBMIT_SOURCE_MESSAGE_HASH_ENV);
  if (!expectedDestinationHashPresent) missing.push(BRIDGE_EVM_SUBMIT_DESTINATION_MESSAGE_HASH_ENV);
  if (!submitterKeyPresent) missing.push('BASE_SUBMITTER_PRIVATE_KEY_or_base_deployer_key');

  return {
    ok: missing.length === 0 && warnings.length === 0,
    mode,
    liveSubmitEnabled,
    routeAllowed: allowedRoute,
    approvedDestinationHashPresent,
    expectedSourceHashPresent,
    expectedDestinationHashPresent,
    submitterKeyPresent,
    missing,
    warnings,
  };
}

function readStateFile(statePath: string): { filePath: string; messages: BridgeMessageState[] } {
  const filePath = fs.statSync(statePath).isDirectory()
    ? path.join(statePath, 'bridge-messages.json')
    : statePath;
  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown;
  const messages = Array.isArray(parsed)
    ? parsed as BridgeMessageState[]
    : Object.values(parsed as Record<string, BridgeMessageState>);
  return { filePath, messages };
}

function writeStateFile(filePath: string, messages: BridgeMessageState[]): void {
  fs.writeFileSync(filePath, JSON.stringify(messages, (_key, value) => {
    if (typeof value === 'bigint') return value.toString();
    return value;
  }, 2));
}

function coerceMessage(message: BridgeMessageV1): BridgeMessageV1 {
  const raw = message as any;
  return {
    ...raw,
    amount: BigInt(raw.amount),
    relayerFee: BigInt(raw.relayerFee ?? 0),
  };
}

function toViemMessage(message: BridgeMessageV1): Record<string, unknown> {
  const clean = (value: string) => asBytes32(value);
  return {
    protocolVersion: message.protocolVersion,
    messageType: message.messageType,
    sourceDomain: message.sourceDomain,
    destinationDomain: message.destinationDomain,
    sourceChainId: BigInt(message.sourceChainId),
    destinationChainId: BigInt(message.destinationChainId),
    canonicalAssetId: clean(message.canonicalAssetId),
    sourceLocalAssetId: clean(message.sourceLocalAssetId),
    destinationLocalAssetId: clean(message.destinationLocalAssetId),
    amount: BigInt(message.amount),
    sourceNullifierHash: clean(message.sourceNullifierHash),
    destinationCommitment: clean(message.destinationCommitment),
    sourceRoot: clean(message.sourceRoot),
    sourceLeafIndex: BigInt(message.sourceLeafIndex),
    sourceTxHash: clean(message.sourceTxHash),
    sourceBlockNumber: BigInt(message.sourceBlockNumber),
    sourceFinalityBlock: BigInt(message.sourceFinalityBlock),
    nonce: BigInt(message.nonce),
    deadline: BigInt(message.deadline),
    relayerFee: BigInt(message.relayerFee ?? 0),
    recipientStealthMetadataHash: clean(message.recipientStealthMetadataHash),
    memoHash: clean(message.memoHash),
    reserved0: clean(message.reserved0),
    reserved1: clean(message.reserved1),
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readMessageConsumedWithRetry(
  client: EvmSubmitClient,
  bridgeInbox: Address,
  destinationHash: string,
  attempts = 5
): Promise<boolean> {
  for (let i = 0; i < attempts; i += 1) {
    const consumed = await client.readContract({
      address: bridgeInbox,
      abi: BRIDGE_INBOX_ABI,
      functionName: 'isMessageConsumed',
      args: [destinationHash as Hex],
    }) as boolean;
    if (consumed || i === attempts - 1) return consumed;
    await sleep(1_000);
  }
  return false;
}

function redactError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw
    .replace(/https?:\/\/[^\s"']+/g, '[redacted-url]')
    .replace(/0x[a-fA-F0-9]{64,}/g, '[redacted-hex]')
    .replace(/private[_-]?key[=:][^\s,"']+/gi, '[redacted-secret]')
    .replace(/operator[_-]?token[=:][^\s,"']+/gi, '[redacted-secret]')
    .replace(/witness[=:][^\s,"']+/gi, '[redacted-secret]');
}

export async function submitSolanaToBaseApprovedMessage(input: {
  env?: Record<string, string | undefined>;
  client: EvmSubmitClient;
  account?: Address | PrivateKeyAccount;
}): Promise<GuardedEvmSubmitResult> {
  const env = input.env ?? process.env;
  const sourceHash = normalizeHash(
    env[BRIDGE_EVM_SUBMIT_SOURCE_MESSAGE_HASH_ENV] || EXPECTED_PR013A_SOURCE_HASH
  );
  const destinationHash = normalizeHash(
    env[BRIDGE_EVM_SUBMIT_DESTINATION_MESSAGE_HASH_ENV] || EXPECTED_PR013A_DESTINATION_HASH
  );
  const errors: string[] = [];
  const baseResult: GuardedEvmSubmitResult = {
    ok: false,
    status: 'blocked_env_or_approval',
    sourceMessageHash: sourceHash,
    destinationBridgeMintHash: destinationHash,
    finalChecks: false,
    simulationRerun: false,
    simulationOk: false,
    submitAttempted: false,
    submitTx: null,
    confirmation: null,
    gasUsed: null,
    blockNumber: null,
    messageConsumed: null,
    commitmentInserted: null,
    duplicateSubmitBlocked: false,
    baseDestinationNoteStateValid: false,
    baseDestinationNoteStatePath: null,
    liveSubmitDisabledAfterWindow: env.BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT_AFTER_WINDOW === 'false',
    destinationTxSubmitted: false,
    errors,
    secretsPrinted: false,
  };

  const envCheck = checkGuardedEvmSubmitEnv({ env, sourceHash, destinationHash });
  if (!envCheck.ok) {
    errors.push(...envCheck.missing, ...envCheck.warnings);
    return baseResult;
  }

  const signerSet = loadDeployedBaseSignerSet(env);
  const config = {
    ...loadApprovalConfigFromEnv(env),
    expectedSourceHash: sourceHash,
    expectedDestinationHash: destinationHash,
    deployedSignerSetVersion: signerSet.version,
    deployedThreshold: signerSet.threshold,
    deployedSignerAddresses: signerSet.signers,
  };
  let filePath: string;
  let messages: BridgeMessageState[];
  try {
    const loaded = readStateFile(config.statePath);
    filePath = loaded.filePath;
    messages = loaded.messages;
  } catch (error) {
    errors.push(`paper_state_unavailable:${redactError(error)}`);
    return { ...baseResult, status: 'blocked_message_load' };
  }
  const state = findApprovalMessage(messages, destinationHash);
  if (!state) {
    errors.push('paper_message_not_found');
    return { ...baseResult, status: 'blocked_message_load' };
  }
  if (state.submitTxHash) {
    return {
      ...baseResult,
      status: 'already_submitted',
      submitTx: state.submitTxHash,
      destinationTxSubmitted: true,
      duplicateSubmitBlocked: true,
      errors: ['message_already_has_submit_tx_hash'],
    };
  }

  const message = coerceMessage(state.message);
  if (normalizeHash(hashBridgeMessageV1(message)) !== destinationHash) {
    errors.push('destination_hash_mismatch');
    return { ...baseResult, status: 'blocked_message_load' };
  }

  const previousDaemonMode = process.env.BRIDGE_DAEMON_MODE;
  const previousLiveSubmit = process.env.BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT;
  process.env.BRIDGE_DAEMON_MODE = 'paper';
  process.env.BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT = 'false';
  let approval;
  try {
    approval = await runSolanaToBaseApproval({ config, client: input.client });
  } finally {
    if (previousDaemonMode === undefined) {
      delete process.env.BRIDGE_DAEMON_MODE;
    } else {
      process.env.BRIDGE_DAEMON_MODE = previousDaemonMode;
    }
    if (previousLiveSubmit === undefined) {
      delete process.env.BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT;
    } else {
      process.env.BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT = previousLiveSubmit;
    }
  }
  baseResult.finalChecks = approval.base.contractExists &&
    approval.base.routeEnabled === true &&
    approval.base.routePaused === false &&
    approval.base.assetSupported === true &&
    approval.base.localAssetSet === true &&
    approval.base.amountWithinCap === true &&
    approval.base.globalPaused === false &&
    approval.base.messageConsumed === false &&
    approval.base.messageFrozen === false &&
    approval.signerSet.signersMatchDeployedSet === true;
  baseResult.simulationRerun = approval.simulation.attempted;
  baseResult.simulationOk = approval.simulation.ok;
  baseResult.messageConsumed = approval.base.messageConsumed;

  if (approval.base.messageConsumed) {
    errors.push('base_message_consumed');
    return {
      ...baseResult,
      status: 'already_consumed',
      messageConsumed: true,
      duplicateSubmitBlocked: true,
    };
  }
  if (!approval.ok) {
    errors.push(...approval.errors);
    return {
      ...baseResult,
      status: approval.simulation.attempted ? 'blocked_simulation' : 'blocked_pre_submit_checks',
      duplicateSubmitBlocked: approval.errors.includes('base_message_consumed') ||
        approval.errors.includes('message_already_has_submit_tx_hash'),
    };
  }

  const noteStateGate = validateBaseDestinationNoteStateGate({
    env,
    sourceHash,
    destinationHash,
    message,
  });
  baseResult.baseDestinationNoteStateValid = noteStateGate.ok;
  baseResult.baseDestinationNoteStatePath = noteStateGate.path;
  if (!noteStateGate.ok) {
    errors.push(...noteStateGate.errors);
    return {
      ...baseResult,
      status: 'blocked_pre_submit_checks',
      baseDestinationNoteStateValid: false,
      baseDestinationNoteStatePath: noteStateGate.path,
    };
  }

  const account = input.account;
  if (!account) {
    errors.push('submitter_account_missing');
    return { ...baseResult, status: 'blocked_env_or_approval' };
  }

  const signerSetVersion = state.signatureMetadata?.signerSetVersion ?? 1;
  const args = [
    toViemMessage(message),
    state.signatures.map((sig) => sig.signature as Hex),
    BigInt(signerSetVersion),
  ] as const;

  try {
    const beforeConsumed = await input.client.readContract({
      address: config.bridgeInbox,
      abi: BRIDGE_INBOX_ABI,
      functionName: 'isMessageConsumed',
      args: [destinationHash as Hex],
    }) as boolean;
    if (beforeConsumed) {
      errors.push('base_message_consumed');
      return {
        ...baseResult,
        status: 'already_consumed',
        messageConsumed: true,
        duplicateSubmitBlocked: true,
      };
    }

    baseResult.submitAttempted = true;
    const txHash = await input.client.writeContract({
      address: config.bridgeInbox,
      abi: BRIDGE_INBOX_ABI,
      functionName: 'acceptBridgeMint',
      args,
      account,
    });
    const receipt = await input.client.waitForTransactionReceipt({
      hash: txHash,
      confirmations: 1,
    });
    const afterConsumed = await readMessageConsumedWithRetry(
      input.client,
      config.bridgeInbox,
      destinationHash
    );

    state.submitTxHash = txHash;
    state.submittedAt = Date.now();
    state.confirmationStatus = receipt.status;
    state.confirmationSlot = Number(receipt.blockNumber);
    state.updatedAt = Date.now();
    writeStateFile(filePath, messages);

    return {
      ...baseResult,
      ok: receipt.status === 'success' && afterConsumed,
      status: receipt.status === 'success' && afterConsumed ? 'success' : 'failed',
      submitTx: txHash,
      confirmation: receipt.status,
      gasUsed: receipt.gasUsed.toString(),
      blockNumber: receipt.blockNumber.toString(),
      messageConsumed: afterConsumed,
      commitmentInserted: afterConsumed,
      duplicateSubmitBlocked: afterConsumed,
      liveSubmitDisabledAfterWindow: env.BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT_AFTER_WINDOW === 'false',
      destinationTxSubmitted: true,
    };
  } catch (error) {
    errors.push(redactError(error));
    return { ...baseResult, status: 'failed' };
  }
}

function loadAccount(env: Record<string, string | undefined>): PrivateKeyAccount {
  const key = submitterKey(env);
  if (!key) throw new Error('Submitter private key missing');
  const normalized = key.startsWith('0x') ? key : `0x${key}`;
  return privateKeyToAccount(normalized as Hex);
}

async function main(): Promise<void> {
  const env = process.env;
  const account = loadAccount(env);
  const rpcUrl = env.BASE_SEPOLIA_RPC_URL || env.BASE_RPC_URL || DEFAULT_BASE_SEPOLIA_RPC_URL;
  const publicClient = createPublicClient({ transport: http(rpcUrl) }) as PublicClient;
  const walletClient = createWalletClient({
    account,
    transport: http(rpcUrl),
  }) as WalletClient;
  const client = {
    getBytecode: publicClient.getBytecode.bind(publicClient),
    readContract: publicClient.readContract.bind(publicClient),
    simulateContract: publicClient.simulateContract.bind(publicClient),
    estimateContractGas: publicClient.estimateContractGas.bind(publicClient),
    writeContract: walletClient.writeContract.bind(walletClient),
    waitForTransactionReceipt: publicClient.waitForTransactionReceipt.bind(publicClient),
  } as unknown as EvmSubmitClient;
  const report = await submitSolanaToBaseApprovedMessage({ env, client, account });
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exit(1);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(JSON.stringify({
      ok: false,
      status: 'failed',
      error: redactError(error),
      destinationTxSubmitted: false,
      secretsPrinted: false,
    }, null, 2));
    process.exit(1);
  });
}
