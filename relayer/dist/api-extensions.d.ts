/**
 * The White Protocol Relayer API Extensions
 *
 * Handles ALL heavy cryptographic operations server-side:
 * - Proof generation (deposit, withdraw)
 * - Poseidon hashing for commitments
 * - Merkle tree operations
 * - Asset ID computation
 *
 * This file should be integrated into your existing relayer at:
 * relayer/src/api-extensions.ts
 *
 * @module relayer/api-extensions
 */
import { Router } from 'express';
import { PublicKey } from '@solana/web3.js';
interface ApiExtensionsConfig {
    /** Path to circuits directory */
    circuitsPath: string;
    /** Solana RPC endpoint */
    rpcEndpoint: string;
    /** Pool configuration pubkey */
    poolConfig: PublicKey;
    /** Program ID */
    programId: PublicKey;
    /** Merkle tree depth */
    treeDepth: number;
}
export declare class RelayerApiExtensions {
    private config;
    private connection;
    private router;
    private merkleTree;
    private depositWasm;
    private depositZkey;
    private depositVk;
    private withdrawWasm;
    private withdrawZkey;
    private withdrawVk;
    private rpcCache;
    constructor(config: ApiExtensionsConfig);
    private setupMiddleware;
    private requireAuth;
    /**
     * Initialize the API extensions (load circuits, poseidon)
     */
    initialize(): Promise<void>;
    private loadCircuitArtifacts;
    /**
     * Persist current merkle tree leaves to disk
     */
    private persistMerkleTree;
    /**
     * Cached account info fetch with optional TTL override
     */
    private getAccountInfoCached;
    private syncMerkleTree;
    private setupRoutes;
    /**
     * Get the Express router
     */
    getRouter(): Router;
}
/**
 * Create and initialize the API extensions
 */
export declare function createApiExtensions(config: ApiExtensionsConfig): Promise<RelayerApiExtensions>;
export {};
/**
 * Example: How to integrate into existing relayer
 *
 * In your relayer/src/index.ts:
 *
 * ```typescript
 * import { createApiExtensions } from './api-extensions';
 *
 * // After creating your express app:
 * const apiExtensions = await createApiExtensions({
 *   circuitsPath: path.join(__dirname, '../../circuits/build'),
 *   rpcEndpoint: process.env.RPC_ENDPOINT || 'https://api.devnet.solana.com',
 *   poolConfig: new PublicKey(process.env.POOL_CONFIG!),
 *   programId: new PublicKey(process.env.PROGRAM_ID!),
 *   treeDepth: 20,
 * });
 *
 * // Mount the API extensions
 * app.use('/api', apiExtensions.getRouter());
 * ```
 */ 
//# sourceMappingURL=api-extensions.d.ts.map