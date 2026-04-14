/**
 * Simple in-memory TTL cache for RPC responses and other expensive data.
 */
export declare class TtlCache<T> {
    private defaultTtlMs;
    private cache;
    constructor(defaultTtlMs?: number);
    get(key: string): T | undefined;
    set(key: string, value: T, ttlMs?: number): void;
    delete(key: string): void;
    clear(): void;
    keys(): IterableIterator<string>;
}
//# sourceMappingURL=ttl-cache.d.ts.map