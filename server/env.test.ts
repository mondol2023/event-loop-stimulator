import { describe, expect, it } from "vitest";
import { parseEnv } from "./env";

const SECRET_32 = "s".repeat(32);
const valid = {
  MONGODB_URI: "mongodb://localhost:27017/silicon-loop?replicaSet=rs0",
  SESSION_SECRET: SECRET_32,
};

describe("parseEnv", () => {
  it("accepts the minimal valid environment", () => {
    expect(parseEnv(valid)).toEqual(valid);
  });

  it("accepts optional REDIS_URL and ADMIN_BOOTSTRAP_EMAIL", () => {
    const env = parseEnv({
      ...valid,
      REDIS_URL: "redis://localhost:6379",
      ADMIN_BOOTSTRAP_EMAIL: "admin@example.com",
    });
    expect(env.REDIS_URL).toBe("redis://localhost:6379");
    expect(env.ADMIN_BOOTSTRAP_EMAIL).toBe("admin@example.com");
  });

  it("ignores unrelated process variables", () => {
    expect(parseEnv({ ...valid, PATH: "/usr/bin" })).toEqual(valid);
  });

  it("names every missing key", () => {
    expect(() => parseEnv({})).toThrow(/MONGODB_URI[\s\S]*SESSION_SECRET/);
  });

  it("rejects a non-mongodb URI", () => {
    expect(() => parseEnv({ ...valid, MONGODB_URI: "postgres://x" })).toThrow(/MONGODB_URI/);
  });

  it("requires SESSION_SECRET of at least 32 chars (31 fails, 32 passes)", () => {
    expect(() => parseEnv({ ...valid, SESSION_SECRET: "s".repeat(31) })).toThrow(/SESSION_SECRET/);
    expect(parseEnv({ ...valid, SESSION_SECRET: SECRET_32 }).SESSION_SECRET).toBe(SECRET_32);
  });

  it("treats empty optional values as unset", () => {
    const env = parseEnv({ ...valid, REDIS_URL: "", ADMIN_BOOTSTRAP_EMAIL: "" });
    expect(env).toEqual(valid);
    expect("REDIS_URL" in env).toBe(false);
  });

  it("rejects an invalid REDIS_URL and ADMIN_BOOTSTRAP_EMAIL", () => {
    expect(() => parseEnv({ ...valid, REDIS_URL: "not a url" })).toThrow(/REDIS_URL/);
    expect(() => parseEnv({ ...valid, ADMIN_BOOTSTRAP_EMAIL: "nope" })).toThrow(/ADMIN_BOOTSTRAP_EMAIL/);
  });

  it("never echoes secret values in the error", () => {
    const leaky = "mongodb-password-should-not-leak";
    try {
      parseEnv({ MONGODB_URI: `postgres://u:${leaky}@h`, SESSION_SECRET: "short-secret" });
      expect.unreachable();
    } catch (e) {
      expect(String(e)).not.toContain(leaky);
      expect(String(e)).not.toContain("short-secret");
    }
  });
});
