import type { Simulator } from "../support/simulator";
import { type Mode, modeSources } from "./classify";
import type { Metadata } from "./metadata";

// Runs one in-subset test262 test against a Simulator and judges it the way test262's
// INTERPRETING.md says a host must (see harnessContract.md for what the simulator provides).

export type Test262Case = { readonly path: string; readonly source: string; readonly meta: Metadata };

export type Pass = { readonly status: "pass" };
export type Fail = { readonly status: "fail"; readonly mode: Mode; readonly message: string };

const ASYNC_COMPLETE = "Test262:AsyncTestComplete";
const ASYNC_FAILURE = "Test262:AsyncTestFailure:";

const firstLine = (text: string): string => text.trim().split("\n")[0] ?? "";
const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function runTest262(sim: Simulator, test: Test262Case): Pass | Fail {
  const { meta } = test;
  for (const run of modeSources(test.source, meta)) {
    const result = sim.run(run.source, "js");
    const fail = (message: string): Fail => ({ status: "fail", mode: run.mode, message: `${test.path} (${run.mode}): ${message}` });
    const stderr = JSON.stringify(firstLine(result.stderr));

    if (meta.negative?.phase === "parse") {
      if (result.exitCode === 0 || !/^E_SYNTAX\b/m.test(result.stderr)) {
        return fail(`expected a syntax error (E_SYNTAX), got exit code ${result.exitCode} and stderr ${stderr}`);
      }
      continue;
    }
    if (meta.negative?.phase === "runtime") {
      const thrown = new RegExp(`^${escapeRegExp(meta.negative.type)}\\b`, "m");
      if (result.exitCode === 0 || !thrown.test(result.stderr)) {
        return fail(`expected an uncaught ${meta.negative.type}, got exit code ${result.exitCode} and stderr ${stderr}`);
      }
      continue;
    }
    if (result.exitCode !== 0) return fail(`exit code ${result.exitCode}: ${firstLine(result.stderr) || "(empty stderr)"}`);
    if (meta.flags.includes("async")) {
      const lines = result.stdout.split("\n");
      const failure = lines.find((line) => line.startsWith(ASYNC_FAILURE));
      if (failure) return fail(failure.slice(ASYNC_FAILURE.length));
      if (!lines.includes(ASYNC_COMPLETE)) return fail(`$DONE was never called (no ${ASYNC_COMPLETE} on stdout)`);
    }
  }
  return { status: "pass" };
}
