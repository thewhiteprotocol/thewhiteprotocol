/**
 * Offline watcher observation report command.
 *
 * Reads persisted watcher findings and writes sanitized JSON/Markdown reports.
 * No live RPC, no webhook, no freeze submission.
 */

import * as path from 'path';
import { BridgeWatcherFindingStore } from './watcher-store';
import { loadBridgeWatcherDaemonConfigFromEnv } from './watcher-daemon';
import {
  buildObservationSummary,
  loadBridgeObservationConfigFromEnv,
  writeObservationReport,
} from './observation';

function splitCsv(value: string | undefined): string[] | undefined {
  if (!value) return undefined;
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

async function main(): Promise<void> {
  const stateDir = process.env.STATE_DIR || process.env.BRIDGE_WATCHER_SMOKE_STATE_DIR || path.join(process.cwd(), 'data');
  const observationConfig = loadBridgeObservationConfigFromEnv(process.env);
  const daemonConfig = loadBridgeWatcherDaemonConfigFromEnv(process.env);
  const findingStore = new BridgeWatcherFindingStore(stateDir, {
    findingsPath: process.env.BRIDGE_WATCHER_FINDINGS_PATH,
  });

  const summary = buildObservationSummary(findingStore.list(), {
    label: observationConfig.label,
    windowHours: observationConfig.windowHours,
    dryRun: daemonConfig.dryRun,
    autoFreeze: daemonConfig.autoFreeze,
    watcherMode: daemonConfig.enabled ? (daemonConfig.dryRun ? 'dry-run' : 'live') : 'disabled',
    chainsMonitored: splitCsv(process.env.BRIDGE_WATCHER_OBSERVATION_CHAINS),
    routesMonitored: splitCsv(process.env.BRIDGE_WATCHER_OBSERVATION_ROUTES),
  });

  writeObservationReport(summary, observationConfig.reportPath);
  console.log(
    JSON.stringify(
      {
        ok: !summary.freeze.unexpectedLiveFreezeInDryRun,
        reportPath: observationConfig.reportPath,
        markdownPath: observationConfig.reportPath.replace(/\.json$/i, '.md'),
        label: summary.label,
        dryRun: summary.watcher.dryRun,
        autoFreeze: summary.watcher.autoFreeze,
        totalFindings: summary.findings.total,
        openFindings: summary.findings.open,
        liveFreezeTxCount: summary.freeze.liveFreezeTxCount,
        unexpectedLiveFreezeInDryRun: summary.freeze.unexpectedLiveFreezeInDryRun,
      },
      null,
      2
    )
  );

  if (summary.freeze.unexpectedLiveFreezeInDryRun) {
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
}

