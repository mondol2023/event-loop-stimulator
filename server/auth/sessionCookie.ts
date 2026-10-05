import "server-only";

// Kept apart from session.ts (iron-session, env, next/headers) so proxy.ts can
// read the cookie name without loading any of that.
const isProduction = process.env.NODE_ENV === "production";

// `__Host-` pins the cookie to this exact host, forbids a Domain attribute and
// requires Secure + Path=/, which only holds in production (HTTPS).
export const SESSION_COOKIE_NAME = isProduction ? "__Host-sl_session" : "sl_session";
