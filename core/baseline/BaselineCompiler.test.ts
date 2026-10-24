import { afterEach, describe, expect, it } from "vitest";
import { CompilationManager } from "@/core/compile/CompilationManager";
import { compileBaseline } from "./BaselineCompiler";
import { TEMPLATES } from "./templates";

type Mutable = Record<string, unknown>;

function firstFunction() {
  const program = new CompilationManager().compile("function f() { return 1; } f();", "js").program;
  const fn = program?.functions[0];
  const opcode = fn?.array.instructions[0]?.opcode;
  if (!fn || !opcode) throw new Error("did not compile");
  return { fn, opcode };
}

describe("compileBaseline error codes", () => {
  const saved = new Map<string, unknown>();
  afterEach(() => {
    for (const [k, v] of saved) (TEMPLATES as Mutable)[k] = v;
    saved.clear();
  });
  const throwing = (opcode: string, error: unknown): void => {
    saved.set(opcode, (TEMPLATES as Mutable)[opcode]);
    (TEMPLATES as Mutable)[opcode] = () => {
      throw error;
    };
  };

  it("labels a RangeError E_TEMPLATE", () => {
    const { fn, opcode } = firstFunction();
    throwing(opcode, new RangeError("Maximum call stack size exceeded"));
    const result = compileBaseline(fn);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error[0]).toEqual({ code: "E_TEMPLATE", message: "Maximum call stack size exceeded" });
  });

  it("labels any other throw E_INTERNAL, including a non-Error", () => {
    for (const thrown of [new TypeError("boom"), "plain"]) {
      const { fn, opcode } = firstFunction();
      throwing(opcode, thrown);
      const result = compileBaseline(fn);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error[0]).toEqual({ code: "E_INTERNAL", message: thrown instanceof Error ? thrown.message : thrown });
    }
  });
});
