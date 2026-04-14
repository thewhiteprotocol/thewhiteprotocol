/**
 * Simple in-memory TTL cache for RPC responses and other expensive data.
 */

export class TtlCache<T> {
  private cache = new Map<string, { value: T; expiresAt: number }>();

  constructor(private defaultTtlMs: number = 5000) {}

  get(key: string): T | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: T, ttlMs?: number): void {
    const expiresAt = Date.now() + (ttlMs ?? this.defaultTtlMs);
    this.cache.set(key, { value, expiresAt });
  }

  delete(key: string): void {
    this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
  }

  keys(): IterableIterator<string> {
    return this.cache.keys();
  }
}
