import { describe, expect, it } from "vitest";
import { parseScript } from "@/core/frontend/parse";
import { analyzeScopes } from "@/core/frontend/scope/ScopeAnalyzer";
import { generateBytecode } from "./BytecodeGenerator";
import { toPrintable } from "./BytecodeProgram";
import { printBytecodeArray } from "./printer";

// Every expectation below is the listing the pinned Node (V8 13.6) prints for the same source,
// copied from `npm run conformance:diff`, never written by hand. Positions read `offset S> text`.

interface Expected {
  readonly registerCount: number;
  readonly instructions: readonly string[];
  readonly constantPool: readonly string[];
}

function expectListing(source: string, expected: Expected): void {
  const parsed = parseScript(source);
  if (!parsed.ok) throw new Error(`test source does not parse: ${parsed.error[0]?.message}`);
  const result = generateBytecode(parsed.value, analyzeScopes(parsed.value));
  if (!result.ok) throw new Error(`not compiled: ${result.error[0]?.message}`);
  const wrapper = result.value.functions[0];
  if (!wrapper) throw new Error("no wrapper function");
  const printed = printBytecodeArray(toPrintable(wrapper));
  expect(printed.instructions.map((i) => (i.position ? `${i.position.at} ${i.position.kind}> ${i.text}` : i.text))).toEqual(expected.instructions);
  expect(printed.constantPool).toEqual(expected.constantPool);
  expect(wrapper.registerCount).toBe(expected.registerCount);
}

describe("FunctionGenerator: literals, locals, operators and globals", () => {
  it("loads small integers, constants and the oddballs", () => {
    expectListing("var a = 0, b = 7, c = 1000, d = 0.5, e = \"s\", f = true, g = null, h = undefined;", {
      registerCount: 8,
      instructions: [
        "8 S> LdaZero",
        "Star0",
        "15 S> LdaSmi [7]",
        "Star1",
        "22 S> LdaSmi.Wide [1000]",
        "Star2",
        "32 S> LdaConstant [0]",
        "Star3",
        "41 S> LdaConstant [1]",
        "Star4",
        "50 S> LdaTrue",
        "Star5",
        "60 S> LdaNull",
        "Star6",
        "70 S> LdaUndefined",
        "Star7",
        "LdaUndefined",
        "79 S> Return",
      ],
      constantPool: ["<HeapNumber 0.5>", "<String[1]: #s>"],
    });
  });

  it("gives an unused variable no register and no store", () => {
    expectListing("var a; var b = 1;", {
      registerCount: 1,
      instructions: [
        "15 S> LdaSmi [1]",
        "Star0",
        "LdaUndefined",
        "16 S> Return",
      ],
      constantPool: [],
    });
  });

  it("adds a Smi literal with the Smi form and two locals with a register", () => {
    expectListing("var a = 1, b = 2; var c = a + 1, d = a + b;", {
      registerCount: 4,
      instructions: [
        "8 S> LdaSmi [1]",
        "Star0",
        "15 S> LdaSmi [2]",
        "Star1",
        "26 S> Ldar r0",
        "28 E> AddSmi [1], [0]",
        "Star2",
        "37 S> Ldar r1",
        "39 E> Add r0, [1]",
        "Star3",
        "LdaUndefined",
        "42 S> Return",
      ],
      constantPool: [],
    });
  });

  it("numbers the feedback slot of an outer binary operation before its operands", () => {
    expectListing("var a = 1, b = 2, c = 3; var d = a + (b + c);", {
      registerCount: 4,
      instructions: [
        "8 S> LdaSmi [1]",
        "Star0",
        "15 S> LdaSmi [2]",
        "Star1",
        "22 S> LdaSmi [3]",
        "Star2",
        "33 S> Ldar r2",
        "40 E> Add r1, [1]",
        "35 E> Add r0, [0]",
        "Star3",
        "LdaUndefined",
        "44 S> Return",
      ],
      constantPool: [],
    });
  });

  it("collapses a chain of one operator into a single run of operations", () => {
    expectListing("var a = 1, b = 2, c = 3; var d = a + b + c;", {
      registerCount: 5,
      instructions: [
        "8 S> LdaSmi [1]",
        "Star0",
        "15 S> LdaSmi [2]",
        "Star1",
        "22 S> LdaSmi [3]",
        "Star2",
        "33 S> Ldar r1",
        "35 E> Add r0, [0]",
        "Star4",
        "Ldar r2",
        "39 E> Add r4, [1]",
        "Star3",
        "LdaUndefined",
        "42 S> Return",
      ],
      constantPool: [],
    });
  });

  it("tests typeof against a literal with TestTypeOf and a global with LdaGlobalInsideTypeof", () => {
    expectListing("var a = 1; var b = typeof a === \"string\", c = typeof missing;", {
      registerCount: 3,
      instructions: [
        "8 S> LdaSmi [1]",
        "Star0",
        "19 S> TestTypeOf #1",
        "Star1",
        "46 S> LdaGlobalInsideTypeof [0], [0]",
        "TypeOf [2]",
        "Star2",
        "LdaUndefined",
        "60 S> Return",
      ],
      constantPool: ["<String[7]: #missing>"],
    });
  });

  it("compares with null and undefined using the dedicated tests", () => {
    expectListing("var a = 1; var b = a == null, c = a === undefined, d = a !== null;", {
      registerCount: 4,
      instructions: [
        "8 S> LdaSmi [1]",
        "Star0",
        "19 S> TestUndetectable",
        "Star1",
        "34 S> Ldar r0",
        "TestUndefined",
        "Star2",
        "55 S> Ldar r0",
        "TestNull",
        "57 E> LogicalNot",
        "Star3",
        "LdaUndefined",
        "65 S> Return",
      ],
      constantPool: [],
    });
  });

  it("short-circuits || and && with the jumps that keep the value", () => {
    expectListing("var a = 1, b = 0; var c = a || b, d = a && b, e = a ?? b;", {
      registerCount: 5,
      instructions: [
        "8 S> LdaSmi [1]",
        "Star0",
        "15 S> LdaZero",
        "Star1",
        "26 S> Ldar r0",
        "JumpIfToBooleanTrue [4] (@11)",
        "Ldar r1",
        "Star2",
        "38 S> Ldar r0",
        "JumpIfToBooleanFalse [4] (@18)",
        "Ldar r1",
        "Star3",
        "50 S> Ldar r0",
        "JumpIfUndefinedOrNull [4] (@25)",
        "Jump [4] (@27)",
        "Ldar r1",
        "Star4",
        "LdaUndefined",
        "56 S> Return",
      ],
      constantPool: [],
    });
  });

  it("turns a condition into jumps and a conditional into two branches", () => {
    expectListing("var a = 1; var b = a ? 2 : 3;", {
      registerCount: 2,
      instructions: [
        "8 S> LdaSmi [1]",
        "Star0",
        "19 S> JumpIfToBooleanFalse [6] (@9)",
        "LdaSmi [2]",
        "Jump [4] (@11)",
        "LdaSmi [3]",
        "Star1",
        "LdaUndefined",
        "28 S> Return",
      ],
      constantPool: [],
    });
  });

  it("inverts a test with LogicalNot or ToBooleanLogicalNot", () => {
    expectListing("var a = 1; var b = !a, c = !(a < 2);", {
      registerCount: 3,
      instructions: [
        "8 S> LdaSmi [1]",
        "Star0",
        "19 S> ToBooleanLogicalNot",
        "Star1",
        "27 S> LdaSmi [2]",
        "31 E> TestLessThan r0, [0]",
        "LogicalNot",
        "Star2",
        "LdaUndefined",
        "35 S> Return",
      ],
      constantPool: [],
    });
  });

  it("loads and stores a global through its feedback slot", () => {
    expectListing("x = 1; var a = x;", {
      registerCount: 1,
      instructions: [
        "0 S> LdaSmi [1]",
        "2 E> StaGlobal [0], [0]",
        "15 S> LdaGlobal [0], [2]",
        "Star0",
        "LdaUndefined",
        "16 S> Return",
      ],
      constantPool: ["<String[1]: #x>"],
    });
  });

  it("updates a local with Inc and Dec, keeping the old value for a postfix", () => {
    expectListing("var a = 1; var b = a++; --a;", {
      registerCount: 3,
      instructions: [
        "8 S> LdaSmi [1]",
        "Star0",
        "19 S> ToNumeric [0]",
        "Star2",
        "Inc [0]",
        "Star0",
        "Mov r2, r1",
        "24 S> Ldar r0",
        "Dec [1]",
        "Star0",
        "LdaUndefined",
        "27 S> Return",
      ],
      constantPool: [],
    });
  });

  it("assigns with compound operators and the logical assignments", () => {
    expectListing("var a = 1, b = 2; a += 1; a -= b; a ||= b; a ??= b;", {
      registerCount: 3,
      instructions: [
        "8 S> LdaSmi [1]",
        "Star0",
        "15 S> LdaSmi [2]",
        "Star1",
        "18 S> Ldar r0",
        "AddSmi [1], [0]",
        "Star0",
        "26 S> Ldar r1",
        "31 E> Sub r0, [1]",
        "Mov r0, r2",
        "Star0",
        "34 S> JumpIfToBooleanTrue [7] (@28)",
        "Mov r1, r0",
        "Ldar r0",
        "43 S> Ldar r0",
        "JumpIfUndefinedOrNull [4] (@34)",
        "Jump [7] (@39)",
        "Mov r1, r0",
        "Ldar r0",
        "LdaUndefined",
        "50 S> Return",
      ],
      constantPool: [],
    });
  });

  it("joins a template literal with ToString and one shared binary-op slot", () => {
    expectListing("var a = 1, s = \"s\"; var t = `a${a}b${s}c`;", {
      registerCount: 4,
      instructions: [
        "8 S> LdaSmi [1]",
        "Star0",
        "15 S> LdaConstant [0]",
        "Star1",
        "28 S> LdaConstant [1]",
        "Star3",
        "Ldar r0",
        "32 E> ToString",
        "Add r3, [0]",
        "Star3",
        "LdaConstant [2]",
        "Add r3, [0]",
        "Star3",
        "Ldar r1",
        "37 E> ToString",
        "Add r3, [0]",
        "Star3",
        "LdaConstant [3]",
        "Add r3, [0]",
        "Star2",
        "LdaUndefined",
        "41 S> Return",
      ],
      constantPool: ["<String[1]: #s>", "<String[1]: #a>", "<String[1]: #b>", "<String[1]: #c>"],
    });
  });

  it("runs a comma expression and void for their effects", () => {
    expectListing("var a = 1, b = 2; var c = (a, b); void a; a, b;", {
      registerCount: 3,
      instructions: [
        "8 S> LdaSmi [1]",
        "Star0",
        "15 S> LdaSmi [2]",
        "Star1",
        "30 S> Mov r1, r2",
        "34 S> LdaUndefined",
        "45 S> LdaUndefined",
        "46 S> Return",
      ],
      constantPool: [],
    });
  });
});
