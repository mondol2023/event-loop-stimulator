import { describe, expect, it } from "vitest";
import { simulate } from "./simulate";

describe("simulate", () => {
  it("runs a synchronous program to completion", () => {
    const r = simulate("console.log(1 + 2 * 3); console.error('e');", "js");
    expect(r.ticks.length).toBeGreaterThan(0);
    expect({ ...r, ticks: [] }).toEqual({ diagnostics: [], stdout: "7\n", stderr: "e\n", exitCode: 0, warnings: [], ticks: [], tickCount: r.ticks.length });
  });

  it("refuses a program with diagnostics as `<code>: <message>` lines and exit code 1", () => {
    const r = simulate("enum E { A }", "ts");
    expect(r.diagnostics.length).toBeGreaterThan(0);
    expect(r.stderr).toBe(r.diagnostics.map((d) => `${d.code}: ${d.message}\n`).join(""));
    expect(r.exitCode).toBe(1);
    expect(r.stdout).toBe("");
  });

  it("prints an uncaught exception with the code frame at the throw and exits 1", () => {
    const r = simulate("console.log('before');\nthrow 'boom';\n", "js");
    expect(r.stdout).toBe("before\n");
    expect(r.stderr.startsWith("\nmain.cjs:2\nthrow 'boom';\n^\nboom\n")).toBe(true);
    expect(r.exitCode).toBe(1);
  });

  it("stops at a limit, keeping the output so far and printing no notice to the streams", () => {
    const r = simulate("console.log('start'); function f(n) { return f(n + 1); } f(0);", "js");
    expect(r.stop).toEqual({ kind: "limit", limit: "callDepth" });
    expect(r.stdout).toBe("start\n");
    expect(r.stderr).toBe("");
  });

  it("gives byte-identical results for the same input", () => {
    const src = "const o = { a: 1, b: [1, 2] }; console.log(o, typeof o);";
    expect(simulate(src, "js")).toEqual(simulate(src, "js"));
  });
});
