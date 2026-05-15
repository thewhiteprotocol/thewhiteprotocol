import express from 'express';
import { PassThrough } from 'stream';
import { BridgeDaemon } from '../daemon';
import { loadBaseToSolanaHistoricalPaperFixture } from '../daemon-paper-fixture';
import { checkBridgeDaemonPaperEnv } from '../daemon-env-check';
import { EvmSourceAdapter } from '../evm-adapter';
import { BridgeStateStore } from '../state';
import { BridgeWatcherFindingStore } from '../watcher-store';
import { BridgeSignerService, LocalDevSignerAdapter } from '../signer';
import { createBridgeStatusRouter } from '../status-api';
import { BridgeMessageStatus, type BridgeDestinationAdapter } from '../types';
import * as os from 'os';
import * as path from 'path';

const TEST_PRIVATE_KEYS = [
  '0x0000000000000000000000000000000000000000000000000000000000000001',
  '0x0000000000000000000000000000000000000000000000000000000000000002',
  '0x0000000000000000000000000000000000000000000000000000000000000003',
];

function tmpDir(name: string): string {
  return path.join(os.tmpdir(), `${name}-${Date.now()}-${Math.random()}`);
}

function makeSigner(): BridgeSignerService {
  return new BridgeSignerService({
    threshold: 2,
    privateKeys: [],
    adapter: new LocalDevSignerAdapter({
      privateKeys: TEST_PRIVATE_KEYS,
      env: { NODE_ENV: 'test', BRIDGE_SIGNER_MODE: 'local-dev' },
    }),
  });
}

function makePaperDaemon(options: {
  stateDir?: string;
  destinationAdapters?: Record<string, BridgeDestinationAdapter>;
} = {}) {
  const fixture = loadBaseToSolanaHistoricalPaperFixture();
  const stateDir = options.stateDir ?? tmpDir('bridge-daemon-paper-live-events');
  const stateStore = new BridgeStateStore(stateDir);
  const findingStore = new BridgeWatcherFindingStore(stateDir);
  const daemon = new BridgeDaemon({
    config: {
      mode: 'paper',
      intervalMs: 30_000,
      allowLiveTestnetSubmit: false,
      allowLocalDevSignerInLiveTestnet: false,
      routes: [fixture.route],
      stateDir,
      signerThreshold: 2,
      signerSetVersion: 1,
      submitTargets: {
        'solana-devnet': 'DAoezX29ingBicFfrqboD7xBeLro2b6RL77dhEbXivVD',
      },
    },
    stateStore,
    findingStore,
    signer: makeSigner(),
    destinationAdapters: options.destinationAdapters,
    now: () => fixture.asOfMs,
  });
  return { daemon, stateStore, fixture };
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

describe('bridge daemon paper mode historical testnet event replay', () => {
  test('env check reports missing names only', () => {
    const result = checkBridgeDaemonPaperEnv({
      BRIDGE_DAEMON_MODE: 'paper',
      BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT: 'false',
      BASE_SEPOLIA_RPC_URL: 'https://base.example.invalid/redacted-token',
      RPC_ENDPOINT: 'https://solana.example.invalid/redacted-token',
      BRIDGE_DAEMON_ROUTES: 'base-sepolia:solana-devnet',
      BRIDGE_DAEMON_STATE_PATH: '/tmp/state',
    });

    expect(result.ok).toBe(false);
    expect(result.present).toContain('BASE_SEPOLIA_RPC_URL');
    expect(result.missing).toEqual(
      expect.arrayContaining([
        'BRIDGE_SIGNER_MODE',
        'BRIDGE_OPERATOR_API_TOKEN',
        'BRIDGE_SIGNER_KEY_FILE or BRIDGE_SIGNER_PRIVATE_KEYS_TESTNET',
      ])
    );
    expect(JSON.stringify(result)).not.toContain('redacted-token');
    expect(JSON.stringify(result)).not.toContain('/tmp/state');
  });

  test('historical live-event fixture enters paper_ready_to_submit', async () => {
    const { daemon, stateStore, fixture } = makePaperDaemon();
    daemon.recordObservation({
      event: fixture.event,
      sourceChain: fixture.sourceChain,
      destinationChain: fixture.destinationChain,
    });

    const tick = await daemon.tick();
    const state = stateStore.list()[0];

    expect(tick.submitted).toBe(0);
    expect(state.status).toBe(BridgeMessageStatus.PAPER_READY_TO_SUBMIT);
    expect(state.policyDecision?.accepted).toBe(true);
    expect(state.finalitySatisfied).toBe(true);
    expect(state.signingDecision?.accepted).toBe(true);
    expect(state.signatures).toHaveLength(2);
    expect(state.submissionPreview?.family).toBe('solana');
  });

  test('paper mode cannot submit even with destination submit function present', async () => {
    let submitCalls = 0;
    const { daemon, fixture } = makePaperDaemon({
      destinationAdapters: {
        'solana-devnet': {
          isMessageConsumed: async () => false,
          submitAcceptBridgeMint: async () => {
            submitCalls += 1;
            return 'solana-live-tx';
          },
        },
      },
    });
    daemon.recordObservation({
      event: fixture.event,
      sourceChain: fixture.sourceChain,
      destinationChain: fixture.destinationChain,
    });

    const tick = await daemon.tick();

    expect(tick.submitted).toBe(0);
    expect(submitCalls).toBe(0);
  });

  test('operator status exposes paper mode and message details without secrets', async () => {
    const { daemon, stateStore, fixture } = makePaperDaemon();
    daemon.recordObservation({
      event: fixture.event,
      sourceChain: fixture.sourceChain,
      destinationChain: fixture.destinationChain,
    });
    await daemon.tick();

    const app = express();
    app.use(express.json());
    app.use(
      createBridgeStatusRouter({
        stateStore,
        routes: [fixture.route],
        bridgeDaemon: daemon,
        operatorApiToken: 'operator-token',
      })
    );

    const status = await invokeApp(app, '/bridge/daemon/status');
    const messages = await invokeApp(app, '/bridge/daemon/messages');
    const serialized = JSON.stringify({ status: status.body, messages: messages.body });

    expect(status.body.mode).toBe('paper');
    expect(messages.body.messages[0].status).toBe('paper_ready_to_submit');
    expect(messages.body.messages[0].submissionPreview.family).toBe('solana');
    expect(serialized).not.toContain('operator-token');
    for (const privateKey of TEST_PRIVATE_KEYS) {
      expect(serialized).not.toContain(privateKey);
    }
  });

  test('historical event replay is idempotent by message hash', async () => {
    const { daemon, stateStore, fixture } = makePaperDaemon();
    for (let i = 0; i < 2; i += 1) {
      daemon.recordObservation({
        event: fixture.event,
        sourceChain: fixture.sourceChain,
        destinationChain: fixture.destinationChain,
      });
      await daemon.tick();
    }

    expect(stateStore.list()).toHaveLength(1);
    expect(stateStore.list()[0].status).toBe(BridgeMessageStatus.PAPER_READY_TO_SUBMIT);
  });

  test('operator tick mutation requires auth', async () => {
    const { daemon, stateStore, fixture } = makePaperDaemon();
    const app = express();
    app.use(express.json());
    app.use(
      createBridgeStatusRouter({
        stateStore,
        routes: [fixture.route],
        bridgeDaemon: daemon,
        operatorApiToken: 'operator-token',
      })
    );

    const unauthorized = await invokeApp(app, '/bridge/daemon/tick', { method: 'POST' });
    const authorized = await invokeApp(app, '/bridge/daemon/tick', {
      method: 'POST',
      headers: { authorization: 'Bearer operator-token' },
    });

    expect(unauthorized.status).toBe(401);
    expect(authorized.status).toBe(200);
    expect(authorized.body.mode).toBe('paper');
  });

  test('mocked live scan returns final event and reaches paper preview', async () => {
    const fixture = loadBaseToSolanaHistoricalPaperFixture();
    const sourceAdapter = new EvmSourceAdapter({
      rpcUrl: 'https://base.example.invalid/redacted-token',
      bridgeOutboxAddress: '0x7eaFB77E2F05Bf0EbCb8F1A51B187BbcdBCb985D',
      chainId: 84532,
      lookbackBlocks: 10,
      publicClient: {
        getBlockNumber: async () => BigInt(fixture.sourceBlockNumber + 5),
        getTransactionReceipt: async () => ({ blockNumber: BigInt(fixture.sourceBlockNumber) }) as any,
        getContractEvents: async () => [
          {
            args: {
              messageHash: fixture.event.messageHash,
              destinationDomain: fixture.event.destinationDomain,
              canonicalAssetId: `0x${fixture.event.canonicalAssetId.replace(/^0x/, '')}`,
              amount: fixture.event.amount,
              nonce: BigInt(fixture.event.nonce),
              encodedMessage: fixture.event.encodedMessage,
            },
            transactionHash: fixture.sourceTxHash,
            blockNumber: BigInt(fixture.sourceBlockNumber),
          },
        ] as any,
      } as any,
    });
    const { daemon, stateStore } = makePaperDaemon();
    (daemon as any).sourceAdapters['base-sepolia'] = sourceAdapter;

    const tick = await daemon.tick();
    const state = stateStore.list()[0];

    expect(tick.observed).toBe(1);
    expect(tick.submitted).toBe(0);
    expect(state.status).toBe(BridgeMessageStatus.PAPER_READY_TO_SUBMIT);
    expect(state.submissionPreview?.family).toBe('solana');
    expect(JSON.stringify(state)).not.toContain('redacted-token');
  });

  test('mocked live scan with no events is a clean no-op', async () => {
    const fixture = loadBaseToSolanaHistoricalPaperFixture();
    const sourceAdapter = new EvmSourceAdapter({
      rpcUrl: 'https://base.example.invalid/redacted-token',
      bridgeOutboxAddress: '0x7eaFB77E2F05Bf0EbCb8F1A51B187BbcdBCb985D',
      chainId: 84532,
      lookbackBlocks: 10,
      publicClient: {
        getBlockNumber: async () => BigInt(fixture.sourceBlockNumber + 5),
        getTransactionReceipt: async () => ({ blockNumber: BigInt(fixture.sourceBlockNumber) }) as any,
        getContractEvents: async () => [] as any,
      } as any,
    });
    const { daemon, stateStore } = makePaperDaemon();
    (daemon as any).sourceAdapters['base-sepolia'] = sourceAdapter;

    const tick = await daemon.tick();

    expect(tick.observed).toBe(0);
    expect(tick.signed).toBe(0);
    expect(tick.submitted).toBe(0);
    expect(stateStore.list()).toHaveLength(0);
  });

  test('mocked live scan keeps not-final event in finality_wait', async () => {
    const fixture = loadBaseToSolanaHistoricalPaperFixture();
    const sourceAdapter = new EvmSourceAdapter({
      rpcUrl: 'https://base.example.invalid/redacted-token',
      bridgeOutboxAddress: '0x7eaFB77E2F05Bf0EbCb8F1A51B187BbcdBCb985D',
      chainId: 84532,
      publicClient: {
        getBlockNumber: async () => BigInt(fixture.sourceBlockNumber + 1),
        getTransactionReceipt: async () => ({ blockNumber: BigInt(fixture.sourceBlockNumber) }) as any,
        getContractEvents: async () => [
          {
            args: {
              messageHash: fixture.event.messageHash,
              destinationDomain: fixture.event.destinationDomain,
              canonicalAssetId: `0x${fixture.event.canonicalAssetId.replace(/^0x/, '')}`,
              amount: fixture.event.amount,
              nonce: BigInt(fixture.event.nonce),
              encodedMessage: fixture.event.encodedMessage,
            },
            transactionHash: fixture.sourceTxHash,
            blockNumber: BigInt(fixture.sourceBlockNumber),
          },
        ] as any,
      } as any,
    });
    const { daemon, stateStore } = makePaperDaemon();
    (daemon as any).sourceAdapters['base-sepolia'] = sourceAdapter;

    const tick = await daemon.tick();
    const state = stateStore.list()[0];

    expect(tick.observed).toBe(1);
    expect(tick.signed).toBe(0);
    expect(state.status).toBe(BridgeMessageStatus.FINALITY_WAIT);
    expect(state.finalitySatisfied).toBe(false);
    expect(state.signatures).toHaveLength(0);
  });
});
