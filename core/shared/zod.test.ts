import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "@/core/shared/zod";

// Zod v4 JIT-compiles object parsers with `new Function` unless `jitless` is
// set. That is code generation at runtime, which PROMPT.md §2.1 bans and a
// CSP without 'unsafe-eval' would block. Every schema goes through this module.
describe("core/shared/zod", () => {
  afterEach(() => vi.restoreAllMocks());

  it("parses objects without ever constructing a Function", () => {
    const spy = vi.spyOn(globalThis, "Function");
    const Schema = z.object({ a: z.string(), b: z.number() }).strict();
    for (let i = 0; i < 3; i++) expect(Schema.parse({ a: "x", b: i })).toEqual({ a: "x", b: i });
    expect(spy).not.toHaveBeenCalled();
  });
});
