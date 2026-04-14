"use strict";
/**
 * Simple in-memory TTL cache for RPC responses and other expensive data.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.TtlCache = void 0;
class TtlCache {
    constructor(defaultTtlMs = 5000) {
        this.defaultTtlMs = defaultTtlMs;
        this.cache = new Map();
    }
    get(key) {
        const entry = this.cache.get(key);
        if (!entry)
            return undefined;
        if (Date.now() > entry.expiresAt) {
            this.cache.delete(key);
            return undefined;
        }
        return entry.value;
    }
    set(key, value, ttlMs) {
        const expiresAt = Date.now() + (ttlMs ?? this.defaultTtlMs);
        this.cache.set(key, { value, expiresAt });
    }
    delete(key) {
        this.cache.delete(key);
    }
    clear() {
        this.cache.clear();
    }
    keys() {
        return this.cache.keys();
    }
}
exports.TtlCache = TtlCache;
