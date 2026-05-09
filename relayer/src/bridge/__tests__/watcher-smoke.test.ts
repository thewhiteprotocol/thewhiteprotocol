import * as os from 'os';
import * as path from 'path';
import { PassThrough } from 'stream';
import express from 'express';
import {
  BridgeAlerter,
  type BridgeAlertPayload,
  type BridgeAlertSink,
} from '../alerts';
import { BridgeStateStore } from '../state';
import { createBridgeStatusRouter } from '../status-api';
import { BridgeWatcherDaemon } from '../watcher-daemon';
import { runBridgeWatcherSmoke } from '../watcher-smoke';
import {
  makeSyntheticBridgeRoutes,
  makeSyntheticFinality,
  makeSyntheticWatcherFindingFixtures,
} from '../watcher-smoke-fixtures';
import { BridgeWatcherFindingStore } from '../watcher-store';

class ThrowingAlertSink implements BridgeAlertSink {
  calls = 0;
  payloads: BridgeAlertPayload[] = [];

  async send(payload: BridgeAlertPayload): Promise<void> {
    this.calls += 1;
    this.payloads.push(payload);
    throw new Error('synthetic webhook outage');
  }
}

function tmpDir(name: string): string {
  return path.join(os.tmpdir(), `${name}-${Date.now()}-${Math.random()}`);
}

function makeSmokeDaemon(
  stateDir: string,
  alerter = new BridgeAlerter({ dryRun: true, minSeverity: 'high', logToConsole: false })
) {
  const stateStore = new BridgeStateStore(stateDir);
  const findingStore = new BridgeWatcherFindingStore(stateDir);
  const daemon = new BridgeWatcherDaemon({
    stateStore,
    findingStore,
    routes: makeSyntheticBridgeRoutes(),
    finality: makeSyntheticFinality(),
    context: { nowSeconds: 1_800_000_000 },
    config: {
      enabled: true,
      dryRun: true,
      autoFreeze: false,
      intervalMs: 1_000,
      maxFindingsPerTick: 100,
      findingRetentionDays: 30,
    },
    alerter,
  });
  return { daemon, stateStore, findingStore };
}

async function invokeApp(
  app: express.Application,
  pathName: string,
  init: { method?: string; headers?: Record<string, string> } = {}
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const req = new PassThrough() as any;
    req.method = init.method ?? 'GET';
    req.url = pathName;
    req.headers = Object.fromEntries(
      Object.entries(init.headers ?? {}).map(([key, value]) => [key.toLowerCase(), value])
    );
    req.connection = { encrypted: false };

    const res = new PassThrough() as any;
    res.statusCode = 200;
    res.headers = {};
    res.setHeader = (key: string, value: string) => {
      res.headers[key.toLowerCase()] = value;
    };
    res.getHeader = (key: string) => res.headers[key.toLowerCase()];
    res.removeHeader = (key: string) => {
      delete res.headers[key.toLowerCase()];
    };
    res.status = (code: number) => {
      res.statusCode = code;
      return res;
    };
    res.json = (body: unknown) => {
      resolve({ status: res.statusCode, body });
      return res;
    };
    res.send = (body: unknown) => {
      resolve({ status: res.statusCode, body });
      return res;
    };
    res.end = () => {
      resolve({ status: res.statusCode, body: undefined });
      return res;
    };

    req.push(null);
    (app as any).handle(req, res, (err: unknown) => {
      if (err) reject(err);
      else resolve({ status: res.statusCode, body: undefined });
    });
  });
}

describe('bridge watcher smoke mode', () => {
  test('generates deterministic synthetic findings for common bridge risks', () => {
    const fixtures = makeSyntheticWatcherFindingFixtures();
    expect(fixtures.map((fixture) => fixture.name)).toEqual([
      'unsafe-solana-init-bridge-v1-out',
      'over-cap-amount',
      'expired-deadline',
      'unsupported-asset',
      'not-final-source',
      'cross-decimal-mismatch',
    ]);
    expect(fixtures.map((fixture) => fixture.expectedCode)).toEqual([
      'unsafe_solana_init_bridge_v1_out',
      'amount_over_max_message_amount',
      'expired_deadline',
      'unsupported_asset',
      'source_not_final',
      'cross_decimal_mismatch',
    ]);
  });

  test('smoke runner persists expected findings and remains dry-run', async () => {
    const stateDir = tmpDir('watcher-smoke-runner');
    const result = await runBridgeWatcherSmoke({ stateDir });

    expect(result.ok).toBe(true);
    expect(result.fixtureCount).toBe(6);
    expect(result.missingCodes).toEqual([]);
    expect(result.findingsPersisted).toBeGreaterThanOrEqual(6);
    expect(result.freezeSubmissions).toEqual([]);
    expect(result.status.dryRun).toBe(true);
    expect(result.status.autoFreeze).toBe(false);
    expect(result.status.alerting.enabled).toBe(false);
    expect(result.freezePreview?.dryRun).toBe(true);
  });

  test('synthetic unsafe Solana event creates expected finding', async () => {
    const stateDir = tmpDir('watcher-smoke-unsafe');
    const { daemon, findingStore } = makeSmokeDaemon(stateDir);
    const unsafe = makeSyntheticWatcherFindingFixtures()[0];

    daemon.recordObservation(unsafe.input);
    const tick = await daemon.tick();

    expect(tick.findingsPersisted).toBe(1);
    expect(findingStore.list()[0].code).toBe('unsafe_solana_init_bridge_v1_out');
    expect(findingStore.list()[0].recommendedAction).toBe('freeze');
  });

  test('no-op alert sink in smoke mode does not send alerts', async () => {
    const stateDir = tmpDir('watcher-smoke-noop-alert');
    const result = await runBridgeWatcherSmoke({ stateDir });

    expect(result.alertsSent).toBe(0);
    expect(result.status.alerting.sink).toBe('noop');
  });

  test('failed webhook alert does not crash watcher and retries on next tick', async () => {
    const stateDir = tmpDir('watcher-smoke-alert-failure');
    const sink = new ThrowingAlertSink();
    const alerter = new BridgeAlerter(
      {
        webhookUrl: 'mock-webhook-url',
        dryRun: false,
        minSeverity: 'high',
      },
      sink
    );
    const { daemon, findingStore } = makeSmokeDaemon(stateDir, alerter);
    const unsafe = makeSyntheticWatcherFindingFixtures()[0];
    daemon.recordObservation(unsafe.input);

    const firstTick = await daemon.tick();
    const secondTick = await daemon.tick();

    expect(firstTick.alertsSent).toBe(0);
    expect(secondTick.alertsSent).toBe(0);
    expect(sink.calls).toBe(2);
    expect(findingStore.list()[0].lastAlertedAt).toBeUndefined();
  });

  test('status endpoint after smoke tick is authenticated and hides secrets', async () => {
    const stateDir = tmpDir('watcher-smoke-status');
    const { daemon, stateStore } = makeSmokeDaemon(stateDir);
    for (const fixture of makeSyntheticWatcherFindingFixtures()) {
      daemon.recordObservation(fixture.input);
    }
    await daemon.tick();

    const app = express();
    app.use(
      createBridgeStatusRouter({
        stateStore,
        routes: makeSyntheticBridgeRoutes(),
        watcherDaemon: daemon,
        operatorApiToken: 'operator-token',
      })
    );

    const unauthorized = await invokeApp(app, '/bridge/watcher/status');
    expect(unauthorized.status).toBe(401);

    const authorized = await invokeApp(app, '/bridge/watcher/status', {
      headers: { authorization: 'Bearer operator-token' },
    });
    expect(authorized.status).toBe(200);
    expect(authorized.body.totalFindings).toBeGreaterThanOrEqual(6);
    expect(authorized.body.dryRun).toBe(true);
    expect(JSON.stringify(authorized.body)).not.toContain('operator-token');
    expect(JSON.stringify(authorized.body)).not.toContain('mock-webhook-url');
  });

  test('retention cleanup works with synthetic findings and keeps open criticals', async () => {
    const stateDir = tmpDir('watcher-smoke-retention');
    await runBridgeWatcherSmoke({ stateDir });
    const findingStore = new BridgeWatcherFindingStore(stateDir);
    const old = Date.now() - 31 * 24 * 60 * 60 * 1000;

    const unsupported = findingStore
      .list()
      .find((finding) => finding.code === 'unsupported_asset');
    expect(unsupported).toBeDefined();
    findingStore.updateStatus(unsupported!.findingId, 'ignored', { now: old });

    const cleanup = findingStore.cleanup(30, Date.now());

    expect(cleanup.deleted).toBe(1);
    expect(findingStore.list().some((finding) => finding.code === 'unsupported_asset')).toBe(
      false
    );
    expect(
      findingStore
        .list()
        .some(
          (finding) =>
            finding.code === 'unsafe_solana_init_bridge_v1_out' &&
            finding.status === 'open' &&
            finding.severity === 'critical'
        )
    ).toBe(true);
  });
});
