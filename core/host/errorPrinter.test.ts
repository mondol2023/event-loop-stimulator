import { describe, expect, it } from "vitest";
import { createError } from "@/core/runtime/builtins/errors";
import { OrdinarySet } from "@/core/runtime/spec/objectOps";
import { specTestWorld } from "@/core/runtime/spec/specTestWorld";
import type { CallSite } from "@/core/runtime/stack";
import { SimulationHalt } from "@/core/shared/simulationHalt";
import { codeFrame, printUncaught, printUnhandledRejection } from "./errorPrinter";

// The fixture-backed cases (every recorded uncaught and rejection shape) are in
// tests/conformance/error-printer-fixtures.test.ts. These pin rules no fixture isolates; each
// expectation was probed on the pinned Node.

const site = (line: number, column: number): CallSite => ({
  functionName: null,
  typeName: null,
  methodName: null,
  isTopLevel: true,
  isAsync: false,
  pos: { line, column },
});

describe("codeFrame (src/node_errors.cc GetErrorSource)", () => {
  it("keeps tabs in the underline", () => {
    expect(codeFrame("\tif (1) {\tthrow 1; }\n", { line: 1, column: 11 })).toBe(
      "main.cjs:1\n\tif (1) {\tthrow 1; }\n\t" + " ".repeat(8) + "\t^\n",
    );
  });

  it("underlines one position per UTF-8 byte of the line, as Node does", () => {
    // Probed: `const s = "é€";\tthrow 1;` puts 16 spaces (no tab) before the caret.
    expect(codeFrame('const s = "é€";\tthrow 1;', { line: 1, column: 17 })).toBe(
      'main.cjs:1\nconst s = "é€";\tthrow 1;\n' + " ".repeat(16) + "^\n",
    );
    // Probed: with "x" in place of "é€" the tab is reached and kept.
    expect(codeFrame('const s = "x";\tthrow 1;', { line: 1, column: 16 })).toBe(
      'main.cjs:1\nconst s = "x";\tthrow 1;\n' + " ".repeat(14) + "\t^\n",
    );
  });
});

describe("printUncaught for values that are not Errors", () => {
  const source = "function t(v) {\n  throw v;\n}\n";
  const ctx = { source, throwPosition: { line: 2, column: 3 }, inspect: () => "{ a: 1 }" };
  const hint = "(Use `node --trace-uncaught ...` to show where the exception was thrown)\n";

  it("prints a primitive with ToString and the trace-uncaught hint", () => {
    const frame = "\nmain.cjs:2\n  throw v;\n  ^\n";
    expect(printUncaught(42, ctx)).toBe(`${frame}42\n${hint}\nNode.js v24.19.0\n`);
    expect(printUncaught(-0, ctx)).toBe(`${frame}0\n${hint}\nNode.js v24.19.0\n`);
    expect(printUncaught(null, ctx)).toBe(`${frame}null\n${hint}\nNode.js v24.19.0\n`);
    expect(printUncaught(undefined, ctx)).toBe(`${frame}undefined\n${hint}\nNode.js v24.19.0\n`);
    expect(printUncaught(true, ctx)).toBe(`${frame}true\n${hint}\nNode.js v24.19.0\n`);
  });

  it("prints an object with util.inspect and no hint", () => {
    const w = specTestWorld();
    expect(printUncaught(w.object({ a: 1 }), ctx)).toBe("\nmain.cjs:2\n  throw v;\n  ^\n{ a: 1 }\n\nNode.js v24.19.0\n");
  });
});

describe("unsupported shapes stop the run instead of guessing", () => {
  const source = "x;\n";
  const ctx = { source, throwPosition: { line: 1, column: 1 }, inspect: () => "?" };

  it("stops for an Error with extra enumerable own properties (inspect appends them)", () => {
    const w = specTestWorld();
    const e = createError(w, w.object({ name: "Error" }), "m", [site(1, 1)]);
    OrdinarySet(w.ctx, e, "code", "X");
    expect(() => printUncaught(e, ctx)).toThrow(SimulationHalt);
    expect(() => printUnhandledRejection(e, ctx)).toThrow(SimulationHalt);
  });

  it("stops for a non-Error object rejection reason (noSideEffectsToString)", () => {
    const w = specTestWorld();
    expect(() => printUnhandledRejection(w.object(), ctx)).toThrow(SimulationHalt);
  });

  it("stops for a rejected Error whose top frame is not in the script", () => {
    const w = specTestWorld();
    const e = createError(w, w.object({ name: "Error" }), "m", [{ native: "n (node:x:1:1)" }]);
    expect(() => printUnhandledRejection(e, ctx)).toThrow(SimulationHalt);
  });
});

describe("printUnhandledRejection for primitives (ERR_UNHANDLED_REJECTION)", () => {
  it("quotes the reason's ToString without escaping", () => {
    const text = printUnhandledRejection('a"b', { source: "", inspect: () => "?" });
    expect(text).toContain('The promise rejected with the reason "a"b".');
    expect(printUnhandledRejection(-0, { source: "", inspect: () => "?" })).toContain('the reason "0".');
  });
});
