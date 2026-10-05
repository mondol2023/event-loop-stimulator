import { NextResponse } from "next/server";
import { CSRF_COOKIE, cookieValue, issueCsrfToken, verifyCsrf } from "@/server/security/csrf";

// Routing only: the token logic lives in server/security/csrf.ts.
// A still-valid token is handed back as is: rotating it on every call (one per tab or
// page load) would invalidate the token other open tabs already hold.
export async function GET(request: Request): Promise<Response> {
  const existing = cookieValue(request.headers.get("cookie"), CSRF_COOKIE);
  const token = existing !== undefined && verifyCsrf(existing, existing) ? existing : issueCsrfToken();
  const response = NextResponse.json({ token }, { headers: { "Cache-Control": "no-store" } });
  response.cookies.set(CSRF_COOKIE, token, {
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    // Readable by script on purpose: the client echoes it in the x-csrf-token header.
    httpOnly: false,
    path: "/",
  });
  return response;
}
