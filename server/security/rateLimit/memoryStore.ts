import "server-only";
import type { BucketConfig, ConsumeResult, RateLimitStore } from "./store";

type Bucket = { tokens: number; updatedMs: number };

const DEFAULT_MAX_KEYS = 10_000;

/**
 * Per-process token bucket. Bounded: a Map keeps insertion order, and every
 * update re-inserts the key, so the first key is always the least recently
 * updated and is the one evicted on overflow.
 */
export class MemoryRateLimitStore implements RateLimitStore {
  private readonly buckets = new Map<string, Bucket>();
  private readonly maxKeys: number;

  constructor(opts: { maxKeys?: number } = {}) {
    this.maxKeys = Math.max(1, opts.maxKeys ?? DEFAULT_MAX_KEYS);
  }

  get size(): number {
    return this.buckets.size;
  }

  consume(key: string, cfg: BucketConfig, nowMs: number): Promise<ConsumeResult> {
    const prev = this.buckets.get(key);
    let tokens = cfg.capacity;
    if (prev) {
      const elapsedSec = Math.max(0, nowMs - prev.updatedMs) / 1000;
      tokens = Math.min(cfg.capacity, prev.tokens + elapsedSec * cfg.refillPerSec);
    }

    const allowed = tokens >= 1;
    if (allowed) tokens -= 1;

    this.buckets.delete(key);
    this.buckets.set(key, { tokens, updatedMs: Math.max(nowMs, prev?.updatedMs ?? nowMs) });
    while (this.buckets.size > this.maxKeys) {
      const oldest = this.buckets.keys().next().value;
      if (oldest === undefined) break;
      this.buckets.delete(oldest);
    }

    return Promise.resolve({
      allowed,
      remaining: Math.floor(tokens),
      retryAfterSec: allowed ? 0 : Math.max(1, Math.ceil((1 - tokens) / cfg.refillPerSec)),
    });
  }
}
