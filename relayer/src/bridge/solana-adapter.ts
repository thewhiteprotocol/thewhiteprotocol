/**
 * Solana Bridge Adapter — PR-010F (Skeleton)
 *
 * Provides instruction building and PDA derivation for
 * accept_bridge_v1_mint on the Solana white-protocol program.
 *
 * Full live submission is deferred until Solana devnet/testnet
 * bridge V1 accounts are deployed and funded.
 */

import { PublicKey, SystemProgram } from '@solana/web3.js';
import { hashBridgeMessageV1, type BridgeMessageV1 } from '@thewhiteprotocol/core';
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
  | 'blocked_live_submit_not_implemented';

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

export interface SolanaAccountInfoLike {
  executable?: boolean;
}

export interface SolanaReadOnlyAccountProvider {
  getAccountInfo(pubkey: PublicKey): Promise<SolanaAccountInfoLike | null>;
}

const PLACEHOLDER_ACCOUNT = '11111111111111111111111111111111';

function asPublicKey(value: string, field: string): PublicKey {
  try {
    return new PublicKey(value);
  } catch {
    throw new Error(`Invalid Solana account for ${field}`);
  }
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
      : poolConfig,
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
  };
}

export function buildAcceptBridgeV1MintAccountMetas(
  accounts: AcceptBridgeV1MintAccounts
): AcceptBridgeV1MintAccountMetasPreview[] {
  return [
    { name: 'caller', pubkey: accounts.caller.toBase58(), isSigner: true, isWritable: true },
    { name: 'bridgeV1Config', pubkey: accounts.bridgeV1Config.toBase58(), isSigner: false, isWritable: false },
    { name: 'signerSet', pubkey: accounts.signerSet.toBase58(), isSigner: false, isWritable: false },
    { name: 'consumedMessage', pubkey: accounts.consumedMessage.toBase58(), isSigner: false, isWritable: true },
    { name: 'routeConfig', pubkey: accounts.routeConfig.toBase58(), isSigner: false, isWritable: false },
    { name: 'assetConfig', pubkey: accounts.assetConfig.toBase58(), isSigner: false, isWritable: false },
    { name: 'frozenMessage', pubkey: accounts.frozenMessage.toBase58(), isSigner: false, isWritable: false },
    { name: 'poolConfig', pubkey: accounts.poolConfig.toBase58(), isSigner: false, isWritable: true },
    { name: 'merkleTree', pubkey: accounts.merkleTree.toBase58(), isSigner: false, isWritable: true },
    { name: 'pendingBuffer', pubkey: accounts.pendingBuffer.toBase58(), isSigner: false, isWritable: true },
    { name: 'assetVault', pubkey: accounts.assetVault.toBase58(), isSigner: false, isWritable: true },
    { name: 'commitmentIndex', pubkey: accounts.commitmentIndex.toBase58(), isSigner: false, isWritable: true },
  ];
}

export function evaluateSolanaSubmitReadiness(input: {
  accounts: Record<string, string>;
  sourceMessageHash?: string;
  destinationMessageHash: string;
  previewMessageHash: string;
  signerSetVersion: number;
  expectedSignerSetVersion?: number;
  liveSubmissionImplemented: boolean;
}): SolanaSubmitReadiness {
  const checks: Record<string, 'pass' | 'fail' | 'unknown'> = {};
  const reasons: string[] = [];
  const placeholders = Object.entries(input.accounts)
    .filter(([name, value]) => name !== 'caller' && value === PLACEHOLDER_ACCOUNT)
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

  if (checks.placeholderAccounts === 'fail') {
    return { readyForOperatorApproval: false, status: 'blocked_placeholder_accounts', reasons, checks };
  }
  if (checks.destinationHash === 'fail') {
    return { readyForOperatorApproval: false, status: 'blocked_hash_mismatch', reasons, checks };
  }
  if (checks.signerSetVersion === 'fail') {
    return { readyForOperatorApproval: false, status: 'blocked_signer_set_mismatch', reasons, checks };
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

  if (Object.values(checks).includes('unknown')) {
    return { readyForOperatorApproval: false, status: 'blocked_rpc_state', reasons, checks };
  }
  if (reasons.length > 0) {
    return { readyForOperatorApproval: false, status: 'blocked_rpc_state', reasons, checks };
  }
  return { readyForOperatorApproval: true, status: 'ready_for_operator_approval', reasons, checks };
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
