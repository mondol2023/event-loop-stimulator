import { describe, expect, it } from "vitest";
import { parseScript } from "@/core/frontend/parse";
import { analyzeScopes } from "@/core/frontend/scope/ScopeAnalyzer";
import { generateBytecode } from "./BytecodeGenerator";
import { type BytecodeFunction, toPrintable } from "./BytecodeProgram";
import { printBytecodeArray } from "./printer";

// Async functions: the generator machinery V8 compiles them to (SwitchOnGeneratorState, the
// _AsyncFunction* intrinsics, SuspendGenerator and ResumeGenerator, a catch-all handler that
// rejects the promise). Every expected listing is what the pinned Node (V8 13.6) prints for the
// same source (`node --print-bytecode`, read through scripts/conformance/bytecode-capture.mts),
// never written by hand. Positions read `offset S> text`.

function compile(source: string): readonly BytecodeFunction[] {
  const parsed = parseScript(source);
  if (!parsed.ok) throw new Error(`test source does not parse: ${parsed.error[0]?.message}`);
  const result = generateBytecode(parsed.value, analyzeScopes(parsed.value));
  if (!result.ok) throw new Error(`not compiled: ${result.error[0]?.message}`);
  return result.value.functions;
}

/** The first function the script creates: its listing, constant pool, handler table and register count. */
function child(source: string): { instructions: string[]; constantPool: string[]; handlerTable: string[]; registerCount: number } {
  const functions = compile(source);
  const fn = functions[1];
  if (!fn) throw new Error("the script creates no function");
  const printed = printBytecodeArray(toPrintable(fn));
  return {
    instructions: printed.instructions.map((i) => (i.position ? `${i.position.at} ${i.position.kind}> ${i.text}` : i.text)),
    constantPool: [...printed.constantPool],
    handlerTable: [...printed.handlerTable],
    registerCount: fn.registerCount,
  };
}

describe("async functions", () => {

  it("returns its parameter without suspending: no jump table, the whole body under one handler", () => {
    const { instructions, constantPool, handlerTable, registerCount } = child("async function f(a) { return a; }\nf(1);\n");
    expect(instructions).toEqual([
      "Mov <closure>, r1",
      "Mov <this>, r2",
      "16 E> InvokeIntrinsic [_AsyncFunctionEnter], r1-r2",
      "Star0",
      "Mov <context>, r1",
      "22 S> Mov r0, r2",
      "Mov a0, r3",
      "InvokeIntrinsic [_AsyncFunctionResolve], r2-r3",
      "31 S> Return",
      "Star3",
      "LdaTheHole",
      "SetPendingMessage",
      "Mov r0, r2",
      "InvokeIntrinsic [_AsyncFunctionReject], r2-r3",
      "Return",
    ]);
    expect(constantPool).toEqual([]);
    expect(handlerTable).toEqual(["(14, 25) -> 25 (prediction=3, data=1)"]);
    expect(registerCount).toBe(4);
  });

  it("falls off the end with an implicit return undefined, positioned at the closing brace", () => {
    const { instructions, constantPool, handlerTable, registerCount } = child("async function f() { }\nf();\n");
    expect(instructions).toEqual([
      "Mov <closure>, r1",
      "Mov <this>, r2",
      "16 E> InvokeIntrinsic [_AsyncFunctionEnter], r1-r2",
      "Star0",
      "Mov <context>, r1",
      "LdaUndefined",
      "Star3",
      "Mov r0, r2",
      "InvokeIntrinsic [_AsyncFunctionResolve], r2-r3",
      "21 S> Return",
      "Star3",
      "LdaTheHole",
      "SetPendingMessage",
      "Mov r0, r2",
      "InvokeIntrinsic [_AsyncFunctionReject], r2-r3",
      "Return",
    ]);
    expect(constantPool).toEqual([]);
    expect(handlerTable).toEqual(["(14, 24) -> 24 (prediction=3, data=1)"]);
    expect(registerCount).toBe(4);
  });

  it("suspends at an await: jump table, suspend and resume, and a resume-mode check that rethrows", () => {
    const { instructions, constantPool, handlerTable, registerCount } = child("async function f(a) { const x = await a; return x; }\nf(1);\n");
    expect(instructions).toEqual([
      "SwitchOnGeneratorState r0, [0], [1] { 0: @33 }",
      "Mov <closure>, r2",
      "Mov <this>, r3",
      "16 E> InvokeIntrinsic [_AsyncFunctionEnter], r2-r3",
      "Star0",
      "Mov <context>, r2",
      "32 S> Mov r0, r3",
      "Mov a0, r4",
      "InvokeIntrinsic [_AsyncFunctionAwait], r3-r4",
      "32 E> SuspendGenerator r0, r0-r2, [0]",
      "ResumeGenerator r0, r0-r2",
      "Star3",
      "InvokeIntrinsic [_GeneratorGetResumeMode], r0-r0",
      "Star4",
      "LdaZero",
      "TestReferenceEqual r4",
      "JumpIfTrue [5] (@51)",
      "Ldar r3",
      "ReThrow",
      "Mov r3, r1",
      "41 S> Mov r0, r3",
      "Mov r1, r4",
      "InvokeIntrinsic [_AsyncFunctionResolve], r3-r4",
      "50 S> Return",
      "Star4",
      "LdaTheHole",
      "SetPendingMessage",
      "Mov r0, r3",
      "InvokeIntrinsic [_AsyncFunctionReject], r3-r4",
      "Return",
    ]);
    expect(constantPool).toEqual(["33"]);
    expect(handlerTable).toEqual(["(18, 65) -> 65 (prediction=3, data=2)"]);
    expect(registerCount).toBe(5);
  });

  it("keeps a call's callee and first argument live across the second await", () => {
    const { instructions, constantPool, handlerTable, registerCount } = child("async function f(g, y) { g(await 1, await y); const z = 1 + await y; }\nf();\n");
    expect(instructions).toEqual([
      "SwitchOnGeneratorState r0, [0], [3] { 0: @36, 1: @69, 2: @110 }",
      "Mov <closure>, r2",
      "Mov <this>, r3",
      "16 E> InvokeIntrinsic [_AsyncFunctionEnter], r2-r3",
      "Star0",
      "Mov <context>, r2",
      "25 S> LdaSmi [1]",
      "Star5",
      "Mov r0, r4",
      "27 E> InvokeIntrinsic [_AsyncFunctionAwait], r4-r5",
      "Mov a0, r3",
      "27 E> SuspendGenerator r0, r0-r3, [0]",
      "ResumeGenerator r0, r0-r3",
      "Star4",
      "InvokeIntrinsic [_GeneratorGetResumeMode], r0-r0",
      "Star5",
      "LdaZero",
      "TestReferenceEqual r5",
      "JumpIfTrue [5] (@54)",
      "Ldar r4",
      "ReThrow",
      "Mov r0, r5",
      "Mov a1, r6",
      "42 E> InvokeIntrinsic [_AsyncFunctionAwait], r5-r6",
      "36 E> SuspendGenerator r0, r0-r4, [1]",
      "ResumeGenerator r0, r0-r4",
      "Star5",
      "InvokeIntrinsic [_GeneratorGetResumeMode], r0-r0",
      "Star6",
      "LdaZero",
      "TestReferenceEqual r6",
      "JumpIfTrue [5] (@87)",
      "Ldar r5",
      "ReThrow",
      "25 E> CallUndefinedReceiver2 r3, r4, r5, [0]",
      "56 S> LdaSmi [1]",
      "Star3",
      "Mov r0, r4",
      "Mov a1, r5",
      "66 E> InvokeIntrinsic [_AsyncFunctionAwait], r4-r5",
      "60 E> SuspendGenerator r0, r0-r3, [2]",
      "ResumeGenerator r0, r0-r3",
      "Star4",
      "InvokeIntrinsic [_GeneratorGetResumeMode], r0-r0",
      "Star5",
      "LdaZero",
      "TestReferenceEqual r5",
      "JumpIfTrue [5] (@128)",
      "Ldar r4",
      "ReThrow",
      "Ldar r4",
      "58 E> Add r3, [2]",
      "Star1",
      "LdaUndefined",
      "Star4",
      "Mov r0, r3",
      "56 E> InvokeIntrinsic [_AsyncFunctionResolve], r3-r4",
      "69 S> Return",
      "Star4",
      "LdaTheHole",
      "SetPendingMessage",
      "Mov r0, r3",
      "InvokeIntrinsic [_AsyncFunctionReject], r3-r4",
      "Return",
    ]);
    expect(constantPool).toEqual(["36","69","110"]);
    expect(handlerTable).toEqual(["(18, 144) -> 144 (prediction=3, data=2)"]);
    expect(registerCount).toBe(7);
  });

  it("creates the function context before the generator object and declares holes before the handler range", () => {
    const { instructions, constantPool, handlerTable, registerCount } = child("async function f(p) { let a = 1; await p; return () => a + p; }\nf();\n");
    expect(instructions).toEqual([
      "SwitchOnGeneratorState r0, [0], [1] { 0: @49 }",
      "16 E> CreateFunctionContext [1], [2]",
      "PushContext r1",
      "Ldar a0",
      "StaCurrentContextSlot [2]",
      "Mov <closure>, r2",
      "Mov <this>, r3",
      "InvokeIntrinsic [_AsyncFunctionEnter], r2-r3",
      "Star0",
      "LdaTheHole",
      "StaCurrentContextSlot [3]",
      "Mov <context>, r2",
      "30 S> LdaSmi [1]",
      "30 E> StaCurrentContextSlot [3]",
      "33 S> LdaImmutableCurrentContextSlot [2]",
      "Star4",
      "Mov r0, r3",
      "InvokeIntrinsic [_AsyncFunctionAwait], r3-r4",
      "33 E> SuspendGenerator r0, r0-r2, [0]",
      "ResumeGenerator r0, r0-r2",
      "Star3",
      "InvokeIntrinsic [_GeneratorGetResumeMode], r0-r0",
      "Star4",
      "LdaZero",
      "TestReferenceEqual r4",
      "JumpIfTrue [5] (@67)",
      "Ldar r3",
      "ReThrow",
      "42 S> CreateClosure [2], [0], #2",
      "Star4",
      "Mov r0, r3",
      "InvokeIntrinsic [_AsyncFunctionResolve], r3-r4",
      "61 S> Return",
      "Star4",
      "LdaTheHole",
      "SetPendingMessage",
      "Mov r0, r3",
      "InvokeIntrinsic [_AsyncFunctionReject], r3-r4",
      "Return",
    ]);
    expect(constantPool).toEqual(["49","<ScopeInfo FUNCTION_SCOPE>","<SharedFunctionInfo>"]);
    expect(handlerTable).toEqual(["(30, 80) -> 80 (prediction=3, data=2)"]);
    expect(registerCount).toBe(5);
  });

  it("predicts try/catch/finally in an async function as caught, with the finally outermost", () => {
    const { instructions, constantPool, handlerTable, registerCount } = child("async function f(p) { try { await p; } catch (e) { p(e); } finally { p(); } return await p; }\nf();\n");
    expect(instructions).toEqual([
      "SwitchOnGeneratorState r0, [0], [2] { 0: @41, 1: @124 }",
      "Mov <closure>, r1",
      "Mov <this>, r2",
      "16 E> InvokeIntrinsic [_AsyncFunctionEnter], r1-r2",
      "Star0",
      "Mov <context>, r1",
      "LdaTheHole",
      "Star4",
      "Mov <context>, r5",
      "Mov <context>, r6",
      "28 S> Mov r0, r7",
      "Mov a0, r8",
      "InvokeIntrinsic [_AsyncFunctionAwait], r7-r8",
      "28 E> SuspendGenerator r0, r0-r6, [0]",
      "ResumeGenerator r0, r0-r6",
      "Star7",
      "InvokeIntrinsic [_GeneratorGetResumeMode], r0-r0",
      "Star8",
      "LdaZero",
      "TestReferenceEqual r8",
      "JumpIfTrue [5] (@59)",
      "Ldar r7",
      "ReThrow",
      "Ldar r7",
      "Jump [22] (@83)",
      "Star7",
      "CreateCatchContext r7, [2]",
      "Star6",
      "LdaTheHole",
      "SetPendingMessage",
      "Ldar r6",
      "PushContext r7",
      "51 S> LdaImmutableCurrentContextSlot [2]",
      "Star9",
      "51 E> CallUndefinedReceiver1 a0, r9, [0]",
      "PopContext r7",
      "LdaSmi [-1]",
      "Star3",
      "Star2",
      "Jump [8] (@95)",
      "Star3",
      "LdaZero",
      "Star2",
      "LdaTheHole",
      "SetPendingMessage",
      "Star4",
      "69 S> CallUndefinedReceiver0 a0, [2]",
      "LdaZero",
      "TestReferenceEqual r2",
      "JumpIfFalse [8] (@109)",
      "Ldar r4",
      "SetPendingMessage",
      "Ldar r3",
      "ReThrow",
      "76 S> Mov r0, r2",
      "Mov a0, r3",
      "InvokeIntrinsic [_AsyncFunctionAwait], r2-r3",
      "83 E> SuspendGenerator r0, r0-r1, [1]",
      "ResumeGenerator r0, r0-r1",
      "Star2",
      "InvokeIntrinsic [_GeneratorGetResumeMode], r0-r0",
      "Star3",
      "LdaZero",
      "TestReferenceEqual r3",
      "JumpIfTrue [5] (@142)",
      "Ldar r2",
      "ReThrow",
      "Ldar r2",
      "Star3",
      "Mov r0, r2",
      "InvokeIntrinsic [_AsyncFunctionResolve], r2-r3",
      "91 S> Return",
      "Star3",
      "LdaTheHole",
      "SetPendingMessage",
      "Mov r0, r2",
      "InvokeIntrinsic [_AsyncFunctionReject], r2-r3",
      "Return",
    ]);
    expect(constantPool).toEqual(["41","124","<ScopeInfo CATCH_SCOPE>"]);
    expect(handlerTable).toEqual(["(18, 153) -> 153 (prediction=3, data=1)","(23, 83) -> 89 (prediction=3, data=5)","(26, 59) -> 63 (prediction=1, data=6)"]);
    expect(registerCount).toBe(10);
  });

  it("compiles an async arrow with an expression body as a return of that expression", () => {
    const { instructions, constantPool, handlerTable, registerCount } = child("const g = async (x) => (await x) + 1;\ng(1);\n");
    expect(instructions).toEqual([
      "SwitchOnGeneratorState r0, [0], [1] { 0: @33 }",
      "Mov <closure>, r1",
      "Mov <this>, r2",
      "10 E> InvokeIntrinsic [_AsyncFunctionEnter], r1-r2",
      "Star0",
      "Mov <context>, r1",
      "33 S> Mov r0, r2",
      "Mov a0, r3",
      "InvokeIntrinsic [_AsyncFunctionAwait], r2-r3",
      "24 E> SuspendGenerator r0, r0-r1, [0]",
      "ResumeGenerator r0, r0-r1",
      "Star2",
      "InvokeIntrinsic [_GeneratorGetResumeMode], r0-r0",
      "Star3",
      "LdaZero",
      "TestReferenceEqual r3",
      "JumpIfTrue [5] (@51)",
      "Ldar r2",
      "ReThrow",
      "Ldar r2",
      "33 E> AddSmi [1], [0]",
      "Star3",
      "Mov r0, r2",
      "InvokeIntrinsic [_AsyncFunctionResolve], r2-r3",
      "36 S> Return",
      "Star3",
      "LdaTheHole",
      "SetPendingMessage",
      "Mov r0, r2",
      "InvokeIntrinsic [_AsyncFunctionReject], r2-r3",
      "Return",
    ]);
    expect(constantPool).toEqual(["33"]);
    expect(handlerTable).toEqual(["(18, 65) -> 65 (prediction=3, data=1)"]);
    expect(registerCount).toBe(4);
  });

  it("positions the closure of an async method at its `async` keyword, not at its name", () => {
    const wrapper = compile("const o = { async m(p) { await p; } };\no.m(1);\n")[0];
    if (!wrapper) throw new Error("no wrapper");
    const printed = printBytecodeArray(toPrintable(wrapper));
    const texts = printed.instructions.map((i) => (i.position ? `${i.position.at} ${i.position.kind}> ${i.text}` : i.text));
    expect(texts.slice(0, 4)).toEqual([
      "10 S> CreateObjectLiteral [0], [0], #41",
      "Star1",
      "12 E> CreateClosure [1], [0], #2",
      "DefineNamedOwnProperty r1, [2], [1]",
    ]);
  });

  it("compiles an anonymous async arrow with a block body", () => {
    const { instructions, constantPool, handlerTable, registerCount } = child("(async () => { await null; })();\n");
    expect(instructions).toEqual([
      "SwitchOnGeneratorState r0, [0], [1] { 0: @32 }",
      "Mov <closure>, r1",
      "Mov <this>, r2",
      "1 E> InvokeIntrinsic [_AsyncFunctionEnter], r1-r2",
      "Star0",
      "Mov <context>, r1",
      "15 S> LdaNull",
      "Star3",
      "Mov r0, r2",
      "InvokeIntrinsic [_AsyncFunctionAwait], r2-r3",
      "15 E> SuspendGenerator r0, r0-r1, [0]",
      "ResumeGenerator r0, r0-r1",
      "Star2",
      "InvokeIntrinsic [_GeneratorGetResumeMode], r0-r0",
      "Star3",
      "LdaZero",
      "TestReferenceEqual r3",
      "JumpIfTrue [5] (@50)",
      "Ldar r2",
      "ReThrow",
      "LdaUndefined",
      "Star3",
      "Mov r0, r2",
      "InvokeIntrinsic [_AsyncFunctionResolve], r2-r3",
      "27 S> Return",
      "Star3",
      "LdaTheHole",
      "SetPendingMessage",
      "Mov r0, r2",
      "InvokeIntrinsic [_AsyncFunctionReject], r2-r3",
      "Return",
    ]);
    expect(constantPool).toEqual(["32"]);
    expect(handlerTable).toEqual(["(18, 60) -> 60 (prediction=3, data=1)"]);
    expect(registerCount).toBe(4);
  });
});
