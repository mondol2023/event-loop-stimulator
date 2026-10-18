import { describe, expect, it } from "vitest";
import { SimulationHalt } from "@/core/shared/simulationHalt";
import { OrdinaryGetOwnProperty, OrdinarySet } from "../spec/objectOps";
import { specTestWorld } from "../spec/specTestWorld";
import type { CallSite } from "../stack";
import { JSError, createError, errorStack, errorToString } from "./errors";

function world() {
  const w = specTestWorld();
  const errorPrototype = w.object({ name: "Error", message: "" });
  const typeErrorPrototype = w.object({ name: "TypeError", message: "" });
  typeErrorPrototype.prototype = errorPrototype;
  return { ...w, errorPrototype, typeErrorPrototype };
}

const readX: CallSite = {
  functionName: "readX",
  typeName: null,
  methodName: null,
  isTopLevel: true,
  isAsync: false,
  pos: { line: 3, column: 12 },
};

describe("createError (the Error constructor's own steps)", () => {
  it("installs message as an own non-enumerable data property", () => {
    const w = world();
    const e = createError(w, w.typeErrorPrototype, "bad", [readX]);
    expect(e).toBeInstanceOf(JSError);
    expect(e.prototype).toBe(w.typeErrorPrototype);
    expect(OrdinaryGetOwnProperty(e, "message")).toEqual({
      value: "bad",
      writable: true,
      enumerable: false,
      configurable: true,
    });
    expect(e.map.instanceType).toBe("JS_ERROR_TYPE");
  });

  it("installs no message when the message is undefined", () => {
    const w = world();
    expect(OrdinaryGetOwnProperty(createError(w, w.errorPrototype, undefined, []), "message")).toBeUndefined();
  });

  it("counts as a heap allocation", () => {
    const w = world();
    const before = w.heap.allocatedCount;
    createError(w, w.errorPrototype, "m", []);
    expect(w.heap.allocatedCount).toBe(before + 1);
  });
});

describe("errorToString (ErrorUtils::ToString)", () => {
  it("joins name and message, leaving out an empty one", () => {
    const w = world();
    expect(errorToString(createError(w, w.typeErrorPrototype, "bad", []))).toBe("TypeError: bad");
    expect(errorToString(createError(w, w.errorPrototype, undefined, []))).toBe("Error");
    const e = createError(w, w.errorPrototype, "only message", []);
    OrdinarySet(w.ctx, e, "name", "");
    expect(errorToString(e)).toBe("only message");
  });

  it("defaults an undefined name to Error and converts primitives", () => {
    const w = world();
    const e = createError(w, w.object(), "m", []);
    expect(errorToString(e)).toBe("Error: m");
    OrdinarySet(w.ctx, e, "name", 42);
    expect(errorToString(e)).toBe("42: m");
  });

  it("stops (unsupported) when name or message is an object", () => {
    const w = world();
    const e = createError(w, w.errorPrototype, "m", []);
    OrdinarySet(w.ctx, e, "name", w.object());
    expect(() => errorToString(e)).toThrow(SimulationHalt);
  });
});

describe("errorStack", () => {
  it("is the header followed by one '    at' line per call site", () => {
    const w = world();
    const e = createError(w, w.typeErrorPrototype, "bad", [readX, { native: "n (node:x:1:1)" }]);
    expect(errorStack(e)).toBe("TypeError: bad\n    at readX (main.cjs:3:12)\n    at n (node:x:1:1)");
  });

  it("is formatted once, at first access, like V8's lazy stack accessor", () => {
    const w = world();
    const e = createError(w, w.errorPrototype, "first", []);
    expect(errorStack(e)).toBe("Error: first");
    OrdinarySet(w.ctx, e, "message", "second");
    expect(errorStack(e)).toBe("Error: first");
  });
});

describe("Error constructors (builtins)", () => {
  it("stack is an own non-enumerable property whose text, header included, is formatted at first access", async () => {
    // Probed on the pinned node: this program prints `Error: b`.
    const { runSource } = await import("@/core/interpreter/interpreterTestWorld");
    const run = runSource("const e = new Error('a'); e.message = 'b'; console.log(e.stack, Object.keys(e));");
    expect(run.stdout.split("\n")[0]).toBe("Error: b");
    expect(run.stdout.endsWith("[]\n")).toBe(true);
  });

  it("supports the cause option and AggregateError's errors list", async () => {
    const { runSource } = await import("@/core/interpreter/interpreterTestWorld");
    const run = runSource(
      "const c = new Error('c'); const e = new Error('m', { cause: c }); const g = new AggregateError([1, 2], 'many');" +
        "console.log(e.cause === c, g.errors, g.message, g.name, Object.keys(e));",
    );
    expect(run.stdout).toBe("true [ 1, 2 ] many AggregateError []\n");
  });
});
