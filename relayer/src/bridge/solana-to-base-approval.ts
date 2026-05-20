/**
 * Guarded Solana Devnet -> Base Sepolia approval/readiness check.
 *
 * This command is read-only. It reviews a paper-ready daemon message, checks
 * Base BridgeInbox state, and simulates acceptBridgeMint without sending a
 * transaction.
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  createPublicClient,
  http,
  parseAbi,
  type Address,
  type Hex,
  type PublicClient,
} from 'viem';
import { hashBridgeMessageV1, type BridgeMessageV1 } from '@thewhiteprotocol/core';
import { BridgeMessageStatus, type BridgeMessageState } from './types';

export const DEFAULT_PR013A_STATE_PATH = '/tmp/pr013a-solana-to-base-paper-state';
export const DEFAULT_BASE_SEPOLIA_RPC_URL = 'https://base-sepolia-rpc.publicnode.com';
export const DEFAULT_BASE_BRIDGE_INBOX =
  '0x4D4aDB460C5C882bEcbe95d0562769ECa812D1FC';
export const EXPECTED_PR013A_SOURCE_HASH =
  '0x060b4eebabf5903359ce67a06587038e70857bca9533b7c33ff521777a9a64e2';
export const EXPECTED_PR013A_DESTINATION_HASH =
  '0xddcc4a5c4c4522ae983186dc8eb10f9e3ad4d2ba36f3ca31ef386d0528a62c83';
export const SOLANA_DEVNET_DOMAIN = 0x01000002;
export const BASE_SEPOLIA_DOMAIN = 0x02000002;
export const BASE_APPROVAL_SIMULATION_ACCOUNT =
  '0x000000000000000000000000000000000000dEaD';

export const BRIDGE_INBOX_ABI = parseAbi([
  'function acceptBridgeMint((uint16 protocolVersion, uint8 messageType, uint32 sourceDomain, uint32 destinationDomain, uint64 sourceChainId, uint64 destinationChainId, bytes32 canonicalAssetId, bytes32 sourceLocalAssetId, bytes32 destinationLocalAssetId, uint128 amount, bytes32 sourceNullifierHash, bytes32 destinationCommitment, bytes32 sourceRoot, uint64 sourceLeafIndex, bytes32 sourceTxHash, uint64 sourceBlockNumber, uint64 sourceFinalityBlock, uint64 nonce, uint64 deadline, uint128 relayerFee, bytes32 recipientStealthMetadataHash, bytes32 memoHash, bytes32 reserved0, bytes32 reserved1) calldata message, bytes[] calldata signatures, uint256 signerSetVersion) external',
  'function isMessageConsumed(bytes32 messageHash) external view returns (bool)',
  'function isMessageFrozen(bytes32 messageHash) external view returns (bool)',
  'function currentSignerSetVersion() external view returns (uint256)',
  'function globalPaused() external view returns (bool)',
  'function isRouteEnabled(uint32 sourceDomain) external view returns (bool)',
  'function isRoutePaused(uint32 sourceDomain, uint32 destinationDomain) external view returns (bool)',
  'function isAssetSupported(bytes32 canonicalAssetId) external view returns (bool)',
  'function isLocalAssetSet(bytes32 canonicalAssetId) external view returns (bool)',
  'function canonicalToLocalAsset(bytes32 canonicalAssetId) external view returns (address)',
  'function maxMessageAmount(bytes32 canonicalAssetId) external view returns (uint128)',
]);

const BRIDGE_INBOX_ERROR_SELECTORS: Record<string, string> = {
  '0xb3aedac4': 'InvalidDestinationDomain',
  '0xaa686463': 'SameDomain',
  '0xa85e3fd8': 'RouteNotEnabled',
  '0x981a2a2b': 'AssetNotSupported',
  '0xcbca5aa2': 'AmountZero',
  '0x7ccf2736': 'MaxMessageAmountExceeded',
  '0x55f9e4d0': 'DailyInflowCapExceeded',
  '0x9025f6e2': 'GlobalDailyCapExceeded',
  '0x8bee704f': 'GlobalPaused',
  '0xcc293e67': 'RoutePaused',
  '0x3ca341e5': 'MessageIsFrozen',
  '0x1ab7da6b': 'DeadlineExpired',
  '0x34e886de': 'MessageAlreadyConsumed',
  '0xbab49470': 'InvalidSignerSetVersion',
  '0xaabd5a09': 'InvalidThreshold',
  '0xe5c48ac5': 'ZeroSigner',
  '0x8044bb33': 'DuplicateSigner',
  '0x59fa4a93': 'ThresholdNotMet',
  '0x8baa579f': 'InvalidSignature',
  '0x01eba551': 'SignaturesNotSorted',
  '0x815e1d64': 'InvalidSigner',
  '0x35cd0e1f': 'LocalAssetNotSet',
};

export interface SolanaToBaseApprovalConfig {
  statePath: string;
  expectedSourceHash: string;
  expectedDestinationHash: string;
  bridgeInbox: Address;
  rpcUrl?: string;
  failOnLiveSubmitEnv?: boolean;
  deployedSignerSetVersion?: number;
  deployedThreshold?: number;
  deployedSignerAddresses?: string[];
}

export interface BaseReadinessChecks {
  contractExists: boolean;
  currentSignerSetVersion: string | null;
  signerSetVersionMatches: boolean;
  globalPaused: boolean | null;
  routeEnabled: boolean | null;
  routePaused: boolean | null;
  assetSupported: boolean | null;
  localAssetSet: boolean | null;
  localAsset: string | null;
  messageConsumed: boolean | null;
  messageFrozen: boolean | null;
  maxMessageAmount: string | null;
  amountWithinCap: boolean | null;
  noOpenCriticalFinding: boolean;
}

export interface SimulationResult {
  attempted: boolean;
  ok: boolean;
  gasEstimate?: string;
  error: string | null;
}

export interface SolanaToBaseApprovalReport {
  ok: boolean;
  readiness: 'approval_ready' | 'blocked';
  generatedAt: string;
  sourceMessageHash: string;
  destinationBridgeMintHash: string;
  messageReviewed: boolean;
  paperStatePath: string;
  sourceTxHash: string | null;
  sourceSlot: number | null;
  route: string | null;
  amount: string | null;
  canonicalAssetId: string | null;
  signerSetVersion: number | null;
  signatureCount: number;
  signaturesReviewed: boolean;
  signerSet: {
    deployedVersion: number | null;
    deployedThreshold: number | null;
    deployedSignerAddresses: string[];
    recoveredSignerAddresses: string[];
    signersMatchDeployedSet: boolean | null;
  };
  submitPreview: {
    destinationChain: string | null;
    target: string | null;
    method: string | null;
    dryRun: boolean | null;
    wouldSubmit: boolean | null;
    submitTxHash: string | null;
  };
  base: BaseReadinessChecks;
  simulation: SimulationResult;
  errors: string[];
  destinationTxSubmitted: false;
  secretsPrinted: false;
}

export interface BaseApprovalClient {
  getBytecode(args: { address: Address }): Promise<Hex | undefined>;
  readContract(args: {
    address: Address;
    abi: typeof BRIDGE_INBOX_ABI;
    functionName: string;
    args?: readonly unknown[];
  }): Promise<unknown>;
  simulateContract(args: {
    address: Address;
    abi: typeof BRIDGE_INBOX_ABI;
    functionName: 'acceptBridgeMint';
    args: readonly unknown[];
    account: Address;
  }): Promise<unknown>;
  estimateContractGas(args: {
    address: Address;
    abi: typeof BRIDGE_INBOX_ABI;
    functionName: 'acceptBridgeMint';
    args: readonly unknown[];
    account: Address;
  }): Promise<bigint>;
}

function normalizeHash(value: string): string {
  return `0x${value.replace(/^0x/i, '').toLowerCase()}`;
}

function asBytes32(value: string): Hex {
  return normalizeHash(value) as Hex;
}

function readStateFile(statePath: string): BridgeMessageState[] {
  const filePath = fs.statSync(statePath).isDirectory()
    ? path.join(statePath, 'bridge-messages.json')
    : statePath;
  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown;
  if (Array.isArray(parsed)) return parsed as BridgeMessageState[];
  return Object.values(parsed as Record<string, BridgeMessageState>);
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

function redactedError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const selector = raw.match(/0x[a-fA-F0-9]{8}/)?.[0]?.toLowerCase();
  const decoded = selector ? BRIDGE_INBOX_ERROR_SELECTORS[selector] : undefined;
  const redacted = raw
    .replace(/https?:\/\/[^\s"']+/g, '[redacted-url]')
    .replace(/0x[a-fA-F0-9]{64,}/g, '[redacted-hex]')
    .replace(/private[_-]?key[=:][^\s,"']+/gi, '[redacted-secret]')
    .replace(/operator[_-]?token[=:][^\s,"']+/gi, '[redacted-secret]')
    .replace(/witness[=:][^\s,"']+/gi, '[redacted-secret]');
  return decoded ? `${decoded}: ${redacted}` : redacted;
}

export function findApprovalMessage(
  messages: BridgeMessageState[],
  expectedDestinationHash: string
): BridgeMessageState | undefined {
  const expected = normalizeHash(expectedDestinationHash);
  return messages.find((message) =>
    [message.messageHash, message.destinationMessageHash]
      .filter(Boolean)
      .map((hash) => normalizeHash(hash as string))
      .includes(expected)
  );
}

function assertNonSecretReport(report: SolanaToBaseApprovalReport): void {
  const serialized = JSON.stringify(report);
  const forbidden = [
    'privateKey',
    'PRIVATE_KEY',
    'operatorToken',
    'OPERATOR_TOKEN',
    'walletFile',
    'witness',
    'destSecret',
    'destNullifier',
  ];
  const leaked = forbidden.find((token) => serialized.includes(token));
  if (leaked) throw new Error(`approval_report_contains_sensitive_field:${leaked}`);
}

export async function runSolanaToBaseApproval(input: {
  config: SolanaToBaseApprovalConfig;
  client: BaseApprovalClient;
  now?: () => Date;
}): Promise<SolanaToBaseApprovalReport> {
  const errors: string[] = [];
  const expectedSourceHash = normalizeHash(input.config.expectedSourceHash);
  const expectedDestinationHash = normalizeHash(input.config.expectedDestinationHash);
  const messages = readStateFile(input.config.statePath);
  const messageState = findApprovalMessage(messages, expectedDestinationHash);
  const message = messageState ? coerceMessage(messageState.message) : undefined;
  const preview = messageState?.submissionPreview as any;
  const signatureCount = messageState?.signatures?.length ?? 0;
  const signerSetVersion = messageState?.signatureMetadata?.signerSetVersion ??
    (typeof preview?.signerSetVersion === 'number' ? preview.signerSetVersion : null);

  if (!messageState) errors.push('paper_message_not_found');
  if (messageState?.status !== BridgeMessageStatus.PAPER_READY_TO_SUBMIT) {
    errors.push('message_not_paper_ready_to_submit');
  }
  if (messageState?.sourceMessageHash && normalizeHash(messageState.sourceMessageHash) !== expectedSourceHash) {
    errors.push('source_hash_mismatch');
  }
  if (messageState?.destinationMessageHash && normalizeHash(messageState.destinationMessageHash) !== expectedDestinationHash) {
    errors.push('destination_hash_mismatch');
  }
  if (message && normalizeHash(hashBridgeMessageV1(message)) !== expectedDestinationHash) {
    errors.push('destination_message_hash_recompute_mismatch');
  }
  if (messageState?.messageHash && normalizeHash(messageState.messageHash) === expectedSourceHash) {
    errors.push('source_hash_used_as_destination_hash');
  }
  if (preview?.target && preview.target.toLowerCase() !== input.config.bridgeInbox.toLowerCase()) {
    errors.push('preview_target_mismatch');
  }
  if (preview?.method !== 'acceptBridgeMint') errors.push('preview_method_not_accept_bridge_mint');
  if (preview?.destinationChain !== 'base-sepolia') errors.push('preview_destination_not_base_sepolia');
  if (preview?.dryRun !== true) errors.push('preview_not_dry_run');
  if (preview?.wouldSubmit !== true) errors.push('preview_would_submit_not_true');
  if (messageState?.submitTxHash) errors.push('message_already_has_submit_tx_hash');
  if (signatureCount < 2) errors.push('insufficient_signatures');
  const recoveredSignerAddresses = (messageState?.signatures ?? []).map((sig) => sig.signerAddress);
  const deployedSignerAddresses = (input.config.deployedSignerAddresses ?? []).map((address) => address.toLowerCase());
  const deployedThreshold = input.config.deployedThreshold ?? null;
  const signaturesMatchingDeployedSet = recoveredSignerAddresses.filter((address) =>
    deployedSignerAddresses.includes(address.toLowerCase())
  );
  const signersMatchDeployedSet = input.config.deployedSignerAddresses
    ? deployedThreshold !== null &&
      signaturesMatchingDeployedSet.length >= deployedThreshold &&
      recoveredSignerAddresses.every((address) => deployedSignerAddresses.includes(address.toLowerCase()))
    : null;
  if (signersMatchDeployedSet === false) {
    errors.push('signatures_do_not_match_deployed_signer_set');
  }
  if (messageState?.finalitySatisfied !== true) errors.push('source_finality_not_satisfied');
  if (messageState?.policyDecision?.accepted !== true) errors.push('policy_not_accepted');
  if (process.env.BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT === 'true') errors.push('live_submit_enabled');
  if (process.env.BRIDGE_DAEMON_MODE && process.env.BRIDGE_DAEMON_MODE !== 'paper') {
    errors.push('daemon_mode_not_paper');
  }

  const base: BaseReadinessChecks = {
    contractExists: false,
    currentSignerSetVersion: null,
    signerSetVersionMatches: false,
    globalPaused: null,
    routeEnabled: null,
    routePaused: null,
    assetSupported: null,
    localAssetSet: null,
    localAsset: null,
    messageConsumed: null,
    messageFrozen: null,
    maxMessageAmount: null,
    amountWithinCap: null,
    noOpenCriticalFinding: true,
  };

  const simulation: SimulationResult = {
    attempted: false,
    ok: false,
    error: null,
  };

  if (message) {
    try {
      const bytecode = await input.client.getBytecode({ address: input.config.bridgeInbox });
      base.contractExists = Boolean(bytecode && bytecode !== '0x');
      if (!base.contractExists) errors.push('base_bridge_inbox_contract_missing');

      const [
        currentSignerSetVersion,
        globalPaused,
        routeEnabled,
        routePaused,
        assetSupported,
        localAssetSet,
        localAsset,
        messageConsumed,
        messageFrozen,
        maxMessageAmount,
      ] = await Promise.all([
        input.client.readContract({
          address: input.config.bridgeInbox,
          abi: BRIDGE_INBOX_ABI,
          functionName: 'currentSignerSetVersion',
        }) as Promise<bigint>,
        input.client.readContract({
          address: input.config.bridgeInbox,
          abi: BRIDGE_INBOX_ABI,
          functionName: 'globalPaused',
        }) as Promise<boolean>,
        input.client.readContract({
          address: input.config.bridgeInbox,
          abi: BRIDGE_INBOX_ABI,
          functionName: 'isRouteEnabled',
          args: [SOLANA_DEVNET_DOMAIN],
        }) as Promise<boolean>,
        input.client.readContract({
          address: input.config.bridgeInbox,
          abi: BRIDGE_INBOX_ABI,
          functionName: 'isRoutePaused',
          args: [SOLANA_DEVNET_DOMAIN, BASE_SEPOLIA_DOMAIN],
        }) as Promise<boolean>,
        input.client.readContract({
          address: input.config.bridgeInbox,
          abi: BRIDGE_INBOX_ABI,
          functionName: 'isAssetSupported',
          args: [asBytes32(message.canonicalAssetId)],
        }) as Promise<boolean>,
        input.client.readContract({
          address: input.config.bridgeInbox,
          abi: BRIDGE_INBOX_ABI,
          functionName: 'isLocalAssetSet',
          args: [asBytes32(message.canonicalAssetId)],
        }) as Promise<boolean>,
        input.client.readContract({
          address: input.config.bridgeInbox,
          abi: BRIDGE_INBOX_ABI,
          functionName: 'canonicalToLocalAsset',
          args: [asBytes32(message.canonicalAssetId)],
        }) as Promise<string>,
        input.client.readContract({
          address: input.config.bridgeInbox,
          abi: BRIDGE_INBOX_ABI,
          functionName: 'isMessageConsumed',
          args: [expectedDestinationHash as Hex],
        }) as Promise<boolean>,
        input.client.readContract({
          address: input.config.bridgeInbox,
          abi: BRIDGE_INBOX_ABI,
          functionName: 'isMessageFrozen',
          args: [expectedDestinationHash as Hex],
        }) as Promise<boolean>,
        input.client.readContract({
          address: input.config.bridgeInbox,
          abi: BRIDGE_INBOX_ABI,
          functionName: 'maxMessageAmount',
          args: [asBytes32(message.canonicalAssetId)],
        }) as Promise<bigint>,
      ]);

      base.currentSignerSetVersion = currentSignerSetVersion.toString();
      base.signerSetVersionMatches = signerSetVersion !== null &&
        BigInt(signerSetVersion) === currentSignerSetVersion;
      base.globalPaused = globalPaused;
      base.routeEnabled = routeEnabled;
      base.routePaused = routePaused;
      base.assetSupported = assetSupported;
      base.localAssetSet = localAssetSet;
      base.localAsset = localAsset;
      base.messageConsumed = messageConsumed;
      base.messageFrozen = messageFrozen;
      base.maxMessageAmount = maxMessageAmount.toString();
      base.amountWithinCap = maxMessageAmount === 0n || BigInt(message.amount) <= maxMessageAmount;

      if (!base.signerSetVersionMatches) errors.push('signer_set_version_mismatch');
      if (base.globalPaused) errors.push('base_global_paused');
      if (!base.routeEnabled) errors.push('base_route_not_enabled');
      if (base.routePaused) errors.push('base_route_paused');
      if (!base.assetSupported) errors.push('base_asset_not_supported');
      if (!base.localAssetSet) errors.push('base_local_asset_not_set');
      if (base.messageConsumed) errors.push('base_message_consumed');
      if (base.messageFrozen) errors.push('base_message_frozen');
      if (!base.amountWithinCap) errors.push('base_amount_over_cap');

      simulation.attempted = true;
      const signatures = messageState?.signatures ?? [];
      const args = [
        toViemMessage(message),
        signatures.map((sig) => sig.signature as Hex),
        BigInt(signerSetVersion ?? 0),
      ] as const;
      await input.client.simulateContract({
        address: input.config.bridgeInbox,
        abi: BRIDGE_INBOX_ABI,
        functionName: 'acceptBridgeMint',
        args,
        account: BASE_APPROVAL_SIMULATION_ACCOUNT,
      });
      const gasEstimate = await input.client.estimateContractGas({
        address: input.config.bridgeInbox,
        abi: BRIDGE_INBOX_ABI,
        functionName: 'acceptBridgeMint',
        args,
        account: BASE_APPROVAL_SIMULATION_ACCOUNT,
      });
      simulation.ok = true;
      simulation.gasEstimate = gasEstimate.toString();
    } catch (error) {
      simulation.error = redactedError(error);
      errors.push('base_simulation_failed');
    }
  }

  const report: SolanaToBaseApprovalReport = {
    ok: errors.length === 0 && simulation.ok,
    readiness: errors.length === 0 && simulation.ok ? 'approval_ready' : 'blocked',
    generatedAt: (input.now ?? (() => new Date()))().toISOString(),
    sourceMessageHash: expectedSourceHash,
    destinationBridgeMintHash: expectedDestinationHash,
    messageReviewed: Boolean(messageState),
    paperStatePath: input.config.statePath,
    sourceTxHash: messageState?.sourceTxHash ?? null,
    sourceSlot: messageState?.sourceBlockNumber ?? null,
    route: messageState ? `${messageState.sourceChain}->${messageState.destinationChain}` : null,
    amount: messageState?.amount ?? null,
    canonicalAssetId: messageState?.canonicalAssetId ?? null,
    signerSetVersion,
    signatureCount,
    signaturesReviewed: signatureCount >= 2,
    signerSet: {
      deployedVersion: input.config.deployedSignerSetVersion ?? null,
      deployedThreshold,
      deployedSignerAddresses: input.config.deployedSignerAddresses ?? [],
      recoveredSignerAddresses,
      signersMatchDeployedSet,
    },
    submitPreview: {
      destinationChain: preview?.destinationChain ?? null,
      target: preview?.target ?? null,
      method: preview?.method ?? null,
      dryRun: preview?.dryRun ?? null,
      wouldSubmit: preview?.wouldSubmit ?? null,
      submitTxHash: messageState?.submitTxHash ?? null,
    },
    base,
    simulation,
    errors: [...new Set(errors)],
    destinationTxSubmitted: false,
    secretsPrinted: false,
  };
  assertNonSecretReport(report);
  return report;
}

export function loadApprovalConfigFromEnv(
  env: Record<string, string | undefined> = process.env
): SolanaToBaseApprovalConfig {
  return {
    statePath: env.BRIDGE_SOLANA_TO_BASE_APPROVAL_STATE_PATH ||
      env.BRIDGE_DAEMON_STATE_PATH ||
      DEFAULT_PR013A_STATE_PATH,
    expectedSourceHash: env.BRIDGE_EXPECTED_SOURCE_MESSAGE_HASH ||
      env.BRIDGE_DAEMON_EXPECTED_SOURCE_MESSAGE_HASH ||
      EXPECTED_PR013A_SOURCE_HASH,
    expectedDestinationHash: env.BRIDGE_EXPECTED_DESTINATION_MESSAGE_HASH ||
      env.BRIDGE_DAEMON_EXPECTED_DESTINATION_MESSAGE_HASH ||
      EXPECTED_PR013A_DESTINATION_HASH,
    bridgeInbox: (env.BASE_BRIDGE_INBOX_ADDRESS ||
      env.BRIDGE_BASE_SEPOLIA_INBOX_ADDRESS ||
      DEFAULT_BASE_BRIDGE_INBOX) as Address,
    rpcUrl: env.BASE_SEPOLIA_RPC_URL || env.BASE_RPC_URL || DEFAULT_BASE_SEPOLIA_RPC_URL,
    deployedSignerSetVersion: env.BRIDGE_DEPLOYED_SIGNER_SET_VERSION
      ? Number(env.BRIDGE_DEPLOYED_SIGNER_SET_VERSION)
      : undefined,
    deployedThreshold: env.BRIDGE_DEPLOYED_SIGNER_THRESHOLD
      ? Number(env.BRIDGE_DEPLOYED_SIGNER_THRESHOLD)
      : undefined,
    deployedSignerAddresses: env.BRIDGE_DEPLOYED_SIGNER_ADDRESSES
      ? env.BRIDGE_DEPLOYED_SIGNER_ADDRESSES.split(',').map((address) => address.trim()).filter(Boolean)
      : undefined,
  };
}

async function main(): Promise<void> {
  const config = loadApprovalConfigFromEnv();
  const client = createPublicClient({
    transport: http(config.rpcUrl),
  }) as PublicClient as BaseApprovalClient;
  const report = await runSolanaToBaseApproval({ config, client });
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exit(1);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(JSON.stringify({
      ok: false,
      readiness: 'blocked',
      error: redactedError(error),
      destinationTxSubmitted: false,
      secretsPrinted: false,
    }, null, 2));
    process.exit(1);
  });
}
