/**
 * The White Protocol — Base (EVM) Batch Settlement Sequencer
 *
 * Automatically polls Base chain for pending deposits, generates ZK proofs,
 * and submits settleBatch transactions.
 */

import { BaseAdapter } from './chains/base';
import { RelayerApiExtensions, ServerMerkleTree } from './api-extensions';
import {
  loadBaseMerkleState,
  saveBaseMerkleState,
  loadBasePendingState,
  saveBasePendingState,
  appendBaseSettledCommitment,
} from './state-store';
import * as crypto from 'crypto';

export interface BaseSequencerConfig {
  baseAdapter: BaseAdapter;
  apiExtensions: RelayerApiExtensions;
  treeDepth: number;
  pollIntervalMs: number;
  logger: any;
}

const MAX_BATCH_SIZE = 1;

export class BaseSequencer {
  private running = false;
  private settleCount = 0;
  private lastSettleAt: number | null = null;
  private lastError: string | null = null;
  private loopPromise: Promise<void> | null = null;

  private merkleTree: ServerMerkleTree;
  private lastScannedBlock: bigint = 0n;
  private pendingCommitments: bigint[] = [];
  private nextLeafIndex: number = 0;

  constructor(private config: BaseSequencerConfig) {
    this.merkleTree = new ServerMerkleTree(config.treeDepth);
    this.loadState();
  }

  getStatus() {
    return {
      running: this.running,
      settleCount: this.settleCount,
      lastSettleAt: this.lastSettleAt,
      lastError: this.lastError,
      pendingCount: this.pendingCommitments.length,
      treeLeafCount: this.merkleTree.getLeafCount(),
      nextLeafIndex: this.nextLeafIndex,
    };
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.config.logger.info(
      `Base sequencer started — polling every ${this.config.pollIntervalMs}ms`
    );
    this.loopPromise = this.runLoop();
    return this.loopPromise;
  }

  stop(): void {
    this.running = false;
    this.config.logger.info('Base sequencer stop requested');
  }

  private async runLoop(): Promise<void> {
    // Small startup delay so the relayer is fully initialized before first poll
    await sleep(10000);

    while (this.running) {
      try {
        await this.tick();
      } catch (err: any) {
        this.lastError = err?.message || String(err);
        this.config.logger.error({ err: this.lastError }, 'Base sequencer tick error');
      }
      await sleep(this.config.pollIntervalMs);
    }

    this.config.logger.info('Base sequencer stopped');
  }

  private async tick(): Promise<void> {
    // Sync tree state from chain (rebuilds if root mismatch detected)
    await this.syncTreeFromEvents();

    // Read current pending deposits
    const pending = await this.config.baseAdapter.getPendingDeposits();
    this.pendingCommitments = pending;
    this.persistState();

    if (pending.length === 0) {
      return;
    }

    const poolState = await this.config.baseAdapter.getPoolState();
    const startIndex = Number(poolState.nextLeafIndex);
    const batchSize = Math.min(pending.length, MAX_BATCH_SIZE);

    // Verify local tree matches on-chain before generating proof
    const localRoot = this.merkleTree.getRoot();
    if (localRoot !== poolState.currentRoot) {
      this.config.logger.warn('Base sequencer: local tree root mismatch — skipping tick', {
        localRoot: localRoot.toString(16).slice(0, 16),
        onChainRoot: poolState.currentRoot.toString(16).slice(0, 16),
        nextLeafIndex: startIndex,
      });
      return;
    }

    const commitments = pending.slice(0, batchSize);
    const { paths, newRoot } = this.merkleTree.simulateBatchInsert(commitments, startIndex);

    this.config.logger.info('Base sequencer: generating ZK proof', {
      batchSize,
      startIndex,
      oldRoot: poolState.currentRoot.toString(16).slice(0, 16),
      newRoot: newRoot.toString(16).slice(0, 16),
    });

    const { proofBytes } = await this.config.apiExtensions.generateBatchProof(
      poolState.currentRoot,
      newRoot,
      startIndex,
      batchSize,
      commitments,
      paths
    );

    // Compute commitmentsHash (must match circuit)
    const commitmentsHash = this.computeCommitmentsHash(commitments);

    this.config.logger.info('Base sequencer: submitting settlement', {
      batchSize,
      startIndex,
      commitmentsHash: commitmentsHash.toString(16).slice(0, 16),
    });

    const txHash = await this.config.baseAdapter.submitSettlement(
      `0x${this.bytesToHex(proofBytes)}` as `0x${string}`,
      poolState.currentRoot,
      newRoot,
      startIndex,
      batchSize,
      commitmentsHash
    );

    // Update local tree with settled commitments
    for (let i = 0; i < batchSize; i++) {
      this.merkleTree.insertAt(startIndex + i, commitments[i]);
      appendBaseSettledCommitment({
        commitment: commitments[i].toString(),
        leafIndex: startIndex + i,
        settledAt: Date.now(),
        signature: txHash,
      });
    }

    this.settleCount++;
    this.lastSettleAt = Date.now();
    this.lastError = null;
    this.nextLeafIndex = startIndex + batchSize;
    this.persistState();

    this.config.logger.info('Base sequencer: batch settled', {
      txHash,
      batchSize,
      startIndex,
      settleCount: this.settleCount,
    });
  }

  /**
   * Sync the local Merkle tree with on-chain state.
   * If our local root doesn't match the contract, rebuild from Deposit + BatchSettlement events.
   */
  private async syncTreeFromEvents(): Promise<void> {
    try {
      const poolState = await this.config.baseAdapter.getPoolState();
      const localRoot = this.merkleTree.getRoot();

      if (localRoot === poolState.currentRoot) {
        this.nextLeafIndex = Number(poolState.nextLeafIndex);
        return; // Already in sync
      }

      this.config.logger.warn('Base sequencer: root mismatch, rebuilding from events', {
        localRoot: localRoot.toString(16).slice(0, 16),
        onChainRoot: poolState.currentRoot.toString(16).slice(0, 16),
        localLeafCount: this.merkleTree.getLeafCount(),
        onChainNextLeafIndex: Number(poolState.nextLeafIndex),
      });

      // Full rebuild from all historical events
      const [depositEvents, settlementEvents] = await Promise.all([
        this.config.baseAdapter.getDepositEvents(),
        this.config.baseAdapter.getBatchSettlementEvents(),
      ]);

      // Sort chronologically by (blockNumber, logIndex)
      const allDeposits = depositEvents
        .sort((a, b) => {
          const blockDiff = Number(a.blockNumber - b.blockNumber);
          if (blockDiff !== 0) return blockDiff;
          return a.logIndex - b.logIndex;
        })
        .map(e => e.commitment);

      const totalSettled = settlementEvents.reduce(
        (sum, s) => sum + Number(s.batchSize),
        0
      );

      const toSettle = Math.min(totalSettled, allDeposits.length);

      const tree = new ServerMerkleTree(this.config.treeDepth);
      for (let i = 0; i < toSettle; i++) {
        tree.insertAt(i, allDeposits[i]);
      }

      this.merkleTree = tree;
      this.nextLeafIndex = Number(poolState.nextLeafIndex);

      const maxBlock = Math.max(
        ...depositEvents.map(e => Number(e.blockNumber)),
        ...settlementEvents.map(e => Number(e.blockNumber)),
        0
      );
      this.lastScannedBlock = BigInt(maxBlock);

      this.config.logger.info('Base sequencer: tree rebuilt from events', {
        settledLeaves: toSettle,
        totalDeposits: allDeposits.length,
        totalSettlements: settlementEvents.length,
        onChainNextLeafIndex: this.nextLeafIndex,
      });

      this.persistState();
    } catch (err: any) {
      this.config.logger.error('Base sequencer sync failed', { error: err.message });
    }
  }

  private loadState(): void {
    const merkleState = loadBaseMerkleState();
    if (merkleState && merkleState.leaves.length > 0) {
      try {
        this.merkleTree.setLeaves(merkleState.leaves.map(l => BigInt(l)));
      } catch (err: any) {
        this.config.logger.warn('Base sequencer: failed to load merkle state, starting fresh', {
          error: err.message,
        });
        this.merkleTree = new ServerMerkleTree(this.config.treeDepth);
      }
    }

    const pendingState = loadBasePendingState();
    if (pendingState) {
      this.pendingCommitments = pendingState.pendingCommitments.map(c => BigInt(c));
      this.nextLeafIndex = pendingState.nextLeafIndex;
      this.lastScannedBlock = BigInt(pendingState.lastScannedBlock || '0');
    }
  }

  private persistState(): void {
    try {
      saveBaseMerkleState({
        leaves: this.merkleTree.getLeaves().map(l => l.toString()),
      });
      saveBasePendingState({
        pendingCommitments: this.pendingCommitments.map(c => c.toString()),
        nextLeafIndex: this.nextLeafIndex,
        lastScannedBlock: this.lastScannedBlock.toString(),
        lastSyncedAt: Date.now(),
      });
    } catch (err: any) {
      this.config.logger.warn('Base sequencer: failed to persist state', { error: err.message });
    }
  }

  /**
   * Compute SHA-256 hash of padded commitments, masked to 253 bits.
   * Matches on-chain commitmentsHash computation.
   */
  private computeCommitmentsHash(commitments: bigint[]): bigint {
    const buffer = Buffer.alloc(MAX_BATCH_SIZE * 32);
    for (let i = 0; i < commitments.length; i++) {
      const bytes = this.feToBytes32BE(commitments[i]);
      buffer.set(bytes, i * 32);
    }
    const hash = crypto.createHash('sha256').update(buffer).digest();
    const hashBigint = this.bytesToBigIntBE(hash);
    const mask = (1n << 253n) - 1n;
    return hashBigint & mask;
  }

  private feToBytes32BE(value: bigint): Uint8Array {
    const hex = value.toString(16).padStart(64, '0');
    const bytes = new Uint8Array(32);
    for (let i = 0; i < 32; i++) {
      bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
    }
    return bytes;
  }

  private bytesToBigIntBE(bytes: Uint8Array): bigint {
    let result = 0n;
    for (const byte of bytes) {
      result = (result << 8n) | BigInt(byte);
    }
    return result;
  }

  private bytesToHex(bytes: Uint8Array): string {
    return Array.from(bytes)
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
