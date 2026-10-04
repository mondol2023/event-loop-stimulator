import { describe, expect, it, vi } from "vitest";

vi.mock("@/server/env", () => ({
  getEnv: () => ({ SESSION_SECRET: "x".repeat(40), MONGODB_URI: "mongodb://localhost/test" }),
}));

import { clientIp, hashIp, requestContextFrom } from "./requestContext";

describe("clientIp", () => {
  it("uses the last x-forwarded-for entry (the one the trusted proxy appended)", () => {
    expect(clientIp(new Headers({ "x-forwarded-for": "1.1.1.1, 2.2.2.2" }))).toBe("2.2.2.2");
  });

  it("takes the last non-empty trimmed entry", () => {
    expect(clientIp(new Headers({ "x-forwarded-for": " 1.1.1.1 ,  2.2.2.2 " }))).toBe("2.2.2.2");
    expect(clientIp(new Headers({ "x-forwarded-for": "1.1.1.1, " }))).toBe("1.1.1.1");
  });

  it("falls back to x-real-ip, then to unknown", () => {
    expect(clientIp(new Headers({ "x-real-ip": "3.3.3.3" }))).toBe("3.3.3.3");
    expect(clientIp(new Headers())).toBe("unknown");
  });
});

describe("hashIp", () => {
  it("is 64 hex chars, stable, and differs per input", () => {
    const a = hashIp("1.2.3.4");
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(hashIp("1.2.3.4")).toBe(a);
    expect(hashIp("1.2.3.5")).not.toBe(a);
  });
});

describe("requestContextFrom", () => {
  it("keeps a given x-request-id and hashes the client ip", () => {
    const ctx = requestContextFrom(new Headers({ "x-request-id": "req-1", "x-real-ip": "9.9.9.9" }));
    expect(ctx).toEqual({ requestId: "req-1", ipHash: hashIp("9.9.9.9") });
  });

  it("generates a request id when none is given", () => {
    const ctx = requestContextFrom(new Headers());
    expect(ctx.requestId).toMatch(/^[0-9a-f-]{36}$/);
  });
});
