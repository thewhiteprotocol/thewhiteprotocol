import { EvmSequencer, EvmSequencerConfig } from '../sequencer/evm';
import { EvmAdapter } from '../chains/evm';
import { RelayerApiExtensions } from '../api-extensions';

// Mock state-store side effects
jest.mock('../state-store', () => ({
  loadEvmMerkleState: jest.fn(() => null),
  saveEvmMerkleState: jest.fn(),
  loadEvmPendingState: jest.fn(() => null),
  saveEvmPendingState: jest.fn(),
  appendEvmSettledCommitment: jest.fn(),
}));

// Mock ServerMerkleTree to avoid Poseidon initialization
jest.mock('../api-extensions', () => {
  const actual = jest.requireActual('../api-extensions');
  return {
    ...actual,
    ServerMerkleTree: class MockServerMerkleTree {
      private leaves: bigint[] = [];
      constructor(private depth: number = 20) {}
      getRoot() { return 0n; }
      getLeafCount() { return this.leaves.length; }
      getLeaves() { return [...this.leaves]; }
      setLeaves(leaves: bigint[]) { this.leaves = leaves; }
      insertAt(index: number, commitment: bigint) { this.leaves[index] = commitment; }
      simulateBatchInsert(commitments: bigint[], startIndex: number) {
        return { paths: commitments.map(() => [0n]), newRoot: 0n };
      }
    },
  };
});

function createMockAdapter(overrides: Partial<{
  poolState: Awaited<ReturnType<EvmAdapter['getPoolState']>>;
  pendingDeposits: bigint[];
  submitSettlementTx: string;
}> = {}): EvmAdapter {
  return {
    chainId: 84532,
    chainName: 'base-sepolia',
    name: 'base-sepolia',
    getAddress: () => '0x1234567890123456789012345678901234567890' as `0x${string}`,
    getBalance: jest.fn(async () => 1000000000000000000n),
    submitWithdrawal: jest.fn(async () => '0xtx'),
    isSpent: jest.fn(async () => false),
    getCommitmentPendingIndex: jest.fn(async () => 0n),
    getPoolState: jest.fn(async () => ({
      currentRoot: 0n,
      currentRootIndex: 0n,
      levels: 20n,
      nextLeafIndex: 0n,
      ...overrides.poolState,
    })),
    getPendingCount: jest.fn(async () => overrides.pendingDeposits?.length ?? 1),
    getPendingDeposits: jest.fn(async () => overrides.pendingDeposits ?? [12345n]),
    submitSettlement: jest.fn(async () => overrides.submitSettlementTx ?? '0xsettle1'),
    getDepositEvents: jest.fn(async () => []),
    getBatchSettlementEvents: jest.fn(async () => []),
  } as unknown as EvmAdapter;
}

function createMockApiExtensions(): RelayerApiExtensions {
  return {
    generateBatchProof: jest.fn(async () => ({ proofBytes: new Uint8Array(256) })),
    // other methods not needed for these tests
  } as unknown as RelayerApiExtensions;
}

function createLogger() {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
}

function createConfig(overrides: Partial<EvmSequencerConfig> = {}): EvmSequencerConfig {
  return {
    chainName: 'base-sepolia',
    adapter: createMockAdapter(),
    deploymentBlock: 0n,
    apiExtensions: createMockApiExtensions(),
    treeDepth: 20,
    pollIntervalMs: 10000,
    logger: createLogger(),
    ...overrides,
  };
}

describe('EvmSequencer in-flight settlement', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('first tick submits settlement and records in-flight state', async () => {
    const adapter = createMockAdapter();
    const config = createConfig({ adapter });
    const seq = new EvmSequencer(config);

    await (seq as any).tick();

    expect(adapter.submitSettlement).toHaveBeenCalledTimes(1);
    const status = seq.getStatus();
    expect(status.inFlight).not.toBeNull();
    expect(status.inFlight?.txHash).toBe('0xsettle1');
  });

  it('second tick while in-flight does not submit again', async () => {
    const adapter = createMockAdapter();
    const config = createConfig({ adapter });
    const seq = new EvmSequencer(config);

    await (seq as any).tick();
    expect(adapter.submitSettlement).toHaveBeenCalledTimes(1);

    await (seq as any).tick();
    // Still only 1 call because in-flight blocks re-submission
    expect(adapter.submitSettlement).toHaveBeenCalledTimes(1);
  });

  it('clears in-flight and allows next batch after nextLeafIndex advances', async () => {
    let nextLeafIndex = 0;
    const adapter = createMockAdapter();

    // Need to mock getPoolState dynamically
    (adapter.getPoolState as jest.Mock).mockImplementation(async () => ({
      currentRoot: nextLeafIndex > 0 ? 999n : 0n,
      currentRootIndex: BigInt(nextLeafIndex),
      levels: 20n,
      nextLeafIndex: BigInt(nextLeafIndex),
    }));

    // Mock pending deposits: first tick has 1, second tick has 0 (settled)
    (adapter.getPendingDeposits as jest.Mock)
      .mockResolvedValueOnce([12345n])
      .mockResolvedValue([]);

    const config = createConfig({ adapter });
    const seq = new EvmSequencer(config);

    await (seq as any).tick();
    expect(adapter.submitSettlement).toHaveBeenCalledTimes(1);
    expect(seq.getStatus().inFlight).not.toBeNull();

    // Simulate mining: nextLeafIndex advances to 1
    nextLeafIndex = 1;
    await (seq as any).tick();

    expect(seq.getStatus().inFlight).toBeNull();
    expect(seq.getStatus().settleCount).toBe(1);
  });

  it('allows retry after in-flight timeout expires', async () => {
    jest.useFakeTimers();
    const adapter = createMockAdapter();
    const config = createConfig({ adapter });
    const seq = new EvmSequencer(config);

    await (seq as any).tick();
    expect(adapter.submitSettlement).toHaveBeenCalledTimes(1);

    // Advance time past 2-minute timeout
    jest.advanceTimersByTime(130_000);

    await (seq as any).tick();
    expect(adapter.submitSettlement).toHaveBeenCalledTimes(2);

    jest.useRealTimers();
  });

  it('root mismatch skips tick instead of blind submit', async () => {
    const adapter = createMockAdapter();
    (adapter.getPoolState as jest.Mock).mockResolvedValue({
      currentRoot: 999n, // different from local
      currentRootIndex: 0n,
      levels: 20n,
      nextLeafIndex: 0n,
    });

    const config = createConfig({ adapter });
    const seq = new EvmSequencer(config);

    await (seq as any).tick();
    expect(adapter.submitSettlement).not.toHaveBeenCalled();
  });

  it('restart loads persisted in-flight state if within timeout', async () => {
    const { loadEvmPendingState } = require('../state-store');
    loadEvmPendingState.mockReturnValue({
      pendingCommitments: ['12345'],
      nextLeafIndex: 0,
      lastScannedBlock: '0',
      lastSyncedAt: Date.now(),
      inFlight: {
        txHash: '0xoldtx',
        startIndex: 0,
        batchSize: 1,
        submittedAt: Date.now() - 10_000, // within timeout
        expectedNextIndex: 1,
        commitments: ['12345'],
      },
    });

    const adapter = createMockAdapter();
    const config = createConfig({ adapter });
    const seq = new EvmSequencer(config);

    const status = seq.getStatus();
    expect(status.inFlight).not.toBeNull();
    expect(status.inFlight?.txHash).toBe('0xoldtx');

    // Next tick should see in-flight and skip
    await (seq as any).tick();
    expect(adapter.submitSettlement).not.toHaveBeenCalled();
  });

  it('restart discards stale in-flight state beyond timeout', async () => {
    const { loadEvmPendingState } = require('../state-store');
    loadEvmPendingState.mockReturnValue({
      pendingCommitments: ['12345'],
      nextLeafIndex: 0,
      lastScannedBlock: '0',
      lastSyncedAt: Date.now(),
      inFlight: {
        txHash: '0xoldtx',
        startIndex: 0,
        batchSize: 1,
        submittedAt: Date.now() - 200_000, // beyond 120s timeout
        expectedNextIndex: 1,
        commitments: ['12345'],
      },
    });

    const adapter = createMockAdapter();
    const config = createConfig({ adapter });
    const seq = new EvmSequencer(config);

    const status = seq.getStatus();
    expect(status.inFlight).toBeNull();
  });
});
