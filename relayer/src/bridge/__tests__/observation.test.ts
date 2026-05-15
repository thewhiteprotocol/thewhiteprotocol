import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  buildObservationSummary,
  determineEscalation,
  loadBridgeObservationConfigFromEnv,
  shouldAlert,
  shouldGenerateFreezePreview,
  shouldRequireManualReview,
  writeObservationReport,
} from '../observation';
import { BridgeWatcherDaemon } from '../watcher-daemon';
import { BridgeStateStore } from '../state';
import {
  makeSyntheticBridgeRoutes,
  makeSyntheticFinality,
  makeSyntheticWatcherFindingFixtures,
} from '../watcher-smoke-fixtures';
import { BridgeWatcherFindingStore, type BridgeWatcherFindingRecord } from '../watcher-store';
import { runBridgeWatcherSmoke } from '../watcher-smoke';
import type {
  BridgeFreezeActionExecutor,
  BridgeFreezePreview,
  BridgeFreezeSubmitResult,
} from '../freeze-actions';

function tmpDir(name: string): string {
  return path.join(os.tmpdir(), `${name}-${Date.now()}-${Math.random()}`);
}

function makeFinding(
  patch: Partial<BridgeWatcherFindingRecord> = {}
): BridgeWatcherFindingRecord {
  const now = 1_800_000_000_000;
  return {
    findingId: patch.findingId ?? `finding-${Math.random()}`,
    messageHash: patch.messageHash ?? `0x${'1'.repeat(64)}`,
    route: patch.route ?? 'base-sepolia->ethereum-sepolia',
    sourceChain: patch.sourceChain ?? 'base-sepolia',
    destinationChain: patch.destinationChain ?? 'ethereum-sepolia',
    severity: patch.severity ?? 'medium',
    code: patch.code ?? 'synthetic_medium',
    reason: patch.reason ?? 'synthetic finding',
    recommendedAction: patch.recommendedAction ?? 'alert',
    status: patch.status ?? 'open',
    createdAt: patch.createdAt ?? now,
    updatedAt: patch.updatedAt ?? now,
    evidence: patch.evidence ?? {},
    evidenceHash: patch.evidenceHash ?? 'abc123',
    dryRun: patch.dryRun ?? true,
    txHash: patch.txHash,
    lastAlertedAt: patch.lastAlertedAt,
    lastAlertEvidenceHash: patch.lastAlertEvidenceHash,
  };
}

class CountingFreezeExecutor implements BridgeFreezeActionExecutor {
  submitCalls = 0;

  buildFreezePreview(finding: BridgeWatcherFindingRecord): BridgeFreezePreview {
    return {
      dryRun: true,
      messageHash: finding.messageHash,
      targetChain: finding.destinationChain,
      targetFamily: 'evm',
      action: 'freeze_message',
      evm: {
        functionName: 'freezeMessage',
        args: [finding.messageHash],
        calldata: '0x',
      },
    };
  }

  async submitFreeze(_preview: BridgeFreezePreview): Promise<BridgeFreezeSubmitResult> {
    this.submitCalls += 1;
    return { txHash: '0xshould-not-submit' };
  }
}

describe('bridge watcher observation reports', () => {
  test('builds observation summary from synthetic findings', () => {
    const findings = [
      makeFinding({ severity: 'critical', code: 'unsafe_source', recommendedAction: 'freeze' }),
      makeFinding({ severity: 'high', code: 'high_value', recommendedAction: 'manual_review' }),
      makeFinding({ severity: 'medium', code: 'source_not_final', recommendedAction: 'delay' }),
      makeFinding({ severity: 'medium', code: 'source_not_final', recommendedAction: 'delay' }),
    ];

    const summary = buildObservationSummary(findings, {
      label: 'unit-window',
      windowHours: 24,
      reportGeneratedAt: 1_800_000_100_000,
      dryRun: true,
      autoFreeze: false,
      tickCount: 3,
      lastTickAt: 1_800_000_090_000,
    });

    expect(summary.label).toBe('unit-window');
    expect(summary.watcher.dryRun).toBe(true);
    expect(summary.watcher.autoFreeze).toBe(false);
    expect(summary.watcher.tickCount).toBe(3);
    expect(summary.findings.total).toBe(4);
    expect(summary.findings.open).toBe(4);
    expect(summary.findings.bySeverity.critical).toBe(1);
    expect(summary.findings.bySeverity.high).toBe(1);
    expect(summary.findings.bySeverity.medium).toBe(2);
    expect(summary.findings.byCode.source_not_final).toBe(2);
    expect(summary.findings.repeated).toBe(2);
  });

  test('flags live freeze tx count as unexpected in dry-run', () => {
    const summary = buildObservationSummary(
      [
        makeFinding({
          status: 'freeze_submitted',
          dryRun: false,
          txHash: '0xlive-freeze-tx',
          severity: 'critical',
          recommendedAction: 'freeze',
        }),
      ],
      {
        dryRun: true,
        autoFreeze: false,
        reportGeneratedAt: 1_800_000_100_000,
      }
    );

    expect(summary.freeze.liveFreezeTxCount).toBe(1);
    expect(summary.freeze.unexpectedLiveFreezeInDryRun).toBe(true);
  });

  test('writes sanitized JSON and Markdown reports without secrets', () => {
    const stateDir = tmpDir('watcher-observation-report');
    const reportPath = path.join(stateDir, 'observation.json');
    const summary = buildObservationSummary(
      [
        makeFinding({
          evidence: {
            operatorToken: 'super-secret-operator-token',
            webhookUrl: 'https://hooks.slack.com/services/secret',
          },
        }),
      ],
      { dryRun: true, autoFreeze: false, reportGeneratedAt: 1_800_000_100_000 }
    );

    writeObservationReport(summary, reportPath);

    const json = fs.readFileSync(reportPath, 'utf8');
    const markdown = fs.readFileSync(reportPath.replace(/\.json$/, '.md'), 'utf8');
    expect(json).not.toContain('super-secret-operator-token');
    expect(json).not.toContain('hooks.slack.com/services');
    expect(markdown).not.toContain('super-secret-operator-token');
    expect(markdown).not.toContain('hooks.slack.com/services');
  });

  test('smoke findings appear in observation report', async () => {
    const stateDir = tmpDir('watcher-observation-smoke');
    const smoke = await runBridgeWatcherSmoke({ stateDir });
    const findings = new BridgeWatcherFindingStore(stateDir).list();
    const summary = buildObservationSummary(findings, {
      dryRun: smoke.status.dryRun,
      autoFreeze: smoke.status.autoFreeze,
      tickCount: smoke.status.tickCount,
    });

    expect(smoke.ok).toBe(true);
    expect(summary.findings.total).toBeGreaterThanOrEqual(6);
    expect(summary.findings.byCode.unsafe_solana_init_bridge_v1_out).toBe(1);
    expect(summary.findings.byCode.cross_decimal_mismatch).toBe(1);
    expect(summary.freeze.liveFreezeTxCount).toBe(0);
  });

  test('observation config defaults are safe', () => {
    const config = loadBridgeObservationConfigFromEnv({});

    expect(config.label).toBe('hosted-testnet-dry-run');
    expect(config.windowHours).toBe(24);
    expect(config.reportPath).toContain('bridge-watcher-observation-report.json');
  });
});

describe('bridge watcher escalation policy', () => {
  test('single medium finding logs only', () => {
    const finding = makeFinding({ severity: 'medium', recommendedAction: 'alert' });
    const decision = determineEscalation(finding, {
      dryRun: true,
      autoFreeze: false,
      repeatedCount: 1,
    });

    expect(decision.shouldAlert).toBe(false);
    expect(decision.shouldRequireManualReview).toBe(false);
    expect(decision.operatorAction).toBe('log');
  });

  test('repeated medium finding escalates to alert and manual review', () => {
    const finding = makeFinding({ severity: 'medium', recommendedAction: 'alert' });
    const context = { dryRun: true, autoFreeze: false, repeatedCount: 2 };

    expect(shouldAlert(finding, context)).toBe(true);
    expect(shouldRequireManualReview(finding, context)).toBe(true);
    expect(determineEscalation(finding, context).reason).toBe('medium_repeated_alert');
  });

  test('high finding triggers immediate alert', () => {
    const finding = makeFinding({ severity: 'high', recommendedAction: 'manual_review' });
    const decision = determineEscalation(finding, {
      dryRun: true,
      autoFreeze: false,
    });

    expect(decision.shouldAlert).toBe(true);
    expect(decision.shouldRequireManualReview).toBe(true);
    expect(decision.shouldGenerateFreezePreview).toBe(false);
  });

  test('critical finding requires alert, freeze preview, and manual review', () => {
    const finding = makeFinding({ severity: 'critical', recommendedAction: 'freeze' });
    const context = { dryRun: true, autoFreeze: false, repeatedCount: 1 };

    expect(shouldAlert(finding, context)).toBe(true);
    expect(shouldGenerateFreezePreview(finding, context)).toBe(true);
    expect(shouldRequireManualReview(finding, context)).toBe(true);
    expect(determineEscalation(finding, context).liveFreezeAllowed).toBe(false);
  });

  test('ignored and resolved findings do not escalate', () => {
    for (const status of ['ignored', 'resolved'] as const) {
      const finding = makeFinding({ status, severity: 'critical', recommendedAction: 'freeze' });
      const decision = determineEscalation(finding, {
        dryRun: true,
        autoFreeze: false,
        repeatedCount: 10,
      });
      expect(decision.shouldAlert).toBe(false);
      expect(decision.shouldGenerateFreezePreview).toBe(false);
      expect(decision.operatorAction).toBe('none');
    }
  });

  test('dry-run blocks live freeze even when critical is repeated', () => {
    const finding = makeFinding({ severity: 'critical', recommendedAction: 'freeze' });
    const decision = determineEscalation(finding, {
      dryRun: true,
      autoFreeze: true,
      repeatedCount: 2,
    });

    expect(decision.freezeRecommended).toBe(true);
    expect(decision.liveFreezeAllowed).toBe(false);
  });
});

describe('bridge watcher dry-run freeze guarantees', () => {
  test('dry-run prevents freeze submission even if autoFreeze is true', async () => {
    const stateDir = tmpDir('watcher-observation-dry-run-freeze');
    const stateStore = new BridgeStateStore(stateDir);
    const findingStore = new BridgeWatcherFindingStore(stateDir);
    const freezeActions = new CountingFreezeExecutor();
    const daemon = new BridgeWatcherDaemon({
      stateStore,
      findingStore,
      routes: makeSyntheticBridgeRoutes(),
      finality: makeSyntheticFinality(),
      context: { nowSeconds: 1_800_000_000 },
      config: {
        enabled: true,
        dryRun: true,
        autoFreeze: true,
        intervalMs: 1_000,
        maxFindingsPerTick: 100,
        findingRetentionDays: 30,
      },
      freezeActions,
    });

    daemon.recordObservation(makeSyntheticWatcherFindingFixtures()[0].input);
    const tick = await daemon.tick();
    const finding = findingStore.list()[0];

    expect(tick.freezeSubmissions).toEqual([]);
    expect(freezeActions.submitCalls).toBe(0);
    expect(finding.status).toBe('freeze_requested');
    expect(finding.dryRun).toBe(true);
  });
});

