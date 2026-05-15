/**
 * Offline-safe bridge daemon paper-mode run.
 *
 * Defaults to replaying a documented historical Base Sepolia -> Solana Devnet
 * BridgeOut artifact. It does not submit destination transactions.
 */

import * as os from 'os';
import * as path from 'path';
import { BridgeDaemon } from './daemon';
import { BridgeStateStore } from './state';
import { BridgeWatcherFindingStore } from './watcher-store';
import { BridgeSignerService, LocalDevSignerAdapter, createBridgeSignerAdapterFromEnv } from './signer';
import { loadBaseToSolanaHistoricalPaperFixture } from './daemon-paper-fixture';

function boolEnv(value: string | undefined): boolean {
  return value === 'true' || value === '1' || value === 'yes';
}

function presentEnv(names: string[]): string[] {
  return names.filter((name) => Boolean(process.env[name]));
}

function missingEnv(names: string[]): string[] {
  return names.filter((name) => !process.env[name]);
}

async function main(): Promise<void> {
  const fixture = loadBaseToSolanaHistoricalPaperFixture();
  const stateDir = process.env.BRIDGE_DAEMON_STATE_PATH ||
    process.env.STATE_DIR ||
    path.join(os.tmpdir(), `white-bridge-daemon-paper-${Date.now()}`);
  const liveSubmitEnabled = boolEnv(process.env.BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT);
  const signerMode = process.env.BRIDGE_SIGNER_MODE || 'local-dev';
  const useEnvSigner = signerMode !== 'local-dev';

  const signerAdapter = useEnvSigner
    ? createBridgeSignerAdapterFromEnv(process.env)
    : new LocalDevSignerAdapter({
      env: { NODE_ENV: 'test', BRIDGE_SIGNER_MODE: 'local-dev' },
    });

  const daemon = new BridgeDaemon({
    config: {
      mode: 'paper',
      intervalMs: 30_000,
      allowLiveTestnetSubmit: false,
      allowLocalDevSignerInLiveTestnet: false,
      routes: [fixture.route],
      stateDir,
      signerThreshold: Number(process.env.BRIDGE_SIGNER_THRESHOLD || '2'),
      signerSetVersion: 1,
      solanaPoolConfig: process.env.BRIDGE_SOLANA_POOL_CONFIG,
      submitTargets: {
        'solana-devnet': process.env.BRIDGE_SOLANA_PROGRAM_ID ||
          'DAoezX29ingBicFfrqboD7xBeLro2b6RL77dhEbXivVD',
      },
    },
    stateStore: new BridgeStateStore(stateDir),
    findingStore: new BridgeWatcherFindingStore(stateDir, {
      findingsPath: process.env.BRIDGE_WATCHER_FINDINGS_PATH,
    }),
    signer: new BridgeSignerService({
      threshold: Number(process.env.BRIDGE_SIGNER_THRESHOLD || '2'),
      privateKeys: [],
      adapter: signerAdapter,
    }),
    now: () => fixture.asOfMs,
  });

  daemon.recordObservation({
    event: fixture.event,
    sourceChain: fixture.sourceChain,
    destinationChain: fixture.destinationChain,
  });
  const tick = await daemon.tick();
  const messages = daemon.listMessages();
  const message = messages[0];

  console.log(JSON.stringify({
    ok: message?.status === 'paper_ready_to_submit' && tick.submitted === 0,
    mode: daemon.getStatus().mode,
    stateDir,
    route: `${fixture.sourceChain}->${fixture.destinationChain}`,
    eventSource: fixture.label,
    sourceTxHash: fixture.sourceTxHash,
    sourceBlockNumber: fixture.sourceBlockNumber,
    sourceFinalityBlock: fixture.sourceFinalityBlock,
    historicalReplayAsOf: new Date(fixture.asOfMs).toISOString(),
    envPresence: {
      present: presentEnv([
        'BRIDGE_DAEMON_MODE',
        'BRIDGE_SIGNER_MODE',
        'BRIDGE_SIGNER_KEY_FILE',
        'BRIDGE_SIGNER_PRIVATE_KEYS_TESTNET',
        'BRIDGE_OPERATOR_API_TOKEN',
        'BASE_SEPOLIA_RPC_URL',
        'ETHEREUM_SEPOLIA_RPC_URL',
        'BASE_RPC_URL',
        'ETH_RPC_URL',
      ]),
      missingLiveRpc: missingEnv([
        'BASE_SEPOLIA_RPC_URL',
        'ETHEREUM_SEPOLIA_RPC_URL',
        'BASE_RPC_URL',
        'ETH_RPC_URL',
      ]),
    },
    safety: {
      paperMode: true,
      liveSubmitEnabled,
      destinationTxSubmitted: tick.submitted > 0,
    },
    tick,
    message,
  }, null, 2));
}

main().catch((err) => {
  console.error(JSON.stringify({
    ok: false,
    error: err instanceof Error ? err.message : String(err),
  }, null, 2));
  process.exit(1);
});
