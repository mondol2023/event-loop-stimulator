import { describe, expect, it } from "vitest";
import { type CallSite, STACK_TRACE_LIMIT, captureStack, formatCallSite, positionOf, sourceLine } from "./stack";

const at = (line: number, column: number) => ({ line, column });

function site(fields: Partial<Exclude<CallSite, { native: string }>>): CallSite {
  return {
    functionName: null,
    typeName: null,
    methodName: null,
    isTopLevel: true,
    isAsync: false,
    pos: at(1, 1),
    ...fields,
  };
}

// The rules of CallSiteInfo serialization (src/objects/call-site-info.cc, AppendMethodCall);
// each shape below is one a recorded fixture shows.
describe("formatCallSite", () => {
  it("prints a plain call as name (location)", () => {
    expect(formatCallSite(site({ functionName: "readX", pos: at(3, 12) }))).toBe("readX (main.cjs:3:12)");
  });

  it("prints a constructor call as new name (location), whatever the receiver is", () => {
    expect(formatCallSite(site({ functionName: "Point", isTopLevel: false, typeName: "Point", isConstructor: true, pos: at(2, 5) }))).toBe(
      "new Point (main.cjs:2:5)",
    );
    expect(formatCallSite(site({ isConstructor: true }))).toBe("new <anonymous> (main.cjs:1:1)");
  });

  it("prints an anonymous function with no receiver type as a bare location", () => {
    expect(formatCallSite(site({ pos: at(5, 9) }))).toBe("main.cjs:5:9");
  });

  it("prints the CommonJS top level as Object.<anonymous>", () => {
    expect(formatCallSite(site({ isTopLevel: false, typeName: "Object", pos: at(9, 13) }))).toBe(
      "Object.<anonymous> (main.cjs:9:13)",
    );
  });

  it("prints a method as Type.name", () => {
    const m = site({ isTopLevel: false, typeName: "Object", functionName: "m", methodName: "m", pos: at(4, 11) });
    expect(formatCallSite(m)).toBe("Object.m (main.cjs:4:11)");
  });

  it("prints an anonymous method as Type.method", () => {
    const t = site({ isTopLevel: false, typeName: "Timeout", methodName: "_onTimeout", pos: at(6, 9) });
    expect(formatCallSite(t)).toBe("Timeout._onTimeout (main.cjs:6:9)");
  });

  it("adds [as method] when the property name differs from the function name", () => {
    const t = site({ isTopLevel: false, typeName: "Timeout", functionName: "tick", methodName: "_onTimeout" });
    expect(formatCallSite(t)).toBe("Timeout.tick [as _onTimeout] (main.cjs:1:1)");
  });

  it("prints <anonymous> for a method call with neither a function nor a method name", () => {
    expect(formatCallSite(site({ isTopLevel: false, typeName: "Immediate", pos: at(4, 9) }))).toBe(
      "Immediate.<anonymous> (main.cjs:4:9)",
    );
  });

  it("does not repeat the type when the function name already starts with it", () => {
    const s = site({ isTopLevel: false, typeName: "Module", functionName: "Module.load", methodName: "load" });
    expect(formatCallSite(s)).toBe("Module.load (main.cjs:1:1)");
  });

  it("prefixes an async frame with async", () => {
    expect(formatCallSite(site({ functionName: "f", isAsync: true, pos: at(2, 3) }))).toBe("async f (main.cjs:2:3)");
  });

  it("prints a native frame verbatim", () => {
    expect(formatCallSite({ native: "listOnTimeout (node:internal/timers:635:17)" })).toBe(
      "listOnTimeout (node:internal/timers:635:17)",
    );
  });
});

describe("captureStack", () => {
  it("appends the host's tail to the user frames", () => {
    const user = [site({ functionName: "f" })];
    const tail: CallSite[] = [{ native: "x (node:a:1:1)" }];
    expect(captureStack({ userCallSites: () => user, hostTail: () => tail })).toEqual([...user, ...tail]);
  });

  it("keeps at most Error.stackTraceLimit (10) frames, internal ones included", () => {
    const user = Array.from({ length: 4 }, () => site({ functionName: "r" }));
    const tail: CallSite[] = Array.from({ length: 7 }, (_, i) => ({ native: `n${i}` }));
    const stack = captureStack({ userCallSites: () => user, hostTail: () => tail });
    expect(STACK_TRACE_LIMIT).toBe(10);
    expect(stack).toHaveLength(10);
    expect(stack.at(-1)).toEqual({ native: "n5" });
  });
});

describe("positionOf and sourceLine", () => {
  const source = "a;\r\nbb;\n\tc\u2028d";

  it("gives 1-based lines and UTF-16 columns, splitting at every line terminator", () => {
    expect(positionOf(source, 0)).toEqual(at(1, 1));
    expect(positionOf(source, 4)).toEqual(at(2, 1));
    expect(positionOf(source, 6)).toEqual(at(2, 3));
    expect(positionOf(source, 9)).toEqual(at(3, 2));
    expect(positionOf(source, 11)).toEqual(at(4, 1));
  });

  it("returns a line's text without its terminator", () => {
    expect(sourceLine(source, 1)).toBe("a;");
    expect(sourceLine(source, 2)).toBe("bb;");
    expect(sourceLine(source, 3)).toBe("\tc");
    expect(sourceLine(source, 4)).toBe("d");
  });
});
