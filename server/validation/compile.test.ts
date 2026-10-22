import { describe, expect, it } from "vitest";
import { LIMITS } from "@/core/shared/limits";
import { CompileSummary } from "./compile";

const ok = {
  diagnostics: [],
  output: { stdout: "1\n", stderr: "", exitCode: 0 },
  warnings: [],
  tickCount: 4,
};

describe("CompileSummary", () => {
  it("accepts a summary at the output budget", () => {
    const stdout = "x".repeat(LIMITS.outputChars);
    expect(CompileSummary.safeParse({ ...ok, output: { ...ok.output, stdout } }).success).toBe(true);
  });

  it("rejects streams past the output budget, so an oversized worker answer never reaches the client", () => {
    const big = "x".repeat(LIMITS.outputChars + 1);
    expect(CompileSummary.safeParse({ ...ok, output: { ...ok.output, stdout: big } }).success).toBe(false);
    expect(CompileSummary.safeParse({ ...ok, output: { ...ok.output, stderr: big } }).success).toBe(false);
  });

  it("rejects oversized warnings and stop reasons", () => {
    expect(CompileSummary.safeParse({ ...ok, warnings: ["w".repeat(1025)] }).success).toBe(false);
    expect(CompileSummary.safeParse({ ...ok, warnings: Array.from({ length: 33 }, () => "w") }).success).toBe(false);
    expect(CompileSummary.safeParse({ ...ok, stop: { kind: "unsupported", reason: "r".repeat(1025) } }).success).toBe(false);
  });

  it("accepts the new output and strings limit stops", () => {
    expect(CompileSummary.safeParse({ ...ok, stop: { kind: "limit", limit: "output" } }).success).toBe(true);
    expect(CompileSummary.safeParse({ ...ok, stop: { kind: "limit", limit: "strings" } }).success).toBe(true);
  });
});
