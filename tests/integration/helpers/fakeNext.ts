import { vi } from "vitest";

// Shared state behind the `next/headers` mock. `vi.hoisted` makes it available
// to the hoisted `vi.mock` factory below.
const state = vi.hoisted(() => ({
  cookies: new Map<string, string>(),
  headers: new Headers(),
}));

// The real unauthorized()/forbidden() throw only when this flag is set (Next
// sets it from `experimental.authInterrupts`). Under Vitest we set it so they
// throw their documented `NEXT_HTTP_ERROR_FALLBACK;401|403` errors.
process.env.__NEXT_EXPERIMENTAL_AUTH_INTERRUPTS = "true";

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get(name: string) {
      const value = state.cookies.get(name);
      return value === undefined ? undefined : { name, value };
    },
    getAll() {
      return [...state.cookies].map(([name, value]) => ({ name, value }));
    },
    has: (name: string) => state.cookies.has(name),
    set(name: string, value: string, options?: { maxAge?: number }) {
      if (options?.maxAge === 0) state.cookies.delete(name);
      else state.cookies.set(name, value);
    },
    delete(name: string) {
      state.cookies.delete(name);
    },
  }),
  headers: async () => state.headers,
}));

export type FakeRequest = {
  cookies: Map<string, string>;
  headers: Headers;
  setIp(ip: string): void;
};

/** Resets the fake cookie jar and request headers. Call in `beforeEach`; import this module before the code under test. */
export function installFakeRequest(): FakeRequest {
  state.cookies.clear();
  state.headers = new Headers();
  const headers = state.headers;
  return {
    cookies: state.cookies,
    headers,
    setIp(ip: string) {
      headers.set("x-forwarded-for", ip);
    },
  };
}
