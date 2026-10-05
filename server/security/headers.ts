import "server-only";

// Pure string builders with no Node APIs, so `proxy.ts` can import them.

type CspOptions = { nonce: string; dev: boolean };

/**
 * Nonce-based CSP. `'strict-dynamic'` lets the nonce'd bootstrap script load the
 * rest. `'unsafe-eval'` exists only in development (React uses eval for debug
 * stacks); production never allows it. There is no `upgrade-insecure-requests`:
 * it would break the http e2e server, and HSTS covers production.
 */
export function buildCsp({ nonce, dev }: CspOptions): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    `style-src 'self' 'nonce-${nonce}'${dev ? " 'unsafe-inline'" : ""}`,
    "img-src 'self' blob: data:",
    "font-src 'self'",
    "connect-src 'self'",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

export function securityHeaders(opts: CspOptions & { https: boolean }): Record<string, string> {
  return {
    "Content-Security-Policy": buildCsp(opts),
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    "X-Frame-Options": "DENY",
    ...(opts.https ? { "Strict-Transport-Security": "max-age=31536000; includeSubDomains" } : {}),
  };
}

/** 16 random bytes, base64. Web Crypto only, so it runs wherever the proxy does. */
export function generateNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
