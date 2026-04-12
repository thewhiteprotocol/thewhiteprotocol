/**
 * Relayer Selection for pSOL v2 (CORRECTED)
 *
 * # Fix Applied
 *
 * Uses Anchor IDL decoder instead of manual byte slicing.
 * This prevents breakage when account layout changes.
 *
 * @module relayer/relayer-selector
 */
import { Connection, PublicKey } from '@solana/web3.js';
import { Program, Idl } from '@coral-xyz/anchor';
import { RelayerInfo } from '../types';
export type RelayerSelectionStrategy = 'lowest-fee' | 'reputation' | 'random';
export interface RelayerSelectorConfig {
    connection: Connection;
    programId: PublicKey;
    pool: PublicKey;
    program?: Program;
}
/**
 * Relayer selector - finds and ranks relayers
 *
 * CORRECTED: Uses Anchor IDL decoder instead of manual byte slicing
 */
export declare class RelayerSelector {
    private connection;
    private programId;
    private pool;
    private program;
    constructor(config: RelayerSelectorConfig);
    /**
     * Load program with IDL if not already loaded
     */
    private ensureProgram;
    /**
     * Get all active relayers for the pool (CORRECTED VERSION)
     *
     * FIXED: Uses Anchor account decoder instead of manual byte slicing
     */
    getAllActiveRelayers(): Promise<RelayerInfo[]>;
    /**
     * Alternative: Fetch relayers without program instance
     *
     * This version manually decodes but uses the CORRECT layout.
     * Better than byte slicing at hard-coded offsets.
     */
    getAllActiveRelayersManual(): Promise<RelayerInfo[]>;
    /**
     * Select best relayer using specified strategy
     */
    getBestRelayer(strategy?: RelayerSelectionStrategy): Promise<RelayerInfo | null>;
    /**
     * Select relayer with lowest fee
     */
    selectByFee(relayers: RelayerInfo[]): RelayerInfo;
    /**
     * Select relayer by reputation (most transactions)
     */
    selectByReputation(relayers: RelayerInfo[]): RelayerInfo;
    /**
     * Select random relayer (for privacy)
     */
    selectRandom(relayers: RelayerInfo[]): RelayerInfo;
    /**
     * Estimate fee for a given relayer and amount
     */
    estimateFee(relayer: RelayerInfo, amount: bigint): bigint;
}
/**
 * Helper: Create selector with loaded program (RECOMMENDED)
 */
export declare function createRelayerSelector(connection: Connection, programId: PublicKey, pool: PublicKey, idl: Idl): Promise<RelayerSelector>;
//# sourceMappingURL=relayer-selector.d.ts.map