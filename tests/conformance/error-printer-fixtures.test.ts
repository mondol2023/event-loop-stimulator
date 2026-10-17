import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { printUncaught, printUnhandledRejection } from "@/core/host/errorPrinter";
import { type EntryPoint, NODE_VERSION, nodeFrameTail } from "@/core/host/nodeFrames";
import { ProcessWarnings, timeoutOverflowWarning } from "@/core/host/warnings";
import { createError, errorStack } from "@/core/runtime/builtins/errors";
import { formatMessage } from "@/core/runtime/messages";
import type { JSObject } from "@/core/runtime/objects/JSObject";
import { specTestWorld } from "@/core/runtime/spec/specTestWorld";
import { type CallSite, captureStack } from "@/core/runtime/stack";
import { readTarget } from "../../scripts/conformance/target.mts";

// Node's error printer, stack formatting and warnings against the recorded fixtures. The call
// sites are built by hand (the interpreter that captures them arrives later); the expected text is
// always the recorded stderr or stdout, read from the `*.expected.json`, never retyped.

const FIXTURES = join(__dirname, "fixtures");

function recorded(fixture: string): { stdout: string; stderr: string; source: string } {
  const e = JSON.parse(readFileSync(join(FIXTURES, `${fixture}.expected.json`), "utf8")) as {
    outcomes: { stdout: string; stderr: string }[];
  };
  const first = e.outcomes[0];
  if (!first) throw new Error(`${fixture} has no recorded outcome`);
  return { ...first, source: readFileSync(join(FIXTURES, `${fixture}.cjs`), "utf8").replace(/\r\n/g, "\n") };
}

const at = (line: number, column: number) => ({ line, column });
const inspect = (): string => {
  throw new Error("no fixture here inspects a value");
};

/** A sloppy call with an undefined receiver: `name (loc)`, or a bare location when anonymous. */
function call(functionName: string | null, line: number, column: number): CallSite {
  return { functionName, typeName: null, methodName: null, isTopLevel: true, isAsync: false, pos: at(line, column) };
}

function method(
  typeName: string,
  functionName: string | null,
  methodName: string | null,
  line: number,
  column: number,
): CallSite {
  return { functionName, typeName, methodName, isTopLevel: false, isAsync: false, pos: at(line, column) };
}

/** The CommonJS module body: called with `this === module.exports`. */
const topLevel = (line: number, column: number) => method("Object", null, null, line, column);

function world() {
  const w = specTestWorld();
  const errorPrototype = w.object({ name: "Error", message: "" });
  const proto = (name: string): JSObject => {
    const p = w.object({ name, message: "" });
    p.prototype = errorPrototype;
    return p;
  };
  const prototypes = { Error: errorPrototype, TypeError: proto("TypeError"), ReferenceError: proto("ReferenceError") };
  const error = (kind: keyof typeof prototypes, message: string, user: CallSite[], entry: EntryPoint) =>
    createError(w, prototypes[kind], message, captureStack({ userCallSites: () => user, hostTail: () => nodeFrameTail(entry) }));
  return { error };
}

describe("printUncaught: synchronous throws (caret at the throw position)", () => {
  const cases: {
    fixture: string;
    kind: "Error" | "TypeError" | "ReferenceError";
    message: string;
    user: CallSite[];
    entry: EntryPoint;
    throwAt: [number, number];
  }[] = [
    {
      fixture: "uncaught-type-error",
      kind: "TypeError",
      message: formatMessage("kNonObjectPropertyLoadWithProperty", "undefined", "x"),
      user: [call("readX", 3, 12), call("wrapper", 6, 10), topLevel(9, 13)],
      entry: "main",
      throwAt: [3, 12],
    },
    {
      fixture: "let-tdz-uncaught",
      kind: "ReferenceError",
      message: formatMessage("kAccessedUninitializedVariable", "y"),
      user: [call("read", 18, 3), topLevel(21, 13)],
      entry: "main",
      throwAt: [18, 3],
    },
    {
      fixture: "uncaught-reference-error",
      kind: "ReferenceError",
      message: formatMessage("kNotDefined", "missingVariable"),
      user: [call("useMissing", 3, 3), topLevel(6, 13)],
      entry: "main",
      throwAt: [3, 3],
    },
    {
      fixture: "error-in-timer-uncaught",
      kind: "Error",
      message: "thrown in a timer",
      user: [method("Timeout", null, "_onTimeout", 6, 9)],
      entry: "timer",
      throwAt: [6, 3],
    },
    {
      fixture: "uncaught-in-nexttick",
      kind: "Error",
      message: "boom in nextTick",
      user: [call(null, 5, 9)],
      entry: "nextTick",
      throwAt: [5, 3],
    },
    {
      fixture: "uncaught-in-immediate",
      kind: "Error",
      message: "boom in immediate",
      user: [method("Immediate", null, null, 4, 9)],
      entry: "immediate",
      throwAt: [4, 3],
    },
    {
      fixture: "uncaught-in-interval-named",
      kind: "Error",
      message: "boom in interval",
      user: [method("Timeout", "tick", "_onTimeout", 7, 11)],
      entry: "timer",
      throwAt: [7, 5],
    },
    {
      fixture: "uncaught-in-method",
      kind: "Error",
      message: "boom in method",
      user: [method("Object", "m", "m", 4, 11), call("outer", 8, 5), topLevel(11, 1)],
      entry: "main",
      throwAt: [4, 5],
    },
    {
      fixture: "uncaught-deep-recursion-frames",
      kind: "Error",
      message: "deep",
      user: [call("r", 4, 11), ...Array.from({ length: 20 }, () => call("r", 6, 3)), topLevel(8, 1)],
      entry: "main",
      throwAt: [4, 5],
    },
  ];

  for (const c of cases) {
    it(c.fixture, () => {
      const { stderr, source } = recorded(c.fixture);
      const e = world().error(c.kind, c.message, c.user, c.entry);
      expect(printUncaught(e, { source, throwPosition: at(...c.throwAt), inspect })).toBe(stderr);
    });
  }

  it("throw-non-error (a string: ToString plus the trace-uncaught hint)", () => {
    const { stderr, source } = recorded("throw-non-error");
    expect(printUncaught("str", { source, throwPosition: at(26, 3), inspect })).toBe(stderr);
  });
});

describe("printUnhandledRejection (caret at the Error's construction position)", () => {
  const cases: { fixture: string; message: string; user: CallSite[]; entry: EntryPoint }[] = [
    { fixture: "unhandled-rejection", message: "nobody handles this", user: [topLevel(7, 16)], entry: "main" },
    {
      fixture: "unhandled-rejection-in-async",
      message: "async boom",
      user: [call("f", 3, 9), topLevel(6, 1)],
      entry: "main",
    },
    { fixture: "uncaught-in-microtask", message: "boom in microtask", user: [call(null, 5, 9)], entry: "microtask" },
    { fixture: "uncaught-after-await", message: "boom after await", user: [call("f", 6, 9)], entry: "microtask" },
  ];

  for (const c of cases) {
    it(c.fixture, () => {
      const { stderr, source } = recorded(c.fixture);
      expect(printUnhandledRejection(world().error("Error", c.message, c.user, c.entry), { source, inspect })).toBe(
        stderr,
      );
    });
  }

  it("unhandled-rejection-non-error (ERR_UNHANDLED_REJECTION)", () => {
    const { stderr, source } = recorded("unhandled-rejection-non-error");
    expect(printUnhandledRejection(42, { source, inspect })).toBe(stderr);
  });
});

describe("e.stack", () => {
  it("error-stack-property (three depths, then a TypeError, cut at 10 frames)", () => {
    const { stdout } = recorded("error-stack-property");
    const { error } = world();
    const a = call("a", 3, 10);
    const stacks = [
      error("Error", "at a", [a, topLevel(11, 13)], "main"),
      error("Error", "at a", [a, call("b", 6, 10), topLevel(12, 13)], "main"),
      error("Error", "at a", [a, call("b", 6, 10), call("c", 9, 10), topLevel(13, 13)], "main"),
      error("TypeError", formatMessage("kNonObjectPropertyLoadWithProperty", "null", "x"), [topLevel(15, 8)], "main"),
    ].map(errorStack);
    expect(stacks.map((s) => `${s}\n`).join("")).toBe(stdout);
  });
});

describe("ProcessWarnings", () => {
  it("timer-overflow-warning (the hint follows only the first warning)", () => {
    const { stderr } = recorded("timer-overflow-warning");
    const w = new ProcessWarnings();
    expect(w.emit(timeoutOverflowWarning(2 ** 31)) + w.emit(timeoutOverflowWarning(2 ** 32))).toBe(stderr);
  });
});

describe("NODE_VERSION", () => {
  it("is the pinned target of docs/TARGET.md", () => {
    expect(NODE_VERSION).toBe(readTarget().node);
  });
});
