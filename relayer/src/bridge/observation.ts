/**
 * Hosted watcher observation window helpers.
 *
 * Pure, offline-safe summary/report generation for persisted watcher findings.
 * This module does not require live RPC and never submits freeze transactions.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { BridgeRiskSeverity } from './types';
import type {
  BridgeWatcherFindingRecord,
  BridgeWatcherFindingStatus,
} from './watcher-store';

export interface BridgeObservationConfig {
  label: string;
  windowHours: number;
  reportPath: string;
}

export interface BridgeObservationSummaryOptions {
  label?: string;
  windowHours?: number;
  reportGeneratedAt?: number;
  dryRun: boolean;
  autoFreeze: boolean;
  watcherMode?: 'disabled' | 'dry-run' | 'live';
  chainsMonitored?: string[];
  routesMonitored?: string[];
  tickCount?: number;
  lastTickAt?: number;
  lastError?: string;
}

export interface BridgeObservationSummary {
  label: string;
  generatedAt: string;
  window: {
    startTime: string;
    endTime: string;
    durationHours: number;
  };
  watcher: {
    mode: 'disabled' | 'dry-run' | 'live';
    dryRun: boolean;
    autoFreeze: boolean;
    tickCount: number;
    lastTickAt?: string;
    lastError?: string;
  };
  monitored: {
    chains: string[];
    routes: string[];
  };
  findings: {
    total: number;
    open: number;
    repeated: number;
    bySeverity: Record<BridgeRiskSeverity, number>;
    byStatus: Record<BridgeWatcherFindingStatus, number>;
    byRoute: Record<string, number>;
    byCode: Record<string, number>;
    topCodes: Array<{ code: string; count: number }>;
  };
  alerts: {
    sent: number;
    suppressedOrDeduped: number;
  };
  freeze: {
    previewsGenerated: number;
    liveFreezeTxCount: number;
    unexpectedLiveFreezeInDryRun: boolean;
  };
  recommendedOperatorActions: string[];
}

export interface BridgeEscalationContext {
  repeatedCount?: number;
  dryRun: boolean;
  autoFreeze: boolean;
}

export interface BridgeEscalationDecision {
  level: BridgeRiskSeverity;
  shouldAlert: boolean;
  shouldGenerateFreezePreview: boolean;
  shouldRequireManualReview: boolean;
  freezeRecommended: boolean;
  liveFreezeAllowed: boolean;
  operatorAction: 'log' | 'alert' | 'manual_review' | 'freeze_preview' | 'none';
  reason: string;
}

const DEFAULT_OBSERVATION_WINDOW_HOURS = 24;
const DEFAULT_OBSERVATION_LABEL = 'hosted-testnet-dry-run';
const DEFAULT_REPORT_FILENAME = 'bridge-watcher-observation-report.json';

const SEVERITIES: BridgeRiskSeverity[] = ['info', 'low', 'medium', 'high', 'critical'];
const STATUSES: BridgeWatcherFindingStatus[] = [
  'open',
  'acknowledged',
  'ignored',
  'freeze_requested',
  'freeze_submitted',
  'resolved',
];

function parsePositiveNumber(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function defaultReportPath(env: Record<string, string | undefined>): string {
  const stateDir = env.STATE_DIR || path.join(process.cwd(), 'data');
  return path.join(stateDir, DEFAULT_REPORT_FILENAME);
}

function countBy<T extends string>(items: T[], keys: readonly T[]): Record<T, number> {
  return keys.reduce<Record<T, number>>((acc, key) => {
    acc[key] = items.filter((item) => item === key).length;
    return acc;
  }, {} as Record<T, number>);
}

function increment(target: Record<string, number>, key: string): void {
  target[key] = (target[key] ?? 0) + 1;
}

function isAlertEligible(finding: BridgeWatcherFindingRecord): boolean {
  return finding.severity === 'high' || finding.severity === 'critical';
}

function hasFreezePreview(finding: BridgeWatcherFindingRecord): boolean {
  return (
    finding.status === 'freeze_requested' ||
    finding.status === 'freeze_submitted' ||
    Boolean((finding.evidence as Record<string, unknown>).freezePreview)
  );
}

function uniqueSorted(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean))).sort();
}

function toIso(value: number | undefined): string | undefined {
  return value === undefined ? undefined : new Date(value).toISOString();
}

function inferWatcherMode(
  dryRun: boolean,
  autoFreeze: boolean,
  explicit?: 'disabled' | 'dry-run' | 'live'
): 'disabled' | 'dry-run' | 'live' {
  if (explicit) return explicit;
  if (dryRun) return 'dry-run';
  return autoFreeze ? 'live' : 'dry-run';
}

export function loadBridgeObservationConfigFromEnv(
  env: Record<string, string | undefined> = process.env
): BridgeObservationConfig {
  return {
    label: env.BRIDGE_WATCHER_OBSERVATION_LABEL || DEFAULT_OBSERVATION_LABEL,
    windowHours: parsePositiveNumber(
      env.BRIDGE_WATCHER_OBSERVATION_WINDOW_HOURS,
      DEFAULT_OBSERVATION_WINDOW_HOURS
    ),
    reportPath: env.BRIDGE_WATCHER_OBSERVATION_REPORT_PATH || defaultReportPath(env),
  };
}

export function determineEscalation(
  finding: Pick<BridgeWatcherFindingRecord, 'severity' | 'status' | 'recommendedAction'>,
  context: BridgeEscalationContext
): BridgeEscalationDecision {
  if (finding.status === 'ignored' || finding.status === 'resolved') {
    return {
      level: finding.severity,
      shouldAlert: false,
      shouldGenerateFreezePreview: false,
      shouldRequireManualReview: false,
      freezeRecommended: false,
      liveFreezeAllowed: false,
      operatorAction: 'none',
      reason: `finding_${finding.status}`,
    };
  }

  const repeated = (context.repeatedCount ?? 1) > 1;
  const isCritical = finding.severity === 'critical';
  const isHigh = finding.severity === 'high';
  const repeatedMedium = finding.severity === 'medium' && repeated;
  const freezeRecommended = isCritical && repeated;
  const shouldGenerateFreezePreview = isCritical || finding.recommendedAction === 'freeze';
  const liveFreezeAllowed =
    freezeRecommended &&
    finding.recommendedAction === 'freeze' &&
    context.autoFreeze &&
    !context.dryRun;

  if (isCritical) {
    return {
      level: finding.severity,
      shouldAlert: true,
      shouldGenerateFreezePreview,
      shouldRequireManualReview: true,
      freezeRecommended,
      liveFreezeAllowed,
      operatorAction: 'freeze_preview',
      reason: repeated ? 'critical_repeated_freeze_recommended' : 'critical_manual_review',
    };
  }

  if (isHigh) {
    return {
      level: finding.severity,
      shouldAlert: true,
      shouldGenerateFreezePreview: false,
      shouldRequireManualReview: true,
      freezeRecommended: false,
      liveFreezeAllowed: false,
      operatorAction: 'manual_review',
      reason: 'high_immediate_alert',
    };
  }

  if (repeatedMedium) {
    return {
      level: finding.severity,
      shouldAlert: true,
      shouldGenerateFreezePreview: false,
      shouldRequireManualReview: true,
      freezeRecommended: false,
      liveFreezeAllowed: false,
      operatorAction: 'alert',
      reason: 'medium_repeated_alert',
    };
  }

  return {
    level: finding.severity,
    shouldAlert: false,
    shouldGenerateFreezePreview: false,
    shouldRequireManualReview: false,
    freezeRecommended: false,
    liveFreezeAllowed: false,
    operatorAction: 'log',
    reason: finding.severity === 'medium' ? 'medium_single_log_only' : 'low_log_only',
  };
}

export function shouldAlert(
  finding: Pick<BridgeWatcherFindingRecord, 'severity' | 'status' | 'recommendedAction'>,
  context: BridgeEscalationContext
): boolean {
  return determineEscalation(finding, context).shouldAlert;
}

export function shouldGenerateFreezePreview(
  finding: Pick<BridgeWatcherFindingRecord, 'severity' | 'status' | 'recommendedAction'>,
  context: BridgeEscalationContext
): boolean {
  return determineEscalation(finding, context).shouldGenerateFreezePreview;
}

export function shouldRequireManualReview(
  finding: Pick<BridgeWatcherFindingRecord, 'severity' | 'status' | 'recommendedAction'>,
  context: BridgeEscalationContext
): boolean {
  return determineEscalation(finding, context).shouldRequireManualReview;
}

export function buildObservationSummary(
  findings: BridgeWatcherFindingRecord[],
  options: BridgeObservationSummaryOptions
): BridgeObservationSummary {
  const reportGeneratedAt = options.reportGeneratedAt ?? Date.now();
  const windowHours = options.windowHours ?? DEFAULT_OBSERVATION_WINDOW_HOURS;
  const windowStart = reportGeneratedAt - windowHours * 60 * 60 * 1000;
  const activeFindings = findings.filter(
    (finding) => finding.createdAt >= windowStart && finding.createdAt <= reportGeneratedAt
  );

  const severityValues = activeFindings.map((finding) => finding.severity);
  const statusValues = activeFindings.map((finding) => finding.status);
  const byRoute: Record<string, number> = {};
  const byCode: Record<string, number> = {};
  for (const finding of activeFindings) {
    increment(byRoute, finding.route);
    increment(byCode, finding.code);
  }

  const repeated = Object.values(byCode).reduce((sum, count) => {
    return sum + (count > 1 ? count : 0);
  }, 0);
  const alertEligible = activeFindings.filter(isAlertEligible);
  const alertDeduped = alertEligible.filter(
    (finding) => finding.lastAlertEvidenceHash === finding.evidenceHash
  ).length;
  const liveFreezeTxCount = activeFindings.filter(
    (finding) => finding.status === 'freeze_submitted' && !finding.dryRun && Boolean(finding.txHash)
  ).length;

  const inferredChains = activeFindings.flatMap((finding) => [
    finding.sourceChain,
    finding.destinationChain,
  ]);
  const inferredRoutes = activeFindings.map((finding) => finding.route);

  return {
    label: options.label ?? DEFAULT_OBSERVATION_LABEL,
    generatedAt: new Date(reportGeneratedAt).toISOString(),
    window: {
      startTime: new Date(windowStart).toISOString(),
      endTime: new Date(reportGeneratedAt).toISOString(),
      durationHours: windowHours,
    },
    watcher: {
      mode: inferWatcherMode(options.dryRun, options.autoFreeze, options.watcherMode),
      dryRun: options.dryRun,
      autoFreeze: options.autoFreeze,
      tickCount: options.tickCount ?? 0,
      lastTickAt: toIso(options.lastTickAt),
      lastError: options.lastError,
    },
    monitored: {
      chains: uniqueSorted(options.chainsMonitored ?? inferredChains),
      routes: uniqueSorted(options.routesMonitored ?? inferredRoutes),
    },
    findings: {
      total: activeFindings.length,
      open: activeFindings.filter((finding) => finding.status === 'open').length,
      repeated,
      bySeverity: countBy(severityValues, SEVERITIES),
      byStatus: countBy(statusValues, STATUSES),
      byRoute,
      byCode,
      topCodes: Object.entries(byCode)
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, 5)
        .map(([code, count]) => ({ code, count })),
    },
    alerts: {
      sent: activeFindings.filter((finding) => Boolean(finding.lastAlertedAt)).length,
      suppressedOrDeduped: alertDeduped,
    },
    freeze: {
      previewsGenerated: activeFindings.filter(hasFreezePreview).length,
      liveFreezeTxCount,
      unexpectedLiveFreezeInDryRun: options.dryRun && liveFreezeTxCount > 0,
    },
    recommendedOperatorActions: recommendedOperatorActions(
      activeFindings,
      options.dryRun,
      options.autoFreeze
    ),
  };
}

function recommendedOperatorActions(
  findings: BridgeWatcherFindingRecord[],
  dryRun: boolean,
  autoFreeze: boolean
): string[] {
  const actions: string[] = [];
  if (dryRun) {
    actions.push('Keep BRIDGE_WATCHER_DRY_RUN=true for this observation window.');
  }
  if (autoFreeze) {
    actions.push('Disable BRIDGE_WATCHER_AUTO_FREEZE during PR-011E dry-run observation.');
  }
  if (findings.some((finding) => finding.severity === 'critical' && finding.status === 'open')) {
    actions.push('Review open critical findings and generate freeze previews only.');
  }
  if (findings.some((finding) => finding.severity === 'high' && finding.status === 'open')) {
    actions.push('Review open high findings before signing affected routes.');
  }
  if (findings.length === 0) {
    actions.push('Continue observation until the minimum window has elapsed.');
  }
  actions.push('Do not submit live freeze transactions in this PR.');
  return actions;
}

export function renderObservationMarkdown(summary: BridgeObservationSummary): string {
  const lines = [
    `# Bridge Watcher Observation Report`,
    '',
    `- Label: ${summary.label}`,
    `- Generated at: ${summary.generatedAt}`,
    `- Window: ${summary.window.startTime} to ${summary.window.endTime} (${summary.window.durationHours}h)`,
    `- Watcher mode: ${summary.watcher.mode}`,
    `- Dry run: ${summary.watcher.dryRun}`,
    `- Auto-freeze: ${summary.watcher.autoFreeze}`,
    `- Tick count: ${summary.watcher.tickCount}`,
    `- Live freeze tx count: ${summary.freeze.liveFreezeTxCount}`,
    `- Unexpected live freeze in dry-run: ${summary.freeze.unexpectedLiveFreezeInDryRun}`,
    '',
    `## Findings`,
    '',
    `- Total: ${summary.findings.total}`,
    `- Open: ${summary.findings.open}`,
    `- Repeated: ${summary.findings.repeated}`,
    `- Critical: ${summary.findings.bySeverity.critical}`,
    `- High: ${summary.findings.bySeverity.high}`,
    `- Medium: ${summary.findings.bySeverity.medium}`,
    `- Low: ${summary.findings.bySeverity.low}`,
    '',
    `## Top Codes`,
    '',
    ...(summary.findings.topCodes.length > 0
      ? summary.findings.topCodes.map((item) => `- ${item.code}: ${item.count}`)
      : ['- none']),
    '',
    `## Operator Actions`,
    '',
    ...summary.recommendedOperatorActions.map((action) => `- ${action}`),
    '',
  ];
  return lines.join('\n');
}

export function writeObservationReport(
  summary: BridgeObservationSummary,
  reportPath: string
): void {
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(summary, null, 2));
  const markdownPath = reportPath.replace(/\.json$/i, '.md');
  fs.writeFileSync(markdownPath, renderObservationMarkdown(summary));
}

