/**
 * Limita chamadas de saída a um provedor (ex.: AeroAPI Personal = 10 result sets/minuto).
 * Janela deslizante: se o limite foi atingido, espera até liberar (ou aborta pelo signal).
 */
export class SlidingWindowThrottle {
  private readonly timestamps: number[] = [];

  constructor(
    private readonly maxPerWindow: number,
    private readonly windowMs = 60_000,
    private readonly now: () => number = Date.now,
    private readonly sleep: (ms: number, signal?: AbortSignal) => Promise<void> = defaultSleep,
  ) {}

  /** Tempo (ms) até haver vaga; 0 se há vaga agora. */
  waitTimeMs(): number {
    const t = this.now();
    while (this.timestamps.length > 0 && this.timestamps[0]! <= t - this.windowMs) this.timestamps.shift();
    if (this.timestamps.length < this.maxPerWindow) return 0;
    return this.timestamps[0]! + this.windowMs - t;
  }

  async acquire(signal?: AbortSignal, maxWaitMs = 20_000): Promise<boolean> {
    let wait = this.waitTimeMs();
    if (wait > maxWaitMs) return false;
    while (wait > 0) {
      await this.sleep(wait, signal);
      wait = this.waitTimeMs();
    }
    this.timestamps.push(this.now());
    return true;
  }
}

function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
      },
      { once: true },
    );
  });
}

/** Limite de requisições de entrada por cliente (protege as chaves pagas contra abuso). */
export class TokenBucketLimiter {
  private readonly buckets = new Map<string, { tokens: number; updatedAt: number }>();

  constructor(
    private readonly capacity: number,
    private readonly refillPerSecond: number,
    private readonly now: () => number = Date.now,
  ) {}

  take(key: string, cost = 1): boolean {
    const t = this.now();
    const b = this.buckets.get(key) ?? { tokens: this.capacity, updatedAt: t };
    const elapsed = (t - b.updatedAt) / 1000;
    b.tokens = Math.min(this.capacity, b.tokens + elapsed * this.refillPerSecond);
    b.updatedAt = t;
    const ok = b.tokens >= cost;
    if (ok) b.tokens -= cost;
    this.buckets.set(key, b);
    if (this.buckets.size > 10_000) this.buckets.delete(this.buckets.keys().next().value!);
    return ok;
  }
}
