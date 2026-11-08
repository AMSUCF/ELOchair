/**
 * Fixed-window counter, in memory. Enough for one server process.
 * Memory and CPU stay bounded under floods: expired entries are swept at most once per window,
 * and past `maxKeys` the oldest entries are evicted.
 */
export class RateLimiter {
  private readonly hits = new Map<string, { count: number; resetAt: number }>();
  private lastSweep = 0;

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
    private readonly maxKeys = 50_000,
  ) {}

  /** Records a hit; returns false when the key is over its limit for this window. */
  hit(key: string): boolean {
    const t = this.now();
    if (t - this.lastSweep >= this.windowMs) {
      for (const [k, v] of this.hits) if (v.resetAt <= t) this.hits.delete(k);
      this.lastSweep = t;
    }
    const entry = this.hits.get(key);
    if (!entry || entry.resetAt <= t) {
      this.hits.delete(key);
      while (this.hits.size >= this.maxKeys) {
        const oldest = this.hits.keys().next().value;
        if (oldest === undefined) break;
        this.hits.delete(oldest);
      }
      this.hits.set(key, { count: 1, resetAt: t + this.windowMs });
      return true;
    }
    entry.count++;
    return entry.count <= this.limit;
  }

  get size(): number {
    return this.hits.size;
  }
}
