import { describe, expect, it } from "vitest";
import { BytecodeArrayBuilder } from "./BytecodeArrayBuilder";
import { CLOSURE, CURRENT_CONTEXT, THIS, argument, local } from "./bytecodes";
import { ConstantPool } from "./ConstantPool";
import { formatInstruction, formatListing, printBytecodeArray } from "./printer";
import { asFunctionId } from "@/core/shared/ids";

function textOf(configure: (b: BytecodeArrayBuilder) => void): string {
  const b = new BytecodeArrayBuilder({ parameterCount: 3 });
  configure(b);
  const [only] = b.build().array.instructions;
  if (!only) throw new Error("no instruction emitted");
  return formatInstruction(only);
}

describe("formatInstruction", () => {
  // Each expected text below occurs in a recorded `*.expected.json`.
  it.each([
    ["Ldar a0", (b: BytecodeArrayBuilder) => b.emit("Ldar", argument(0))],
    ["Ldar <this>", (b: BytecodeArrayBuilder) => b.emit("Ldar", THIS)],
    ["Mov <context>, r0", (b: BytecodeArrayBuilder) => b.emit("Mov", CURRENT_CONTEXT, local(0))],
    ["Mov a0, r0", (b: BytecodeArrayBuilder) => b.emit("Mov", argument(0), local(0))],
    ["Star r17", (b: BytecodeArrayBuilder) => b.emit("Star", local(17))],
    ["Star13", (b: BytecodeArrayBuilder) => b.emit("Star13")],
    ["LdaConstant [7]", (b: BytecodeArrayBuilder) => b.emit("LdaConstant", 7)],
    ["LdaSmi [100]", (b: BytecodeArrayBuilder) => b.emit("LdaSmi", 100)],
    ["LdaGlobal [5], [4]", (b: BytecodeArrayBuilder) => b.emit("LdaGlobal", 5, 4)],
    ["GetNamedProperty r12, [6], [6]", (b: BytecodeArrayBuilder) => b.emit("GetNamedProperty", local(12), 6, 6)],
    ["CreateClosure [13], [0], #2", (b: BytecodeArrayBuilder) => b.emit("CreateClosure", 13, 0, 2)],
    ["CreateObjectLiteral [7], [0], #41", (b: BytecodeArrayBuilder) => b.emit("CreateObjectLiteral", 7, 0, 41)],
    ["CallUndefinedReceiver1 r0, r12, [0]", (b: BytecodeArrayBuilder) => b.emit("CallUndefinedReceiver1", local(0), local(12), 0)],
    ["CallUndefinedReceiver0 r11, [72]", (b: BytecodeArrayBuilder) => b.emit("CallUndefinedReceiver0", local(11), 72)],
    ["CallProperty r4, r5-r8, [63]", (b: BytecodeArrayBuilder) => b.emit("CallProperty", local(4), local(5), 4, 63)],
    ["CallProperty0 r13, r1, [10]", (b: BytecodeArrayBuilder) => b.emit("CallProperty0", local(13), local(1), 10)],
    ["CallUndefinedReceiver r8, r15-r17, [94]", (b: BytecodeArrayBuilder) => b.emit("CallUndefinedReceiver", local(8), local(15), 3, 94)],
    ["Construct r9, r10-r10, [14]", (b: BytecodeArrayBuilder) => b.emit("Construct", local(9), local(10), 1, 14)],
    ["CallRuntime [ThrowConstAssignError], r0-r0", (b: BytecodeArrayBuilder) => b.emit("CallRuntime", "ThrowConstAssignError", local(0), 1)],
    ["CallRuntime [DefineClass], r5-r10", (b: BytecodeArrayBuilder) => b.emit("CallRuntime", "DefineClass", local(5), 6)],
    ["InvokeIntrinsic [_AsyncFunctionEnter], r1-r2", (b: BytecodeArrayBuilder) => b.emit("InvokeIntrinsic", "_AsyncFunctionEnter", local(1), 2)],
    ["SuspendGenerator r0, r0-r1, [0]", (b: BytecodeArrayBuilder) => b.emit("SuspendGenerator", local(0), local(0), 2, 0)],
    ["ResumeGenerator r0, r0-r1", (b: BytecodeArrayBuilder) => b.emit("ResumeGenerator", local(0), local(0), 2)],
    ["DefineKeyedOwnProperty <this>, r1, #0, [0]", (b: BytecodeArrayBuilder) => b.emit("DefineKeyedOwnProperty", THIS, local(1), 0, 0)],
    ["LdaImmutableContextSlot <context>, [5], [1]", (b: BytecodeArrayBuilder) => b.emit("LdaImmutableContextSlot", CURRENT_CONTEXT, 5, 1)],
    ["LdaCurrentContextSlot [3]", (b: BytecodeArrayBuilder) => b.emit("LdaCurrentContextSlot", 3)],
    ["CreateFunctionContext [0], [3]", (b: BytecodeArrayBuilder) => b.emit("CreateFunctionContext", 0, 3)],
    ["TestTypeOf #7", (b: BytecodeArrayBuilder) => b.emit("TestTypeOf", 7)],
    ["Mov <closure>, r2", (b: BytecodeArrayBuilder) => b.emit("Mov", CLOSURE, local(2))],
    ["Return", (b: BytecodeArrayBuilder) => b.emit("Return")],
  ])("prints %s", (expected, configure) => {
    expect(textOf(configure)).toBe(expected);
  });
});

describe("printBytecodeArray", () => {
  // The `inner` function of the closure-counter fixture, copied from its expected.json:
  //   function inner(x) { return x * 2; }
  it("reproduces the recorded bytecode of a small function", () => {
    const b = new BytecodeArrayBuilder({ parameterCount: 2 });
    b.setStatementPosition(1407);
    b.emit("Ldar", argument(0));
    b.setExpressionPosition(1416);
    b.emit("MulSmi", 2, b.feedback.addSlot("binary-op"));
    b.setStatementPosition(1420);
    b.emit("Return");
    const built = b.build();
    expect(
      printBytecodeArray({
        name: "inner",
        array: built.array,
        header: built.header,
        positions: built.positions,
        constantPool: b.constantPool,
        handlerTable: [],
      }),
    ).toEqual({
      name: "inner",
      header: { length: 6, parameterCount: 2, registerCount: 0, frameSize: 0 },
      instructions: [
        { offset: 0, position: { at: 1407, kind: "S" }, text: "Ldar a0" },
        { offset: 2, position: { at: 1416, kind: "E" }, text: "MulSmi [2], [0]" },
        { offset: 5, position: { at: 1420, kind: "S" }, text: "Return" },
      ],
      constantPool: [],
      handlerTable: [],
      children: {},
    });
  });

  it("prints the constant pool in the normalized form", () => {
    const b = new BytecodeArrayBuilder({ parameterCount: 1 });
    const pool = b.constantPool;
    pool.add({ kind: "scope-info", scope: "FUNCTION_SCOPE" });
    pool.add({ kind: "sfi", name: "inc", functionId: asFunctionId(2) });
    pool.add({ kind: "string", value: "count" });
    b.emit("Return");
    const built = b.build();
    const printed = printBytecodeArray({
      name: "makeCounter",
      array: built.array,
      header: built.header,
      positions: built.positions,
      constantPool: pool,
      handlerTable: ["(3, 14) -> 14 (prediction=1, data=0)"],
    });
    expect(printed.constantPool).toEqual(["<ScopeInfo FUNCTION_SCOPE>", "<SharedFunctionInfo inc>", "<String[5]: #count>"]);
    expect(printed.handlerTable).toEqual(["(3, 14) -> 14 (prediction=1, data=0)"]);
  });
});

describe("formatListing", () => {
  it("lays out the header, one line per instruction and the pools", () => {
    const b = new BytecodeArrayBuilder({ parameterCount: 3 });
    b.allocateRegister();
    b.setStatementPosition(35);
    b.emit("Ldar", argument(0));
    b.setExpressionPosition(44);
    b.emit("AddSmi", 1, b.feedback.addSlot("binary-op"));
    b.emit("Star0");
    b.emit("Return");
    b.constantPool.add({ kind: "string", value: "x" });
    const built = b.build();
    expect(
      formatListing({
        name: "add",
        array: built.array,
        header: built.header,
        positions: built.positions,
        constantPool: b.constantPool,
        handlerTable: [],
      }),
    ).toEqual([
      "[bytecode for function: add]",
      "Bytecode length: 7",
      "Parameter count 3",
      "Register count 1",
      "Frame size 8",
      "   35 S> @    0 : Ldar a0",
      "   44 E> @    2 : AddSmi [1], [0]",
      "         @    5 : Star0",
      "         @    6 : Return",
      "Constant pool (size = 1)",
      "           0: <String[1]: #x>",
      "Handler Table (size = 0)",
    ]);
  });
});

describe("ConstantPool printing is shared with the printer", () => {
  it("prints an empty pool as an empty list", () => {
    expect(new ConstantPool().printEntries()).toEqual([]);
  });
});
