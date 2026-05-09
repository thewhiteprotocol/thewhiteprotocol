/**
 * Bridge production acceptance policy.
 *
 * This module is intentionally deterministic and RPC-free. Runtime adapters
 * provide observations; policy decides whether the relayer is allowed to sign.
 */

import {
  BridgeMessageType,
  hashBridgeMessageV1,
  validateBridgeMessageV1,
  type BridgeMessageV1,
} from '@thewhiteprotocol/core';
import type {
  BridgeChainPolicyConfig,
  BridgeEventObservation,
  BridgeFinalityConfig,
  BridgePolicyAction,
  BridgePolicyDecision,
  BridgeRiskSeverity,
  BridgeRouteAssetConfig,
  BridgeRouteConfig,
  BridgeSourceEventKind,
} from './types';

export const DEFAULT_BRIDGE_FINALITY: Record<string, BridgeFinalityConfig> = {
  'base-sepolia': {
    confirmations: 3,
    maxAgeSeconds: 86_400,
    reason: 'Base Sepolia testnet route uses short finality for E2E speed.',
    productionRecommendation: 'Use conservative L2 finality and L1 derivation checks before mainnet.',
  },
  'ethereum-sepolia': {
    confirmations: 12,
    maxAgeSeconds: 86_400,
    reason: 'Ethereum Sepolia testnet route waits multiple L1 blocks.',
    productionRecommendation: 'Use finalized/checkpointed L1 data for mainnet policy.',
  },
  'bsc-testnet': {
    confirmations: 15,
    maxAgeSeconds: 86_400,
    reason: 'BNB testnet route uses additional confirmations because public RPC state can lag.',
    productionRecommendation: 'Use chain-specific finality assumptions and redundant RPCs.',
  },
  'polygon-amoy': {
    confirmations: 64,
    maxAgeSeconds: 86_400,
    reason: 'Polygon Amoy route uses a larger testnet confirmation window.',
    productionRecommendation: 'Use checkpoint/finality-aware policy for Polygon mainnet.',
  },
  'solana-devnet': {
    confirmations: 32,
    maxAgeSeconds: 86_400,
    reason: 'Solana Devnet source events should be confirmed/finalized before attestation.',
    productionRecommendation: 'Require finalized commitment and slot/root monitoring before mainnet.',
  },
};

export const DEFAULT_BRIDGE_CHAINS: Record<string, BridgeChainPolicyConfig> = {
  'base-sepolia': {
    chainKey: 'base-sepolia',
    family: 'evm',
    domainId: 0x02000002,
    chainId: 84532,
    finality: DEFAULT_BRIDGE_FINALITY['base-sepolia'],
  },
  'ethereum-sepolia': {
    chainKey: 'ethereum-sepolia',
    family: 'evm',
    domainId: 0x02000003,
    chainId: 11155111,
    finality: DEFAULT_BRIDGE_FINALITY['ethereum-sepolia'],
  },
  'polygon-amoy': {
    chainKey: 'polygon-amoy',
    family: 'evm',
    domainId: 0x02000004,
    chainId: 80002,
    finality: DEFAULT_BRIDGE_FINALITY['polygon-amoy'],
  },
  'bsc-testnet': {
    chainKey: 'bsc-testnet',
    family: 'evm',
    domainId: 0x02000006,
    chainId: 97,
    finality: DEFAULT_BRIDGE_FINALITY['bsc-testnet'],
  },
  'solana-devnet': {
    chainKey: 'solana-devnet',
    family: 'solana',
    domainId: 0x01000002,
    chainId: 0,
    solanaProgramId: 'DAoezX29ingBicFfrqboD7xBeLro2b6RL77dhEbXivVD',
    finality: DEFAULT_BRIDGE_FINALITY['solana-devnet'],
  },
};

export interface BridgePolicyContext {
  chains?: Record<string, BridgeChainPolicyConfig>;
  routes: BridgeRouteConfig[];
  finality?: Record<string, BridgeFinalityConfig>;
  nowSeconds?: number;
  currentBlockNumber?: number;
  stateHasMessage?: boolean;
  destinationConsumed?: boolean;
  maxFastPathAmount?: bigint;
  manualReviewAmount?: bigint;
}

export interface ValidateBridgeSourceEventArgs {
  event: BridgeEventObservation;
  message: BridgeMessageV1;
  sourceChain: string;
  destinationChain: string;
  context: BridgePolicyContext;
}

function cleanHex(value: string): string {
  return value.replace(/^0x/i, '').toLowerCase();
}

function normalizeHash(value: string): string {
  return `0x${cleanHex(value)}`;
}

function normalizeAddress(value: string): string {
  return value.toLowerCase();
}

function hasReason(reasons: string[], prefix: string): boolean {
  return reasons.some((reason) => reason.startsWith(prefix));
}

function decision(
  accepted: boolean,
  action: BridgePolicyAction,
  severity: BridgeRiskSeverity,
  reasons: string[]
): BridgePolicyDecision {
  return { accepted, action, severity, reasons };
}

export function getBridgeChainPolicy(
  chainKey: string,
  context?: Pick<BridgePolicyContext, 'chains' | 'finality'>
): BridgeChainPolicyConfig | undefined {
  const chain = context?.chains?.[chainKey] ?? DEFAULT_BRIDGE_CHAINS[chainKey];
  if (!chain) return undefined;
  return {
    ...chain,
    finality: context?.finality?.[chainKey] ?? chain.finality,
  };
}

export function findBridgeRoutePolicy(
  routes: BridgeRouteConfig[],
  source: string,
  destination: string
): BridgeRouteConfig | undefined {
  return routes.find((route) => route.source === source && route.destination === destination);
}

export function getSourceEventKind(
  event: BridgeEventObservation,
  sourceChain: BridgeChainPolicyConfig
): BridgeSourceEventKind {
  if (event.sourceEventKind) return event.sourceEventKind;
  return sourceChain.family === 'evm'
    ? 'evm_bridge_outbox_bridge_out_initiated'
    : 'unknown';
}

export function isProductionBridgeSourceEvent(
  event: BridgeEventObservation,
  sourceChain: BridgeChainPolicyConfig
): BridgePolicyDecision {
  const kind = getSourceEventKind(event, sourceChain);
  const reasons: string[] = [];

  if (kind === 'solana_init_bridge_v1_out') {
    return decision(false, 'ignore', 'critical', [
      'unsafe_solana_init_bridge_v1_out: message-level/test-only Solana event must be ignored',
    ]);
  }
  if (kind === 'evm_bridge_outbox_direct') {
    return decision(false, 'reject', 'critical', [
      'unsafe_evm_direct_outbox_event: direct/message-level BridgeOutbox event is not source-bound',
    ]);
  }
  if (kind === 'unknown') {
    return decision(false, 'reject', 'high', [
      'unknown_source_event_kind: source-bound event marker is required',
    ]);
  }

  if (sourceChain.family === 'solana') {
    if (kind !== 'solana_bridge_out_v1_with_proof') {
      return decision(false, 'reject', 'critical', [
        `invalid_solana_source_event_kind: ${kind}`,
      ]);
    }
    if (event.sourceBoundProofMarker !== 'bridge_out_v1_with_proof') {
      return decision(false, 'reject', 'critical', [
        'missing_solana_source_bound_proof_marker',
      ]);
    }
    if (event.sourceAddress && sourceChain.solanaProgramId) {
      if (event.sourceAddress !== sourceChain.solanaProgramId) {
        reasons.push('wrong_solana_program_id');
      }
    }
  }

  if (sourceChain.family === 'evm') {
    if (kind !== 'evm_bridge_out_v1' && kind !== 'evm_bridge_outbox_bridge_out_initiated') {
      return decision(false, 'reject', 'critical', [`invalid_evm_source_event_kind: ${kind}`]);
    }
    if (event.sourceAddress && sourceChain.bridgeOutboxAddress) {
      if (normalizeAddress(event.sourceAddress) !== normalizeAddress(sourceChain.bridgeOutboxAddress)) {
        reasons.push('wrong_evm_bridge_outbox_address');
      }
    }
  }

  if (reasons.length > 0) {
    return decision(false, 'reject', 'high', reasons);
  }
  return decision(true, 'accept', 'info', []);
}

export function validateFinalityPolicy(
  event: BridgeEventObservation,
  sourceChain: string,
  context: BridgePolicyContext
): BridgePolicyDecision {
  const chain = getBridgeChainPolicy(sourceChain, context);
  const finality = context.finality?.[sourceChain] ?? chain?.finality;
  if (!finality) {
    return decision(false, 'reject', 'high', [`missing_finality_config: ${sourceChain}`]);
  }

  if (event.sourceTxSucceeded === false) {
    return decision(false, 'reject', 'critical', ['source_tx_reverted_or_missing']);
  }

  const confirmations = event.confirmations ??
    (context.currentBlockNumber !== undefined
      ? Math.max(0, context.currentBlockNumber - event.blockNumber)
      : undefined);

  if (confirmations !== undefined && confirmations < finality.confirmations) {
    return decision(false, 'delay', 'medium', [
      `source_not_final: confirmations=${confirmations}, required=${finality.confirmations}`,
    ]);
  }

  return decision(true, 'accept', 'info', []);
}

export function validateRoutePolicy(
  message: BridgeMessageV1,
  sourceChain: string,
  destinationChain: string,
  context: BridgePolicyContext
): BridgePolicyDecision {
  const route = findBridgeRoutePolicy(context.routes, sourceChain, destinationChain);
  if (!route) {
    return decision(false, 'reject', 'high', [
      `unsupported_route: ${sourceChain}->${destinationChain}`,
    ]);
  }
  if (!route.enabled || route.status === 'disabled') {
    return decision(false, 'reject', 'high', [
      `route_disabled: ${sourceChain}->${destinationChain}`,
    ]);
  }
  if (route.status === 'manual-review') {
    return decision(false, 'manual_review', 'medium', [
      `route_requires_manual_review: ${sourceChain}->${destinationChain}`,
    ]);
  }

  const source = getBridgeChainPolicy(sourceChain, context);
  const destination = getBridgeChainPolicy(destinationChain, context);
  const reasons: string[] = [];
  if (source && message.sourceDomain !== source.domainId) {
    reasons.push(`wrong_source_domain: expected=${source.domainId}, got=${message.sourceDomain}`);
  }
  if (destination && message.destinationDomain !== destination.domainId) {
    reasons.push(
      `wrong_destination_domain: expected=${destination.domainId}, got=${message.destinationDomain}`
    );
  }
  if (source?.chainId !== undefined && message.sourceChainId !== source.chainId) {
    reasons.push(`wrong_source_chain_id: expected=${source.chainId}, got=${message.sourceChainId}`);
  }
  if (destination?.chainId !== undefined && message.destinationChainId !== destination.chainId) {
    reasons.push(
      `wrong_destination_chain_id: expected=${destination.chainId}, got=${message.destinationChainId}`
    );
  }

  if (reasons.length > 0) {
    return decision(false, 'reject', 'high', reasons);
  }
  return decision(true, 'accept', 'info', []);
}

export function findRouteAssetPolicy(
  route: BridgeRouteConfig | undefined,
  canonicalAssetId: string
): BridgeRouteAssetConfig | undefined {
  return route?.assets?.find(
    (asset) => cleanHex(asset.canonicalAssetId) === cleanHex(canonicalAssetId)
  );
}

export function validateAssetPolicy(
  message: BridgeMessageV1,
  sourceChain: string,
  destinationChain: string,
  context: BridgePolicyContext
): BridgePolicyDecision {
  const route = findBridgeRoutePolicy(context.routes, sourceChain, destinationChain);
  if (!route?.assets || route.assets.length === 0) {
    return decision(true, 'accept', 'info', []);
  }

  const asset = findRouteAssetPolicy(route, message.canonicalAssetId);
  if (!asset) {
    return decision(false, 'reject', 'high', [
      `unsupported_asset: ${message.canonicalAssetId}`,
    ]);
  }

  const capUnits = asset.capAmountUnits ??
    (asset.sourceDecimals === asset.destinationDecimals ? 'source' : 'destination');
  if (capUnits === 'source') {
    return validateAmountPolicy(message.amount, asset, route, context);
  }

  return decision(true, 'accept', 'info', []);
}

export function validateAmountPolicy(
  amount: bigint,
  asset: Pick<BridgeRouteAssetConfig, 'maxMessageAmount' | 'dailyCap'>,
  route?: Pick<BridgeRouteConfig, 'maxFastPathAmount' | 'manualReviewAmount'>,
  context?: Pick<BridgePolicyContext, 'maxFastPathAmount' | 'manualReviewAmount'>
): BridgePolicyDecision {
  if (asset.maxMessageAmount > 0n && amount > asset.maxMessageAmount) {
    return decision(false, 'reject', 'high', [
      `amount_over_max_message_amount: amount=${amount}, max=${asset.maxMessageAmount}`,
    ]);
  }
  if (asset.dailyCap > 0n && amount > asset.dailyCap) {
    return decision(false, 'reject', 'high', [
      `amount_over_daily_cap: amount=${amount}, dailyCap=${asset.dailyCap}`,
    ]);
  }

  const manualReviewAmount = route?.manualReviewAmount ?? context?.manualReviewAmount;
  if (manualReviewAmount !== undefined && amount >= manualReviewAmount) {
    return decision(false, 'manual_review', 'medium', [
      `amount_requires_manual_review: amount=${amount}, threshold=${manualReviewAmount}`,
    ]);
  }

  return decision(true, 'accept', 'info', []);
}

export function validateCrossDecimalPolicy(
  sourceMessage: BridgeMessageV1,
  destinationMessage: BridgeMessageV1,
  asset: BridgeRouteAssetConfig
): BridgePolicyDecision {
  if (asset.normalizationMode !== 'exact-decimal') {
    return decision(true, 'accept', 'info', []);
  }

  let expected: bigint;
  if (asset.sourceDecimals === asset.destinationDecimals) {
    expected = sourceMessage.amount;
  } else if (asset.sourceDecimals > asset.destinationDecimals) {
    const factor = 10n ** BigInt(asset.sourceDecimals - asset.destinationDecimals);
    if (sourceMessage.amount % factor !== 0n) {
      return decision(false, 'reject', 'high', [
        `cross_decimal_non_divisible: amount=${sourceMessage.amount}, factor=${factor}`,
      ]);
    }
    expected = sourceMessage.amount / factor;
  } else {
    const factor = 10n ** BigInt(asset.destinationDecimals - asset.sourceDecimals);
    expected = sourceMessage.amount * factor;
  }

  if (destinationMessage.amount !== expected) {
    return decision(false, 'reject', 'high', [
      `cross_decimal_mismatch: expected=${expected}, got=${destinationMessage.amount}`,
    ]);
  }
  return validateAmountPolicy(destinationMessage.amount, asset);
}

export function validateBridgeSourceEvent({
  event,
  message,
  sourceChain,
  destinationChain,
  context,
}: ValidateBridgeSourceEventArgs): BridgePolicyDecision {
  const reasons: string[] = [];
  const nowSeconds = context.nowSeconds ?? Math.floor(Date.now() / 1000);
  const source = getBridgeChainPolicy(sourceChain, context);
  if (!source) {
    return decision(false, 'reject', 'high', [`unknown_source_chain: ${sourceChain}`]);
  }

  const sourceEventDecision = isProductionBridgeSourceEvent(event, source);
  if (!sourceEventDecision.accepted) return sourceEventDecision;

  const validationErrors = validateBridgeMessageV1(message);
  if (validationErrors.length > 0) {
    return decision(false, 'reject', 'high', [
      ...validationErrors.map((error) => `invalid_message_${error.field}: ${error.code}`),
    ]);
  }

  if (message.messageType !== BridgeMessageType.BridgeOut) {
    reasons.push(`invalid_source_message_type: ${message.messageType}`);
  }

  const computedHash = hashBridgeMessageV1(message);
  if (normalizeHash(event.messageHash) !== normalizeHash(computedHash)) {
    reasons.push(`message_hash_mismatch: expected=${computedHash}, got=${event.messageHash}`);
  }
  if (event.destinationDomain !== message.destinationDomain) {
    reasons.push(
      `event_destination_domain_mismatch: event=${event.destinationDomain}, message=${message.destinationDomain}`
    );
  }
  if (cleanHex(event.canonicalAssetId) !== cleanHex(message.canonicalAssetId)) {
    reasons.push('event_canonical_asset_mismatch');
  }
  if (event.amount !== message.amount) {
    reasons.push(`event_amount_mismatch: event=${event.amount}, message=${message.amount}`);
  }
  if (event.nonce !== message.nonce) {
    reasons.push(`event_nonce_mismatch: event=${event.nonce}, message=${message.nonce}`);
  }
  if (message.deadline < nowSeconds) {
    reasons.push(`expired_deadline: deadline=${message.deadline}, now=${nowSeconds}`);
  }

  if (context.stateHasMessage) {
    reasons.push('duplicate_message_hash_state');
  }
  if (context.destinationConsumed) {
    reasons.push('destination_message_already_consumed');
  }

  if (reasons.length > 0) {
    return decision(false, 'reject', 'high', reasons);
  }

  for (const policyDecision of [
    validateRoutePolicy(message, sourceChain, destinationChain, context),
    validateAssetPolicy(message, sourceChain, destinationChain, context),
    validateFinalityPolicy(event, sourceChain, context),
  ]) {
    if (!policyDecision.accepted) return policyDecision;
  }

  return decision(true, 'accept', 'info', []);
}

export function shouldRelayerSign(decision: BridgePolicyDecision): boolean {
  return decision.accepted && decision.action === 'accept' && decision.reasons.length === 0;
}

export function rejectUnsafeMessageLevelEvent(
  eventKind: BridgeSourceEventKind
): BridgePolicyDecision {
  if (eventKind === 'solana_init_bridge_v1_out') {
    return decision(false, 'ignore', 'critical', [
      'unsafe_solana_init_bridge_v1_out: production relayers must ignore this event',
    ]);
  }
  if (eventKind === 'evm_bridge_outbox_direct') {
    return decision(false, 'reject', 'critical', [
      'unsafe_evm_direct_outbox_event: production relayers must reject this event',
    ]);
  }
  return decision(true, 'accept', 'info', []);
}

export function summarizePolicyDecision(decision: BridgePolicyDecision): string {
  if (decision.accepted) return 'accepted';
  const primary = decision.reasons[0] ?? decision.action;
  return `${decision.action}: ${primary}`;
}

export function containsPolicyReason(decision: BridgePolicyDecision, reasonPrefix: string): boolean {
  return hasReason(decision.reasons, reasonPrefix);
}
