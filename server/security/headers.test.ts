import { describe, expect, it } from "vitest";
import { buildCsp, generateNonce, securityHeaders } from "./headers";

const directive = (csp: string, name: string): string | undefined =>
  csp
    .split(";")
    .map((part) => part.trim())
    .find((part) => part === name || part.startsWith(`${name} `));

describe("buildCsp (production)", () => {
  const csp = buildCsp({ nonce: "abc123==", dev: false });

  it("never allows eval or inline script/style", () => {
    expect(csp).not.toContain("unsafe-eval");
    expect(csp).not.toContain("unsafe-inline");
  });

  it("is nonce-based with strict-dynamic for scripts and a nonce for styles", () => {
    expect(directive(csp, "script-src")).toBe("script-src 'self' 'nonce-abc123==' 'strict-dynamic'");
    expect(directive(csp, "style-src")).toBe("style-src 'self' 'nonce-abc123=='");
  });

  it("allows workers from self and blob, and forbids framing, plugins and foreign bases", () => {
    expect(directive(csp, "worker-src")).toBe("worker-src 'self' blob:");
    expect(directive(csp, "frame-ancestors")).toBe("frame-ancestors 'none'");
    expect(directive(csp, "object-src")).toBe("object-src 'none'");
    expect(directive(csp, "base-uri")).toBe("base-uri 'self'");
    expect(directive(csp, "form-action")).toBe("form-action 'self'");
    expect(directive(csp, "default-src")).toBe("default-src 'self'");
    expect(directive(csp, "connect-src")).toBe("connect-src 'self'");
    expect(directive(csp, "img-src")).toBe("img-src 'self' blob: data:");
    expect(directive(csp, "font-src")).toBe("font-src 'self'");
  });

  it("omits upgrade-insecure-requests (it would break the http e2e server; HSTS covers production)", () => {
    expect(csp).not.toContain("upgrade-insecure-requests");
  });
});

describe("buildCsp (development)", () => {
  const csp = buildCsp({ nonce: "n", dev: true });

  it("adds unsafe-eval for React's debugging and unsafe-inline styles for HMR", () => {
    expect(directive(csp, "script-src")).toContain("'unsafe-eval'");
    expect(directive(csp, "style-src")).toContain("'unsafe-inline'");
  });

  it("still forbids framing", () => {
    expect(directive(csp, "frame-ancestors")).toBe("frame-ancestors 'none'");
  });
});

describe("generateNonce", () => {
  it("differs on every call and is valid base64 of 16 bytes", () => {
    const nonces = new Set(Array.from({ length: 50 }, () => generateNonce()));
    expect(nonces.size).toBe(50);
    for (const nonce of nonces) {
      expect(nonce).toMatch(/^[A-Za-z0-9+/]{22}==$/);
      expect(Buffer.from(nonce, "base64")).toHaveLength(16);
    }
  });
});

describe("securityHeaders", () => {
  const base = securityHeaders({ nonce: "n", dev: false, https: false });

  it("carries the CSP, nosniff, referrer policy and frame denial", () => {
    expect(base["Content-Security-Policy"]).toBe(buildCsp({ nonce: "n", dev: false }));
    expect(base["X-Content-Type-Options"]).toBe("nosniff");
    expect(base["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(base["X-Frame-Options"]).toBe("DENY");
  });

  it("denies camera, microphone and geolocation", () => {
    const policy = base["Permissions-Policy"] ?? "";
    for (const feature of ["camera", "microphone", "geolocation"]) expect(policy).toContain(`${feature}=()`);
  });

  it("sends HSTS only over https", () => {
    expect(base["Strict-Transport-Security"]).toBeUndefined();
    const secure = securityHeaders({ nonce: "n", dev: false, https: true });
    expect(secure["Strict-Transport-Security"]).toBe("max-age=31536000; includeSubDomains");
  });
});
