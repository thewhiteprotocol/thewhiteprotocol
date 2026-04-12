"use strict";
/**
 * Nullifier Cache for The White Protocol Relayer
 *
 * Simple in-memory cache for nullifiers.
 * For production, use Redis or a persistent store.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.NullifierCache = void 0;
/**
 * In-memory nullifier cache
 */
class NullifierCache {
    constructor() {
        this.cache = new Map();
    }
    /**
     * Generate cache key for a nullifier
     */
    getNullifierKey(pool, nullifierHash) {
        const poolStr = pool.toBase58();
        const hashHex = Buffer.from(nullifierHash).toString('hex');
        return `${poolStr}:${hashHex}`;
    }
    /**
     * Check if a nullifier has been used (cached check)
     */
    async isNullifierUsed(pool, nullifierHash) {
        const key = this.getNullifierKey(pool, nullifierHash);
        return this.cache.get(key) ?? false;
    }
    /**
     * Mark a nullifier as used in the cache
     */
    async markNullifierUsed(pool, nullifierHash) {
        const key = this.getNullifierKey(pool, nullifierHash);
        this.cache.set(key, true);
        console.log(`Cached nullifier as spent: ${key}`);
    }
    /**
     * Clear cache for a pool
     */
    async clearCache(pool) {
        const poolStr = pool.toBase58();
        let deletedCount = 0;
        for (const key of this.cache.keys()) {
            if (key.startsWith(poolStr)) {
                this.cache.delete(key);
                deletedCount++;
            }
        }
        console.log(`Cache cleared: ${deletedCount} keys deleted`);
    }
    /**
     * Get cache statistics
     */
    async getStats(pool) {
        const poolStr = pool.toBase58();
        let totalKeys = 0;
        for (const key of this.cache.keys()) {
            if (key.startsWith(poolStr)) {
                totalKeys++;
            }
        }
        return { totalKeys };
    }
}
exports.NullifierCache = NullifierCache;
