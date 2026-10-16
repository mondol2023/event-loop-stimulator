import { describe, expect, it } from "vitest";
import { parseScript } from "@/core/frontend/parse";
import { analyzeScopes } from "@/core/frontend/scope/ScopeAnalyzer";
import { generateBytecode } from "./BytecodeGenerator";
import { type BytecodeFunction, toPrintable } from "./BytecodeProgram";
import { printBytecodeArray } from "./printer";

// Functions, calls, closures and contexts. Every expected listing is what the pinned Node (V8 13.6)
// prints for the same source, copied from `npm run conformance:diff` (or the recorded
// `bc-*.expected.json` micro-fixtures), never written by hand. Positions read `offset S> text`.

interface Expected {
  readonly name?: string;
  readonly parameterCount?: number;
  /** Left out for a function the test does not examine. */
  readonly registerCount?: number;
  readonly instructions?: readonly string[];
  readonly constantPool?: readonly string[];
  /** The closures this function creates, in constant-pool order. */
  readonly children?: readonly Expected[];
}

function compile(source: string): readonly BytecodeFunction[] {
  const parsed = parseScript(source);
  if (!parsed.ok) throw new Error(`test source does not parse: ${parsed.error[0]?.message}`);
  const result = generateBytecode(parsed.value, analyzeScopes(parsed.value));
  if (!result.ok) throw new Error(`not compiled: ${result.error[0]?.message}`);
  return result.value.functions;
}

/** Checks the wrapper, then the functions it creates, depth first. */
function expectFunctions(source: string, wrapper: Expected, ...children: Expected[]): void {
  const functions = compile(source);
  const byId = (id: number): BytecodeFunction => {
    const fn = functions[id];
    if (!fn) throw new Error(`no function ${id}`);
    return fn;
  };
  const check = (fn: BytecodeFunction, expected: Expected): void => {
    const printed = printBytecodeArray(toPrintable(fn));
    if (expected.instructions) {
      expect(printed.instructions.map((i) => (i.position ? `${i.position.at} ${i.position.kind}> ${i.text}` : i.text))).toEqual(expected.instructions);
    }
    if (expected.registerCount !== undefined) expect(fn.registerCount).toBe(expected.registerCount);
    if (expected.constantPool) expect(printed.constantPool).toEqual(expected.constantPool);
    if (expected.name !== undefined) expect(fn.name).toBe(expected.name);
    if (expected.parameterCount !== undefined) expect(fn.parameterCount).toBe(expected.parameterCount);
    const nested = expected.children ?? [];
    if (expected.children) expect(fn.children).toHaveLength(nested.length);
    nested.forEach((child, i) => check(byId(fn.children[i] as number), child));
  };
  check(byId(0), { ...wrapper, children });
}

describe("functions and plain calls", () => {
  it("emits nothing after a loop that never exits: JumpLoop ends its block like Jump does", () => {
    expectFunctions(
      "function g(x){ if (x) { for(;;){} x = 5; } } g(0);",
      { registerCount: 3 },
      {
        name: "g",
        registerCount: 0,
        instructions: ["15 S> Ldar a0", "JumpIfToBooleanFalse [6] (@8)", "24 E> JumpLoop [0], [0], [0] (@4)", "LdaUndefined", "43 S> Return"],
      },
    );
  });

  it("drops a function declaration nothing refers to, as V8 does: no closure, no register", () => {
    expectFunctions("function foo(){}", { registerCount: 0, instructions: ["LdaUndefined", "15 S> Return"], children: [] });
    expectFunctions(
      "function w(){ function unused(){} return 1; } w();",
      {
        registerCount: 1,
        instructions: ["0 E> CreateClosure [0], [0], #2", "Star0", "46 S> CallUndefinedReceiver0 r0, [0]", "LdaUndefined", "49 S> Return"],
        constantPool: ["<SharedFunctionInfo w>"],
      },
      { name: "w", registerCount: 0, instructions: ["34 S> LdaSmi [1]", "43 S> Return"], constantPool: [], children: [] },
    );
  });

  it("creates declared functions first, then calls them with the receiver left undefined", () => {
    expectFunctions(
      "function add(a, b) { return a + b; }\nvar f = function (x) { return x; };\nvar g = (y) => y + 1;\nadd(1, 2);\nf(3);\ng(4);\n",
      {
        registerCount: 6,
        instructions: [
          "0 E> CreateClosure [0], [0], #2",
          "Star0",
          "45 S> CreateClosure [1], [1], #2",
          "Star1",
          "81 S> CreateClosure [2], [2], #2",
          "Star2",
          "95 S> LdaSmi [1]",
          "Star4",
          "LdaSmi [2]",
          "Star5",
          "95 E> CallUndefinedReceiver2 r0, r4, r5, [0]",
          "106 S> LdaSmi [3]",
          "Star4",
          "106 E> CallUndefinedReceiver1 r1, r4, [2]",
          "112 S> LdaSmi [4]",
          "Star4",
          "112 E> CallUndefinedReceiver1 r2, r4, [4]",
          "LdaUndefined",
          "117 S> Return",
        ],
        constantPool: ["<SharedFunctionInfo add>", "<SharedFunctionInfo f>", "<SharedFunctionInfo g>"],
      },
      { name: "add", parameterCount: 3, registerCount: 0, instructions: ["21 S> Ldar a1", "30 E> Add a0, [0]", "34 S> Return"] },
      { name: "f", parameterCount: 2, registerCount: 0, instructions: ["60 S> Ldar a0", "69 S> Return"] },
      { name: "g", parameterCount: 2, registerCount: 0, instructions: ["90 S> Ldar a0", "90 E> AddSmi [1], [0]", "93 S> Return"] },
    );
  });

  it("takes the callee register first, so nested calls and operands use the next ones", () => {
    expectFunctions(
      "var one = function (a) { return a; };\nfunction declared() { return 1; }\none(one(1));\none(1 + declared());\nString(2);\n(function () {})();\n",
      {
        registerCount: 5,
        instructions: [
          "0 E> CreateClosure [0], [0], #2",
          "Star1",
          "10 S> CreateClosure [1], [1], #2",
          "Star0",
          "72 S> LdaSmi [1]",
          "Star4",
          "76 E> CallUndefinedReceiver1 r0, r4, [0]",
          "Star3",
          "72 E> CallUndefinedReceiver1 r0, r3, [2]",
          "85 S> LdaSmi [1]",
          "Star3",
          "93 E> CallUndefinedReceiver0 r1, [5]",
          "91 E> Add r3, [4]",
          "Star3",
          "85 E> CallUndefinedReceiver1 r0, r3, [7]",
          "106 S> LdaGlobal [2], [9]",
          "Star2",
          "LdaSmi [2]",
          "Star3",
          "106 E> CallUndefinedReceiver1 r2, r3, [11]",
          "117 S> CreateClosure [3], [2], #2",
          "Star2",
          "133 E> CallUndefinedReceiver0 r2, [13]",
          "LdaUndefined",
          "136 S> Return",
        ],
        constantPool: ["<SharedFunctionInfo declared>", "<SharedFunctionInfo one>", "<String[6]: #String>", "<SharedFunctionInfo>"],
      },
      { name: "declared", parameterCount: 1, registerCount: 0, instructions: ["60 S> LdaSmi [1]", "69 S> Return"] },
      { name: "one", parameterCount: 2, registerCount: 0, instructions: ["25 S> Ldar a0", "34 S> Return"] },
      { name: "", parameterCount: 1, registerCount: 0, instructions: ["LdaUndefined", "131 S> Return"] },
    );
  });
});

describe("function contexts", () => {
  // The same source as tests/conformance/fixtures/bc-closures.cjs.
  const source = `function outer() {
  var x = 1;
  function mid() {
    var y = 2;
    function inner() { return y; }
    function inner2() { return x; }
    return x + y + inner() + inner2();
  }
  function reader() { return x; }
  return mid() + reader();
}
outer();
function counter(start) {
  var n = start;
  var m = 1;
  return function () { n = n + 1; return n + m; };
}
var c = counter(0);
c();
var top = 5;
function readTop() { return top; }
readTop();
`;

  it("keeps captured variables in a context each function pushes, read by depth from its closures", () => {
    expectFunctions(
      source,
      {
        registerCount: 7,
        instructions: [
          "0 E> CreateFunctionContext [0], [1]",
          "PushContext r4",
          "CreateClosure [1], [0], #2",
          "Star0",
          "CreateClosure [2], [1], #2",
          "Star1",
          "CreateClosure [3], [2], #2",
          "Star3",
          "243 S> CallUndefinedReceiver0 r0, [0]",
          "369 S> LdaZero",
          "Star6",
          "369 E> CallUndefinedReceiver1 r1, r6, [2]",
          "Star2",
          "381 S> CallUndefinedReceiver0 r2, [4]",
          "396 S> LdaSmi [5]",
          "396 E> StaCurrentContextSlot [2]",
          "434 S> CallUndefinedReceiver0 r3, [6]",
          "LdaUndefined",
          "444 S> Return",
        ],
        constantPool: ["<ScopeInfo FUNCTION_SCOPE>", "<SharedFunctionInfo outer>", "<SharedFunctionInfo counter>", "<SharedFunctionInfo readTop>"],
      },
      {
        name: "outer",
        registerCount: 4,
        instructions: [
          "14 E> CreateFunctionContext [0], [1]",
          "PushContext r2",
          "CreateClosure [1], [0], #2",
          "Star0",
          "CreateClosure [2], [1], #2",
          "Star1",
          "29 S> LdaSmi [1]",
          "29 E> StaCurrentContextSlot [2]",
          "223 S> CallUndefinedReceiver0 r0, [1]",
          "Star3",
          "231 E> CallUndefinedReceiver0 r1, [3]",
          "229 E> Add r3, [0]",
          "240 S> Return",
        ],
        constantPool: ["<ScopeInfo FUNCTION_SCOPE>", "<SharedFunctionInfo mid>", "<SharedFunctionInfo reader>"],
        children: [
          {
            name: "mid",
            registerCount: 4,
            instructions: [
              "46 E> CreateFunctionContext [0], [1]",
              "PushContext r2",
              "CreateClosure [1], [0], #2",
              "Star0",
              "CreateClosure [2], [1], #2",
              "Star1",
              "63 S> LdaSmi [2]",
              "63 E> StaCurrentContextSlot [2]",
              "141 S> LdaImmutableContextSlot r2, [2], [0]",
              "Star3",
              "LdaImmutableCurrentContextSlot [2]",
              "150 E> Add r3, [0]",
              "Star3",
              "156 E> CallUndefinedReceiver0 r0, [1]",
              "154 E> Add r3, [3]",
              "Star3",
              "166 E> CallUndefinedReceiver0 r1, [4]",
              "164 E> Add r3, [6]",
              "175 S> Return",
            ],
            children: [
              { name: "inner", registerCount: 0, instructions: ["89 S> LdaImmutableCurrentContextSlot [2]", "98 S> Return"] },
              { name: "inner2", registerCount: 0, instructions: ["125 S> LdaImmutableContextSlot <context>, [2], [1]", "134 S> Return"] },
            ],
          },
          { name: "reader", registerCount: 0, instructions: ["202 S> LdaImmutableCurrentContextSlot [2]", "211 S> Return"] },
        ],
      },
      {
        name: "counter",
        parameterCount: 2,
        registerCount: 1,
        instructions: [
          "268 E> CreateFunctionContext [0], [2]",
          "PushContext r0",
          "288 S> Ldar a0",
          "288 E> StaCurrentContextSlot [2]",
          "305 S> LdaSmi [1]",
          "305 E> StaCurrentContextSlot [3]",
          "310 S> CreateClosure [1], [0], #2",
          "358 S> Return",
        ],
        children: [
          {
            name: "",
            registerCount: 1,
            instructions: [
              "331 S> LdaCurrentContextSlot [2]",
              "337 E> AddSmi [1], [0]",
              "333 E> StaCurrentContextSlot [2]",
              "342 S> LdaCurrentContextSlot [2]",
              "Star0",
              "LdaImmutableCurrentContextSlot [3]",
              "351 E> Add r0, [1]",
              "355 S> Return",
            ],
          },
        ],
      },
      { name: "readTop", registerCount: 0, instructions: ["420 S> LdaImmutableCurrentContextSlot [2]", "431 S> Return"] },
    );
  });
});

describe("temporal dead zone", () => {
  // The same source as tests/conformance/fixtures/bc-tdz.cjs.
  const source = `function early() { return later; }
let later = 1;
const fixed = 2;
let unset;
function useAll() { return later + fixed; }
early();
useAll();
function localTdz() {
  let a = 1;
  const b = a + 1;
  function read() { return c; }
  let c = b;
  return read() + a;
}
localTdz();
function assignCaptured() {
  let n = 0;
  const bump = function () { n = n + 1; };
  bump();
  return n;
}
assignCaptured();
`;

  it("fills a binding that can be read too early with the hole, and checks it where it is read", () => {
    expectFunctions(
      source,
      {
        registerCount: 6,
        instructions: [
          "0 E> CreateFunctionContext [0], [2]",
          "PushContext r5",
          "CreateClosure [1], [0], #2",
          "Star0",
          "LdaTheHole",
          "StaCurrentContextSlot [2]",
          "LdaTheHole",
          "StaCurrentContextSlot [3]",
          "CreateClosure [2], [1], #2",
          "Star2",
          "CreateClosure [3], [2], #2",
          "Star3",
          "CreateClosure [4], [3], #2",
          "Star4",
          "47 S> LdaSmi [1]",
          "47 E> StaCurrentContextSlot [2]",
          "64 S> LdaSmi [2]",
          "64 E> StaCurrentContextSlot [3]",
          "71 S> LdaUndefined",
          "Star1",
          "122 S> CallUndefinedReceiver0 r0, [0]",
          "131 S> CallUndefinedReceiver0 r2, [2]",
          "263 S> CallUndefinedReceiver0 r3, [4]",
          "383 S> CallUndefinedReceiver0 r4, [6]",
          "LdaUndefined",
          "400 S> Return",
        ],
      },
      {
        name: "early",
        registerCount: 0,
        instructions: ["19 S> LdaImmutableCurrentContextSlot [2]", "ThrowReferenceErrorIfHole [0]", "32 S> Return"],
        constantPool: ["<String[5]: #later>"],
      },
      {
        name: "useAll",
        registerCount: 1,
        instructions: [
          "98 S> LdaImmutableCurrentContextSlot [2]",
          "ThrowReferenceErrorIfHole [0]",
          "Star0",
          "LdaImmutableCurrentContextSlot [3]",
          "113 E> ThrowReferenceErrorIfHole [1]",
          "111 E> Add r0, [0]",
          "119 S> Return",
        ],
        constantPool: ["<String[5]: #later>", "<String[5]: #fixed>"],
      },
      {
        name: "localTdz",
        registerCount: 5,
        instructions: [
          "158 E> CreateFunctionContext [0], [1]",
          "PushContext r3",
          "CreateClosure [1], [0], #2",
          "Star2",
          "LdaTheHole",
          "StaCurrentContextSlot [2]",
          "173 S> LdaSmi [1]",
          "Star0",
          "190 S> AddSmi [1], [0]",
          "Star1",
          "237 S> StaCurrentContextSlot [2]",
          "249 S> CallUndefinedReceiver0 r2, [2]",
          "Star4",
          "Ldar r0",
          "256 E> Add r4, [1]",
          "260 S> Return",
        ],
        children: [
          {
            name: "read",
            registerCount: 0,
            instructions: ["215 S> LdaImmutableCurrentContextSlot [2]", "ThrowReferenceErrorIfHole [0]", "224 S> Return"],
          },
        ],
      },
      {
        name: "assignCaptured",
        registerCount: 2,
        instructions: [
          "298 E> CreateFunctionContext [0], [1]",
          "PushContext r1",
          "LdaTheHole",
          "StaCurrentContextSlot [2]",
          "313 S> LdaZero",
          "313 E> StaCurrentContextSlot [2]",
          "331 S> CreateClosure [1], [0], #2",
          "Star0",
          "361 S> CallUndefinedReceiver0 r0, [0]",
          "371 S> LdaCurrentContextSlot [2]",
          "380 S> Return",
        ],
        children: [
          {
            name: "bump",
            registerCount: 0,
            instructions: [
              "345 S> LdaCurrentContextSlot [2]",
              "ThrowReferenceErrorIfHole [0]",
              "351 E> AddSmi [1], [0]",
              "347 E> StaCurrentContextSlot [2]",
              "LdaUndefined",
              "356 S> Return",
            ],
          },
        ],
      },
    );
  });
});

describe("assigning to a const", () => {
  // The same source as tests/conformance/fixtures/bc-const-assign.cjs.
  const source = `function local(c) {
  const v = 1;
  if (c) { v = 2; v++; v += 1; }
  return v;
}
function captured(c) {
  const q = 1;
  return function () {
    if (c) { q = 3; q = 4; }
    return q;
  };
}
local(0);
captured(0)();
`;

  it("evaluates the right-hand side, then throws through a runtime call at the operator", () => {
    expectFunctions(
      source,
      {
        registerCount: 5,
        instructions: [
          "0 E> CreateClosure [0], [0], #2",
          "Star0",
          "CreateClosure [1], [1], #2",
          "Star1",
          "193 S> LdaZero",
          "Star3",
          "193 E> CallUndefinedReceiver1 r0, r3, [0]",
          "203 S> LdaZero",
          "Star4",
          "203 E> CallUndefinedReceiver1 r1, r4, [2]",
          "Star2",
          "214 E> CallUndefinedReceiver0 r2, [4]",
          "LdaUndefined",
          "217 S> Return",
        ],
      },
      {
        name: "local",
        registerCount: 1,
        instructions: [
          "32 S> LdaSmi [1]",
          "Star0",
          "37 S> Ldar a0",
          "JumpIfToBooleanFalse [28] (@33)",
          "46 S> LdaSmi [2]",
          "48 E> CallRuntime [ThrowConstAssignError], r0-r0",
          "53 S> Ldar r0",
          "Inc [0]",
          "54 E> CallRuntime [ThrowConstAssignError], r0-r0",
          "58 S> Ldar r0",
          "AddSmi [1], [1]",
          "60 E> CallRuntime [ThrowConstAssignError], r0-r0",
          "70 S> Ldar r0",
          "79 S> Return",
        ],
      },
      {
        name: "captured",
        registerCount: 1,
        instructions: [
          "99 E> CreateFunctionContext [0], [2]",
          "PushContext r0",
          "Ldar a0",
          "StaCurrentContextSlot [2]",
          "LdaTheHole",
          "StaCurrentContextSlot [3]",
          "117 S> LdaSmi [1]",
          "117 E> StaCurrentContextSlot [3]",
          "122 S> CreateClosure [1], [0], #2",
          "190 S> Return",
        ],
        // The hole check comes first when the binding may still be uninitialized.
        children: [
          {
            registerCount: 1,
            instructions: [
              "147 S> LdaImmutableCurrentContextSlot [2]",
              "JumpIfToBooleanFalse [21] (@23)",
              "156 S> LdaSmi [3]",
              "Star0",
              "LdaCurrentContextSlot [3]",
              "158 E> ThrowReferenceErrorIfHole [0]",
              "CallRuntime [ThrowConstAssignError], r0-r0",
              "163 S> LdaSmi [4]",
              "165 E> CallRuntime [ThrowConstAssignError], r0-r0",
              "176 S> LdaImmutableCurrentContextSlot [3]",
              "ThrowReferenceErrorIfHole [0]",
              "185 S> Return",
            ],
          },
        ],
      },
    );
  });
});

describe("default parameters", () => {
  // The same source as tests/conformance/fixtures/bc-defaults.cjs; the wrapper is not examined.
  const source = `// Default parameters: evaluated on each call that passes undefined, left to right.
function greet(name = 1, punctuation = 2) {
  return name + punctuation;
}
greet();
function area(width, height = width) {
  return width * height;
}
area(4);
let calls = 0;
function next() {
  calls = calls + 1;
  return calls;
}
function withCounter(id = next()) {
  return id;
}
withCounter();
function early(a = b, b = 1) {
  return a + b;
}
early(5);
const arrow = (x = 5, y = x * 2) => x + y;
arrow();
function viaClosure(x = 1, read = () => x) {
  x = 99;
  return read();
}
viaClosure();
`;
  const skip = {};

  it("copies each parameter into a register, taking the default only when the argument is undefined", () => {
    expectFunctions(
      source,
      skip,
      {
        name: "greet",
        registerCount: 2,
        instructions: [
          "Ldar a0",
          "JumpIfNotUndefined [6] (@8)",
          "LdaSmi [1]",
          "Jump [4] (@10)",
          "Ldar a0",
          "Star0",
          "Ldar a1",
          "JumpIfNotUndefined [6] (@19)",
          "LdaSmi [2]",
          "Jump [4] (@21)",
          "Ldar a1",
          "Star1",
          "130 S> Ldar r1",
          "142 E> Add r0, [0]",
          "156 S> Return",
        ],
      },
      {
        name: "area",
        registerCount: 2,
        // A parameter without a default is only copied; a later default reads the copy.
        instructions: [
          "Mov a0, r0",
          "Ldar a1",
          "JumpIfNotUndefined [6] (@11)",
          "Ldar r0",
          "Jump [4] (@13)",
          "Ldar a1",
          "Star1",
          "209 S> Ldar r1",
          "222 E> Mul r0, [0]",
          "231 S> Return",
        ],
      },
      skip,
      {
        name: "withCounter",
        registerCount: 2,
        instructions: [
          "Ldar a0",
          "JumpIfNotUndefined [10] (@12)",
          "LdaImmutableCurrentContextSlot [3]",
          "Star1",
          "341 E> CallUndefinedReceiver0 r1, [0]",
          "Jump [4] (@14)",
          "Ldar a0",
          "Star0",
          "363 S> Return",
        ],
      },
      {
        name: "early",
        registerCount: 2,
        // `b` is read before its own parameter is set, so it starts as the hole and the read is checked.
        instructions: [
          "LdaTheHole",
          "Star1",
          "Ldar a0",
          "JumpIfNotUndefined [8] (@12)",
          "Ldar r1",
          "400 E> ThrowReferenceErrorIfHole [0]",
          "Jump [4] (@14)",
          "Ldar a0",
          "Star0",
          "Ldar a1",
          "JumpIfNotUndefined [6] (@23)",
          "LdaSmi [1]",
          "Jump [4] (@25)",
          "Ldar a1",
          "Star1",
          "414 S> Ldar r1",
          "423 E> Add r0, [0]",
          "427 S> Return",
        ],
        constantPool: ["<String[1]: #b>"],
      },
      {
        name: "viaClosure",
        registerCount: 2,
        // A captured parameter lives in the function context and is not copied there from the argument.
        instructions: [
          "511 E> CreateFunctionContext [0], [1]",
          "PushContext r1",
          "LdaTheHole",
          "StaCurrentContextSlot [2]",
          "Ldar a0",
          "JumpIfNotUndefined [6] (@16)",
          "LdaSmi [1]",
          "Jump [4] (@18)",
          "Ldar a0",
          "StaCurrentContextSlot [2]",
          "Ldar a1",
          "JumpIfNotUndefined [8] (@30)",
          "CreateClosure [1], [0], #2",
          "Jump [4] (@32)",
          "Ldar a1",
          "Star0",
          "539 S> LdaSmi [99]",
          "541 E> StaCurrentContextSlot [2]",
          "556 S> CallUndefinedReceiver0 r0, [0]",
          "563 S> Return",
        ],
        children: [{ instructions: ["532 S> LdaCurrentContextSlot [2]", "ThrowReferenceErrorIfHole [0]", "533 S> Return"] }],
      },
      {
        name: "arrow",
        registerCount: 2,
        instructions: [
          "Ldar a0",
          "JumpIfNotUndefined [6] (@8)",
          "LdaSmi [5]",
          "Jump [4] (@10)",
          "Ldar a0",
          "Star0",
          "Ldar a1",
          "JumpIfNotUndefined [9] (@22)",
          "Ldar r0",
          "468 E> MulSmi [2], [0]",
          "Jump [4] (@24)",
          "Ldar a1",
          "Star1",
          "478 S> Ldar r1",
          "478 E> Add r0, [1]",
          "481 S> Return",
        ],
      },
    );
  });
});

describe("this", () => {
  // The same source as tests/conformance/fixtures/bc-this.cjs.
  const source = `// "this": the module's receiver at top level, the call's receiver in functions, captured by arrows.
function sloppy() {
  return this;
}
sloppy();
function strictFn() {
  "use strict";
  return this;
}
strictFn();
const topArrow = () => this;
topArrow();
function withArrow() {
  const read = () => this;
  return read();
}
withArrow();
function useThis() {
  const v = this;
  return v;
}
useThis();
const viaTop = this;
`;

  it("reads the receiver directly, or from the context when an arrow captures it", () => {
    expectFunctions(
      source,
      {
        registerCount: 7,
        // The receiver is copied into the context of the function whose arrow reads it.
        instructions: [
          "0 E> CreateFunctionContext [0], [1]",
          "PushContext r6",
          "Ldar <this>",
          "StaCurrentContextSlot [2]",
          "CreateClosure [1], [0], #2",
          "Star0",
          "CreateClosure [2], [1], #2",
          "Star1",
          "CreateClosure [3], [2], #2",
          "Star3",
          "CreateClosure [4], [3], #2",
          "Star4",
          "138 S> CallUndefinedReceiver0 r0, [0]",
          "203 S> CallUndefinedReceiver0 r1, [2]",
          "232 S> CreateClosure [5], [4], #2",
          "Star2",
          "244 S> CallUndefinedReceiver0 r2, [4]",
          "325 S> CallUndefinedReceiver0 r3, [6]",
          "391 S> CallUndefinedReceiver0 r4, [8]",
          "417 S> LdaImmutableCurrentContextSlot [2]",
          "Star5",
          "LdaUndefined",
          "422 S> Return",
        ],
      },
      { name: "sloppy", registerCount: 0, instructions: ["123 S> Ldar <this>", "135 S> Return"] },
      { name: "strictFn", registerCount: 0, instructions: ["188 S> Ldar <this>", "200 S> Return"] },
      {
        name: "withArrow",
        registerCount: 2,
        instructions: [
          "274 E> CreateFunctionContext [0], [1]",
          "PushContext r1",
          "Ldar <this>",
          "StaCurrentContextSlot [2]",
          "294 S> CreateClosure [1], [0], #2",
          "Star0",
          "315 S> CallUndefinedReceiver0 r0, [0]",
          "322 S> Return",
        ],
        children: [{ name: "read", registerCount: 0, instructions: ["300 S> LdaImmutableCurrentContextSlot [2]", "304 S> Return"] }],
      },
      { name: "useThis", registerCount: 1, instructions: ["371 S> Mov <this>, r0", "379 S> Ldar r0", "388 S> Return"] },
      { name: "topArrow", registerCount: 0, instructions: ["238 S> LdaImmutableCurrentContextSlot [2]", "242 S> Return"] },
    );
  });
});

describe("a captured receiver", () => {
  // The same source as tests/conformance/fixtures/bc-receiver-capture.cjs; the wrapper is not examined.
  const source = `// A captured receiver is copied into the context first, then the captured parameters last to first.
function both(a, b) {
  const x = 1;
  return () => this + a + b + x;
}
both(1, 2)();
function dflt(a = 1) {
  return () => this + a;
}
dflt()();
`;

  it("takes the first context slot, ahead of the captured parameters, which follow last to first", () => {
    expectFunctions(
      source,
      {},
      {
        name: "both",
        registerCount: 1,
        instructions: [
          "114 E> CreateFunctionContext [0], [4]",
          "PushContext r0",
          "Ldar <this>",
          "StaCurrentContextSlot [2]",
          "Ldar a0",
          "StaCurrentContextSlot [4]",
          "Ldar a1",
          "StaCurrentContextSlot [3]",
          "LdaTheHole",
          "StaCurrentContextSlot [5]",
          "135 S> LdaSmi [1]",
          "135 E> StaCurrentContextSlot [5]",
          "140 S> CreateClosure [1], [0], #2",
          "170 S> Return",
        ],
        // A chain of one operator is one operation, positioned at its first operand.
        children: [
          {
            registerCount: 1,
            instructions: [
              "153 S> LdaImmutableCurrentContextSlot [2]",
              "Star0",
              "LdaImmutableCurrentContextSlot [4]",
              "158 E> Add r0, [0]",
              "Star0",
              "LdaImmutableCurrentContextSlot [3]",
              "162 E> Add r0, [1]",
              "Star0",
              "LdaImmutableCurrentContextSlot [5]",
              "168 E> ThrowReferenceErrorIfHole [0]",
              "166 E> Add r0, [2]",
              "169 S> Return",
            ],
          },
        ],
      },
      {
        name: "dflt",
        registerCount: 1,
        instructions: [
          "200 E> CreateFunctionContext [0], [2]",
          "PushContext r0",
          "Ldar <this>",
          "StaCurrentContextSlot [2]",
          "LdaTheHole",
          "StaCurrentContextSlot [3]",
          "Ldar a0",
          "JumpIfNotUndefined [6] (@20)",
          "LdaSmi [1]",
          "Jump [4] (@22)",
          "Ldar a0",
          "StaCurrentContextSlot [3]",
          "212 S> CreateClosure [1], [0], #2",
          "234 S> Return",
        ],
        children: [
          {
            registerCount: 1,
            instructions: [
              "230 S> LdaImmutableCurrentContextSlot [2]",
              "Star0",
              "LdaImmutableCurrentContextSlot [3]",
              "232 E> ThrowReferenceErrorIfHole [0]",
              "230 E> Add r0, [0]",
              "233 S> Return",
            ],
          },
        ],
      },
    );
  });
});

describe("sibling scopes", () => {
  // The same source as tests/conformance/fixtures/bc-sibling-blocks.cjs; the wrapper is not examined.
  const source = `// V8 hands out stack registers to sibling scopes last to first.
function sib() {
  { let a = 1; a = a + 1; }
  { let b = 2; b = b + 1; }
  let top = 3;
  return top;
}
sib();
function nestedSib() {
  let x = 1;
  { let y = 2; { let z = 3; z = z + 1; } let w = 4; w = w + y; }
  { let v = 5; v = v + x; }
}
nestedSib();
`;

  it("gives registers to the last sibling first, each scope's own locals before its inner scopes", () => {
    expectFunctions(
      source,
      {},
      {
        name: "sib",
        registerCount: 3,
        instructions: [
          "94 S> LdaSmi [1]",
          "Star2",
          "103 S> AddSmi [1], [0]",
          "Star2",
          "122 S> LdaSmi [2]",
          "Star1",
          "131 S> AddSmi [1], [1]",
          "Star1",
          "150 S> LdaSmi [3]",
          "Star0",
          "166 S> Return",
        ],
      },
      {
        name: "nestedSib",
        registerCount: 5,
        instructions: [
          "209 S> LdaSmi [1]",
          "Star0",
          "224 S> LdaSmi [2]",
          "Star2",
          "237 S> LdaSmi [3]",
          "Star4",
          "246 S> AddSmi [1], [0]",
          "Star4",
          "261 S> LdaSmi [4]",
          "Star3",
          "264 S> Ldar r2",
          "270 E> Add r3, [1]",
          "Star3",
          "289 S> LdaSmi [5]",
          "Star1",
          "292 S> Ldar r0",
          "298 E> Add r1, [2]",
          "Star1",
          "LdaUndefined",
          "305 S> Return",
        ],
      },
    );
  });
});

describe("block contexts", () => {
  // The same source as tests/conformance/fixtures/bc-block-contexts.cjs; the wrapper is not examined.
  const source = `// Blocks whose bindings a closure captures get a context of their own.
function blockCapture(c) {
  let outer = 1;
  if (c) {
    let inner = 2;
    const f = () => inner + outer;
    return f();
  }
  return outer;
}
blockCapture(1);
function blockPlain(c) {
  if (c) {
    let a = 1;
    const b = a + 1;
    return b;
  }
  return 0;
}
blockPlain(1);
function blockTdz(c) {
  {
    const g = () => later;
    let later = 5;
    return g();
  }
}
blockTdz(1);
function twoBlocks(c) {
  { let p = 1; const f = () => p; f(); }
  { let q = 2; const g = () => q; g(); }
}
twoBlocks(1);
`;

  it("pushes a context for a block whose bindings a closure captures, and pops it when the block falls through", () => {
    expectFunctions(
      source,
      {},
      {
        name: "blockCapture",
        registerCount: 3,
        instructions: [
          "93 E> CreateFunctionContext [0], [1]",
          "PushContext r1",
          "LdaTheHole",
          "StaCurrentContextSlot [2]",
          "113 S> LdaSmi [1]",
          "113 E> StaCurrentContextSlot [2]",
          "118 S> Ldar a0",
          "JumpIfToBooleanFalse [22] (@36)",
          "CreateBlockContext [1]",
          "PushContext r2",
          "LdaTheHole",
          "StaCurrentContextSlot [2]",
          "143 S> LdaSmi [2]",
          "143 E> StaCurrentContextSlot [2]",
          "160 S> CreateClosure [2], [0], #2",
          "Star0",
          "192 S> CallUndefinedReceiver0 r0, [0]",
          "196 S> Return",
          "203 S> LdaImmutableCurrentContextSlot [2]",
          "216 S> Return",
        ],
        constantPool: ["<ScopeInfo FUNCTION_SCOPE>", "<ScopeInfo BLOCK_SCOPE>", "<SharedFunctionInfo f>"],
        // The closure reads the block's slot at depth 0 and the function's one hop out.
        children: [
          {
            name: "f",
            registerCount: 1,
            instructions: [
              "172 S> LdaImmutableCurrentContextSlot [2]",
              "ThrowReferenceErrorIfHole [0]",
              "Star0",
              "LdaImmutableContextSlot <context>, [2], [1]",
              "174 E> ThrowReferenceErrorIfHole [1]",
              "172 E> Add r0, [0]",
              "179 S> Return",
            ],
          },
        ],
      },
      {},
      {
        name: "blockTdz",
        registerCount: 2,
        instructions: [
          "372 E> CreateBlockContext [0]",
          "PushContext r1",
          "LdaTheHole",
          "StaCurrentContextSlot [2]",
          "396 S> CreateClosure [1], [0], #2",
          "Star0",
          "425 S> LdaSmi [5]",
          "425 E> StaCurrentContextSlot [2]",
          "439 S> CallUndefinedReceiver0 r0, [0]",
          "443 S> Return",
        ],
        children: [{ registerCount: 0, instructions: ["402 S> LdaImmutableCurrentContextSlot [2]", "ThrowReferenceErrorIfHole [0]", "407 S> Return"] }],
      },
      {
        name: "twoBlocks",
        registerCount: 3,
        // Each block keeps its own scope info, and the register that holds the outer context is reused.
        instructions: [
          "481 E> CreateBlockContext [0]",
          "PushContext r2",
          "LdaTheHole",
          "StaCurrentContextSlot [2]",
          "499 S> LdaSmi [1]",
          "499 E> StaCurrentContextSlot [2]",
          "512 S> CreateClosure [1], [0], #2",
          "Star1",
          "521 S> CallUndefinedReceiver0 r1, [0]",
          "PopContext r2",
          "CreateBlockContext [2]",
          "PushContext r2",
          "LdaTheHole",
          "StaCurrentContextSlot [2]",
          "540 S> LdaSmi [2]",
          "540 E> StaCurrentContextSlot [2]",
          "553 S> CreateClosure [3], [1], #2",
          "Star0",
          "562 S> CallUndefinedReceiver0 r0, [2]",
          "PopContext r2",
          "LdaUndefined",
          "569 S> Return",
        ],
        children: [
          { registerCount: 0, instructions: ["518 S> LdaImmutableCurrentContextSlot [2]", "ThrowReferenceErrorIfHole [0]", "519 S> Return"] },
          { registerCount: 0, instructions: ["559 S> LdaImmutableCurrentContextSlot [2]", "ThrowReferenceErrorIfHole [0]", "560 S> Return"] },
        ],
      },
    );
  });
});

describe("a loop variable a closure captures", () => {
  // V8 gives each iteration a context of its own through a copying desugaring that is not built yet.
  it("is refused rather than compiled as a function-level slot", () => {
    expect(() => compile("function f(n) { let g; for (let i = 0; i < n; i = i + 1) { g = () => i; } return g; } f(1);")).toThrow(
      "ForStatement is not compiled to bytecode yet",
    );
  });
});

describe("leaving a block context by break or continue", () => {
  it("pops to the loop's context before the jump", () => {
    expectFunctions(
      `// break and continue leave the contexts of the blocks they jump out of.
function exits(n) {
  let k = 0;
  while (k < n) {
    {
      let c = k;
      const f = () => c;
      if (f() > 2) break;
      if (f() > 1) continue;
      k = k + 1;
    }
  }
  return k;
}
exits(1);
`,
      {},
      {
        registerCount: 4,
        instructions: [
          "103 S> LdaZero",
          "Star0",
          "117 S> Ldar a0",
          "117 E> TestLessThan r0, [0]",
          "JumpIfFalse [60] (@67)",
          "CreateBlockContext [0]",
          "PushContext r2",
          "LdaTheHole",
          "StaCurrentContextSlot [2]",
          "144 S> Ldar r0",
          "144 E> StaCurrentContextSlot [2]",
          "163 S> CreateClosure [1], [0], #2",
          "Star1",
          "182 S> CallUndefinedReceiver0 r1, [1]",
          "Star3",
          "LdaSmi [2]",
          "186 E> TestGreaterThan r3, [3]",
          "JumpIfFalse [6] (@40)",
          "191 S> PopContext r2",
          "Jump [29] (@67)",
          "208 S> CallUndefinedReceiver0 r1, [4]",
          "Star3",
          "LdaSmi [1]",
          "212 E> TestGreaterThan r3, [6]",
          "JumpIfFalse [6] (@55)",
          "217 S> PopContext r2",
          "Jump [10] (@63)",
          "233 S> Ldar r0",
          "239 E> AddSmi [1], [7]",
          "Star0",
          "PopContext r2",
          "108 E> JumpLoop [61], [0], [8] (@2)",
          "256 S> Ldar r0",
          "265 S> Return",
        ],
      },
    );
  });
});

describe("a named function expression's own name", () => {
  const source = `// A named function expression sees its own name.
function outer() {
  const fact = function inner(n) { return n < 2 ? 1 : n * inner(n - 1); };
  return fact(3);
}
outer();
function viaClosure() {
  const g = function self() { return () => self; };
  return g()();
}
viaClosure();
`;

  it("is a register copied from the closure, or a context slot when captured", () => {
    expectFunctions(
      source,
      {},
      {
        registerCount: 3,
        instructions: ["84 S> CreateClosure [0], [0], #2", "Star0", "146 S> LdaSmi [3]", "Star2", "153 E> CallUndefinedReceiver1 r0, r2, [0]", "161 S> Return"],
        children: [
          {
            registerCount: 4,
            instructions: [
              "Mov <closure>, r0",
              "104 S> LdaSmi [2]",
              "113 E> TestLessThan a0, [0]",
              "JumpIfFalse [6] (@14)",
              "LdaSmi [1]",
              "Jump [15] (@27)",
              "Ldar a0",
              "135 E> SubSmi [1], [2]",
              "Star3",
              "127 E> CallUndefinedReceiver1 r0, r3, [3]",
              "125 E> Mul a0, [1]",
              "140 S> Return",
            ],
          },
        ],
      },
      {
        registerCount: 2,
        instructions: [
          "209 S> CreateClosure [0], [0], #2",
          "Star0",
          "258 S> CallUndefinedReceiver0 r0, [0]",
          "Star1",
          "261 E> CallUndefinedReceiver0 r1, [2]",
          "264 S> Return",
        ],
        children: [
          {
            registerCount: 1,
            instructions: [
              "222 E> CreateFunctionContext [0], [1]",
              "PushContext r0",
              "Ldar <closure>",
              "StaCurrentContextSlot [2]",
              "227 S> CreateClosure [1], [0], #2",
              "245 S> Return",
            ],
            constantPool: ["<ScopeInfo FUNCTION_SCOPE>", "<SharedFunctionInfo>"],
            children: [{ registerCount: 0, instructions: ["240 S> LdaImmutableCurrentContextSlot [2]", "244 S> Return"] }],
          },
        ],
      },
    );
  });

  it("starts a method at the parenthesis of its parameters, where its context is created", () => {
    expectFunctions(
      "const o = {\n  then(resolve) { return () => resolve; },\n};\no.then(1);\n",
      {},
      {
        name: "then",
        registerCount: 1,
        instructions: [
          "18 E> CreateFunctionContext [0], [1]",
          "PushContext r0",
          "Ldar a0",
          "StaCurrentContextSlot [2]",
          "30 S> CreateClosure [1], [0], #2",
          "51 S> Return",
        ],
        constantPool: ["<ScopeInfo FUNCTION_SCOPE>", "<SharedFunctionInfo>"],
      },
    );
  });
});
