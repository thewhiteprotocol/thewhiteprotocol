/**
 * The White Protocol — Solana Batch Settlement Sequencer
 *
 * Automatically polls for pending deposits, generates ZK proofs,
 * and submits settle_deposits_batch transactions.
 *
 * This wraps the proven settlement logic from api-extensions.ts
 * in a clean, observable, stoppable loop.
 */

import {
  Connection,
  PublicKey,
  Keypair,
  Transaction,
  ComputeBudgetProgram,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import { Program } from '@coral-xyz/anchor';
import { RelayerApiExtensions } from './api-extensions';
import { appendSettledCommitment } from './state-store';

export interface SequencerConfig {
  connection: Connection;
  wallet: Keypair;
  program: Program;
  apiExtensions: RelayerApiExtensions;
  poolConfig: PublicKey;
  merkleTree: PublicKey;
  pendingBuffer: PublicKey;
  vkPda: PublicKey;
  pollIntervalMs: number;
  logger: any;
}

export class Sequencer {
  private running = false;
  private settleCount = 0;
  private lastSettleAt: number | null = null;
  private lastError: string | null = null;
  private loopPromise: Promise<void> | null = null;

  constructor(private config: SequencerConfig) {}

  getStatus() {
    return {
      running: this.running,
      settleCount: this.settleCount,
      lastSettleAt: this.lastSettleAt,
      lastError: this.lastError,
    };
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.config.logger.info(
      `Sequencer started — polling every ${this.config.pollIntervalMs}ms`
    );
    this.loopPromise = this.runLoop();
    return this.loopPromise;
  }

  stop(): void {
    this.running = false;
    this.config.logger.info('Sequencer stop requested');
  }

  private async runLoop(): Promise<void> {
    // Small startup delay so the relayer is fully initialized before first poll
    await sleep(10000);

    while (this.running) {
      try {
        await this.tick();
      } catch (err: any) {
        this.lastError = err?.message || String(err);
        this.config.logger.error({ err: this.lastError }, 'Sequencer tick error');
      }
      await sleep(this.config.pollIntervalMs);
    }

    this.config.logger.info('Sequencer stopped');
  }

  private async tick(): Promise<void> {
    const settlement = await this.config.apiExtensions.settlePendingDeposits();
    if (!settlement) {
      // No pending deposits — normal, silent return
      return;
    }

    const {
      proofBytes,
      newRootBytes,
      batchSize,
      startIndex,
      commitments,
      merkleTreePda,
      pendingBufferPda,
      vkPda,
    } = settlement;

    this.config.logger.info('Sequencer: submitting ZK proof', { batchSize, startIndex });

    const authority = this.config.wallet;

    const ix = await (this.config.program.methods as any)
      .settleDepositsBatch({
        proof: Array.from(proofBytes),
        newRoot: Array.from(newRootBytes),
        batchSize,
      })
      .accounts({
        authority: authority.publicKey,
        poolConfig: this.config.poolConfig,
        merkleTree: merkleTreePda,
        pendingBuffer: pendingBufferPda,
        verificationKey: vkPda,
      })
      .instruction();

    const tx = new Transaction().add(
      ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50_000 }),
      ix
    );

    const signature = await sendAndConfirmTransaction(
      this.config.connection,
      tx,
      [authority],
      { commitment: 'confirmed', maxRetries: 3 }
    );

    // Persist settled commitments so restarts never lose tree state
    try {
      for (let i = 0; i < batchSize; i++) {
        appendSettledCommitment({
          commitment: commitments[i].toString(),
          leafIndex: startIndex + i,
          settledAt: Date.now(),
          signature,
        });
      }
      this.config.logger.info('Sequencer: persisted settled commitments', {
        count: batchSize,
        startIndex,
      });
    } catch (persistErr) {
      this.config.logger.warn('Failed to persist settled commitments', { error: String(persistErr) });
    }

    this.settleCount++;
    this.lastSettleAt = Date.now();
    this.lastError = null;

    this.config.logger.info('Sequencer: batch settled', {
      signature,
      batchSize,
      startIndex,
      settleCount: this.settleCount,
    });
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
