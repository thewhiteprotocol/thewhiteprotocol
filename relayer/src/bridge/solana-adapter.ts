/**
 * Solana Bridge Adapter — PR-010F (Skeleton)
 *
 * Provides instruction building and PDA derivation for
 * accept_bridge_v1_mint on the Solana white-protocol program.
 *
 * Full live submission is deferred until Solana devnet/testnet
 * bridge V1 accounts are deployed and funded.
 */

import { createHash } from 'crypto';
import {
  ComputeBudgetProgram,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  VersionedTransaction,
} from '@solana/web3.js';
import {
  BridgeMessageType,
  hashBridgeMessageV1,
  type BridgeMessageV1,
} from '@thewhiteprotocol/core';
import type {
  BridgeEventObservation,
  BridgeDestinationAdapter,
  BridgeSolanaDestinationConfig,
} from './types';

/** Program ID for white-protocol (devnet). */
export const WHITE_PROTOCOL_PROGRAM_ID = new PublicKey(
  'DAoezX29ingBicFfrqboD7xBeLro2b6RL77dhEbXivVD'
);

/** Seed prefixes matching the Rust program. */
export const SEEDS = {
  bridgeV1Config: Buffer.from('bridge_v1_config'),
  bridgeSignerSet: Buffer.from('bridge_signer_set'),
  consumedMessage: Buffer.from('bridge_consumed'),
  frozenMessage: Buffer.from('bridge_frozen'),
  outboundMessage: Buffer.from('bridge_outbound'),
  bridgeRoute: Buffer.from('bridge_route'),
  bridgeAsset: Buffer.from('bridge_asset'),
  pending: Buffer.from('pending'),
  commitment: Buffer.from('commitment'),
  merkleTree: Buffer.from('merkle_tree'),
  vault: Buffer.from('vault'),
} as const;

// =============================================================================
// PDA Derivation
// =============================================================================

export function deriveBridgeV1ConfigPDA(programId: PublicKey = WHITE_PROTOCOL_PROGRAM_ID): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync([SEEDS.bridgeV1Config], programId);
  return pda;
}

export function deriveBridgeSignerSetPDA(
  version: number,
  programId: PublicKey = WHITE_PROTOCOL_PROGRAM_ID
): PublicKey {
  const versionBytes = Buffer.allocUnsafe(4);
  versionBytes.writeUInt32LE(version, 0);
  const [pda] = PublicKey.findProgramAddressSync(
    [SEEDS.bridgeSignerSet, versionBytes],
    programId
  );
  return pda;
}

export function deriveConsumedMessagePDA(
  messageHash: Uint8Array,
  programId: PublicKey = WHITE_PROTOCOL_PROGRAM_ID
): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [SEEDS.consumedMessage, messageHash],
    programId
  );
  return pda;
}

export function deriveFrozenMessagePDA(
  messageHash: Uint8Array,
  programId: PublicKey = WHITE_PROTOCOL_PROGRAM_ID
): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [SEEDS.frozenMessage, messageHash],
    programId
  );
  return pda;
}

export function deriveOutboundMessagePDA(
  bridgeV1Config: PublicKey,
  messageHash: Uint8Array,
  programId: PublicKey = WHITE_PROTOCOL_PROGRAM_ID
): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [SEEDS.outboundMessage, bridgeV1Config.toBuffer(), messageHash],
    programId
  );
  return pda;
}

export function deriveBridgeRoutePDA(
  sourceDomain: number,
  destinationDomain: number,
  programId: PublicKey = WHITE_PROTOCOL_PROGRAM_ID
): PublicKey {
  const srcBytes = Buffer.allocUnsafe(4);
  srcBytes.writeUInt32LE(sourceDomain, 0);
  const dstBytes = Buffer.allocUnsafe(4);
  dstBytes.writeUInt32LE(destinationDomain, 0);
  const [pda] = PublicKey.findProgramAddressSync(
    [SEEDS.bridgeRoute, srcBytes, dstBytes],
    programId
  );
  return pda;
}

export function deriveBridgeAssetPDA(
  canonicalAssetId: Uint8Array,
  programId: PublicKey = WHITE_PROTOCOL_PROGRAM_ID
): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [SEEDS.bridgeAsset, canonicalAssetId],
    programId
  );
  return pda;
}

export function derivePendingBufferPDA(
  poolConfig: PublicKey,
  programId: PublicKey = WHITE_PROTOCOL_PROGRAM_ID
): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [SEEDS.pending, poolConfig.toBuffer()],
    programId
  );
  return pda;
}

export function deriveCommitmentIndexPDA(
  poolConfig: PublicKey,
  commitment: Uint8Array,
  programId: PublicKey = WHITE_PROTOCOL_PROGRAM_ID
): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [SEEDS.commitment, poolConfig.toBuffer(), commitment],
    programId
  );
  return pda;
}

// =============================================================================
// Instruction Builder
// =============================================================================

export interface AcceptBridgeV1MintAccounts {
  caller: PublicKey;
  bridgeV1Config: PublicKey;
  signerSet: PublicKey;
  consumedMessage: PublicKey;
  routeConfig: PublicKey;
  assetConfig: PublicKey;
  frozenMessage: PublicKey;
  poolConfig: PublicKey;
  merkleTree: PublicKey;
  pendingBuffer: PublicKey;
  assetVault: PublicKey;
  commitmentIndex: PublicKey;
  systemProgram: PublicKey;
}

export interface AcceptBridgeV1MintAccountMetasPreview {
  name: keyof AcceptBridgeV1MintAccounts;
  pubkey: string;
  isSigner: boolean;
  isWritable: boolean;
}

export type SolanaSubmitReadinessStatus =
  | 'ready_for_operator_approval'
  | 'blocked_placeholder_accounts'
  | 'blocked_hash_mismatch'
  | 'blocked_signer_set_mismatch'
  | 'blocked_rpc_state'
  | 'blocked_live_submit_not_implemented'
  | 'blocked_approval_required'
  | 'blocked_approval_hash_mismatch'
  | 'blocked_approval_expired';

export interface SolanaSubmitReadiness {
  readyForOperatorApproval: boolean;
  status: SolanaSubmitReadinessStatus;
  reasons: string[];
  checks: Record<string, 'pass' | 'fail' | 'unknown'>;
}

export interface SolanaInstructionPreview {
  programId: string;
  instruction: 'accept_bridge_v1_mint';
  accounts: Record<keyof AcceptBridgeV1MintAccounts, string>;
  accountMetas: AcceptBridgeV1MintAccountMetasPreview[];
  sourceMessageHash?: string;
  destinationMessageHash: string;
  destinationCommitment: string;
  computeBudget: string;
  liveSubmissionImplemented: boolean;
  readiness: SolanaSubmitReadiness;
}

export interface SolanaAccountMetaValidation {
  valid: boolean;
  reasons: string[];
  accountMetaCount: number;
  expectedOrder: string[];
  actualOrder: string[];
}

export type SolanaApprovalStatus =
  | 'approved'
  | 'blocked_approval_required'
  | 'blocked_approval_hash_mismatch'
  | 'blocked_approval_expired';

export interface SolanaApprovalGate {
  status: SolanaApprovalStatus;
  approved: boolean;
  approvedMessageHash?: string;
  route?: string;
  expiresAt?: number;
  reasons: string[];
}

export type SolanaSimulationStatus =
  | 'success'
  | 'failed'
  | 'skipped'
  | 'blocked_approval_required'
  | 'blocked_approval_hash_mismatch'
  | 'blocked_approval_expired'
  | 'blocked_pre_submit_checks';

export interface SolanaSimulationResult {
  simulationAttempted: boolean;
  simulationOk: boolean;
  simulationStatus: SolanaSimulationStatus;
  simulationResult: string;
  sigVerify: false;
  readyForLiveSubmit: boolean;
  logsPreview: string[];
  unitsConsumed?: number;
  slot?: number;
  blockhash?: string;
  error?: string;
}

export interface SolanaSimulationConnectionLike {
  getLatestBlockhash(): Promise<{ blockhash: string; lastValidBlockHeight?: number }>;
  simulateTransaction(
    transaction: Transaction | VersionedTransaction,
    config?: { sigVerify?: boolean; replaceRecentBlockhash?: boolean }
  ): Promise<{
    context?: { slot?: number };
    value: {
      err: unknown;
      logs?: string[] | null;
      unitsConsumed?: number;
    };
  }>;
}

export interface SolanaAcceptBridgeMintTransactionPreview {
  transaction: Transaction;
  instructions: Array<{
    programId: string;
    name: string;
    accountCount: number;
    dataLength: number;
  }>;
  accountMetas: AcceptBridgeV1MintAccountMetasPreview[];
  accountMetaValidation: SolanaAccountMetaValidation;
  messageHash: string;
  sourceMessageHash?: string;
  signerSetVersion: number;
  signatureCount: number;
  computeBudgetIncluded: boolean;
  transactionAssemblyImplemented: boolean;
  liveSubmissionImplemented: false;
  willSubmit: false;
  serializedLength: number;
  simulationStatus: 'skipped';
  simulationResult: string;
}

export interface SolanaAccountInfoLike {
  executable?: boolean;
  data?: Uint8Array | Buffer;
}

export interface SolanaReadOnlyAccountProvider {
  getAccountInfo(pubkey: PublicKey): Promise<SolanaAccountInfoLike | null>;
}

const PLACEHOLDER_ACCOUNT = '11111111111111111111111111111111';
const ACCEPT_BRIDGE_V1_MINT_IX_NAME = 'accept_bridge_v1_mint';
const DRY_RUN_RECENT_BLOCKHASH = '11111111111111111111111111111111';
const DEFAULT_COMPUTE_UNIT_LIMIT = 400_000;
const DEFAULT_COMPUTE_UNIT_PRICE_MICRO_LAMPORTS = 0;

function readU32AccountData(
  account: SolanaAccountInfoLike | null,
  offset: number,
  field: string
): number {
  if (!account?.data || account.data.length < offset + 4) {
    throw new Error(`${field}_data_unavailable`);
  }
  return Buffer.from(account.data).readUInt32LE(offset);
}

function normalizeHexHash(value: string): string {
  return `0x${value.replace(/^0x/i, '').toLowerCase()}`;
}

function isHash(value: string | undefined): value is string {
  return Boolean(value && /^0x[0-9a-fA-F]{64}$/.test(normalizeHexHash(value)));
}

function sanitizeSimulationLog(log: string): string {
  return log
    .replace(/https?:\/\/\S+/g, '[redacted-url]')
    .replace(/(api[-_]?key|token|secret|private[-_]?key)=\S+/gi, '$1=[redacted]')
    .slice(0, 500);
}

function asPublicKey(value: string, field: string): PublicKey {
  try {
    return new PublicKey(value);
  } catch {
    throw new Error(`Invalid Solana account for ${field}`);
  }
}

function deriveDryRunCallerPDA(programId: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from('bridge_dry_run_payer')],
    programId
  );
  return pda;
}

function deriveOrConfigured(
  configured: string | undefined,
  derived: PublicKey,
  field: string
): PublicKey {
  return configured ? asPublicKey(configured, field) : derived;
}

export function buildAcceptBridgeV1MintAccounts(
  message: BridgeMessageV1,
  poolConfig: PublicKey,
  programId: PublicKey = WHITE_PROTOCOL_PROGRAM_ID,
  options: {
    signerSetVersion?: number;
    destinationConfig?: BridgeSolanaDestinationConfig;
    messageHash?: string;
  } = {}
): AcceptBridgeV1MintAccounts {
  const messageHashBytes = hexToBytes(options.messageHash ?? hashBridgeMessageV1(message));
  const signerSetVersion = options.destinationConfig?.signerSetVersion ??
    options.signerSetVersion ??
    1;
  const bridgeV1Config = deriveBridgeV1ConfigPDA(programId);
  const signerSet = deriveBridgeSignerSetPDA(signerSetVersion, programId);
  const routeConfig = deriveBridgeRoutePDA(
    message.sourceDomain,
    message.destinationDomain,
    programId
  );
  const assetConfig = deriveBridgeAssetPDA(
    hexToBytes(message.canonicalAssetId),
    programId
  );
  const pendingBuffer = derivePendingBufferPDA(poolConfig, programId);

  return {
    caller: options.destinationConfig?.caller
      ? asPublicKey(options.destinationConfig.caller, 'caller')
      : deriveDryRunCallerPDA(programId),
    bridgeV1Config: deriveOrConfigured(
      options.destinationConfig?.bridgeV1Config,
      bridgeV1Config,
      'bridgeV1Config'
    ),
    signerSet: deriveOrConfigured(
      options.destinationConfig?.signerSetPda,
      signerSet,
      'signerSet'
    ),
    consumedMessage: deriveConsumedMessagePDA(messageHashBytes, programId),
    routeConfig: deriveOrConfigured(
      options.destinationConfig?.routeConfig,
      routeConfig,
      'routeConfig'
    ),
    assetConfig: deriveOrConfigured(
      options.destinationConfig?.assetConfig,
      assetConfig,
      'assetConfig'
    ),
    frozenMessage: deriveFrozenMessagePDA(messageHashBytes, programId),
    poolConfig: options.destinationConfig?.poolConfig
      ? asPublicKey(options.destinationConfig.poolConfig, 'poolConfig')
      : poolConfig,
    merkleTree: options.destinationConfig?.merkleTree
      ? asPublicKey(options.destinationConfig.merkleTree, 'merkleTree')
      : SystemProgram.programId,
    pendingBuffer: deriveOrConfigured(
      options.destinationConfig?.pendingBuffer,
      pendingBuffer,
      'pendingBuffer'
    ),
    assetVault: options.destinationConfig?.assetVault
      ? asPublicKey(options.destinationConfig.assetVault, 'assetVault')
      : SystemProgram.programId,
    commitmentIndex: deriveCommitmentIndexPDA(
      poolConfig,
      hexToBytes(message.destinationCommitment),
      programId
    ),
    systemProgram: SystemProgram.programId,
  };
}

export function buildAcceptBridgeV1MintAccountMetas(
  accounts: AcceptBridgeV1MintAccounts
): AcceptBridgeV1MintAccountMetasPreview[] {
  return [
    { name: 'caller', pubkey: accounts.caller.toBase58(), isSigner: true, isWritable: true },
    { name: 'bridgeV1Config', pubkey: accounts.bridgeV1Config.toBase58(), isSigner: false, isWritable: true },
    { name: 'signerSet', pubkey: accounts.signerSet.toBase58(), isSigner: false, isWritable: false },
    { name: 'consumedMessage', pubkey: accounts.consumedMessage.toBase58(), isSigner: false, isWritable: true },
    { name: 'routeConfig', pubkey: accounts.routeConfig.toBase58(), isSigner: false, isWritable: true },
    { name: 'assetConfig', pubkey: accounts.assetConfig.toBase58(), isSigner: false, isWritable: true },
    { name: 'frozenMessage', pubkey: accounts.frozenMessage.toBase58(), isSigner: false, isWritable: false },
    { name: 'poolConfig', pubkey: accounts.poolConfig.toBase58(), isSigner: false, isWritable: true },
    { name: 'merkleTree', pubkey: accounts.merkleTree.toBase58(), isSigner: false, isWritable: true },
    { name: 'pendingBuffer', pubkey: accounts.pendingBuffer.toBase58(), isSigner: false, isWritable: true },
    { name: 'assetVault', pubkey: accounts.assetVault.toBase58(), isSigner: false, isWritable: true },
    { name: 'commitmentIndex', pubkey: accounts.commitmentIndex.toBase58(), isSigner: false, isWritable: true },
    { name: 'systemProgram', pubkey: accounts.systemProgram.toBase58(), isSigner: false, isWritable: false },
  ];
}

export function validateSolanaAcceptBridgeMintAccountMetas(
  metas: AcceptBridgeV1MintAccountMetasPreview[],
  input: {
    accounts: Record<string, string>;
    expectedSignerSetVersion?: number;
    signerSetVersion: number;
    messageHash: string;
    destinationMessageHash: string;
    computedDestinationMessageHash?: string;
  }
): SolanaAccountMetaValidation {
  const expectedOrder = [
    'caller',
    'bridgeV1Config',
    'signerSet',
    'consumedMessage',
    'routeConfig',
    'assetConfig',
    'frozenMessage',
    'poolConfig',
    'merkleTree',
    'pendingBuffer',
    'assetVault',
    'commitmentIndex',
    'systemProgram',
  ];
  const actualOrder = metas.map((meta) => meta.name);
  const reasons: string[] = [];

  if (expectedOrder.join(',') !== actualOrder.join(',')) {
    reasons.push('account_order_mismatch');
  }

  const byName = new Map(metas.map((meta) => [meta.name, meta]));
  const expectedFlags: Record<string, { isSigner: boolean; isWritable: boolean }> = {
    caller: { isSigner: true, isWritable: true },
    bridgeV1Config: { isSigner: false, isWritable: true },
    signerSet: { isSigner: false, isWritable: false },
    consumedMessage: { isSigner: false, isWritable: true },
    routeConfig: { isSigner: false, isWritable: true },
    assetConfig: { isSigner: false, isWritable: true },
    frozenMessage: { isSigner: false, isWritable: false },
    poolConfig: { isSigner: false, isWritable: true },
    merkleTree: { isSigner: false, isWritable: true },
    pendingBuffer: { isSigner: false, isWritable: true },
    assetVault: { isSigner: false, isWritable: true },
    commitmentIndex: { isSigner: false, isWritable: true },
    systemProgram: { isSigner: false, isWritable: false },
  };
  for (const [name, expected] of Object.entries(expectedFlags)) {
    const meta = byName.get(name as keyof AcceptBridgeV1MintAccounts);
    if (!meta) {
      reasons.push(`missing_meta:${name}`);
      continue;
    }
    if (meta.isSigner !== expected.isSigner || meta.isWritable !== expected.isWritable) {
      reasons.push(`meta_flags_mismatch:${name}`);
    }
  }

  const seen = new Set<string>();
  for (const meta of metas) {
    if (seen.has(meta.pubkey) && meta.name !== 'systemProgram') {
      reasons.push(`duplicate_account:${meta.name}`);
    }
    seen.add(meta.pubkey);
  }

  for (const [name, value] of Object.entries(input.accounts)) {
    if (name === 'caller' || name === 'systemProgram') continue;
    if (value === PLACEHOLDER_ACCOUNT) reasons.push(`placeholder_account:${name}`);
  }

  if (input.messageHash.toLowerCase() !== input.destinationMessageHash.toLowerCase()) {
    reasons.push('source_hash_used_for_destination_instruction');
  }
  if (
    input.computedDestinationMessageHash !== undefined &&
    input.messageHash.toLowerCase() !== input.computedDestinationMessageHash.toLowerCase()
  ) {
    reasons.push('message_hash_does_not_match_destination_message');
  }
  if (
    input.expectedSignerSetVersion !== undefined &&
    input.signerSetVersion !== input.expectedSignerSetVersion
  ) {
    reasons.push('signer_set_version_mismatch');
  }

  return {
    valid: reasons.length === 0,
    reasons,
    accountMetaCount: metas.length,
    expectedOrder,
    actualOrder,
  };
}

export function evaluateSolanaOperatorApproval(input: {
  destinationMessageHash: string;
  sourceMessageHash?: string;
  route?: string;
  approvedMessageHashes?: string[];
  nowSeconds?: number;
}): SolanaApprovalGate {
  const approvals = (input.approvedMessageHashes ?? [])
    .map((entry) => entry.trim())
    .filter(Boolean);
  const destinationHash = normalizeHexHash(input.destinationMessageHash);
  const sourceHash = input.sourceMessageHash ? normalizeHexHash(input.sourceMessageHash) : undefined;
  const nowSeconds = input.nowSeconds ?? Math.floor(Date.now() / 1000);

  if (approvals.length === 0) {
    return {
      status: 'blocked_approval_required',
      approved: false,
      reasons: ['destination_message_hash_approval_required'],
    };
  }

  let sourceHashOnlyApproved = false;
  for (const approval of approvals) {
    let route: string | undefined;
    let hash = approval;
    let expiresAt: number | undefined;

    if (approval.includes('|')) {
      const parts = approval.split('|').map((part) => part.trim());
      if (parts.length >= 2) {
        route = parts[0] || undefined;
        hash = parts[1];
        expiresAt = parts[2] ? Number(parts[2]) : undefined;
      }
    } else if (approval.includes('=')) {
      const [routePart, hashPart] = approval.split('=').map((part) => part.trim());
      route = routePart || undefined;
      hash = hashPart;
    }

    if (!isHash(hash)) continue;
    const normalizedApprovalHash = normalizeHexHash(hash);
    if (sourceHash && normalizedApprovalHash === sourceHash) sourceHashOnlyApproved = true;
    if (normalizedApprovalHash !== destinationHash) continue;
    if (route && input.route && route !== input.route) continue;
    if (expiresAt !== undefined && Number.isFinite(expiresAt) && expiresAt <= nowSeconds) {
      return {
        status: 'blocked_approval_expired',
        approved: false,
        approvedMessageHash: destinationHash,
        route,
        expiresAt,
        reasons: ['approval_expired'],
      };
    }
    return {
      status: 'approved',
      approved: true,
      approvedMessageHash: destinationHash,
      route,
      expiresAt: Number.isFinite(expiresAt) ? expiresAt : undefined,
      reasons: [],
    };
  }

  return {
    status: 'blocked_approval_hash_mismatch',
    approved: false,
    reasons: [
      sourceHashOnlyApproved
        ? 'source_message_hash_is_not_destination_approval'
        : 'approved_destination_message_hash_not_found',
    ],
  };
}

export function evaluateSolanaSubmitReadiness(input: {
  accounts: Record<string, string>;
  sourceMessageHash?: string;
  destinationMessageHash: string;
  previewMessageHash: string;
  signerSetVersion: number;
  expectedSignerSetVersion?: number;
  liveSubmissionImplemented: boolean;
  approval?: SolanaApprovalGate;
}): SolanaSubmitReadiness {
  const checks: Record<string, 'pass' | 'fail' | 'unknown'> = {};
  const reasons: string[] = [];
  const placeholders = Object.entries(input.accounts)
    .filter(([name, value]) => name !== 'caller' && name !== 'systemProgram' && value === PLACEHOLDER_ACCOUNT)
    .map(([name]) => name);
  checks.placeholderAccounts = placeholders.length === 0 ? 'pass' : 'fail';
  if (placeholders.length > 0) reasons.push(`placeholder_accounts:${placeholders.join(',')}`);

  checks.destinationHash = input.previewMessageHash.toLowerCase() === input.destinationMessageHash.toLowerCase()
    ? 'pass'
    : 'fail';
  if (checks.destinationHash === 'fail') reasons.push('preview_message_hash_mismatch');

  checks.sourceHashPreserved = input.sourceMessageHash ? 'pass' : 'unknown';

  checks.signerSetVersion = input.expectedSignerSetVersion === undefined ||
    input.signerSetVersion === input.expectedSignerSetVersion
    ? 'pass'
    : 'fail';
  if (checks.signerSetVersion === 'fail') reasons.push('signer_set_version_mismatch');

  checks.liveSubmissionImplemented = input.liveSubmissionImplemented ? 'pass' : 'fail';
  if (!input.liveSubmissionImplemented) reasons.push('live_submit_not_implemented');

  if (input.approval) {
    checks.operatorApproval = input.approval.approved ? 'pass' : 'fail';
    reasons.push(...input.approval.reasons);
  } else {
    checks.operatorApproval = 'unknown';
  }

  if (checks.placeholderAccounts === 'fail') {
    return { readyForOperatorApproval: false, status: 'blocked_placeholder_accounts', reasons, checks };
  }
  if (checks.destinationHash === 'fail') {
    return { readyForOperatorApproval: false, status: 'blocked_hash_mismatch', reasons, checks };
  }
  if (checks.signerSetVersion === 'fail') {
    return { readyForOperatorApproval: false, status: 'blocked_signer_set_mismatch', reasons, checks };
  }
  if (input.approval && !input.approval.approved) {
    const status = input.approval.status === 'approved'
      ? 'blocked_approval_required'
      : input.approval.status;
    return { readyForOperatorApproval: false, status, reasons, checks };
  }
  if (!input.liveSubmissionImplemented) {
    return { readyForOperatorApproval: false, status: 'blocked_live_submit_not_implemented', reasons, checks };
  }
  return { readyForOperatorApproval: true, status: 'ready_for_operator_approval', reasons, checks };
}

export async function runSolanaPreSubmitReadinessChecks(
  accounts: AcceptBridgeV1MintAccounts,
  provider: SolanaReadOnlyAccountProvider
): Promise<SolanaSubmitReadiness> {
  const checks: Record<string, 'pass' | 'fail' | 'unknown'> = {};
  const reasons: string[] = [];

  async function expectExists(name: keyof AcceptBridgeV1MintAccounts): Promise<void> {
    try {
      const account = await provider.getAccountInfo(accounts[name]);
      checks[`${name}Exists`] = account ? 'pass' : 'fail';
      if (!account) reasons.push(`${name}_missing`);
    } catch {
      checks[`${name}Exists`] = 'unknown';
      reasons.push(`${name}_unknown`);
    }
  }

  async function expectAbsent(name: keyof AcceptBridgeV1MintAccounts): Promise<void> {
    try {
      const account = await provider.getAccountInfo(accounts[name]);
      checks[`${name}Absent`] = account ? 'fail' : 'pass';
      if (account) reasons.push(`${name}_already_exists`);
    } catch {
      checks[`${name}Absent`] = 'unknown';
      reasons.push(`${name}_unknown`);
    }
  }

  try {
    const program = await provider.getAccountInfo(WHITE_PROTOCOL_PROGRAM_ID);
    checks.programExecutable = program?.executable ? 'pass' : 'fail';
    if (!program?.executable) reasons.push('program_not_executable');
  } catch {
    checks.programExecutable = 'unknown';
    reasons.push('program_unknown');
  }

  await expectExists('bridgeV1Config');
  await expectExists('signerSet');
  await expectExists('routeConfig');
  await expectExists('assetConfig');
  await expectExists('pendingBuffer');
  await expectExists('poolConfig');
  await expectExists('merkleTree');
  await expectExists('assetVault');
  await expectAbsent('consumedMessage');
  await expectAbsent('frozenMessage');
  await expectAbsent('commitmentIndex');

  try {
    const [bridgeConfig, signerSet] = await Promise.all([
      provider.getAccountInfo(accounts.bridgeV1Config),
      provider.getAccountInfo(accounts.signerSet),
    ]);
    const configVersion = readU32AccountData(
      bridgeConfig,
      44,
      'bridgeV1Config.signerSetVersion'
    );
    const signerSetVersion = readU32AccountData(
      signerSet,
      8,
      'signerSet.version'
    );
    checks.signerSetVersion = configVersion === signerSetVersion ? 'pass' : 'fail';
    if (checks.signerSetVersion === 'fail') {
      reasons.push(`signer_set_version_mismatch:config=${configVersion},signerSet=${signerSetVersion}`);
    }
  } catch {
    checks.signerSetVersion = 'unknown';
    reasons.push('signer_set_version_unknown');
  }

  if (Object.values(checks).includes('unknown')) {
    return { readyForOperatorApproval: false, status: 'blocked_rpc_state', reasons, checks };
  }
  if (reasons.length > 0) {
    return { readyForOperatorApproval: false, status: 'blocked_rpc_state', reasons, checks };
  }
  return { readyForOperatorApproval: true, status: 'ready_for_operator_approval', reasons, checks };
}

function anchorDiscriminator(name: string): Buffer {
  return createHash('sha256').update(`global:${name}`).digest().subarray(0, 8);
}

function writeU16(value: number): Buffer {
  const out = Buffer.alloc(2);
  out.writeUInt16LE(value, 0);
  return out;
}

function writeU32(value: number): Buffer {
  const out = Buffer.alloc(4);
  out.writeUInt32LE(value, 0);
  return out;
}

function writeU64(value: number | bigint): Buffer {
  const out = Buffer.alloc(8);
  out.writeBigUInt64LE(BigInt(value), 0);
  return out;
}

function writeU128(value: bigint): Buffer {
  const out = Buffer.alloc(16);
  out.writeBigUInt64LE(value & ((1n << 64n) - 1n), 0);
  out.writeBigUInt64LE(value >> 64n, 8);
  return out;
}

function fixedBytes32(value: string, field: string): Buffer {
  const out = Buffer.from(value.replace(/^0x/i, ''), 'hex');
  if (out.length !== 32) throw new Error(`${field} must be 32 bytes`);
  return out;
}

function encodeBridgeMessageV1ForAnchor(message: BridgeMessageV1): Buffer {
  return Buffer.concat([
    writeU16(message.protocolVersion),
    Buffer.from([message.messageType]),
    writeU32(message.sourceDomain),
    writeU32(message.destinationDomain),
    writeU64(message.sourceChainId),
    writeU64(message.destinationChainId),
    fixedBytes32(message.canonicalAssetId, 'canonicalAssetId'),
    fixedBytes32(message.sourceLocalAssetId, 'sourceLocalAssetId'),
    fixedBytes32(message.destinationLocalAssetId, 'destinationLocalAssetId'),
    writeU128(message.amount),
    fixedBytes32(message.sourceNullifierHash, 'sourceNullifierHash'),
    fixedBytes32(message.destinationCommitment, 'destinationCommitment'),
    fixedBytes32(message.sourceRoot, 'sourceRoot'),
    writeU64(message.sourceLeafIndex),
    fixedBytes32(message.sourceTxHash, 'sourceTxHash'),
    writeU64(message.sourceBlockNumber),
    writeU64(message.sourceFinalityBlock),
    writeU64(message.nonce),
    writeU64(message.deadline),
    writeU128(message.relayerFee),
    fixedBytes32(message.recipientStealthMetadataHash, 'recipientStealthMetadataHash'),
    fixedBytes32(message.memoHash, 'memoHash'),
    fixedBytes32(message.reserved0, 'reserved0'),
    fixedBytes32(message.reserved1, 'reserved1'),
  ]);
}

function encodeSignaturesForAnchor(signatures: string[]): Buffer {
  const encoded: Buffer[] = [writeU32(signatures.length)];
  for (const signature of signatures) {
    const bytes = Buffer.from(signature.replace(/^0x/i, ''), 'hex');
    if (bytes.length !== 65) throw new Error('Bridge signature must be 65 bytes');
    encoded.push(bytes);
  }
  return Buffer.concat(encoded);
}

export function buildAcceptBridgeV1MintInstructionData(input: {
  message: BridgeMessageV1;
  signatures: string[];
  signerSetVersion: number;
}): Buffer {
  if (input.message.messageType !== BridgeMessageType.BridgeMint) {
    throw new Error('accept_bridge_v1_mint requires a BridgeMint destination message');
  }
  return Buffer.concat([
    anchorDiscriminator(ACCEPT_BRIDGE_V1_MINT_IX_NAME),
    encodeBridgeMessageV1ForAnchor(input.message),
    encodeSignaturesForAnchor(input.signatures),
    writeU32(input.signerSetVersion),
  ]);
}

export function buildSolanaAcceptBridgeMintTransactionPreview(input: {
  message: BridgeMessageV1;
  messageHash: string;
  sourceMessageHash?: string;
  signatures: string[];
  signerSetVersion: number;
  destinationConfig: BridgeSolanaDestinationConfig;
  programId?: PublicKey;
  recentBlockhash?: string;
  computeUnitLimit?: number;
  computeUnitPriceMicroLamports?: number;
}): SolanaAcceptBridgeMintTransactionPreview {
  const programId = input.programId ?? asPublicKey(input.destinationConfig.programId, 'programId');
  const poolConfig = asPublicKey(input.destinationConfig.poolConfig, 'poolConfig');
  const computedDestinationMessageHash = hashBridgeMessageV1(input.message);
  const accounts = buildAcceptBridgeV1MintAccounts(input.message, poolConfig, programId, {
    signerSetVersion: input.signerSetVersion,
    destinationConfig: input.destinationConfig,
    messageHash: input.messageHash,
  });
  const metas = buildAcceptBridgeV1MintAccountMetas(accounts);
  const accountMap = Object.fromEntries(
    Object.entries(accounts).map(([key, value]) => [key, value.toBase58()])
  ) as Record<string, string>;
  const accountMetaValidation = validateSolanaAcceptBridgeMintAccountMetas(metas, {
    accounts: accountMap,
    expectedSignerSetVersion: input.destinationConfig.signerSetVersion,
    signerSetVersion: input.signerSetVersion,
    messageHash: input.messageHash,
    destinationMessageHash: input.messageHash,
    computedDestinationMessageHash,
  });
  const bridgeInstruction = new TransactionInstruction({
    programId,
    keys: metas.map((meta) => ({
      pubkey: asPublicKey(meta.pubkey, meta.name),
      isSigner: meta.isSigner,
      isWritable: meta.isWritable,
    })),
    data: buildAcceptBridgeV1MintInstructionData({
      message: input.message,
      signatures: input.signatures,
      signerSetVersion: input.signerSetVersion,
    }),
  });
  const computeLimitIx = ComputeBudgetProgram.setComputeUnitLimit({
    units: input.computeUnitLimit ?? DEFAULT_COMPUTE_UNIT_LIMIT,
  });
  const computePriceIx = ComputeBudgetProgram.setComputeUnitPrice({
    microLamports: input.computeUnitPriceMicroLamports ?? DEFAULT_COMPUTE_UNIT_PRICE_MICRO_LAMPORTS,
  });
  const transaction = new Transaction({
    feePayer: accounts.caller,
    recentBlockhash: input.recentBlockhash ?? DRY_RUN_RECENT_BLOCKHASH,
  }).add(computeLimitIx, computePriceIx, bridgeInstruction);
  const serialized = transaction.serialize({
    requireAllSignatures: false,
    verifySignatures: false,
  });

  return {
    transaction,
    instructions: [
      {
        programId: computeLimitIx.programId.toBase58(),
        name: 'compute_budget_set_compute_unit_limit',
        accountCount: computeLimitIx.keys.length,
        dataLength: computeLimitIx.data.length,
      },
      {
        programId: computePriceIx.programId.toBase58(),
        name: 'compute_budget_set_compute_unit_price',
        accountCount: computePriceIx.keys.length,
        dataLength: computePriceIx.data.length,
      },
      {
        programId: bridgeInstruction.programId.toBase58(),
        name: ACCEPT_BRIDGE_V1_MINT_IX_NAME,
        accountCount: bridgeInstruction.keys.length,
        dataLength: bridgeInstruction.data.length,
      },
    ],
    accountMetas: metas,
    accountMetaValidation,
    messageHash: input.messageHash,
    sourceMessageHash: input.sourceMessageHash,
    signerSetVersion: input.signerSetVersion,
    signatureCount: input.signatures.length,
    computeBudgetIncluded: true,
    transactionAssemblyImplemented: true,
    liveSubmissionImplemented: false,
    willSubmit: false,
    serializedLength: serialized.length,
    simulationStatus: 'skipped',
    simulationResult: 'not_attempted_no_rpc_required',
  };
}

export async function simulateSolanaAcceptBridgeMintTransaction(
  preview: SolanaAcceptBridgeMintTransactionPreview,
  connection: SolanaSimulationConnectionLike,
  options: {
    approval?: SolanaApprovalGate;
    preSubmitReadiness?: SolanaSubmitReadiness;
  } = {}
): Promise<SolanaSimulationResult> {
  if (options.approval && !options.approval.approved) {
    const status = options.approval.status === 'approved'
      ? 'blocked_approval_required'
      : options.approval.status;
    return {
      simulationAttempted: false,
      simulationOk: false,
      simulationStatus: status,
      simulationResult: status,
      sigVerify: false,
      readyForLiveSubmit: false,
      logsPreview: [],
      error: options.approval.reasons.join(', ') || options.approval.status,
    };
  }

  if (options.preSubmitReadiness && !options.preSubmitReadiness.readyForOperatorApproval) {
    return {
      simulationAttempted: false,
      simulationOk: false,
      simulationStatus: 'blocked_pre_submit_checks',
      simulationResult: options.preSubmitReadiness.status,
      sigVerify: false,
      readyForLiveSubmit: false,
      logsPreview: [],
      error: options.preSubmitReadiness.reasons.join(', ') || options.preSubmitReadiness.status,
    };
  }

  const latest = await connection.getLatestBlockhash();
  preview.transaction.recentBlockhash = latest.blockhash;
  let result: Awaited<ReturnType<SolanaSimulationConnectionLike['simulateTransaction']>>;
  try {
    const versionedTransaction = new VersionedTransaction(preview.transaction.compileMessage());
    result = await connection.simulateTransaction(versionedTransaction, {
      sigVerify: false,
      replaceRecentBlockhash: false,
    });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return {
      simulationAttempted: true,
      simulationOk: false,
      simulationStatus: 'failed',
      simulationResult: 'failed',
      sigVerify: false,
      readyForLiveSubmit: false,
      logsPreview: [],
      blockhash: latest.blockhash,
      error: sanitizeSimulationLog(error),
    };
  }
  const logsPreview = (result.value.logs ?? [])
    .slice(0, 25)
    .map(sanitizeSimulationLog);
  const error = result.value.err ? JSON.stringify(result.value.err).slice(0, 500) : undefined;
  const simulationOk = !result.value.err;

  return {
    simulationAttempted: true,
    simulationOk,
    simulationStatus: simulationOk ? 'success' : 'failed',
    simulationResult: simulationOk ? 'ok' : 'failed',
    sigVerify: false,
    readyForLiveSubmit: simulationOk &&
      Boolean(options.approval?.approved) &&
      Boolean(options.preSubmitReadiness?.readyForOperatorApproval),
    logsPreview,
    unitsConsumed: result.value.unitsConsumed,
    slot: result.context?.slot,
    blockhash: latest.blockhash,
    error,
  };
}

export async function simulateSolanaAcceptBridgeMintTransactionWithGates(input: {
  preview: SolanaAcceptBridgeMintTransactionPreview;
  connection: SolanaSimulationConnectionLike;
  accountProvider: SolanaReadOnlyAccountProvider;
  accounts: AcceptBridgeV1MintAccounts;
  approval: SolanaApprovalGate;
}): Promise<SolanaSimulationResult & { preSubmitReadiness: SolanaSubmitReadiness }> {
  const preSubmitReadiness = await runSolanaPreSubmitReadinessChecks(
    input.accounts,
    input.accountProvider
  );
  const simulation = await simulateSolanaAcceptBridgeMintTransaction(
    input.preview,
    input.connection,
    { approval: input.approval, preSubmitReadiness }
  );
  return { ...simulation, preSubmitReadiness };
}

// =============================================================================
// Destination Adapter Skeleton
// =============================================================================

export class SolanaDestinationAdapter implements BridgeDestinationAdapter {
  async isMessageConsumed(_messageHash: string): Promise<boolean> {
    // TODO: Implement account fetch once devnet accounts are available
    return false;
  }

  async submitAcceptBridgeMint(
    _message: BridgeMessageV1,
    _signatures: string[],
    _signerSetVersion: number
  ): Promise<string> {
    // TODO: Build and submit Anchor instruction once devnet is ready
    throw new Error(
      'Solana bridge submission is not yet implemented. Use EVM bridge for E2E tests.'
    );
  }
}

// =============================================================================
// Helpers
// =============================================================================

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.replace(/^0x/, '');
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}
