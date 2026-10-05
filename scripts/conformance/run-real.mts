import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { normalizeOutput } from "./normalize.mts";

// The one place real node is spawned (PROMPT.md §3.4; ADR-008): only on
// repo-owned or generated fixture programs, never on user input. The child runs
// under Node's permission model with no filesystem, network, child-process or
// worker grants, an empty environment and a 64 MiB heap, so a fixture can
// observe the language but not the machine.
//
// `env: {}` starts node fine on Windows 11 (no SystemRoot needed), so nothing is
// passed through. Caveat, observed on the dev machine: Windows itself (or the
// host) then re-adds its standard per-user variables (PATH, USERPROFILE, TEMP...)
// to every spawned process, python included, so a child there is not truly
// empty. Nothing of ours leaks, and the permission model is what contains it.

export type RealRun = { readonly stdout: string; readonly stderr: string; readonly exitCode: number };

export type RealRunOptions = {
  readonly lang: "js" | "ts";
  readonly nodeArgs?: readonly string[];
  readonly timeoutMs?: number;
};

/** A run that did not finish cleanly: no partial result is ever returned. */
export class RealRunError extends Error {
  override name = "RealRunError";
}

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_BUFFER = 1024 * 1024;
// Next augments ProcessEnv with a required NODE_ENV; the child must get none.
const EMPTY_ENV = {} as NodeJS.ProcessEnv;

export function runReal(source: string, opts: RealRunOptions): RealRun {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const file = opts.lang === "ts" ? "main.cts" : "main.cjs";
  const dir = mkdtempSync(join(tmpdir(), "sl-real-"));
  try {
    writeFileSync(join(dir, file), source);
    const result = spawnSync(
      process.execPath,
      ["--permission", "--max-old-space-size=64", ...(opts.nodeArgs ?? []), file],
      { cwd: dir, env: EMPTY_ENV, timeout: timeoutMs, maxBuffer: MAX_BUFFER, encoding: "utf8" },
    );
    const code = (result.error as NodeJS.ErrnoException | undefined)?.code;
    if (code === "ETIMEDOUT") throw new RealRunError(`real node timed out after ${timeoutMs} ms`);
    if (code === "ENOBUFS") throw new RealRunError(`real node exceeded the output limit of ${MAX_BUFFER} bytes`);
    if (result.error) throw new RealRunError(`real node could not run: ${result.error.message}`);
    if (result.signal !== null) throw new RealRunError(`real node was killed by ${result.signal}`);
    if (result.status === null) throw new RealRunError("real node ended without an exit code");
    // The directory is private to this call, so only the runner can normalize
    // the script path out of the output (and the pid, and CRLF) before returning.
    const ctx = { dir };
    return {
      stdout: normalizeOutput(result.stdout, ctx),
      stderr: normalizeOutput(result.stderr, ctx),
      exitCode: result.status,
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
