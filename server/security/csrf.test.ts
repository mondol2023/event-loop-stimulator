import { beforeEach, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => ({ secret: "s".repeat(48) }));
vi.mock("@/server/env", () => ({ getEnv: () => ({ SESSION_SECRET: env.secret }) }));

import { checkOrigin, issueCsrfToken, verifyCsrf } from "./csrf";

beforeEach(() => {
  env.secret = "s".repeat(48);
});

describe("issueCsrfToken / verifyCsrf", () => {
  it("issues a different token each call, and each verifies with itself", () => {
    const a = issueCsrfToken();
    const b = issueCsrfToken();
    expect(a).not.toBe(b);
    expect(verifyCsrf(a, a)).toBe(true);
    expect(verifyCsrf(b, b)).toBe(true);
  });

  it("rejects a missing cookie or header", () => {
    const token = issueCsrfToken();
    expect(verifyCsrf(undefined, token)).toBe(false);
    expect(verifyCsrf(token, null)).toBe(false);
    expect(verifyCsrf("", "")).toBe(false);
  });

  it("rejects a cookie/header mismatch, even when both are validly signed", () => {
    expect(verifyCsrf(issueCsrfToken(), issueCsrfToken())).toBe(false);
  });

  it("rejects a tampered signature or random part, and a token with no signature", () => {
    const token = issueCsrfToken();
    const [random, signature] = token.split(".") as [string, string];
    const flipped = `${signature.slice(0, -1)}${signature.endsWith("A") ? "B" : "A"}`;
    expect(verifyCsrf(`${random}.${flipped}`, `${random}.${flipped}`)).toBe(false);
    expect(verifyCsrf(`x${random}.${signature}`, `x${random}.${signature}`)).toBe(false);
    expect(verifyCsrf(random, random)).toBe(false);
    expect(verifyCsrf(`${token}.extra`, `${token}.extra`)).toBe(false);
  });

  it("rejects a pair an attacker could mint for themselves without the secret", () => {
    const forged = `${Buffer.alloc(32, 1).toString("base64url")}.${Buffer.alloc(32, 2).toString("base64url")}`;
    expect(verifyCsrf(forged, forged)).toBe(false);
  });

  it("rejects a token signed under another secret", () => {
    env.secret = "o".repeat(48);
    const foreign = issueCsrfToken();
    env.secret = "s".repeat(48);
    expect(verifyCsrf(foreign, foreign)).toBe(false);
  });
});

describe("checkOrigin", () => {
  const url = "https://app.example/api/compile";
  const headers = (init: Record<string, string>) => new Headers(init);

  it("accepts an Origin whose host equals the Host header", () => {
    expect(checkOrigin(headers({ origin: "https://app.example", host: "app.example" }), url)).toBe(true);
  });

  it("accepts a matching port and a matching X-Forwarded-Host", () => {
    expect(checkOrigin(headers({ origin: "http://localhost:3100", host: "localhost:3100" }), "http://localhost:3100/x")).toBe(true);
    expect(
      checkOrigin(headers({ origin: "https://app.example", host: "internal:3000", "x-forwarded-host": "app.example" }), url),
    ).toBe(true);
  });

  it("rejects a missing Origin", () => {
    expect(checkOrigin(headers({ host: "app.example" }), url)).toBe(false);
  });

  it("rejects Origin: null", () => {
    expect(checkOrigin(headers({ origin: "null", host: "app.example" }), url)).toBe(false);
  });

  it("rejects a foreign Origin and a malformed one", () => {
    expect(checkOrigin(headers({ origin: "https://evil.example", host: "app.example" }), url)).toBe(false);
    expect(checkOrigin(headers({ origin: "not a url", host: "app.example" }), url)).toBe(false);
    expect(checkOrigin(headers({ origin: "https://app.example.evil.example", host: "app.example" }), url)).toBe(false);
  });

  it("rejects when X-Forwarded-Host disagrees with Origin, even if Host matches", () => {
    expect(
      checkOrigin(headers({ origin: "https://app.example", host: "app.example", "x-forwarded-host": "evil.example" }), url),
    ).toBe(false);
  });

  it("rejects a different port on the same hostname", () => {
    expect(checkOrigin(headers({ origin: "https://app.example:8443", host: "app.example" }), url)).toBe(false);
  });
});
