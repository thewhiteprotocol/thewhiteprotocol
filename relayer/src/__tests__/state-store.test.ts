import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('state-store', () => {
  let tmpDir: string;
  let originalStateDir: string | undefined;

  // Helper to load the module fresh with current env
  function loadStateStoreModule() {
    jest.resetModules();
    return require('../state-store');
  }

  beforeEach(() => {
    originalStateDir = process.env.STATE_DIR;
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'relayer-test-'));
    process.env.STATE_DIR = tmpDir;
  });

  afterEach(() => {
    process.env.STATE_DIR = originalStateDir;
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
    jest.resetModules();
  });

  describe('relayer state', () => {
    it('returns null when file does not exist', () => {
      const ss = loadStateStoreModule();
      expect(ss.loadRelayerState()).toBeNull();
    });

    it('saves and loads relayer state', () => {
      const ss = loadStateStoreModule();
      const state = { totalTransactions: 42, totalFeesEarned: '1000', supportedAssets: ['USDC'] };
      ss.saveRelayerState(state);
      expect(ss.loadRelayerState()).toEqual(state);
    });
  });

  describe('merkle tree state', () => {
    it('returns null when file does not exist', () => {
      const ss = loadStateStoreModule();
      expect(ss.loadMerkleTreeState()).toBeNull();
    });

    it('saves and loads merkle tree state', () => {
      const ss = loadStateStoreModule();
      const state = { leaves: ['0xabc', '0xdef'] };
      ss.saveMerkleTreeState(state);
      expect(ss.loadMerkleTreeState()).toEqual(state);
    });
  });

  describe('pending state', () => {
    it('returns null when file does not exist', () => {
      const ss = loadStateStoreModule();
      expect(ss.loadPendingState()).toBeNull();
    });

    it('saves and loads pending state', () => {
      const ss = loadStateStoreModule();
      const state = { pendingCommitments: ['0x1', '0x2'], nextLeafIndex: 5, lastSyncedAt: 12345 };
      ss.savePendingState(state);
      expect(ss.loadPendingState()).toEqual(state);
    });
  });

  describe('settled commitments', () => {
    it('returns null when file does not exist', () => {
      const ss = loadStateStoreModule();
      expect(ss.loadSettledCommitments()).toBeNull();
    });

    it('saves and loads settled commitments', () => {
      const ss = loadStateStoreModule();
      const state = {
        commitments: [
          { commitment: '0x1', leafIndex: 0, settledAt: 1000, signature: 'sig1' },
        ],
      };
      ss.saveSettledCommitments(state);
      expect(ss.loadSettledCommitments()).toEqual(state);
    });

    it('appends commitment to existing state', () => {
      const ss = loadStateStoreModule();
      ss.appendSettledCommitment({ commitment: '0x1', leafIndex: 0, settledAt: 1000, signature: 'sig1' });
      ss.appendSettledCommitment({ commitment: '0x2', leafIndex: 1, settledAt: 2000, signature: 'sig2' });

      const loaded = ss.loadSettledCommitments();
      expect(loaded?.commitments).toHaveLength(2);
      expect(loaded?.commitments[1].commitment).toBe('0x2');
    });
  });

  describe('base (legacy EVM) state', () => {
    it('saves and loads base merkle state', () => {
      const ss = loadStateStoreModule();
      const state = { leaves: ['0xa', '0xb'] };
      ss.saveBaseMerkleState(state);
      expect(ss.loadBaseMerkleState()).toEqual(state);
    });

    it('saves and loads base pending state', () => {
      const ss = loadStateStoreModule();
      const state = {
        pendingCommitments: ['0x1'],
        nextLeafIndex: 3,
        lastScannedBlock: '100',
        lastSyncedAt: 999,
      };
      ss.saveBasePendingState(state);
      expect(ss.loadBasePendingState()).toEqual(state);
    });

    it('saves and loads base settled commitments', () => {
      const ss = loadStateStoreModule();
      const state = {
        commitments: [{ commitment: '0x1', leafIndex: 0, settledAt: 100, signature: 's1' }],
      };
      ss.saveBaseSettledCommitments(state);
      expect(ss.loadBaseSettledCommitments()).toEqual(state);
    });

    it('appends base settled commitment', () => {
      const ss = loadStateStoreModule();
      ss.appendBaseSettledCommitment({ commitment: '0x1', leafIndex: 0, settledAt: 100, signature: 's1' });
      const loaded = ss.loadBaseSettledCommitments();
      expect(loaded?.commitments).toHaveLength(1);
    });
  });

  describe('per-chain EVM state', () => {
    it('saves and loads per-chain merkle state', () => {
      const ss = loadStateStoreModule();
      const state = { leaves: ['0x1', '0x2'] };
      ss.saveEvmMerkleState('base-sepolia', state);
      expect(ss.loadEvmMerkleState('base-sepolia')).toEqual(state);
    });

    it('returns null for different chain', () => {
      const ss = loadStateStoreModule();
      ss.saveEvmMerkleState('base-sepolia', { leaves: ['0x1'] });
      expect(ss.loadEvmMerkleState('ethereum-sepolia')).toBeNull();
    });

    it('saves and loads per-chain pending state with in-flight', () => {
      const ss = loadStateStoreModule();
      const state = {
        pendingCommitments: ['0x1'],
        nextLeafIndex: 1,
        lastScannedBlock: '100',
        lastSyncedAt: Date.now(),
        inFlight: {
          txHash: '0xabc',
          startIndex: 0,
          batchSize: 1,
          submittedAt: Date.now(),
          expectedNextIndex: 1,
          commitments: ['0x1'],
        },
      };
      ss.saveEvmPendingState('base-sepolia', state);
      expect(ss.loadEvmPendingState('base-sepolia')).toEqual(state);
    });

    it('saves and loads per-chain settled commitments', () => {
      const ss = loadStateStoreModule();
      const state = {
        commitments: [{ commitment: '0x1', leafIndex: 0, settledAt: 100, signature: 's1' }],
      };
      ss.saveEvmSettledCommitments('base-sepolia', state);
      expect(ss.loadEvmSettledCommitments('base-sepolia')).toEqual(state);
    });

    it('appends per-chain settled commitment', () => {
      const ss = loadStateStoreModule();
      ss.appendEvmSettledCommitment('base-sepolia', { commitment: '0x1', leafIndex: 0, settledAt: 100, signature: 's1' });
      ss.appendEvmSettledCommitment('base-sepolia', { commitment: '0x2', leafIndex: 1, settledAt: 200, signature: 's2' });
      const loaded = ss.loadEvmSettledCommitments('base-sepolia');
      expect(loaded?.commitments).toHaveLength(2);
    });

    it('isolates per-chain state', () => {
      const ss = loadStateStoreModule();
      ss.saveEvmMerkleState('base-sepolia', { leaves: ['0xbase'] });
      ss.saveEvmMerkleState('ethereum-sepolia', { leaves: ['0xeth'] });

      expect(ss.loadEvmMerkleState('base-sepolia')).toEqual({ leaves: ['0xbase'] });
      expect(ss.loadEvmMerkleState('ethereum-sepolia')).toEqual({ leaves: ['0xeth'] });
    });
  });

  describe('atomic write semantics', () => {
    it('writes via temp file and rename', () => {
      const ss = loadStateStoreModule();
      ss.saveRelayerState({ totalTransactions: 1, totalFeesEarned: '0', supportedAssets: [] });
      const files = fs.readdirSync(tmpDir);
      // Should not leave .tmp files behind
      expect(files.some(f => f.endsWith('.tmp'))).toBe(false);
      expect(files).toContain('relayer-state.json');
    });
  });

  describe('graceful error handling', () => {
    it('returns null for corrupted JSON', () => {
      fs.mkdirSync(tmpDir, { recursive: true });
      fs.writeFileSync(path.join(tmpDir, 'relayer-state.json'), 'not-json{');
      const ss = loadStateStoreModule();
      expect(ss.loadRelayerState()).toBeNull();
    });
  });
});
