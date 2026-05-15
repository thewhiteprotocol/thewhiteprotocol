/**
 * Hosted/fresh bridge daemon paper-mode scan.
 *
 * Requires RPC and signer env to be configured as host secrets. If env is
 * missing, prints missing names only and exits without scanning.
 */

import * as fs from 'fs';
import * as path from 'path';
import { EvmSourceAdapter } from './evm-adapter';
import { BridgeDaemon } from './daemon';
import { BridgeStateStore } from './state';
import { BridgeWatcherFindingStore } from './watcher-store';
import { BridgeSignerService, createBridgeSignerAdapterFromEnv } from './signer';
import { checkBridgeDaemonPaperEnv } from './daemon-env-check';
import { loadBaseToSolanaHistoricalPaperFixture } from './daemon-paper-fixture';

function repoRoot(): string {
  return path.resolve(__dirname, '../../..');
}

function loadBaseBridgeOutbox(): `0x${string}` {
  const deploymentPath = path.join(repoRoot(), 'chains/evm/deployments/base-sepolia.json');
  const deployment = JSON.parse(fs.readFileSync(deploymentPath, 'utf8')) as any;
  const address = process.env.BRIDGE_BASE_SEPOLIA_OUTBOX_ADDRESS ||
    deployment.bridgeV1?.BridgeOutbox;
  if (!address || !/^0x[0-9a-fA-F]{40}$/.test(address)) {
    throw new Error('Missing Base Sepolia BridgeOutbox address');
  }
  return address;
}

function parseOptionalBigInt(value: string | undefined): bigint | undefined {
  if (!value) return undefined;
  return BigInt(value);
}

async function main(): Promise<void> {
  const envCheck = checkBridgeDaemonPaperEnv(process.env);
  if (!envCheck.ok) {
    console.log(JSON.stringify({
      ok: false,
      skipped: 'missing_or_unsafe_env',
      envCheck,
      destinationTxSubmitted: false,
    }, null, 2));
    return;
  }

  const fixture = loadBaseToSolanaHistoricalPaperFixture();
  const stateDir = process.env.BRIDGE_DAEMON_STATE_PATH!;
  const baseRpcUrl = process.env.BASE_SEPOLIA_RPC_URL || process.env.BASE_RPC_URL!;
  const sourceAdapter = new EvmSourceAdapter({
    rpcUrl: baseRpcUrl,
    bridgeOutboxAddress: loadBaseBridgeOutbox(),
    chainId: 84532,
    fromBlock: parseOptionalBigInt(process.env.BRIDGE_DAEMON_SCAN_FROM_BLOCK),
    toBlock: parseOptionalBigInt(process.env.BRIDGE_DAEMON_SCAN_TO_BLOCK),
    lookbackBlocks: Number(process.env.BRIDGE_DAEMON_SCAN_LOOKBACK_BLOCKS || '5000'),
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
      adapter: createBridgeSignerAdapterFromEnv(process.env),
    }),
    sourceAdapters: {
      'base-sepolia': sourceAdapter,
    },
  });

  const tick = await daemon.tick();
  const status = daemon.getStatus();
  const messages = daemon.listMessages();
  console.log(JSON.stringify({
    ok: true,
    mode: status.mode,
    route: 'base-sepolia->solana-devnet',
    scan: {
      fromBlock: process.env.BRIDGE_DAEMON_SCAN_FROM_BLOCK || null,
      toBlock: process.env.BRIDGE_DAEMON_SCAN_TO_BLOCK || null,
      lookbackBlocks: Number(process.env.BRIDGE_DAEMON_SCAN_LOOKBACK_BLOCKS || '5000'),
    },
    safety: {
      liveSubmitEnabled: false,
      destinationTxSubmitted: tick.submitted > 0,
    },
    tick,
    messages,
  }, null, 2));
}

main().catch((err) => {
  console.error(JSON.stringify({
    ok: false,
    error: err instanceof Error ? err.message : String(err),
    destinationTxSubmitted: false,
  }, null, 2));
  process.exit(1);
});
