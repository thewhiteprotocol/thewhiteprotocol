/**
 * Bridge watcher alerting hooks.
 *
 * Safe by default: no webhook URL means no-op, and alert dry-run defaults to
 * true. Payloads are intentionally small and sanitized.
 */

import { logger } from '../logger';
import type { BridgePolicyAction, BridgeRiskSeverity } from './types';
import type { BridgeWatcherFindingRecord } from './watcher-store';

export interface BridgeAlertConfig {
  webhookUrl?: string;
  minSeverity: BridgeRiskSeverity;
  dryRun: boolean;
  logToConsole: boolean;
}

export interface BridgeAlertStatus {
  enabled: boolean;
  dryRun: boolean;
  minSeverity: BridgeRiskSeverity;
  sink: 'noop' | 'webhook' | 'log';
}

export interface BridgeAlertPayload {
  findingId: string;
  severity: BridgeRiskSeverity;
  code: string;
  messageHash: string;
  sourceChain: string;
  destinationChain: string;
  recommendedAction: BridgePolicyAction;
  dryRun: boolean;
  createdAt: number;
  evidenceSummary: Record<string, unknown>;
}

export interface BridgeAlertResult {
  sent: boolean;
  reason?: string;
  payload?: BridgeAlertPayload;
}

export interface BridgeAlertSink {
  send(payload: BridgeAlertPayload): Promise<void>;
}

const DEFAULT_ALERT_CONFIG: BridgeAlertConfig = {
  minSeverity: 'high',
  dryRun: true,
  logToConsole: false,
};

function parseBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  const normalized = value.toLowerCase().trim();
  if (normalized === 'true' || normalized === '1' || normalized === 'yes') return true;
  if (normalized === 'false' || normalized === '0' || normalized === 'no') return false;
  return fallback;
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

function sanitizeValue(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString();
  return value;
}

function sanitizeEvidence(evidence: Record<string, unknown>): Record<string, unknown> {
  const event = evidence.event as Record<string, unknown> | undefined;
  const message = evidence.message as Record<string, unknown> | undefined;
  const policyDecision = evidence.policyDecision as Record<string, unknown> | undefined;

  return {
    policyAction: policyDecision?.action,
    policySeverity: policyDecision?.severity,
    policyReasons: Array.isArray(policyDecision?.reasons)
      ? policyDecision.reasons.slice(0, 5)
      : undefined,
    txHash: sanitizeValue(event?.txHash),
    blockNumber: sanitizeValue(event?.blockNumber),
    sourceEventKind: sanitizeValue(event?.sourceEventKind),
    confirmations: sanitizeValue(event?.confirmations),
    sourceTxSucceeded: sanitizeValue(event?.sourceTxSucceeded),
    sourceDomain: sanitizeValue(message?.sourceDomain),
    destinationDomain: sanitizeValue(message?.destinationDomain),
    canonicalAssetId: sanitizeValue(message?.canonicalAssetId),
    amount: sanitizeValue(message?.amount),
    nonce: sanitizeValue(message?.nonce),
  };
}

export function buildBridgeAlertPayload(
  finding: BridgeWatcherFindingRecord
): BridgeAlertPayload {
  return {
    findingId: finding.findingId,
    severity: finding.severity,
    code: finding.code,
    messageHash: finding.messageHash,
    sourceChain: finding.sourceChain,
    destinationChain: finding.destinationChain,
    recommendedAction: finding.recommendedAction,
    dryRun: finding.dryRun,
    createdAt: finding.createdAt,
    evidenceSummary: sanitizeEvidence(finding.evidence),
  };
}

export function loadBridgeAlertConfigFromEnv(
  env: Record<string, string | undefined> = process.env
): BridgeAlertConfig {
  return {
    webhookUrl: env.BRIDGE_ALERT_WEBHOOK_URL,
    minSeverity: (env.BRIDGE_ALERT_MIN_SEVERITY as BridgeRiskSeverity) ??
      DEFAULT_ALERT_CONFIG.minSeverity,
    dryRun: parseBool(env.BRIDGE_ALERT_DRY_RUN, DEFAULT_ALERT_CONFIG.dryRun),
    logToConsole: parseBool(env.BRIDGE_ALERT_LOG, DEFAULT_ALERT_CONFIG.logToConsole),
  };
}

export class WebhookBridgeAlertSink implements BridgeAlertSink {
  constructor(private readonly webhookUrl: string) {}

  async send(payload: BridgeAlertPayload): Promise<void> {
    const response = await fetch(this.webhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      throw new Error(`Bridge alert webhook failed: ${response.status}`);
    }
  }
}

export class LogBridgeAlertSink implements BridgeAlertSink {
  async send(payload: BridgeAlertPayload): Promise<void> {
    logger.warn('Bridge watcher alert', { ...payload });
  }
}

export class NoopBridgeAlertSink implements BridgeAlertSink {
  async send(_payload: BridgeAlertPayload): Promise<void> {
    // Intentionally empty.
  }
}

export class BridgeAlerter {
  private readonly config: BridgeAlertConfig;
  private readonly sink: BridgeAlertSink;
  private readonly sinkName: BridgeAlertStatus['sink'];

  constructor(config: Partial<BridgeAlertConfig> = {}, sink?: BridgeAlertSink) {
    this.config = { ...DEFAULT_ALERT_CONFIG, ...config };
    if (sink) {
      this.sink = sink;
      this.sinkName = this.config.webhookUrl ? 'webhook' : 'log';
    } else if (this.config.webhookUrl) {
      this.sink = new WebhookBridgeAlertSink(this.config.webhookUrl);
      this.sinkName = 'webhook';
    } else if (this.config.logToConsole) {
      this.sink = new LogBridgeAlertSink();
      this.sinkName = 'log';
    } else {
      this.sink = new NoopBridgeAlertSink();
      this.sinkName = 'noop';
    }
  }

  getStatus(): BridgeAlertStatus {
    return {
      enabled: this.sinkName !== 'noop',
      dryRun: this.config.dryRun,
      minSeverity: this.config.minSeverity,
      sink: this.sinkName,
    };
  }

  shouldAlert(finding: Pick<BridgeWatcherFindingRecord, 'severity'>): boolean {
    return severityRank(finding.severity) >= severityRank(this.config.minSeverity);
  }

  async sendFindingAlert(finding: BridgeWatcherFindingRecord): Promise<BridgeAlertResult> {
    if (!this.shouldAlert(finding)) {
      return { sent: false, reason: 'below_severity_threshold' };
    }

    const payload = buildBridgeAlertPayload(finding);

    if (this.sinkName === 'noop') {
      return { sent: false, reason: 'no_alert_sink', payload };
    }

    if (this.config.dryRun) {
      if (this.sinkName === 'log') {
        await this.sink.send(payload);
      }
      return { sent: false, reason: 'alert_dry_run', payload };
    }

    try {
      await this.sink.send(payload);
      return { sent: true, payload };
    } catch (err) {
      return {
        sent: false,
        reason: `alert_failed: ${err instanceof Error ? err.message : String(err)}`,
        payload,
      };
    }
  }
}
