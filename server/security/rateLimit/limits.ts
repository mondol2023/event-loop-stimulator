import "server-only";
import { z } from "@/core/shared/zod";

export type RateLimitScope = "compile.anon" | "compile.user" | "auth" | "auth.ip" | "snippet.write";
export type ScopeLimit = { readonly limit: number; readonly windowSec: number };
export type Limits = Readonly<Record<RateLimitScope, ScopeLimit>>;

// Frozen all the way down: this object (and every merged result) is shared by
// all callers, so nobody may mutate it.
export const DEFAULT_LIMITS: Limits = Object.freeze({
  "compile.anon": Object.freeze({ limit: 20, windowSec: 60 }),
  "compile.user": Object.freeze({ limit: 60, windowSec: 60 }),
  auth: Object.freeze({ limit: 5, windowSec: 60 }),
  "auth.ip": Object.freeze({ limit: 30, windowSec: 60 }),
  "snippet.write": Object.freeze({ limit: 30, windowSec: 60 }),
});

const SCOPES = Object.keys(DEFAULT_LIMITS) as RateLimitScope[];

// Integers only: a fractional limit (e.g. 0.5) gives capacity < 1, so a bucket
// could never hold a whole token and the scope would be locked out forever.
const ScopeLimitSchema = z
  .object({
    limit: z.number().int().positive().max(100_000),
    windowSec: z.number().int().positive().max(86_400),
  })
  .strict();
const OverrideSchema = z
  .object({
    "compile.anon": ScopeLimitSchema.optional(),
    "compile.user": ScopeLimitSchema.optional(),
    auth: ScopeLimitSchema.optional(),
    "auth.ip": ScopeLimitSchema.optional(),
    "snippet.write": ScopeLimitSchema.optional(),
  })
  .strict();

const DEFAULT_TTL_MS = 30_000;

export type LimitsProvider = { get(): Promise<Limits>; invalidate(): void };

function merge(doc: unknown): Limits {
  const parsed = OverrideSchema.safeParse(doc);
  if (!parsed.success) return DEFAULT_LIMITS;
  const merged: Record<RateLimitScope, ScopeLimit> = { ...DEFAULT_LIMITS };
  for (const scope of SCOPES) {
    const override = parsed.data[scope];
    if (override) merged[scope] = Object.freeze({ limit: override.limit, windowSec: override.windowSec });
  }
  return Object.freeze(merged);
}

/**
 * Admin-editable limits with a short cache. Anything wrong (load failure,
 * invalid shape) yields the defaults, and those are cached for the same TTL so
 * a database outage costs one slow call per TTL rather than one per request.
 */
export function createLimitsProvider(opts: {
  load: () => Promise<unknown | null>;
  now: () => number;
  ttlMs?: number;
}): LimitsProvider {
  const ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
  let cached: { value: Limits; expiresAt: number } | undefined;
  let inflight: Promise<Limits> | undefined;

  async function refresh(): Promise<Limits> {
    let value: Limits;
    try {
      value = merge(await opts.load());
    } catch {
      value = DEFAULT_LIMITS;
    }
    cached = { value, expiresAt: opts.now() + ttlMs };
    return value;
  }

  return {
    async get() {
      if (cached && opts.now() < cached.expiresAt) return cached.value;
      inflight ??= refresh().finally(() => {
        inflight = undefined;
      });
      return inflight;
    },
    invalidate() {
      cached = undefined;
    },
  };
}
