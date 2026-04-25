/**
 * The White Protocol — Solana Batch Settlement Sequencer
 *
 * Automatically polls for pending deposits, generates ZK proofs,
 * and submits settle_deposits_batch transactions.
 *
 * This wraps the proven settlement logic from api-extensions.ts
 * in a clean, observable, stoppable loop.
 */
import { Connection, PublicKey, Keypair } from '@solana/web3.js';
import { Program } from '@coral-xyz/anchor';
import { RelayerApiExtensions } from './api-extensions';
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
export declare class Sequencer {
    private config;
    private running;
    private settleCount;
    private lastSettleAt;
    private lastError;
    private loopPromise;
    constructor(config: SequencerConfig);
    getStatus(): {
        running: boolean;
        settleCount: number;
        lastSettleAt: number | null;
        lastError: string | null;
    };
    start(): Promise<void>;
    stop(): void;
    private runLoop;
    private tick;
}
//# sourceMappingURL=sequencer.d.ts.map