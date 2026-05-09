/**
 * Daemon-capable bridge watcher service.
 *
 * Disabled and dry-run by default. The daemon evaluates tracked bridge messages
 * and explicit source observations, persists findings, and optionally builds
 * freeze previews. It does not submit live freeze transactions unless an
 * executor is injected and auto-freeze is explicitly enabled with dry-run off.
 */

import { encodeBridgeMessageV1, hashBridgeMessageV1, parseBridgeMessageV1Json, type BridgeMessageV1 } from '@thewhiteprotocol/core';
import { BridgeStateStore } from './state';
import type {
  BridgeEventObservation,
  BridgeFinalityConfig,
  BridgeRiskSeverity,
  BridgeRouteConfig,
} from './types';
import { DEFAULT_BRIDGE_FINALITY, type BridgePolicyContext } from './policy';
import { watchBridgeMessage, type BridgeWatchInput, type BridgeWatcherResult } from './watcher';
import {
  BridgeWatcherFindingStore,
  type BridgeWatcherFindingRecord,
} from './watcher-store';
import {
  BridgeFreezeActionBuilder,
  type BridgeFreezeActionExecutor,
  type BridgeFreezePreview,
} from './freeze-actions';
import {
  BridgeAlerter,
  loadBridgeAlertConfigFromEnv,
  type BridgeAlertStatus,
} from './alerts';
import { logger } from '../logger';

export interface BridgeWatcherDaemonConfig {
  enabled: boolean;
  dryRun: boolean;
  intervalMs: number;
  maxFindingsPerTick: number;
  autoFreeze: boolean;
  minSeverityToFreeze: BridgeRiskSeverity;
  findingRetentionDays: number;
}

export interface BridgeWatcherDaemonStatus {
  enabled: boolean;
  running: boolean;
  dryRun: boolean;
  autoFreeze: boolean;
  intervalMs: number;
  maxFindingsPerTick: number;
  minSeverityToFreeze: BridgeRiskSeverity;
  findingRetentionDays: number;
  lastTickAt?: number;
  lastTickDurationMs?: number;
  lastError?: string;
  findingsBySeverity: Record<string, number>;
  findingsByStatus: Record<string, number>;
  openFindings: number;
  totalFindings: number;
  alerting: BridgeAlertStatus;
}

export interface BridgeWatcherTickResult {
  enabled: boolean;
  evaluated: number;
  findingsPersisted: number;
  freezePreviews: BridgeFreezePreview[];
  freezeSubmissions: string[];
  alertsSent: number;
  findingsCleaned: number;
  skipped: string[];
}

export interface BridgeWatcherDaemonOptions {
  stateStore: BridgeStateStore;
  findingStore: BridgeWatcherFindingStore;
  routes: BridgeRouteConfig[];
  finality?: Record<string, BridgeFinalityConfig>;
  context?: Partial<BridgePolicyContext>;
  config?: Partial<BridgeWatcherDaemonConfig>;
  freezeActions?: BridgeFreezeActionExecutor;
  alerter?: BridgeAlerter;
}

const DEFAULT_DAEMON_CONFIG: BridgeWatcherDaemonConfig = {
  enabled: false,
  dryRun: true,
  intervalMs: 30_000,
  maxFindingsPerTick: 100,
  autoFreeze: false,
  minSeverityToFreeze: 'critical',
  findingRetentionDays: 30,
};

function parseBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  const normalized = value.toLowerCase().trim();
  if (normalized === 'true' || normalized === '1' || normalized === 'yes') return true;
  if (normalized === 'false' || normalized === '0' || normalized === 'no') return false;
  return fallback;
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
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

function hexFromBytes(bytes: Uint8Array): string {
  return `0x${Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

function buildEventFromState(message: BridgeMessageV1, state: { sourceTxHash: string; sourceBlockNumber: number }): BridgeEventObservation {
  const encoded = encodeBridgeMessageV1(message);
  return {
    messageHash: hashBridgeMessageV1(message),
    destinationDomain: message.destinationDomain,
    canonicalAssetId: message.canonicalAssetId,
    amount: message.amount,
    nonce: message.nonce,
    encodedMessage: hexFromBytes(encoded),
    txHash: state.sourceTxHash,
    blockNumber: state.sourceBlockNumber,
    sourceTxSucceeded: true,
  };
}

export function loadBridgeWatcherDaemonConfigFromEnv(
  env: Record<string, string | undefined> = process.env
): BridgeWatcherDaemonConfig {
  return {
    enabled: parseBool(env.BRIDGE_WATCHER_ENABLED, DEFAULT_DAEMON_CONFIG.enabled),
    dryRun: parseBool(env.BRIDGE_WATCHER_DRY_RUN, DEFAULT_DAEMON_CONFIG.dryRun),
    intervalMs: parsePositiveInt(
      env.BRIDGE_WATCHER_INTERVAL_MS,
      DEFAULT_DAEMON_CONFIG.intervalMs
    ),
    maxFindingsPerTick: parsePositiveInt(
      env.BRIDGE_WATCHER_MAX_FINDINGS_PER_TICK,
      DEFAULT_DAEMON_CONFIG.maxFindingsPerTick
    ),
    autoFreeze: parseBool(env.BRIDGE_WATCHER_AUTO_FREEZE, DEFAULT_DAEMON_CONFIG.autoFreeze),
    minSeverityToFreeze: (env.BRIDGE_WATCHER_MIN_SEVERITY_TO_FREEZE as BridgeRiskSeverity) ||
      DEFAULT_DAEMON_CONFIG.minSeverityToFreeze,
    findingRetentionDays: parsePositiveInt(
      env.BRIDGE_WATCHER_FINDING_RETENTION_DAYS,
      DEFAULT_DAEMON_CONFIG.findingRetentionDays
    ),
  };
}

export class BridgeWatcherDaemon {
  private readonly stateStore: BridgeStateStore;
  private readonly findingStore: BridgeWatcherFindingStore;
  private readonly routes: BridgeRouteConfig[];
  private readonly finality: Record<string, BridgeFinalityConfig>;
  private readonly context: Partial<BridgePolicyContext>;
  private readonly config: BridgeWatcherDaemonConfig;
  private readonly freezeActions: BridgeFreezeActionExecutor;
  private readonly alerter: BridgeAlerter;
  private readonly observations = new Map<string, BridgeWatchInput>();
  private timer?: NodeJS.Timeout;
  private lastTickAt?: number;
  private lastTickDurationMs?: number;
  private lastError?: string;

  constructor(options: BridgeWatcherDaemonOptions) {
    this.stateStore = options.stateStore;
    this.findingStore = options.findingStore;
    this.routes = options.routes;
    this.finality = options.finality ?? DEFAULT_BRIDGE_FINALITY;
    this.context = options.context ?? {};
    this.config = { ...DEFAULT_DAEMON_CONFIG, ...options.config };
    this.freezeActions = options.freezeActions ?? new BridgeFreezeActionBuilder();
    this.alerter = options.alerter ?? new BridgeAlerter(loadBridgeAlertConfigFromEnv());
  }

  isEnabled(): boolean {
    return this.config.enabled;
  }

  isRunning(): boolean {
    return this.timer !== undefined;
  }

  start(): void {
    if (!this.config.enabled || this.timer) return;
    this.timer = setInterval(() => {
      this.tick().catch((err) => {
        this.lastError = err instanceof Error ? err.message : String(err);
        logger.error('Bridge watcher tick failed', { error: this.lastError });
      });
    }, this.config.intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  getStatus(): BridgeWatcherDaemonStatus {
    const findings = this.findingStore.list();
    const findingsBySeverity = findings.reduce<Record<string, number>>((acc, finding) => {
      acc[finding.severity] = (acc[finding.severity] ?? 0) + 1;
      return acc;
    }, {});
    const findingsByStatus = findings.reduce<Record<string, number>>((acc, finding) => {
      acc[finding.status] = (acc[finding.status] ?? 0) + 1;
      return acc;
    }, {});

    return {
      enabled: this.config.enabled,
      running: this.isRunning(),
      dryRun: this.config.dryRun,
      autoFreeze: this.config.autoFreeze,
      intervalMs: this.config.intervalMs,
      maxFindingsPerTick: this.config.maxFindingsPerTick,
      minSeverityToFreeze: this.config.minSeverityToFreeze,
      findingRetentionDays: this.config.findingRetentionDays,
      lastTickAt: this.lastTickAt,
      lastTickDurationMs: this.lastTickDurationMs,
      lastError: this.lastError,
      findingsBySeverity,
      findingsByStatus,
      openFindings: findings.filter((finding) => finding.status === 'open').length,
      totalFindings: findings.length,
      alerting: this.alerter.getStatus(),
    };
  }

  recordObservation(input: BridgeWatchInput): void {
    const key = input.event.messageHash.toLowerCase();
    this.observations.set(key, input);
  }

  getFindingStore(): BridgeWatcherFindingStore {
    return this.findingStore;
  }

  async freezeDryRun(findingId: string): Promise<BridgeFreezePreview> {
    const finding = this.findingStore.get(findingId);
    if (!finding) {
      throw new Error(`Watcher finding not found: ${findingId}`);
    }
    return this.freezeActions.buildFreezePreview(finding);
  }

  private buildInputs(): BridgeWatchInput[] {
    const inputs: BridgeWatchInput[] = [];
    const seen = new Set<string>();

    for (const state of this.stateStore.list()) {
      const message = parseBridgeMessageV1Json(state.message);
      const messageHash = hashBridgeMessageV1(message).toLowerCase();
      const observed = this.observations.get(messageHash);
      if (observed) {
        inputs.push(observed);
      } else {
        inputs.push({
          event: buildEventFromState(message, state),
          message,
          sourceChain: state.sourceChain,
          destinationChain: state.destinationChain,
          context: this.buildPolicyContext(),
        });
      }
      seen.add(messageHash);
    }

    for (const [messageHash, observed] of this.observations.entries()) {
      if (!seen.has(messageHash)) {
        inputs.push(observed);
      }
    }

    return inputs;
  }

  private buildPolicyContext(): BridgePolicyContext {
    return {
      routes: this.routes,
      finality: this.finality,
      ...this.context,
    };
  }

  private persistWatcherResult(
    input: BridgeWatchInput,
    result: BridgeWatcherResult,
    remainingFindings: number
  ): BridgeWatcherFindingRecord[] {
    const records: BridgeWatcherFindingRecord[] = [];
    const messageHash = input.event.messageHash.toLowerCase();

    for (const finding of result.findings) {
      if (records.length >= remainingFindings) break;
      records.push(
        this.findingStore.upsert({
          messageHash,
          sourceChain: input.sourceChain,
          destinationChain: input.destinationChain,
          severity: finding.severity,
          code: finding.code,
          reason: finding.message,
          recommendedAction: finding.recommendedAction,
          dryRun: this.config.dryRun,
          evidence: {
            policyDecision: result.policyDecision,
            event: {
              txHash: input.event.txHash,
              blockNumber: input.event.blockNumber,
              sourceEventKind: input.event.sourceEventKind,
              sourceAddress: input.event.sourceAddress,
              confirmations: input.event.confirmations,
              sourceTxSucceeded: input.event.sourceTxSucceeded,
            },
            recommendedAction: result.recommendedAction,
            message: {
              sourceDomain: input.message.sourceDomain,
              destinationDomain: input.message.destinationDomain,
              canonicalAssetId: input.message.canonicalAssetId,
              amount: input.message.amount,
              nonce: input.message.nonce,
            },
          },
        })
      );
    }

    return records;
  }

  private shouldFreeze(finding: BridgeWatcherFindingRecord): boolean {
    if (finding.recommendedAction !== 'freeze') return false;
    return severityRank(finding.severity) >= severityRank(this.config.minSeverityToFreeze);
  }

  private async maybeFreeze(
    findings: BridgeWatcherFindingRecord[],
    result: BridgeWatcherTickResult
  ): Promise<void> {
    if (!this.config.autoFreeze) return;
    for (const finding of findings) {
      if (!this.shouldFreeze(finding)) continue;
      if (finding.status === 'freeze_submitted') continue;
      const preview = this.freezeActions.buildFreezePreview(finding);
      result.freezePreviews.push(preview);
      if (this.config.dryRun || !this.freezeActions.submitFreeze) {
        this.findingStore.updateStatus(finding.findingId, 'freeze_requested', {
          dryRun: true,
          evidence: { ...finding.evidence, freezePreview: preview },
        });
        continue;
      }
      const submission = await this.freezeActions.submitFreeze(preview);
      this.findingStore.updateStatus(finding.findingId, 'freeze_submitted', {
        dryRun: false,
        txHash: submission.txHash,
        evidence: { ...finding.evidence, freezePreview: preview },
      });
      result.freezeSubmissions.push(submission.txHash);
    }
  }

  private async maybeAlert(findings: BridgeWatcherFindingRecord[]): Promise<number> {
    let sent = 0;
    for (const finding of findings) {
      if (finding.lastAlertEvidenceHash === finding.evidenceHash) continue;
      const alertResult = await this.alerter.sendFindingAlert(finding);
      if (alertResult.sent) {
        this.findingStore.markAlerted(finding.findingId);
        sent += 1;
      }
    }
    return sent;
  }

  async tick(): Promise<BridgeWatcherTickResult> {
    const tickResult: BridgeWatcherTickResult = {
      enabled: this.config.enabled,
      evaluated: 0,
      findingsPersisted: 0,
      freezePreviews: [],
      freezeSubmissions: [],
      alertsSent: 0,
      findingsCleaned: 0,
      skipped: [],
    };

    if (!this.config.enabled) {
      tickResult.skipped.push('watcher_disabled');
      return tickResult;
    }

    try {
      const startedAt = Date.now();
      const cleanup = this.findingStore.cleanup(this.config.findingRetentionDays, startedAt);
      tickResult.findingsCleaned = cleanup.deleted;

      const inputs = this.buildInputs();
      for (const input of inputs) {
        const result = watchBridgeMessage({
          ...input,
          context: {
            ...this.buildPolicyContext(),
            ...input.context,
          },
          config: {
            enabled: true,
          },
        });
        tickResult.evaluated += 1;
        const remaining = this.config.maxFindingsPerTick - tickResult.findingsPersisted;
        if (remaining <= 0) {
          tickResult.skipped.push('max_findings_per_tick_reached');
          break;
        }
        const persisted = this.persistWatcherResult(input, result, remaining);
        tickResult.findingsPersisted += persisted.length;
        tickResult.alertsSent += await this.maybeAlert(persisted);
        await this.maybeFreeze(persisted, tickResult);
      }
      this.lastTickAt = Date.now();
      this.lastTickDurationMs = this.lastTickAt - startedAt;
      this.lastError = undefined;
      return tickResult;
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : String(err);
      throw err;
    }
  }
}
