/**
 * Bridge watcher/challenge/freeze scaffolding.
 *
 * The watcher is policy-only in PR-011A: it does not submit freeze
 * transactions. It produces deterministic findings and recommended actions
 * that an operator daemon can turn into alerts, delays, or future freezes.
 */

import type { BridgeMessageV1 } from '@thewhiteprotocol/core';
import type {
  BridgeEventObservation,
  BridgeFinalityConfig,
  BridgePolicyAction,
  BridgePolicyDecision,
  BridgeRiskFinding,
  BridgeRiskSeverity,
  BridgeRouteAssetConfig,
  BridgeRouteConfig,
} from './types';
import {
  containsPolicyReason,
  findBridgeRoutePolicy,
  findRouteAssetPolicy,
  validateBridgeSourceEvent,
  validateCrossDecimalPolicy,
  type BridgePolicyContext,
} from './policy';

export interface BridgeWatcherConfig {
  enabled: boolean;
  maxFastPathAmount?: bigint;
  manualReviewAmount?: bigint;
  finalityOverrides?: Record<string, BridgeFinalityConfig>;
}

export interface BridgeWatchInput {
  event: BridgeEventObservation;
  message: BridgeMessageV1;
  sourceChain: string;
  destinationChain: string;
  context: BridgePolicyContext;
  destinationMessage?: BridgeMessageV1;
  destinationConsumed?: boolean;
  signerSetVersionMatches?: boolean;
  expectedSignerSetVersion?: number;
  observedSignerSetVersion?: number;
  config?: Partial<BridgeWatcherConfig>;
}

export interface BridgeWatcherResult {
  enabled: boolean;
  policyDecision: BridgePolicyDecision;
  findings: BridgeRiskFinding[];
  recommendedAction: BridgePolicyAction;
}

function finding(
  code: string,
  message: string,
  severity: BridgeRiskSeverity,
  recommendedAction: BridgePolicyAction
): BridgeRiskFinding {
  return { code, message, severity, recommendedAction };
}

function severityRank(severity: BridgeRiskSeverity): number {
  switch (severity) {
    case 'critical':
      return 5;
    case 'high':
      return 4;
    case 'medium':
      return 3;
    case 'low':
      return 2;
    case 'info':
    default:
      return 1;
  }
}

function actionRank(action: BridgePolicyAction): number {
  switch (action) {
    case 'freeze':
      return 7;
    case 'reject':
      return 6;
    case 'manual_review':
      return 5;
    case 'delay':
      return 4;
    case 'alert':
      return 3;
    case 'ignore':
      return 2;
    case 'accept':
    default:
      return 1;
  }
}

function actionForPolicyReason(reason: string, action: BridgePolicyAction): BridgePolicyAction {
  if (
    reason.startsWith('unsafe_') ||
    reason.startsWith('source_tx_reverted') ||
    reason.startsWith('destination_message_already_consumed') ||
    reason.startsWith('duplicate_message_hash_state') ||
    reason.startsWith('message_hash_mismatch')
  ) {
    return 'freeze';
  }
  if (reason.startsWith('source_not_final')) return 'delay';
  if (reason.startsWith('amount_requires_manual_review')) return 'manual_review';
  if (action === 'ignore') return 'ignore';
  return action === 'accept' ? 'alert' : action;
}

function codeFromReason(reason: string): string {
  return reason.split(':')[0].trim();
}

function mergeContext(
  context: BridgePolicyContext,
  config?: Partial<BridgeWatcherConfig>
): BridgePolicyContext {
  return {
    ...context,
    finality: {
      ...context.finality,
      ...config?.finalityOverrides,
    },
    maxFastPathAmount: config?.maxFastPathAmount ?? context.maxFastPathAmount,
    manualReviewAmount: config?.manualReviewAmount ?? context.manualReviewAmount,
  };
}

function parseBigIntEnv(value: string | undefined): bigint | undefined {
  if (!value || value.trim() === '') return undefined;
  return BigInt(value);
}

export function loadBridgeWatcherConfigFromEnv(
  env: Record<string, string | undefined> = process.env
): BridgeWatcherConfig {
  const enabledRaw = env.BRIDGE_WATCHER_ENABLED?.toLowerCase();
  const enabled = enabledRaw === undefined || (enabledRaw !== '0' && enabledRaw !== 'false');
  const finalityOverrides: Record<string, BridgeFinalityConfig> = {};

  if (env.BRIDGE_FINALITY_OVERRIDES) {
    const parsed = JSON.parse(env.BRIDGE_FINALITY_OVERRIDES) as Record<
      string,
      number | Partial<BridgeFinalityConfig>
    >;
    for (const [chain, override] of Object.entries(parsed)) {
      if (typeof override === 'number') {
        finalityOverrides[chain] = { confirmations: override, maxAgeSeconds: 86_400 };
      } else if (override.confirmations !== undefined) {
        finalityOverrides[chain] = {
          confirmations: override.confirmations,
          maxAgeSeconds: override.maxAgeSeconds ?? 86_400,
          reason: override.reason,
          productionRecommendation: override.productionRecommendation,
        };
      }
    }
  }

  return {
    enabled,
    maxFastPathAmount: parseBigIntEnv(env.BRIDGE_MAX_FAST_PATH_AMOUNT),
    manualReviewAmount: parseBigIntEnv(env.BRIDGE_MANUAL_REVIEW_AMOUNT),
    finalityOverrides:
      Object.keys(finalityOverrides).length > 0 ? finalityOverrides : undefined,
  };
}

export function recommendWatcherAction(findings: BridgeRiskFinding[]): BridgePolicyAction {
  if (findings.length === 0) return 'accept';
  return findings.reduce<BridgePolicyAction>((selected, item) => {
    return actionRank(item.recommendedAction) > actionRank(selected)
      ? item.recommendedAction
      : selected;
  }, 'accept');
}

export function shouldRecommendFreeze(findings: BridgeRiskFinding[]): boolean {
  return findings.some(
    (item) => item.recommendedAction === 'freeze' || item.severity === 'critical'
  );
}

export function validateWatcherRouteAsset(
  route: BridgeRouteConfig | undefined,
  canonicalAssetId: string
): BridgeRouteAssetConfig | undefined {
  return findRouteAssetPolicy(route, canonicalAssetId);
}

export function watchBridgeMessage(input: BridgeWatchInput): BridgeWatcherResult {
  const config: BridgeWatcherConfig = {
    enabled: input.config?.enabled ?? true,
    maxFastPathAmount: input.config?.maxFastPathAmount,
    manualReviewAmount: input.config?.manualReviewAmount,
    finalityOverrides: input.config?.finalityOverrides,
  };
  const context = mergeContext(input.context, config);
  const findings: BridgeRiskFinding[] = [];

  const policyDecision = validateBridgeSourceEvent({
    event: input.event,
    message: input.message,
    sourceChain: input.sourceChain,
    destinationChain: input.destinationChain,
    context: {
      ...context,
      destinationConsumed: input.destinationConsumed ?? context.destinationConsumed,
    },
  });

  if (!policyDecision.accepted) {
    for (const reason of policyDecision.reasons) {
      findings.push(
        finding(
          codeFromReason(reason),
          reason,
          policyDecision.severity,
          actionForPolicyReason(reason, policyDecision.action)
        )
      );
    }
  }

  if (input.event.sourceTxSucceeded === false && !containsPolicyReason(policyDecision, 'source_tx')) {
    findings.push(
      finding(
        'source_tx_reverted_or_missing',
        'Source transaction was reverted or could not be verified',
        'critical',
        'freeze'
      )
    );
  }

  if (input.destinationConsumed) {
    findings.push(
      finding(
        'destination_already_consumed',
        'Destination message hash is already consumed',
        'critical',
        'freeze'
      )
    );
  }

  if (input.signerSetVersionMatches === false) {
    findings.push(
      finding(
        'signer_set_mismatch',
        `Signer set mismatch: expected=${input.expectedSignerSetVersion ?? 'unknown'}, observed=${input.observedSignerSetVersion ?? 'unknown'}`,
        'high',
        'manual_review'
      )
    );
  }

  const route = findBridgeRoutePolicy(
    context.routes,
    input.sourceChain,
    input.destinationChain
  );
  const asset = validateWatcherRouteAsset(route, input.message.canonicalAssetId);

  if (input.destinationMessage && asset) {
    const crossDecimalDecision = validateCrossDecimalPolicy(
      input.message,
      input.destinationMessage,
      asset
    );
    if (!crossDecimalDecision.accepted) {
      for (const reason of crossDecimalDecision.reasons) {
        findings.push(finding(codeFromReason(reason), reason, 'high', 'freeze'));
      }
    }
  }

  const manualReviewAmount = route?.manualReviewAmount ?? context.manualReviewAmount;
  if (manualReviewAmount !== undefined && input.message.amount >= manualReviewAmount) {
    findings.push(
      finding(
        'high_value_manual_review',
        `Message amount ${input.message.amount} meets manual review threshold ${manualReviewAmount}`,
        'medium',
        'manual_review'
      )
    );
  }

  const fastPathAmount = route?.maxFastPathAmount ?? context.maxFastPathAmount;
  if (fastPathAmount !== undefined && input.message.amount > fastPathAmount) {
    findings.push(
      finding(
        'above_fast_path_amount',
        `Message amount ${input.message.amount} exceeds fast path threshold ${fastPathAmount}`,
        'low',
        'alert'
      )
    );
  }

  findings.sort((a, b) => severityRank(b.severity) - severityRank(a.severity));

  return {
    enabled: config.enabled,
    policyDecision,
    findings,
    recommendedAction: config.enabled ? recommendWatcherAction(findings) : 'ignore',
  };
}
