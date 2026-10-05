import { describe, expect, it, vi } from "vitest";
import { DEFAULT_LIMITS, createLimitsProvider } from "./limits";

function make(load: () => Promise<unknown | null>) {
  let t = 0;
  const loadFn = vi.fn(load);
  const provider = createLimitsProvider({ load: loadFn, now: () => t });
  return {
    provider,
    loadFn,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

describe("DEFAULT_LIMITS", () => {
  it("has the documented values", () => {
    expect(DEFAULT_LIMITS).toEqual({
      "compile.anon": { limit: 20, windowSec: 60 },
      "compile.user": { limit: 60, windowSec: 60 },
      auth: { limit: 5, windowSec: 60 },
      "auth.ip": { limit: 30, windowSec: 60 },
      "snippet.write": { limit: 30, windowSec: 60 },
    });
  });
});

describe("createLimitsProvider", () => {
  it("merges a valid override over the defaults", async () => {
    const { provider } = make(async () => ({ "compile.anon": { limit: 2, windowSec: 60 } }));
    expect(await provider.get()).toEqual({ ...DEFAULT_LIMITS, "compile.anon": { limit: 2, windowSec: 60 } });
  });

  it("falls back to defaults for a negative limit, unknown scope or non-object", async () => {
    expect(await make(async () => ({ auth: { limit: -1, windowSec: 60 } })).provider.get()).toEqual(DEFAULT_LIMITS);
    expect(await make(async () => ({ nope: { limit: 1, windowSec: 60 } })).provider.get()).toEqual(DEFAULT_LIMITS);
    expect(await make(async () => "garbage").provider.get()).toEqual(DEFAULT_LIMITS);
    expect(await make(async () => null).provider.get()).toEqual(DEFAULT_LIMITS);
  });

  it("rejects fractional, zero and absurd limits or windows (lockout guard)", async () => {
    const bad = [
      { auth: { limit: 0.5, windowSec: 60 } },
      { auth: { limit: 0, windowSec: 60 } },
      { auth: { limit: 5, windowSec: 0 } },
      { auth: { limit: 5, windowSec: 1.5 } },
      { auth: { limit: 1_000_000, windowSec: 60 } },
      { auth: { limit: 5, windowSec: 10_000_000 } },
    ];
    for (const doc of bad) expect(await make(async () => doc).provider.get()).toEqual(DEFAULT_LIMITS);
  });

  it("never exposes a mutable shared object: results and DEFAULT_LIMITS are frozen", async () => {
    const snapshot = structuredClone(DEFAULT_LIMITS);
    type Mutable = Record<string, { limit: number }>;
    for (const doc of [null, { auth: { limit: 7, windowSec: 60 } }]) {
      const got = (await make(async () => doc).provider.get()) as unknown as Mutable;
      expect(() => {
        got["auth"]!.limit = 999;
      }).toThrow(TypeError);
      expect(() => {
        got["compile.anon"] = { limit: 1 };
      }).toThrow(TypeError);
    }
    expect(DEFAULT_LIMITS).toEqual(snapshot);
  });

  it("falls back to defaults when load rejects, without throwing", async () => {
    const { provider } = make(async () => {
      throw new Error("mongo down");
    });
    expect(await provider.get()).toEqual(DEFAULT_LIMITS);
  });

  it("caches for 30s (including defaults after a failure) and reloads after", async () => {
    const { provider, loadFn, advance } = make(async () => {
      throw new Error("mongo down");
    });
    await provider.get();
    advance(29_000);
    await provider.get();
    expect(loadFn).toHaveBeenCalledTimes(1);
    advance(2_000);
    await provider.get();
    expect(loadFn).toHaveBeenCalledTimes(2);
  });

  it("invalidate() forces a reload", async () => {
    const { provider, loadFn } = make(async () => null);
    await provider.get();
    provider.invalidate();
    await provider.get();
    expect(loadFn).toHaveBeenCalledTimes(2);
  });
});
