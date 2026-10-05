import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE_NAME } from "@/server/auth/sessionCookie";
import { generateNonce, securityHeaders } from "@/server/security/headers";

// Optimistic only: it checks that a session cookie EXISTS, never that it is valid
// (no database, no unsealing). Real authentication and authorization happen in
// the DAL (server/auth/dal.ts); this just redirects visitors who clearly have none.
const PROTECTED_PREFIXES = ["/dashboard", "/admin"];

const WELL_FORMED_REQUEST_ID = /^[A-Za-z0-9_-]{8,64}$/;

const isProtected = (pathname: string): boolean =>
  PROTECTED_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));

export function proxy(request: NextRequest): NextResponse {
  const incomingId = request.headers.get("x-request-id");
  const requestId = incomingId !== null && WELL_FORMED_REQUEST_ID.test(incomingId) ? incomingId : crypto.randomUUID();
  const nonce = generateNonce();
  const https = request.nextUrl.protocol === "https:" || request.headers.get("x-forwarded-proto") === "https";
  const headers = securityHeaders({ nonce, dev: process.env.NODE_ENV === "development", https });

  const { pathname, search } = request.nextUrl;
  let response: NextResponse;
  if (isProtected(pathname) && !request.cookies.has(SESSION_COOKIE_NAME)) {
    const login = new URL("/login", request.url);
    login.searchParams.set("next", `${pathname}${search}`);
    response = NextResponse.redirect(login);
  } else {
    // Next reads the nonce out of the REQUEST's CSP header while rendering.
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set("x-request-id", requestId);
    requestHeaders.set("x-nonce", nonce);
    requestHeaders.set("Content-Security-Policy", headers["Content-Security-Policy"] ?? "");
    response = NextResponse.next({ request: { headers: requestHeaders } });
  }

  for (const [name, value] of Object.entries(headers)) response.headers.set(name, value);
  response.headers.set("x-request-id", requestId);
  return response;
}

export const config = {
  matcher: [
    {
      // API routes stay matched (they need x-request-id); static assets and prefetches do not.
      source: "/((?!_next/static|_next/image|favicon.ico).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
