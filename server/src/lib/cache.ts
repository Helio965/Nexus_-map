/**
 * Cache em memória com TTL e limite de entradas (descarta a mais antiga — ordem de inserção
 * do Map, renovada a cada leitura, ou seja, LRU).
 */
export class TtlCache<V> {
  private readonly store = new Map<string, { value: V; expiresAt: number }>();

  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries = 500,
    private readonly now: () => number = Date.now,
  ) {}

  get(key: string): V | undefined {
    const hit = this.store.get(key);
    if (!hit) return undefined;
    if (hit.expiresAt <= this.now()) {
      this.store.delete(key);
      return undefined;
    }
    this.store.delete(key);
    this.store.set(key, hit);
    return hit.value;
  }

  set(key: string, value: V, ttlMs = this.ttlMs): void {
    if (this.store.has(key)) this.store.delete(key);
    this.store.set(key, { value, expiresAt: this.now() + ttlMs });
    while (this.store.size > this.maxEntries) {
      const oldest = this.store.keys().next().value;
      if (oldest === undefined) break;
      this.store.delete(oldest);
    }
  }

  async getOrLoad(key: string, load: () => Promise<V>, ttlMs?: number): Promise<V> {
    const cached = this.get(key);
    if (cached !== undefined) return cached;
    const value = await load();
    this.set(key, value, ttlMs);
    return value;
  }

  get size(): number {
    return this.store.size;
  }
}

export function cacheKey(parts: unknown): string {
  return JSON.stringify(parts);
}
