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
  readonly registerCount: number;
  readonly instructions: readonly string[];
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
    expect(printed.instructions.map((i) => (i.position ? `${i.position.at} ${i.position.kind}> ${i.text}` : i.text))).toEqual(expected.instructions);
    expect(fn.registerCount).toBe(expected.registerCount);
    if (expected.constantPool) expect(printed.constantPool).toEqual(expected.constantPool);
    if (expected.name !== undefined) expect(fn.name).toBe(expected.name);
    if (expected.parameterCount !== undefined) expect(fn.parameterCount).toBe(expected.parameterCount);
    const nested = expected.children ?? [];
    expect(fn.children).toHaveLength(nested.length);
    nested.forEach((child, i) => check(byId(fn.children[i] as number), child));
  };
  check(byId(0), { ...wrapper, children });
}

describe("functions and plain calls", () => {
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
