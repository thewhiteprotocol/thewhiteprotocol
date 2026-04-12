/**
 * Nullifier Cache for The White Protocol Relayer
 *
 * Simple in-memory cache for nullifiers.
 * For production, use Redis or a persistent store.
 */
import { PublicKey } from '@solana/web3.js';
/**
 * In-memory nullifier cache
 */
export declare class NullifierCache {
    private cache;
    /**
     * Generate cache key for a nullifier
     */
    private getNullifierKey;
    /**
     * Check if a nullifier has been used (cached check)
     */
    isNullifierUsed(pool: PublicKey, nullifierHash: Uint8Array): Promise<boolean>;
    /**
     * Mark a nullifier as used in the cache
     */
    markNullifierUsed(pool: PublicKey, nullifierHash: Uint8Array): Promise<void>;
    /**
     * Clear cache for a pool
     */
    clearCache(pool: PublicKey): Promise<void>;
    /**
     * Get cache statistics
     */
    getStats(pool: PublicKey): Promise<{
        totalKeys: number;
    }>;
}
//# sourceMappingURL=nullifier-cache.d.ts.map