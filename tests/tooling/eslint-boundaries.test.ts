import { ESLint } from "eslint";
import { beforeAll, describe, expect, it } from "vitest";

// Lints in-memory source as if it lived at `filePath`, so the directory
// dependency rule (PROMPT.md §6.2) is proven by tooling, not by convention.
const eslint = new ESLint({ cwd: process.cwd() });

async function ruleIds(code: string, filePath: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath });
  return (result?.messages ?? []).map((m) => m.ruleId ?? "fatal");
}

// The first lint loads the whole Next/TypeScript config, which can exceed the
// default 5s test timeout when other suites are starting Mongo in parallel.
beforeAll(async () => {
  await ruleIds("export {};", "lib/warmup.ts");
}, 60_000);

const IMPORT = "no-restricted-imports";
const SYNTAX = "no-restricted-syntax";

describe("dependency rule", () => {
  it.each([
    ['import { getEnv } from "@/server/env";', "core/frontend/parse.ts"],
    ['import { getEnv } from "../../server/env";', "core/frontend/parse.ts"],
    ['import { useState } from "react";', "core/frontend/parse.ts"],
    ['import { cookies } from "next/headers";', "core/frontend/parse.ts"],
    ['import { readFile } from "node:fs";', "core/frontend/parse.ts"],
    ['import Page from "@/app/page";', "core/frontend/parse.ts"],
    ['import { getEnv } from "@/server/env";', "features/playground/store.ts"],
    ['import { getEnv } from "../../server/env";', "features/playground/store.ts"],
    ['import Page from "@/app/page";', "features/playground/store.ts"],
    ['import Layout from "@/app/layout";', "server/auth/dal.ts"],
    ['import Page from "../app/page";', "components/ui/button.tsx"],
    // Nothing imports tests/ or scripts/ (the conformance harness included).
    ['import { run } from "@/tests/conformance/runner";', "app/playground/page.tsx"],
    ['import { run } from "../../tests/conformance/runner";', "core/frontend/parse.ts"],
    ['import { run } from "@/tests/conformance/runner";', "features/playground/store.ts"],
    ['import { record } from "@/scripts/conformance/record";', "server/security/sandbox.ts"],
    ['import { record } from "../scripts/conformance/record";', "lib/utils.ts"],
    // Zod only via core/shared/zod, which disables its `new Function` JIT.
    ['import { z } from "zod";', "server/env.ts"],
    ['import * as z from "zod/v4";', "features/playground/worker/messages.ts"],
    ['import { z } from "zod/mini";', "core/frontend/parse.ts"],
  ])("rejects %s in %s", async (code, filePath) => {
    expect(await ruleIds(code, filePath)).toContain(IMPORT);
  });

  it.each([
    ['import type { Range } from "@/core/shared/ids";', "core/frontend/parse.ts"],
    ['import type { Range } from "../shared/ids";', "core/frontend/parse.ts"],
    ['import type { Range } from "@/core/shared/ids";', "features/playground/store.ts"],
    ['import { cn } from "@/lib/utils";', "features/playground/store.ts"],
    ['import { saveSnippet } from "@/server/actions/snippets";', "features/snippets/form.tsx"],
    ['import { saveSnippet } from "@/server/actions";', "features/snippets/form.tsx"],
    ['import { saveSnippet } from "../../server/actions";', "features/snippets/form.tsx"],
    ['import { parse } from "@babel/parser";', "core/frontend/parse.ts"],
    ['import { renderToString } from "react-dom/server";', "features/playground/store.ts"],
    ['import { getEnv } from "@/server/env";', "app/playground/page.tsx"],
    ['import { z } from "@/core/shared/zod";', "server/env.ts"],
    ['import { z } from "zod";', "core/shared/zod.ts"],
  ])("allows %s in %s", async (code, filePath) => {
    expect(await ruleIds(code, filePath)).not.toContain(IMPORT);
  });
});

describe("models-import boundary (only server/repositories/** and server/db/** read models)", () => {
  it.each([
    ['import "@/server/db/models/User";', "server/auth/x.ts"],
    ['import { User } from "@/server/db/models/User";', "server/actions/auth.ts"],
    ['import { User } from "../db/models/User";', "server/auth/x.ts"],
    ['import { User } from "../../server/db/models/User";', "app/page.tsx"],
    ['import { Snippet } from "@/server/db/models/Snippet";', "features/snippets/x.ts"],
    ['import { User } from "@/server/db/models/User";', "tests/integration/x.test.ts"],
    ['export const m = await import("@/server/db/models/User");', "server/auth/x.ts"],
    // The shared bans survive in the repositories block (flat config does not merge).
    ['import vm from "node:vm";', "server/repositories/x.ts"],
    ['import { z } from "zod";', "server/db/x.ts"],
  ])("rejects %s in %s", async (code, filePath) => {
    const ids = await ruleIds(code, filePath);
    expect(ids.some((id) => id === IMPORT || id === SYNTAX)).toBe(true);
  });

  it.each([
    ['import "@/server/db/models/User";', "server/repositories/x.ts"],
    ['import { User } from "@/server/db/models/User";', "server/repositories/userRepository.ts"],
    ['import "@/server/db/models/User";', "server/db/x.ts"],
    ['import { User } from "./models/User";', "server/db/indexes.ts"],
    ['import { User } from "../db/models/User";', "server/repositories/x.ts"],
    ['export const m = await import("@/server/db/models/User");', "server/repositories/x.ts"],
    ['import { userRepository } from "@/server/repositories/userRepository";', "server/auth/x.ts"],
    ['import { connectDb } from "@/server/db/connection";', "server/auth/x.ts"],
  ])("allows %s in %s", async (code, filePath) => {
    const ids = await ruleIds(code, filePath);
    expect(ids).not.toContain(IMPORT);
    expect(ids).not.toContain(SYNTAX);
  });
});

describe("code-execution bans (repo-wide)", () => {
  it.each([
    ['export const x = eval("1");', "app/page.tsx"],
    ['export const x = globalThis.eval("1");', "server/env.ts"],
    ['export const f = new Function("return 1");', "app/page.tsx"],
    ['export const f = Function("return 1");', "core/frontend/parse.ts"],
    // Indirect forms (review finding): any reference to the name is banned.
    ['export const x = (0, eval)("1");', "app/page.tsx"],
    ['export const x = window["eval"]("1");', "features/playground/store.ts"],
    ['export const f = new globalThis.Function("return 1");', "server/env.ts"],
    ['export const f = globalThis["Function"];', "core/frontend/parse.ts"],
    ['export const r = globalThis["ShadowRealm"];', "core/frontend/parse.ts"],
    // Dynamic import() and require() are held to the same bans as static imports.
    ['export const m = await import("node:vm");', "core/frontend/parse.ts"],
    ['export const m = import("child_process");', "server/security/sandbox.ts"],
    ['export const m = require("node:child_process");', "app/api/compile/route.ts"],
    ['export const m = await import("@/server/env");', "core/frontend/parse.ts"],
    ['export const m = await import("node:fs");', "core/frontend/parse.ts"],
    ['export const m = await import("@/server/db/connect");', "features/playground/store.ts"],
    ['export const m = await import("../app/page");', "lib/utils.ts"],
    ['export const m = await import("zod");', "server/env.ts"],
    ["export const load = (name: string) => import(name);", "features/playground/store.ts"],
    ["export const load = (name: string) => import(`./x/${name}`);", "core/frontend/parse.ts"],
    ["export const r = new ShadowRealm();", "features/playground/worker/pipeline.worker.ts"],
    ["export const r = new globalThis.ShadowRealm();", "core/runtime/spec/realm.ts"],
    // The conformance exception covers child_process only, never eval.
    ['export const x = eval("1");', "scripts/conformance/record.ts"],
    ['export const f = new Function("return 1");', "tests/conformance/runner.test.ts"],
  ])("rejects %s in %s", async (code, filePath) => {
    expect(await ruleIds(code, filePath)).toContain(SYNTAX);
  });

  it.each([
    ['import vm from "node:vm";', "server/security/sandbox.ts"],
    ['import vm from "vm";', "server/security/sandbox.ts"],
    ['import { exec } from "child_process";', "app/api/compile/route.ts"],
    ['import { exec } from "node:child_process";', "server/security/sandbox.ts"],
    ['import { spawn } from "node:child_process";', "core/host/NodeEventLoop.ts"],
    ['import { spawn } from "child_process";', "features/playground/store.ts"],
    ['import vm from "node:vm";', "scripts/conformance/record.ts"],
    ['import vm from "vm";', "tests/conformance/runner.test.ts"],
  ])("rejects %s in %s", async (code, filePath) => {
    expect(await ruleIds(code, filePath)).toContain(IMPORT);
  });
});

describe("dynamic imports with literal, allowed specifiers", () => {
  it.each([
    ['export const m = await import("@/core/frontend/parse");', "features/playground/store.ts"],
    ['export const m = await import("./worker/pipeline.worker");', "features/playground/store.ts"],
    ['export const m = await import("./server/env");', "instrumentation.ts"],
  ])("allows %s in %s", async (code, filePath) => {
    const ids = await ruleIds(code, filePath);
    expect(ids).not.toContain(IMPORT);
    expect(ids).not.toContain(SYNTAX);
  });
});

describe("conformance exception (PROMPT.md §3.4: the only code that spawns real node)", () => {
  it.each([
    ['import { spawnSync } from "node:child_process";', "scripts/conformance/record.ts"],
    ['import { spawnSync } from "child_process";', "tests/conformance/runner.test.ts"],
    ['import { generate } from "../../tests/conformance/generator";', "scripts/conformance/record.ts"],
    ['export const cp = await import("node:child_process");', "scripts/conformance/record.ts"],
  ])("allows %s in %s", async (code, filePath) => {
    const ids = await ruleIds(code, filePath);
    expect(ids).not.toContain(IMPORT);
    expect(ids).not.toContain(SYNTAX);
  });
});
