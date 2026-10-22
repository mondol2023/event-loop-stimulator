import { describe, expect, it } from "vitest";
import { parseScript } from "@/core/frontend/parse";
import { analyzeScopes } from "@/core/frontend/scope/ScopeAnalyzer";
import { generateBytecode } from "./BytecodeGenerator";
import { type BytecodeFunction, toPrintable } from "./BytecodeProgram";
import { printBytecodeArray } from "./printer";

// Function scopes beyond the plain case: a var block under parameter expressions, Annex B block
// functions, async functions with parameter expressions, `delete` of a name and the arguments
// object. Every expected listing is what the pinned Node (V8 13.6) prints for the same source,
// copied from `npm run conformance:diff`, never written by hand. A function V8 never compiled
// (it was never called) is not listed.

interface Listing {
  /** Index of the closure's constant-pool entry in the function that creates it. */
  readonly at?: number;
  readonly name: string;
  readonly registerCount: number;
  readonly instructions: readonly string[];
  readonly constantPool: readonly string[];
  readonly children: readonly Listing[];
}

function expectListing(source: string, expected: Listing): void {
  const parsed = parseScript(source);
  if (!parsed.ok) throw new Error(`test source does not parse: ${parsed.error[0]?.message}`);
  const result = generateBytecode(parsed.value, analyzeScopes(parsed.value));
  if (!result.ok) throw new Error(`not compiled: ${result.error[0]?.message}`);
  const functions = result.value.functions;
  const check = (fn: BytecodeFunction, listing: Listing): void => {
    const printed = printBytecodeArray(toPrintable(fn));
    expect(printed.instructions.map((i) => (i.position ? `${i.position.at} ${i.position.kind}> ${i.text}` : i.text)), listing.name).toEqual(listing.instructions);
    expect(printed.constantPool, listing.name).toEqual(listing.constantPool);
    expect(fn.registerCount, listing.name).toBe(listing.registerCount);
    for (const child of listing.children) {
      const entry = fn.constantPool.get(child.at ?? -1);
      if (entry?.kind !== "sfi") throw new Error(`${listing.name}: constant ${child.at} is not a closure`);
      const code = functions[entry.functionId];
      if (!code) throw new Error(`no function ${entry.functionId}`);
      check(code, child);
    }
  };
  const wrapper = functions[0];
  if (!wrapper) throw new Error("no wrapper function");
  check(wrapper, expected);
}

describe("function scopes and the bytecode V8 makes for them", () => {
  it("a sloppy block function is also assigned to the function-level var, unless a parameter has the name", () => {
    expectListing(
      "function h(p) {\n  { function q() { return 1; } function p() { return 2; } }\n  { function w() { return 3; } }\n  var w;\n  return q;\n}\nh();\nfunction k() {\n  { function z() { return 1; } }\n  return function () { return z; };\n}\nk();\n",
      {
        name: "",
        registerCount: 2,
        instructions: ["0 E> CreateClosure [0], [0], #2","Star0","CreateClosure [1], [1], #2","Star1","132 S> CallUndefinedReceiver0 r0, [0]","223 S> CallUndefinedReceiver0 r1, [2]","LdaUndefined","227 S> Return"],
        constantPool: ["<SharedFunctionInfo h>","<SharedFunctionInfo k>"],
        children: [
          {
            at: 0,
            name: "h",
            registerCount: 4,
            instructions: ["10 E> CreateClosure [0], [0], #2","Star3","46 S> Star1","46 E> CreateClosure [1], [1], #2","Star2","106 S> Star0","120 S> Ldar r3","129 S> Return"],
            constantPool: ["<SharedFunctionInfo q>","<SharedFunctionInfo w>"],
            children: [],
          },
          {
            at: 1,
            name: "k",
            registerCount: 2,
            instructions: ["147 E> CreateFunctionContext [0], [1]","PushContext r1","CreateClosure [1], [0], #2","Star0","182 S> StaCurrentContextSlot [2]","187 S> CreateClosure [2], [1], #2","220 S> Return"],
            constantPool: ["<ScopeInfo FUNCTION_SCOPE>","<SharedFunctionInfo z>","<SharedFunctionInfo>"],
            children: [],
          },
        ],
      },
    );
  });

  it("a block function's closure sees a later let in the block as uninitialized", () => {
    expectListing(
      "function run(g) { g(); }\n{\n  function f() { return x + 1; }\n  try { run(function () { f(); }); } catch (e) {}\n  const x = 1;\n}\n",
      {
        name: "",
        registerCount: 6,
        instructions: ["0 E> CreateClosure [0], [0], #2","Star0","CreateBlockContext [1]","PushContext r2","CreateClosure [2], [1], #2","StaCurrentContextSlot [2]","LdaTheHole","StaCurrentContextSlot [3]","59 S> LdaImmutableCurrentContextSlot [2]","Star1","Mov <context>, r3","68 S> CreateClosure [3], [2], #2","Star5","68 E> CallUndefinedReceiver1 r0, r5, [0]","Jump [15] (@48)","Star4","CreateCatchContext r4, [4]","Star3","LdaTheHole","SetPendingMessage","Ldar r3","PushContext r4","PopContext r4","122 S> LdaSmi [1]","122 E> StaCurrentContextSlot [3]","PopContext r2","LdaUndefined","126 S> Return"],
        constantPool: ["<SharedFunctionInfo run>","<ScopeInfo BLOCK_SCOPE>","<SharedFunctionInfo f>","<SharedFunctionInfo>","<ScopeInfo CATCH_SCOPE>"],
        children: [
          {
            at: 0,
            name: "run",
            registerCount: 0,
            instructions: ["18 S> CallUndefinedReceiver0 a0, [0]","LdaUndefined","23 S> Return"],
            constantPool: [],
            children: [],
          },
          {
            at: 2,
            name: "f",
            registerCount: 0,
            instructions: ["44 S> LdaImmutableCurrentContextSlot [3]","ThrowReferenceErrorIfHole [0]","53 E> AddSmi [1], [0]","57 S> Return"],
            constantPool: ["<String[1]: #x>"],
            children: [],
          },
          {
            at: 3,
            name: "",
            registerCount: 1,
            instructions: ["86 S> LdaImmutableCurrentContextSlot [2]","Star0","86 E> CallUndefinedReceiver0 r0, [0]","LdaUndefined","91 S> Return"],
            constantPool: [],
            children: [],
          },
        ],
      },
    );
  });

  it("the arguments object is created at entry: unmapped in strict code and with parameter expressions, mapped otherwise", () => {
    expectListing(
      "function f1(x = 1) { return arguments; }\nf1();\nfunction f2() { return typeof arguments; }\nf2(42);\nfunction f3(a) { \"use strict\"; return arguments.length; }\nf3();\nfunction f4() { var q = 1; return () => arguments; }\nf4();\n",
      {
        name: "",
        registerCount: 6,
        instructions: ["0 E> CreateClosure [0], [0], #2","Star0","CreateClosure [1], [1], #2","Star1","CreateClosure [2], [2], #2","Star2","CreateClosure [3], [3], #2","Star3","41 S> CallUndefinedReceiver0 r0, [0]","90 S> LdaSmi [42]","Star5","90 E> CallUndefinedReceiver1 r1, r5, [2]","156 S> CallUndefinedReceiver0 r2, [4]","215 S> CallUndefinedReceiver0 r3, [6]","LdaUndefined","220 S> Return"],
        constantPool: ["<SharedFunctionInfo f1>","<SharedFunctionInfo f2>","<SharedFunctionInfo f3>","<SharedFunctionInfo f4>"],
        children: [
          {
            at: 0,
            name: "f1",
            registerCount: 2,
            instructions: ["11 E> CreateUnmappedArguments","Star1","Ldar a0","JumpIfNotUndefined [6] (@10)","LdaSmi [1]","Jump [4] (@12)","Ldar a0","Star0","21 S> Ldar r1","38 S> Return"],
            constantPool: [],
            children: [],
          },
          {
            at: 1,
            name: "f2",
            registerCount: 1,
            instructions: ["58 E> CreateMappedArguments","Star0","63 S> TypeOf [0]","87 S> Return"],
            constantPool: [],
            children: [],
          },
          {
            at: 2,
            name: "f3",
            registerCount: 1,
            instructions: ["109 E> CreateUnmappedArguments","Star0","146 S> GetNamedProperty r0, [0], [0]","153 S> Return"],
            constantPool: ["<String[6]: #length>"],
            children: [],
          },
          {
            at: 3,
            name: "f4",
            registerCount: 2,
            instructions: ["173 E> CreateFunctionContext [0], [1]","PushContext r1","CreateMappedArguments","StaCurrentContextSlot [2]","186 S> LdaSmi [1]","Star0","189 S> CreateClosure [1], [0], #2","212 S> Return"],
            constantPool: ["<ScopeInfo FUNCTION_SCOPE>","<SharedFunctionInfo>"],
            children: [],
          },
        ],
      },
    );
  });

  it("an async function with parameter expressions runs them inside the rejecting try, its generator after the parameters", () => {
    expectListing(
      "async function a(x, y = x) { var q = 1; return () => q + y; }\na(1);\n",
      {
        name: "",
        registerCount: 3,
        instructions: ["0 E> CreateClosure [0], [0], #2","Star0","62 S> LdaSmi [1]","Star2","62 E> CallUndefinedReceiver1 r0, r2, [0]","LdaUndefined","67 S> Return"],
        constantPool: ["<SharedFunctionInfo a>"],
        children: [
          {
            at: 0,
            name: "a",
            registerCount: 7,
            instructions: ["16 E> CreateFunctionContext [0], [1]","PushContext r2","Mov <closure>, r3","Mov <this>, r4","InvokeIntrinsic [_AsyncFunctionEnter], r3-r4","Star1","LdaTheHole","StaCurrentContextSlot [2]","Mov <context>, r3","Mov a0, r0","Ldar a1","JumpIfNotUndefined [6] (@33)","Ldar r0","Jump [4] (@35)","Ldar a1","24 E> StaCurrentContextSlot [2]","CreateBlockContext [1]","PushContext r4","37 S> LdaSmi [1]","37 E> StaCurrentContextSlot [2]","40 S> CreateClosure [2], [0], #2","Star6","Mov r1, r5","InvokeIntrinsic [_AsyncFunctionResolve], r5-r6","59 S> Return","Star5","LdaTheHole","SetPendingMessage","Mov r1, r4","InvokeIntrinsic [_AsyncFunctionReject], r4-r5","Return"],
            constantPool: ["<ScopeInfo FUNCTION_SCOPE>","<ScopeInfo BLOCK_SCOPE>","<SharedFunctionInfo>"],
            children: [],
          },
        ],
      },
    );
  });

  it("delete of a declared name is false, of a global goes to DeleteLookupSlot, of a literal is true", () => {
    expectListing(
      "var v = 1;\nG = 2;\nfunction h(p) {\n  var l = 1;\n  var r1 = delete l;\n  var r2 = delete p;\n  var r3 = delete v;\n  var r4 = delete G;\n  var r5 = delete 1;\n  return r1;\n}\nh();\n",
      {
        name: "",
        registerCount: 2,
        instructions: ["0 E> CreateFunctionContext [0], [1]","PushContext r1","CreateClosure [1], [0], #2","Star0","8 S> LdaSmi [1]","8 E> StaCurrentContextSlot [2]","11 S> LdaSmi [2]","13 E> StaGlobal [2], [0]","167 S> CallUndefinedReceiver0 r0, [2]","LdaUndefined","171 S> Return"],
        constantPool: ["<ScopeInfo FUNCTION_SCOPE>","<SharedFunctionInfo h>","<String[1]: #G>"],
        children: [
          {
            at: 1,
            name: "h",
            registerCount: 7,
            instructions: ["44 S> LdaSmi [1]","Star0","58 S> LdaFalse","Star1","79 S> LdaFalse","Star2","100 S> LdaFalse","Star3","121 S> LdaConstant [0]","Star6","CallRuntime [DeleteLookupSlot], r6-r6","Star4","142 S> LdaTrue","Star5","154 S> Ldar r1","164 S> Return"],
            constantPool: ["<String[1]: #G>"],
            children: [],
          },
        ],
      },
    );
  });

  it("a body var a closure captures gets a block context of its own, after the parameter initializers", () => {
    expectListing(
      "function f(_ = null) {\n  var x = 'inside';\n  return function () { return x; };\n}\nf();\n",
      {
        name: "",
        registerCount: 1,
        instructions: ["0 E> CreateClosure [0], [0], #2","Star0","81 S> CallUndefinedReceiver0 r0, [0]","LdaUndefined","85 S> Return"],
        constantPool: ["<SharedFunctionInfo f>"],
        children: [
          {
            at: 0,
            name: "f",
            registerCount: 2,
            instructions: ["Ldar a0","JumpIfNotUndefined [5] (@7)","LdaNull","Jump [4] (@9)","Ldar a0","Star0","10 E> CreateBlockContext [0]","PushContext r1","33 S> LdaConstant [1]","33 E> StaCurrentContextSlot [2]","45 S> CreateClosure [2], [0], #2","78 S> Return"],
            constantPool: ["<ScopeInfo BLOCK_SCOPE>","<String[6]: #inside>","<SharedFunctionInfo>"],
            children: [],
          },
        ],
      },
    );
  });

  it("a body var named like a parameter starts out as the parameter's value, the last declared first", () => {
    expectListing(
      "function g(a, b = 1) { var a; var c = a; var b; return c + b; }\ng(1);\n",
      {
        name: "",
        registerCount: 3,
        instructions: ["0 E> CreateClosure [0], [0], #2","Star0","64 S> LdaSmi [1]","Star2","64 E> CallUndefinedReceiver1 r0, r2, [0]","LdaUndefined","69 S> Return"],
        constantPool: ["<SharedFunctionInfo g>"],
        children: [
          {
            at: 0,
            name: "g",
            registerCount: 5,
            instructions: ["Mov a0, r0","Ldar a1","JumpIfNotUndefined [6] (@11)","LdaSmi [1]","Jump [4] (@13)","Ldar a1","Star1","Star4","Mov r0, r2","38 S> Mov r2, r3","48 S> Ldar r1","57 E> Add r3, [0]","61 S> Return"],
            constantPool: [],
            children: [],
          },
        ],
      },
    );
  });
});
