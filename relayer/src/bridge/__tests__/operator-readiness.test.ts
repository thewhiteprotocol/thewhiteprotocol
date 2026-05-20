import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { buildHostedOperatorReadiness, hostedStartupStatusPath } from '../operator-readiness';
import { createBridgeStatusRouter } from '../status-api';
import { BridgeStateStore } from '../state';

const DESTINATION_HASH = '0x' + 'b'.repeat(64);

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'operator-readiness-'));
}

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function baseEnv(dir: string): Record<string, string> {
  return {
    BRIDGE_HOSTED_STARTUP_STATUS_PATH: path.join(dir, 'hosted-startup-status.json'),
    BRIDGE_RESULTS_DIR: path.join(dir, 'results'),
    BRIDGE_NOTE_STATE_BACKUP_DIR: path.join(dir, 'note-state'),
    BRIDGE_CIRCUIT_ARTIFACT_DIR: path.join(dir, 'artifacts'),
    BRIDGE_DAEMON_MODE: 'paper',
    BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT: 'false',
    PR012B_DESTINATION_MESSAGE_HASH: DESTINATION_HASH,
  };
}

function writeStartup(env: Record<string, string>, patch: Record<string, unknown> = {}): void {
  writeJson(env.BRIDGE_HOSTED_STARTUP_STATUS_PATH, {
    timestamp: '2026-05-20T00:00:00.000Z',
    gitCommit: 'abcdef0',
    hostedBootstrapEnabled: true,
    failClosed: true,
    zkeyBootstrapAttempted: true,
    zkeyBootstrapOk: true,
    merkleZkeyHashOk: true,
    withdrawZkeyHashOk: true,
    merkleSymlinkOk: true,
    withdrawSymlinkOk: true,
    operatorPrereqAttempted: false,
    operatorPrereqOk: null,
    daemonMode: 'paper',
    liveSubmitEnabled: false,
    circuitArtifactDir: env.BRIDGE_CIRCUIT_ARTIFACT_DIR,
    noteStateDir: env.BRIDGE_NOTE_STATE_BACKUP_DIR,
    bridgeResultsDir: env.BRIDGE_RESULTS_DIR,
    readiness: 'warning_operator_prereq_skipped',
    transactionsSubmitted: false,
    proofsGenerated: false,
    secretsPrinted: false,
    ...patch,
  });
}

describe('hosted operator readiness', () => {
  test('parses startup status and returns non-secret readiness fields', () => {
    const dir = tempDir();
    const env = baseEnv(dir);
    fs.mkdirSync(env.BRIDGE_RESULTS_DIR, { recursive: true });
    fs.mkdirSync(env.BRIDGE_NOTE_STATE_BACKUP_DIR, { recursive: true });
    fs.mkdirSync(env.BRIDGE_CIRCUIT_ARTIFACT_DIR, { recursive: true });
    writeStartup(env);
    writeJson(path.join(env.BRIDGE_RESULTS_DIR, `operator-status-${DESTINATION_HASH.slice(2)}.json`), {
      final: { readiness: 'already_complete', recommendedAction: 'no_action_already_complete' },
    });
    writeJson(path.join(env.BRIDGE_RESULTS_DIR, 'operator-job-index.json'), {
      version: 1,
      jobs: [
        {
          status: 'dry_run_ready',
          phase: 'dry_run_ready',
          preflightReportSha256: 'a'.repeat(64),
          recoverySnapshotSha256: 'c'.repeat(64),
        },
      ],
    });

    const readiness = buildHostedOperatorReadiness(env);

    expect(readiness.ok).toBe(true);
    expect(readiness.readiness).toBe('warning_operator_prereq_skipped');
    expect(readiness.zkeys.merkleHashOk).toBe(true);
    expect(readiness.zkeys.withdrawHashOk).toBe(true);
    expect(readiness.zkeys.merkleSymlinkOk).toBe(true);
    expect(readiness.zkeys.withdrawSymlinkOk).toBe(true);
    expect(readiness.safeMode.ok).toBe(true);
    expect(readiness.latestOperatorStatus.readiness).toBe('already_complete');
    expect(readiness.latestJobIndex.latestStatus).toBe('dry_run_ready');
  });

  test('missing startup status returns safe unknown status', () => {
    const dir = tempDir();
    const env = baseEnv(dir);
    const readiness = buildHostedOperatorReadiness(env);

    expect(hostedStartupStatusPath(env)).toBe(env.BRIDGE_HOSTED_STARTUP_STATUS_PATH);
    expect(readiness.ok).toBe(false);
    expect(readiness.readiness).toBe('unknown_startup_status');
    expect(readiness.startupStatusPresent).toBe(false);
  });

  test('failed zkey bootstrap maps to blocked_zkeys', () => {
    const dir = tempDir();
    const env = baseEnv(dir);
    writeStartup(env, {
      zkeyBootstrapOk: false,
      merkleZkeyHashOk: false,
      readiness: 'blocked_zkeys',
    });

    const readiness = buildHostedOperatorReadiness(env);

    expect(readiness.ok).toBe(false);
    expect(readiness.readiness).toBe('blocked_zkeys');
    expect(readiness.zkeys.bootstrapOk).toBe(false);
  });

  test('live submit without valid bootstrap maps to blocked_live_submit_guard', () => {
    const dir = tempDir();
    const env = { ...baseEnv(dir), BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT: 'true' };
    writeStartup(env, {
      zkeyBootstrapOk: false,
      readiness: 'blocked_zkeys',
    });

    const readiness = buildHostedOperatorReadiness(env);

    expect(readiness.ok).toBe(false);
    expect(readiness.readiness).toBe('blocked_live_submit_guard');
    expect(readiness.liveSubmitGuard.ok).toBe(false);
  });

  test('local startup without hosted flag is safe when status says ready', () => {
    const dir = tempDir();
    const env = baseEnv(dir);
    writeStartup(env, {
      hostedBootstrapEnabled: false,
      zkeyBootstrapAttempted: false,
      zkeyBootstrapOk: null,
      readiness: 'ready',
    });

    const readiness = buildHostedOperatorReadiness(env);

    expect(readiness.ok).toBe(true);
    expect(readiness.hostedBootstrapEnabled).toBe(false);
    expect(readiness.readiness).toBe('ready');
  });

  test('output redacts secret-like fields', () => {
    const dir = tempDir();
    const env = {
      ...baseEnv(dir),
      RPC_ENDPOINT: 'https://example.invalid/key',
      BRIDGE_OPERATOR_API_TOKEN: 'operator-token',
      PRIVATE_KEY: 'private-key',
    };
    writeStartup(env);

    const text = JSON.stringify(buildHostedOperatorReadiness(env));

    expect(text).not.toContain('RPC_ENDPOINT');
    expect(text).not.toContain('operator-token');
    expect(text).not.toContain('PRIVATE_KEY');
    expect(text).not.toContain('destSecret');
    expect(text).not.toContain('destNullifier');
    expect(text).not.toContain('witness');
  });

  test('status router exposes read-only readiness endpoint', () => {
    const dir = tempDir();
    const router = createBridgeStatusRouter({
      stateStore: new BridgeStateStore(dir),
      routes: [],
    });

    const paths = (router as any).stack.map((layer: any) => layer.route?.path).filter(Boolean);

    expect(paths).toContain('/bridge/operator/readiness');
    const readinessLayer = (router as any).stack.find((layer: any) => layer.route?.path === '/bridge/operator/readiness');
    expect(Object.keys(readinessLayer.route.methods)).toEqual(['get']);
  });
});
