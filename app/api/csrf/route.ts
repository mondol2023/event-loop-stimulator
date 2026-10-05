import { NextResponse } from "next/server";
import { CSRF_COOKIE, issueCsrfToken } from "@/server/security/csrf";

// Routing only: the token logic lives in server/security/csrf.ts.
export async function GET(): Promise<Response> {
  const token = issueCsrfToken();
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
