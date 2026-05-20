import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

type Env = NodeJS.ProcessEnv | Record<string, string | undefined>;

export type HostedOperatorReadiness = {
  ok: boolean;
  generatedAt: string;
  startupStatusPath: string;
  startupStatusPresent: boolean;
  readiness: string;
  hostedBootstrapEnabled: boolean;
  failClosed: boolean | null;
  zkeys: {
    bootstrapAttempted: boolean;
    bootstrapOk: boolean | null;
    merkleHashOk: boolean;
    withdrawHashOk: boolean;
    merkleSymlinkOk: boolean;
    withdrawSymlinkOk: boolean;
  };
  operatorPrereq: {
    attempted: boolean;
    ok: boolean | null;
  };
  safeMode: {
    daemonMode: string | null;
    liveSubmitEnabled: boolean;
    ok: boolean;
  };
  liveSubmitGuard: {
    ok: boolean;
    status: 'disabled' | 'enabled_with_valid_bootstrap' | 'blocked_live_submit_guard';
  };
  paths: {
    circuitArtifactDir: { path: string; present: boolean };
    noteStateDir: { path: string; present: boolean };
    bridgeResultsDir: { path: string; present: boolean };
  };
  latestOperatorStatus: {
    path: string | null;
    present: boolean;
    sha256: string | null;
    readiness: string | null;
    recommendedAction: string | null;
  };
  latestWatcherReport: {
    path: string | null;
    present: boolean;
    ok: boolean | null;
    label: string | null;
    dryRun: boolean | null;
    autoFreeze: boolean | null;
    totalFindings: number | null;
    openFindings: number | null;
    liveFreezeTxCount: number | null;
    unexpectedLiveFreezeInDryRun: boolean | null;
  };
  latestJobIndex: {
    path: string;
    present: boolean;
    jobCount: number;
    latestStatus: string | null;
    latestPhase: string | null;
    preflightHash: string | null;
    recoveryHash: string | null;
    settlementTx: string | null;
    withdrawTx: string | null;
    resultReportPath: string | null;
  };
  transactionsSubmitted: false;
  proofsGenerated: false;
  secretsPrinted: false;
};

function bool(value: unknown): boolean {
  return value === true || value === 'true' || value === '1' || value === 'yes';
}

function readJson<T>(filePath: string | null): T | null {
  try {
    if (!filePath || !fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
  } catch {
    return null;
  }
}

function sha256File(filePath: string | null): string | null {
  try {
    if (!filePath || !fs.existsSync(filePath)) return null;
    return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
  } catch {
    return null;
  }
}

function resultDir(env: Env): string {
  return path.resolve(env.BRIDGE_RESULTS_DIR || '/data/bridge-results');
}

export function hostedStartupStatusPath(env: Env = process.env): string {
  return path.resolve(
    env.BRIDGE_HOSTED_STARTUP_STATUS_PATH || path.join(resultDir(env), 'hosted-startup-status.json')
  );
}

function normalizeDestinationHash(env: Env): string | null {
  const value = env.PR012B_DESTINATION_MESSAGE_HASH || env.BRIDGE_DESTINATION_MESSAGE_HASH || null;
  return typeof value === 'string' && /^0x[0-9a-fA-F]{64}$/.test(value) ? value.toLowerCase() : null;
}

function operatorStatusPath(env: Env): string | null {
  if (env.BRIDGE_OPERATOR_STATUS_PATH) return path.resolve(env.BRIDGE_OPERATOR_STATUS_PATH);
  const destination = normalizeDestinationHash(env);
  if (!destination) return null;
  return path.join(resultDir(env), `operator-status-${destination.slice(2)}.json`);
}

function watcherReportPath(env: Env): string {
  return path.resolve(env.BRIDGE_WATCHER_REPORT_PATH || path.join(process.cwd(), 'data/bridge-watcher-observation-report.json'));
}

function jobIndexPath(env: Env): string {
  return path.resolve(env.BRIDGE_OPERATOR_JOB_INDEX_PATH || path.join(resultDir(env), 'operator-job-index.json'));
}

function safeString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function safeNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function latestJobSummary(indexPath: string): HostedOperatorReadiness['latestJobIndex'] {
  const parsed = readJson<{ jobs?: Array<Record<string, unknown>> }>(indexPath);
  const jobs = Array.isArray(parsed?.jobs) ? parsed!.jobs! : [];
  const latest = jobs.length > 0 ? jobs[jobs.length - 1] : null;
  return {
    path: indexPath,
    present: Boolean(parsed),
    jobCount: jobs.length,
    latestStatus: safeString(latest?.status),
    latestPhase: safeString(latest?.phase) || safeString(latest?.status),
    preflightHash: safeString(latest?.preflightReportSha256),
    recoveryHash: safeString(latest?.recoverySnapshotSha256),
    settlementTx: safeString(latest?.settlementTx),
    withdrawTx: safeString(latest?.withdrawTx),
    resultReportPath: safeString(latest?.resultReportPath),
  };
}

function determineReadiness(input: {
  startupPresent: boolean;
  startupReadiness: string | null;
  liveSubmitEnabled: boolean;
  zkeyBootstrapOk: boolean | null;
  operatorPrereqOk: boolean | null;
}): { ok: boolean; readiness: string; liveSubmitGuard: HostedOperatorReadiness['liveSubmitGuard'] } {
  if (!input.startupPresent) {
    return {
      ok: false,
      readiness: 'unknown_startup_status',
      liveSubmitGuard: {
        ok: !input.liveSubmitEnabled,
        status: input.liveSubmitEnabled ? 'blocked_live_submit_guard' : 'disabled',
      },
    };
  }

  if (input.liveSubmitEnabled && input.zkeyBootstrapOk !== true) {
    return {
      ok: false,
      readiness: 'blocked_live_submit_guard',
      liveSubmitGuard: { ok: false, status: 'blocked_live_submit_guard' },
    };
  }

  const blocked = input.startupReadiness?.startsWith('blocked_') === true;
  return {
    ok: !blocked,
    readiness: input.startupReadiness || 'unknown_startup_status',
    liveSubmitGuard: {
      ok: true,
      status: input.liveSubmitEnabled ? 'enabled_with_valid_bootstrap' : 'disabled',
    },
  };
}

export function buildHostedOperatorReadiness(env: Env = process.env): HostedOperatorReadiness {
  const startupPath = hostedStartupStatusPath(env);
  const startup = readJson<Record<string, unknown>>(startupPath);
  const daemonMode = safeString(env.BRIDGE_DAEMON_MODE) || safeString(startup?.daemonMode);
  const liveSubmitEnabled = bool(env.BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT ?? startup?.liveSubmitEnabled);
  const zkeyBootstrapOk = startup?.zkeyBootstrapOk === undefined ? null : bool(startup.zkeyBootstrapOk);
  const operatorPrereqOk = startup?.operatorPrereqOk === undefined ? null : bool(startup.operatorPrereqOk);
  const readiness = determineReadiness({
    startupPresent: Boolean(startup),
    startupReadiness: safeString(startup?.readiness),
    liveSubmitEnabled,
    zkeyBootstrapOk,
    operatorPrereqOk,
  });
  const operatorStatusFile = operatorStatusPath(env);
  const operatorStatus = readJson<Record<string, any>>(operatorStatusFile);
  const watcherFile = watcherReportPath(env);
  const watcher = readJson<Record<string, any>>(watcherFile);
  const circuitArtifactDir = safeString(startup?.circuitArtifactDir) || env.BRIDGE_CIRCUIT_ARTIFACT_DIR || '/data/circuit-artifacts';
  const noteStateDir = safeString(startup?.noteStateDir) || env.BRIDGE_NOTE_STATE_BACKUP_DIR || '/data/white-bridge-note-state';
  const bridgeResultsDir = safeString(startup?.bridgeResultsDir) || env.BRIDGE_RESULTS_DIR || '/data/bridge-results';

  return {
    ok: readiness.ok,
    generatedAt: new Date().toISOString(),
    startupStatusPath: startupPath,
    startupStatusPresent: Boolean(startup),
    readiness: readiness.readiness,
    hostedBootstrapEnabled: bool(startup?.hostedBootstrapEnabled ?? env.BRIDGE_HOSTED_STARTUP_BOOTSTRAP),
    failClosed: startup?.failClosed === undefined ? null : bool(startup.failClosed),
    zkeys: {
      bootstrapAttempted: bool(startup?.zkeyBootstrapAttempted),
      bootstrapOk: zkeyBootstrapOk,
      merkleHashOk: bool(startup?.merkleZkeyHashOk),
      withdrawHashOk: bool(startup?.withdrawZkeyHashOk),
      merkleSymlinkOk: bool(startup?.merkleSymlinkOk),
      withdrawSymlinkOk: bool(startup?.withdrawSymlinkOk),
    },
    operatorPrereq: {
      attempted: bool(startup?.operatorPrereqAttempted),
      ok: operatorPrereqOk,
    },
    safeMode: {
      daemonMode,
      liveSubmitEnabled,
      ok: daemonMode === 'paper' && liveSubmitEnabled === false,
    },
    liveSubmitGuard: readiness.liveSubmitGuard,
    paths: {
      circuitArtifactDir: { path: path.resolve(circuitArtifactDir), present: fs.existsSync(circuitArtifactDir) },
      noteStateDir: { path: path.resolve(noteStateDir), present: fs.existsSync(noteStateDir) },
      bridgeResultsDir: { path: path.resolve(bridgeResultsDir), present: fs.existsSync(bridgeResultsDir) },
    },
    latestOperatorStatus: {
      path: operatorStatusFile,
      present: Boolean(operatorStatus),
      sha256: sha256File(operatorStatusFile),
      readiness: safeString(operatorStatus?.final?.readiness),
      recommendedAction: safeString(operatorStatus?.final?.recommendedAction),
    },
    latestWatcherReport: {
      path: watcherFile,
      present: Boolean(watcher),
      ok: watcher?.ok === undefined ? null : bool(watcher.ok),
      label: safeString(watcher?.label),
      dryRun: watcher?.watcher?.dryRun === undefined ? null : bool(watcher.watcher.dryRun),
      autoFreeze: watcher?.watcher?.autoFreeze === undefined ? null : bool(watcher.watcher.autoFreeze),
      totalFindings: safeNumber(watcher?.findings?.total),
      openFindings: safeNumber(watcher?.findings?.open),
      liveFreezeTxCount: safeNumber(watcher?.freeze?.liveFreezeTxCount),
      unexpectedLiveFreezeInDryRun:
        watcher?.freeze?.unexpectedLiveFreezeInDryRun === undefined ? null : bool(watcher.freeze.unexpectedLiveFreezeInDryRun),
    },
    latestJobIndex: latestJobSummary(jobIndexPath(env)),
    transactionsSubmitted: false,
    proofsGenerated: false,
    secretsPrinted: false,
  };
}
