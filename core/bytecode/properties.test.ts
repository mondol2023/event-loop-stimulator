import { describe, expect, it } from "vitest";
import { parseScript } from "@/core/frontend/parse";
import { analyzeScopes } from "@/core/frontend/scope/ScopeAnalyzer";
import { generateBytecode } from "./BytecodeGenerator";
import { type BytecodeFunction, toPrintable } from "./BytecodeProgram";
import { printBytecodeArray } from "./printer";

// Property access, method calls, `new`, `delete`, optional chains, object and array literals and
// nested templates. Every expected listing is what the pinned Node (V8 13.6) prints for the same
// source (`node --print-bytecode`, read through scripts/conformance/bytecode-capture.mts), never
// written by hand. Positions read `offset S> text`.

function compile(source: string): readonly BytecodeFunction[] {
  const parsed = parseScript(source);
  if (!parsed.ok) throw new Error(`test source does not parse: ${parsed.error[0]?.message}`);
  const result = generateBytecode(parsed.value, analyzeScopes(parsed.value));
  if (!result.ok) throw new Error(`not compiled: ${result.error[0]?.message}`);
  return result.value.functions;
}

function listing(fn: BytecodeFunction): { instructions: string[]; constantPool: string[] } {
  const printed = printBytecodeArray(toPrintable(fn));
  return {
    instructions: printed.instructions.map((i) => (i.position ? `${i.position.at} ${i.position.kind}> ${i.text}` : i.text)),
    constantPool: [...printed.constantPool],
  };
}

/** The top-level function's listing and register count. */
function wrapper(source: string): { instructions: string[]; constantPool: string[]; registerCount: number } {
  const fn = compile(source)[0];
  if (!fn) throw new Error("no top-level function");
  return { ...listing(fn), registerCount: fn.registerCount };
}

describe("object literals", () => {
  it("builds the constant part from a boilerplate and defines the computed values one by one", () => {
    const { instructions, constantPool, registerCount } = wrapper("var x = 1;\nvar a = { p: 1, q: x };\nvar e = {};\nvar n = { l: [1] };\n");
    expect(instructions).toEqual([
      "8 S> LdaSmi [1]",
      "Star0",
      "19 S> CreateObjectLiteral [0], [0], #41",
      "Star4",
      "Ldar r0",
      "30 E> DefineNamedOwnProperty r4, [1], [1]",
      "Mov r4, r1",
      "43 S> CreateEmptyObjectLiteral",
      "Star2",
      "55 S> CreateObjectLiteral [2], [3], #12",
      "Star3",
      "LdaUndefined",
      "66 S> Return",
    ]);
    expect(constantPool).toEqual(["<ObjectBoilerplateDescription[4]>", "<String[1]: #q>", "<ObjectBoilerplateDescription[2]>"]);
    expect(registerCount).toBe(5);
  });

  it("positions a method closure at its key", () => {
    const { instructions } = wrapper("var o = { m() { return 1; } };\nvar q = 0;\n");
    expect(instructions.slice(0, 5)).toEqual([
      "8 S> CreateObjectLiteral [0], [0], #41",
      "Star2",
      "10 E> CreateClosure [1], [0], #2",
      "DefineNamedOwnProperty r2, [2], [1]",
      "Mov r2, r0",
    ]);
  });

  it.each([
    ["spread", "var a = { ...{} };"],
    ["a computed key", "var k = 'a'; var a = { [k]: 1 };"],
    ["an accessor", "var a = { get x() { return 1; } };"],
    ["__proto__", "var a = { __proto__: null };"],
    ["an index key with a computed value", "var x = 1; var a = { 1: x };"],
  ])("refuses %s rather than compiling it differently from V8", (_, source) => {
    const parsed = parseScript(source);
    if (!parsed.ok) throw new Error("test source does not parse");
    expect(generateBytecode(parsed.value, analyzeScopes(parsed.value)).ok).toBe(false);
  });
});

describe("array literals", () => {
  it("stores computed elements by index and takes the elements kind from the constants", () => {
    const { instructions, constantPool, registerCount } = wrapper("var x = 1;\nvar a = [x, 2];\nvar h = [1, , 3];\nvar d = [1.5, 2];\nvar e = [];\n");
    expect(instructions).toEqual([
      "8 S> LdaSmi [1]",
      "Star0",
      "19 S> CreateArrayLiteral [0], [0], #37",
      "Star5",
      "LdaZero",
      "Star6",
      "Ldar r0",
      "20 E> StaInArrayLiteral r5, r6, [1]",
      "Mov r5, r1",
      "35 S> CreateArrayLiteral [1], [3], #37",
      "Star2",
      "53 S> CreateArrayLiteral [2], [4], #37",
      "Star3",
      "71 S> CreateEmptyArrayLiteral [5]",
      "Star4",
      "LdaUndefined",
      "74 S> Return",
    ]);
    expect(constantPool).toEqual([
      "<ArrayBoilerplateDescription PACKED_SMI_ELEMENTS, <FixedArray[2]>>",
      "<ArrayBoilerplateDescription HOLEY_SMI_ELEMENTS, <FixedArray[3]>>",
      "<ArrayBoilerplateDescription PACKED_DOUBLE_ELEMENTS, <FixedDoubleArray[2]>>",
    ]);
    expect(registerCount).toBe(7);
  });
});

describe("method calls, new and delete", () => {
  it("calls a method with the object as receiver, constructs with the callee as new.target and deletes by key", () => {
    const { instructions, constantPool } = wrapper("var o = { m() { return 1; } };\no.m();\no.m(1);\nvar s = new Object();\nnew Object(1);\ndelete o.m;\n");
    expect(instructions.slice(5)).toEqual([
      "33 S> GetNamedProperty r0, [2], [3]",
      "Star2",
      "33 E> CallProperty0 r2, r0, [5]",
      "40 S> GetNamedProperty r0, [2], [3]",
      "Star2",
      "LdaSmi [1]",
      "Star4",
      "40 E> CallProperty1 r2, r0, r4, [7]",
      "54 S> LdaGlobal [3], [9]",
      "Star2",
      "54 E> Construct r2, r0-r0, [11]",
      "Star1",
      "68 S> LdaGlobal [3], [9]",
      "Star2",
      "LdaSmi [1]",
      "Star3",
      "Ldar r2",
      "68 E> Construct r2, r3-r3, [13]",
      "83 S> LdaConstant [2]",
      "DeletePropertySloppy r0",
      "LdaUndefined",
      "94 S> Return",
    ]);
    expect(constantPool).toEqual(["<ObjectBoilerplateDescription[2]>", "<SharedFunctionInfo m>", "<String[1]: #m>", "<String[6]: #Object>"]);
  });

  it("positions a member on the dot after a call, and a call on the parenthesis for a reserved-word method", () => {
    expect(wrapper("var o = { f() { return o; }, v: 1 };\no.f().v;\n").instructions.slice(8)).toEqual([
      "37 S> LdaImmutableCurrentContextSlot [2]",
      "Star2",
      "39 E> GetNamedProperty r2, [3], [3]",
      "Star1",
      "39 E> CallProperty0 r1, r2, [5]",
      "Star1",
      "42 E> GetNamedProperty r1, [4], [7]",
      "LdaUndefined",
      "45 S> Return",
    ]);
    expect(wrapper("var p = Promise.resolve();\np.catch(function () {});\n").instructions.slice(6)).toEqual([
      "29 S> GetNamedProperty r0, [2], [6]",
      "Star1",
      "CreateClosure [3], [0], #2",
      "Star3",
      "34 E> CallProperty1 r1, r0, r3, [8]",
      "LdaUndefined",
      "51 S> Return",
    ]);
  });
});

describe("optional chains", () => {
  it("short-circuits the rest of the chain to undefined at the first nullish link", () => {
    expect(wrapper("var o = null;\nvar k = 0;\no?.a;\no?.a.b;\no?.[k];\n").instructions).toEqual([
      "8 S> LdaNull",
      "Star0",
      "22 S> LdaZero",
      "Star1",
      "25 S> Ldar r0",
      "Mov r0, r2",
      "JumpIfUndefinedOrNull [8] (@17)",
      "26 E> GetNamedProperty r2, [0], [0]",
      "Jump [3] (@18)",
      "LdaUndefined",
      "31 S> Ldar r0",
      "Mov r0, r2",
      "JumpIfUndefinedOrNull [13] (@36)",
      "32 E> GetNamedProperty r2, [0], [0]",
      "Star2",
      "35 E> GetNamedProperty r2, [1], [2]",
      "Jump [3] (@37)",
      "LdaUndefined",
      "39 S> Ldar r0",
      "Mov r0, r2",
      "JumpIfUndefinedOrNull [9] (@51)",
      "Ldar r1",
      "42 E> GetKeyedProperty r2, [4]",
      "Jump [3] (@52)",
      "LdaUndefined",
      "LdaUndefined",
      "46 S> Return",
    ]);
  });
});

describe("templates and function names", () => {
  it("converts a nested template to a string again before concatenating it", () => {
    expect(wrapper("var a = 1;\nvar s = `x${`y${a}`}`;\n").instructions).toEqual([
      "8 S> LdaSmi [1]",
      "Star0",
      "19 S> LdaConstant [0]",
      "Star2",
      "LdaConstant [1]",
      "Star3",
      "Ldar r0",
      "27 E> ToString",
      "Add r3, [1]",
      "ToString",
      "Add r2, [0]",
      "Star1",
      "LdaUndefined",
      "33 S> Return",
    ]);
  });

  it("gives a named function expression no register of its own while its name is never used", () => {
    const [top, g] = compile("var f = function g() { return 1; };\nf();\n");
    expect(top && listing(top).instructions).toEqual([
      "8 S> CreateClosure [0], [0], #2",
      "Star0",
      "36 S> CallUndefinedReceiver0 r0, [0]",
      "LdaUndefined",
      "40 S> Return",
    ]);
    expect(top?.registerCount).toBe(1);
    expect(g?.registerCount).toBe(0);
  });
});
