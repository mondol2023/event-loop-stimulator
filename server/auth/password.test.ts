import argon2 from "argon2";
import { afterEach, describe, expect, it, vi } from "vitest";
import { hashPassword, verifyAgainstDummy, verifyPassword } from "./password";

describe("password hashing", () => {
  it("uses argon2id with the pinned OWASP parameters", async () => {
    const hash = await hashPassword("correct horse battery");
    // argon2@0.45 serializes the params as `m,p,t` rather than the PHC-conventional
    // `m,t,p`, so assert the parameter set, not their order.
    const [, algorithm, version, params] = hash.split("$");
    expect(algorithm).toBe("argon2id");
    expect(version).toBe("v=19");
    expect(new Set(params?.split(","))).toEqual(new Set(["m=19456", "t=2", "p=1"]));
  });

  it("verifies the right password and rejects a wrong one", async () => {
    const hash = await hashPassword("correct horse battery");
    expect(await verifyPassword(hash, "correct horse battery")).toBe(true);
    expect(await verifyPassword(hash, "correct horse batterY")).toBe(false);
  });

  it("salts: two hashes of the same password differ", async () => {
    const [a, b] = await Promise.all([hashPassword("same password 123"), hashPassword("same password 123")]);
    expect(a).not.toBe(b);
  });

  it("verifyPassword returns false (never throws) for a malformed hash", async () => {
    expect(await verifyPassword("not-a-hash", "whatever")).toBe(false);
    expect(await verifyPassword("", "whatever")).toBe(false);
  });

  it("verifyAgainstDummy resolves without throwing, repeatedly", async () => {
    await expect(verifyAgainstDummy("anything at all")).resolves.toBeUndefined();
    await expect(verifyAgainstDummy("")).resolves.toBeUndefined();
  });
});

describe("verifyAgainstDummy resilience", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("does not cache a failed dummy hash: the next call retries and still does a real verify", async () => {
    vi.resetModules();
    const fresh = await import("./password");
    const hashSpy = vi.spyOn(argon2, "hash").mockRejectedValueOnce(new Error("out of memory"));

    await expect(fresh.verifyAgainstDummy("pw")).resolves.toBeUndefined();
    expect(hashSpy).toHaveBeenCalledTimes(1);

    const verifySpy = vi.spyOn(argon2, "verify");
    await expect(fresh.verifyAgainstDummy("pw")).resolves.toBeUndefined();
    expect(hashSpy).toHaveBeenCalledTimes(2);
    expect(verifySpy).toHaveBeenCalledTimes(1);

    // Built once successfully, then reused.
    await fresh.verifyAgainstDummy("pw");
    expect(hashSpy).toHaveBeenCalledTimes(2);
    expect(verifySpy).toHaveBeenCalledTimes(2);
  });
});
