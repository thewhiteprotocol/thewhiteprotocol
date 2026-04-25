"use strict";
/**
 * The White Protocol — Solana Batch Settlement Sequencer
 *
 * Automatically polls for pending deposits, generates ZK proofs,
 * and submits settle_deposits_batch transactions.
 *
 * This wraps the proven settlement logic from api-extensions.ts
 * in a clean, observable, stoppable loop.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.Sequencer = void 0;
const web3_js_1 = require("@solana/web3.js");
class Sequencer {
    config;
    running = false;
    settleCount = 0;
    lastSettleAt = null;
    lastError = null;
    loopPromise = null;
    constructor(config) {
        this.config = config;
    }
    getStatus() {
        return {
            running: this.running,
            settleCount: this.settleCount,
            lastSettleAt: this.lastSettleAt,
            lastError: this.lastError,
        };
    }
    async start() {
        if (this.running)
            return;
        this.running = true;
        this.config.logger.info(`Sequencer started — polling every ${this.config.pollIntervalMs}ms`);
        this.loopPromise = this.runLoop();
        return this.loopPromise;
    }
    stop() {
        this.running = false;
        this.config.logger.info('Sequencer stop requested');
    }
    async runLoop() {
        // Small startup delay so the relayer is fully initialized before first poll
        await sleep(10000);
        while (this.running) {
            try {
                await this.tick();
            }
            catch (err) {
                this.lastError = err?.message || String(err);
                this.config.logger.error({ err: this.lastError }, 'Sequencer tick error');
            }
            await sleep(this.config.pollIntervalMs);
        }
        this.config.logger.info('Sequencer stopped');
    }
    async tick() {
        const settlement = await this.config.apiExtensions.settlePendingDeposits();
        if (!settlement) {
            // No pending deposits — normal, silent return
            return;
        }
        const { proofBytes, newRootBytes, batchSize, merkleTreePda, pendingBufferPda, vkPda } = settlement;
        this.config.logger.info('Sequencer: submitting ZK proof', { batchSize });
        const authority = this.config.wallet;
        const ix = await this.config.program.methods
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
        const tx = new web3_js_1.Transaction().add(web3_js_1.ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }), web3_js_1.ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50_000 }), ix);
        const signature = await (0, web3_js_1.sendAndConfirmTransaction)(this.config.connection, tx, [authority], { commitment: 'confirmed', maxRetries: 3 });
        this.settleCount++;
        this.lastSettleAt = Date.now();
        this.lastError = null;
        this.config.logger.info('Sequencer: batch settled', {
            signature,
            batchSize,
            settleCount: this.settleCount,
        });
    }
}
exports.Sequencer = Sequencer;
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
