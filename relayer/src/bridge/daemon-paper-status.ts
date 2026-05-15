/**
 * Print sanitized paper daemon state from the configured state directory.
 */

import * as os from 'os';
import * as path from 'path';
import { BridgeDaemon, loadBridgeDaemonConfigFromEnv } from './daemon';
import { BridgeStateStore } from './state';
import { BridgeWatcherFindingStore } from './watcher-store';
import { BridgeSignerService, LocalDevSignerAdapter } from './signer';
import { loadBaseToSolanaHistoricalPaperFixture } from './daemon-paper-fixture';

async function main(): Promise<void> {
  const fixture = loadBaseToSolanaHistoricalPaperFixture();
  const stateDir = process.env.BRIDGE_DAEMON_STATE_PATH ||
    process.env.STATE_DIR ||
    path.join(os.tmpdir(), 'white-bridge-daemon-paper-status');
  const envConfig = loadBridgeDaemonConfigFromEnv(process.env);
  const daemon = new BridgeDaemon({
    config: {
      ...envConfig,
      mode: envConfig.mode === 'disabled' ? 'paper' : envConfig.mode,
      routes: envConfig.routes.length > 0 ? envConfig.routes : [fixture.route],
      stateDir,
      allowLiveTestnetSubmit: false,
    },
    stateStore: new BridgeStateStore(stateDir),
    findingStore: new BridgeWatcherFindingStore(stateDir, {
      findingsPath: process.env.BRIDGE_WATCHER_FINDINGS_PATH,
    }),
    signer: new BridgeSignerService({
      threshold: envConfig.signerThreshold,
      privateKeys: [],
      adapter: new LocalDevSignerAdapter({
        env: { NODE_ENV: 'test', BRIDGE_SIGNER_MODE: 'local-dev' },
      }),
    }),
  });

  console.log(JSON.stringify({
    status: daemon.getStatus(),
    messages: daemon.listMessages(),
  }, null, 2));
}

main().catch((err) => {
  console.error(JSON.stringify({
    ok: false,
    error: err instanceof Error ? err.message : String(err),
  }, null, 2));
  process.exit(1);
});
