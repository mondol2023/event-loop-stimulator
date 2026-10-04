import "server-only";

export type BucketConfig = { capacity: number; refillPerSec: number };

export type ConsumeResult = {
  allowed: boolean;
  /** Whole tokens left after this call. */
  remaining: number;
  /** Integer seconds until one token is available; 0 when allowed. */
  retryAfterSec: number;
};

export interface RateLimitStore {
  /** Atomically refills the bucket at `key` up to `nowMs` and tries to take one token. */
  consume(key: string, cfg: BucketConfig, nowMs: number): Promise<ConsumeResult>;
}
