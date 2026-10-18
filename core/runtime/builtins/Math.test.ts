import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { runSource } from "@/core/interpreter/interpreterTestWorld";
import { Realm } from "@/core/runtime/Realm";
import { OrdinaryGet } from "@/core/runtime/spec/objectOps";
import { JSFunction } from "@/core/runtime/objects/JSFunction";
import type { JSObject } from "@/core/runtime/objects/JSObject";

function out(source: string): string {
  const run = runSource(source);
  if (run.completion.type === "throw") throw new Error(`threw: ${run.stderr}`);
  return run.stdout;
}

describe("Math", () => {
  it("max and min follow the -0 / NaN / empty rules", () => {
    expect(out("console.log(Math.max(), Math.min(), Math.max(-0, 0), Math.min(0, -0), Math.max(1, NaN), Math.max('3', 2));")).toBe(
      "-Infinity Infinity 0 -0 NaN 3\n",
    );
  });

  it("round, sign and trunc keep negative zero", () => {
    expect(out("console.log(Math.round(2.5), Math.round(-2.5), Math.round(-0.4), Math.sign(-0), Math.trunc(-0.9), Math.sqrt(-1));")).toBe(
      "3 -2 -0 -0 -0 NaN\n",
    );
  });

  it("agrees with the host on random doubles (bit-exact)", () => {
    const realm = new Realm({ write() {}, entryPoint: () => "main" });
    const math = OrdinaryGet(realm.globalObject, "Math") as JSObject;
    for (const name of ["abs", "ceil", "floor", "round", "sign", "sqrt", "trunc"] as const) {
      const fn = OrdinaryGet(math, name);
      expect(fn).toBeInstanceOf(JSFunction);
      fc.assert(
        fc.property(fc.double({ noDefaultInfinity: false }), (x) => {
          const r = (fn as JSFunction).native?.(realm, math, [x]);
          expect(r).toEqual({ type: "normal", value: expect.anything() });
          expect(Object.is((r as { value: number }).value, Math[name](x))).toBe(true);
        }),
      );
    }
  });
});
