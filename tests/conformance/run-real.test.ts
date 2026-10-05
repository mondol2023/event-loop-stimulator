import { describe, expect, it } from "vitest";
import { RealRunError, runReal } from "../../scripts/conformance/run-real.mts";
import { checkPinnedRuntime, readTarget } from "../../scripts/conformance/target.mts";

// Spawning real node is only meaningful on the pinned runtime (docs/TARGET.md):
// on any other Node these tests are skipped rather than weakened.
const pinnedProblems = checkPinnedRuntime({ node: process.versions.node, v8: process.versions.v8 }, readTarget());
const pinned = pinnedProblems.length === 0;
if (!pinned) {
  console.warn(`Skipping real-node runner tests: ${pinnedProblems.join("; ")} (docs/TARGET.md)`);
}

describe.skipIf(!pinned)("runReal (real node, permission model on)", () => {
  it("runs a program and returns stdout, stderr and the exit code", () => {
    expect(runReal("console.log(1+1)", { lang: "js" })).toEqual({ stdout: "2\n", stderr: "", exitCode: 0 });
  });

  it("returns a non-zero exit code with stderr for an uncaught error, naming main.cjs", () => {
    const run = runReal("undefined.x", { lang: "js" });
    expect(run.exitCode).not.toBe(0);
    expect(run.stderr.split("\n")[0]).toBe("main.cjs:1");
    expect(run.stderr).not.toMatch(/Administrator|Temp/);
    expect(run.stderr).not.toMatch(/[A-Za-z]:[\\/]/);
  });

  it("runs the permission model: filesystem, child-process and worker use are denied", () => {
    // Node grants the entry script itself read access even under --permission
    // (verified on 24.19.0: reading main.cjs succeeds), so denial is probed on
    // other files. ERR_ACCESS_DENIED is thrown before any existence check.
    const probe = (call: string) => `try { ${call}; console.log("allowed") } catch (e) { console.log(e.code) }`;
    for (const call of [
      `require("fs").readFileSync("other.txt")`,
      `require("fs").readdirSync(".")`,
      `require("fs").writeFileSync("x.txt", "1")`,
      `require("child_process").execSync("echo")`,
      `new (require("worker_threads").Worker)("1", { eval: true })`,
    ]) {
      expect(runReal(probe(call), { lang: "js" })).toEqual({ stdout: "ERR_ACCESS_DENIED\n", stderr: "", exitCode: 0 });
    }
  });

  it("does not pass the parent environment through", () => {
    // Windows re-adds its own standard variables to any child, so assert on a
    // sentinel of ours rather than on an empty process.env.
    process.env["SL_ENV_SENTINEL"] = "leaked";
    try {
      const run = runReal(`console.log(process.env.SL_ENV_SENTINEL)`, { lang: "js" });
      expect(run.stdout).toBe("undefined\n");
    } finally {
      delete process.env["SL_ENV_SENTINEL"];
    }
  });

  it("runs a .cts program with Node's type stripping", () => {
    const run = runReal("const n: number = 3; console.log(n * 2)", { lang: "ts" });
    expect(run).toEqual({ stdout: "6\n", stderr: "", exitCode: 0 });
  });

  it("passes extra node args before the script", () => {
    const run = runReal("console.log(typeof gc)", { lang: "js", nodeArgs: ["--expose-gc"] });
    expect(run.stdout).toBe("function\n");
  });

  it("throws RealRunError on timeout", () => {
    expect(() => runReal("for(;;){}", { lang: "js", timeoutMs: 300 })).toThrow(
      expect.objectContaining({ name: "RealRunError", message: expect.stringMatching(/timed out/) }),
    );
  });

  it("throws RealRunError when output exceeds the buffer limit", () => {
    const source = `process.stdout.write("x".repeat(2 * 1024 * 1024))`;
    expect(() => runReal(source, { lang: "js" })).toThrow(
      expect.objectContaining({ name: "RealRunError", message: expect.stringMatching(/output limit/) }),
    );
  });

  // Windows has no signals: process.kill(.., "SIGKILL") there is a plain exit.
  it.skipIf(process.platform === "win32")("throws RealRunError when the process dies from a signal", () => {
    expect(() => runReal(`process.kill(process.pid, "SIGKILL")`, { lang: "js" })).toThrow(RealRunError);
  });

  it("two runs of a warning-emitting program have identical stderr (the pid is normalized)", () => {
    // Real Node puts its pid in every process warning: (node:<pid>) ...
    const source = "setTimeout(() => {}, 2 ** 31)";
    const a = runReal(source, { lang: "js" });
    const b = runReal(source, { lang: "js" });
    expect(a.stderr).toContain("(node:PID) TimeoutOverflowWarning");
    expect(a.stderr).toBe(b.stderr);
  });
});
