/**
 * Offline bridge watcher smoke run.
 *
 * This is intentionally dry-run only: it injects deterministic synthetic
 * observations, persists findings, and builds a freeze preview without live RPC
 * or on-chain transaction submission.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { BridgeAlerter } from './alerts';
import { BridgeStateStore } from './state';
import { BridgeWatcherDaemon, type BridgeWatcherDaemonStatus } from './watcher-daemon';
import {
  makeSyntheticBridgeRoutes,
  makeSyntheticFinality,
  makeSyntheticWatcherFindingFixtures,
} from './watcher-smoke-fixtures';
import { BridgeWatcherFindingStore } from './watcher-store';
import type { BridgeFreezePreview } from './freeze-actions';

export interface BridgeWatcherSmokeOptions {
  stateDir?: string;
  nowSeconds?: number;
}

export interface BridgeWatcherSmokeResult {
  ok: boolean;
  stateDir: string;
  fixtureCount: number;
  expectedCodes: string[];
  observedCodes: string[];
  missingCodes: string[];
  findingsPersisted: number;
  alertsSent: number;
  freezeSubmissions: string[];
  freezePreview?: BridgeFreezePreview;
  status: BridgeWatcherDaemonStatus;
}

function jsonReplacer(_key: string, value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString();
  return value;
}

function makeStateDir(requested?: string): string {
  if (requested) {
    fs.mkdirSync(requested, { recursive: true });
    return requested;
  }
  return fs.mkdtempSync(path.join(os.tmpdir(), 'white-bridge-watcher-smoke-'));
}

export async function runBridgeWatcherSmoke(
  options: BridgeWatcherSmokeOptions = {}
): Promise<BridgeWatcherSmokeResult> {
  const stateDir = makeStateDir(options.stateDir);
  const stateStore = new BridgeStateStore(stateDir);
  const findingStore = new BridgeWatcherFindingStore(stateDir);
  const fixtures = makeSyntheticWatcherFindingFixtures();

  const daemon = new BridgeWatcherDaemon({
    stateStore,
    findingStore,
    routes: makeSyntheticBridgeRoutes(),
    finality: makeSyntheticFinality(),
    context: { nowSeconds: options.nowSeconds ?? 1_800_000_000 },
    config: {
      enabled: true,
      dryRun: true,
      autoFreeze: false,
      intervalMs: 1_000,
      maxFindingsPerTick: 100,
      findingRetentionDays: 30,
    },
    alerter: new BridgeAlerter({
      dryRun: true,
      minSeverity: 'high',
      logToConsole: false,
    }),
  });

  for (const fixture of fixtures) {
    daemon.recordObservation(fixture.input);
  }

  const tick = await daemon.tick();
  const findings = findingStore.list();
  const observedCodes = Array.from(new Set(findings.map((finding) => finding.code))).sort();
  const expectedCodes = Array.from(new Set(fixtures.map((fixture) => fixture.expectedCode))).sort();
  const missingCodes = expectedCodes.filter((code) => !observedCodes.includes(code));
  const freezeCandidate = findings.find((finding) => finding.recommendedAction === 'freeze');
  const freezePreview = freezeCandidate
    ? await daemon.freezeDryRun(freezeCandidate.findingId)
    : undefined;
  const status = daemon.getStatus();

  const ok =
    missingCodes.length === 0 &&
    findings.length >= fixtures.length &&
    tick.freezeSubmissions.length === 0 &&
    status.dryRun === true &&
    status.autoFreeze === false;

  return {
    ok,
    stateDir,
    fixtureCount: fixtures.length,
    expectedCodes,
    observedCodes,
    missingCodes,
    findingsPersisted: tick.findingsPersisted,
    alertsSent: tick.alertsSent,
    freezeSubmissions: tick.freezeSubmissions,
    freezePreview,
    status,
  };
}

async function main(): Promise<void> {
  const result = await runBridgeWatcherSmoke({
    stateDir: process.env.BRIDGE_WATCHER_SMOKE_STATE_DIR,
  });
  console.log(JSON.stringify(result, jsonReplacer, 2));
  if (!result.ok) {
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
}
