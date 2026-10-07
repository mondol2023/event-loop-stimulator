import { describe, expect, it } from "vitest";
import { BytecodeArrayBuilder } from "@/core/bytecode/BytecodeArrayBuilder";
import { type BytecodeFunction, finishFunction } from "@/core/bytecode/BytecodeProgram";
import { argument, local } from "@/core/bytecode/bytecodes";
import { asFunctionId } from "@/core/shared/ids";
import type { RealFunctionBytecode } from "../../scripts/conformance/expectation.mts";
import { compareBytecode } from "./support/compareBytecode";

// `function add(a, b) { let x = a + 1; return x + b }` as V8 prints it.
const REAL_ADD: RealFunctionBytecode = {
  name: "add",
  header: { length: 12, parameterCount: 3, registerCount: 1, frameSize: 8 },
  instructions: [
    { offset: 0, position: { at: 35, kind: "S" }, text: "Ldar a0" },
    { offset: 2, position: { at: 44, kind: "E" }, text: "AddSmi [1], [0]" },
    { offset: 5, text: "Star0" },
    { offset: 6, position: { at: 51, kind: "S" }, text: "Ldar a1" },
    { offset: 8, position: { at: 56, kind: "E" }, text: "Add r0, [1]" },
    { offset: 11, position: { at: 59, kind: "S" }, text: "Return" },
  ],
  constantPool: [],
  handlerTable: [],
  children: {},
};

function ours(change: (b: BytecodeArrayBuilder) => void): BytecodeFunction {
  const b = new BytecodeArrayBuilder({ parameterCount: 3 });
  b.allocateRegister();
  change(b);
  return finishFunction(b, { id: asFunctionId(1), name: "add" });
}

function assembleAdd(b: BytecodeArrayBuilder, options: { addSmi?: number; extra?: boolean } = {}): void {
  b.setStatementPosition(35);
  b.emit("Ldar", argument(0));
  b.setExpressionPosition(44);
  b.emit("AddSmi", options.addSmi ?? 1, b.feedback.addSlot("binary-op"));
  b.emit("Star0");
  if (options.extra) b.emit("Star1");
  b.setStatementPosition(51);
  b.emit("Ldar", argument(1));
  b.setExpressionPosition(56);
  b.emit("Add", local(0), b.feedback.addSlot("binary-op"));
  b.setStatementPosition(59);
  b.emit("Return");
}

describe("compareBytecode", () => {
  it("accepts an identical function at both levels", () => {
    expect(compareBytecode(ours((b) => assembleAdd(b)), REAL_ADD)).toEqual({ opcodes: true, exact: true, diffs: [] });
  });

  it("reports an operand difference as opcodes-equal but not exact, naming the offset and both texts", () => {
    const result = compareBytecode(ours((b) => assembleAdd(b, { addSmi: 2 })), REAL_ADD);
    expect(result.opcodes).toBe(true);
    expect(result.exact).toBe(false);
    expect(result.diffs).toEqual(["offset 2: ours `AddSmi [2], [0]`, V8 `AddSmi [1], [0]`"]);
  });

  it("reports an extra opcode as an opcode difference", () => {
    const result = compareBytecode(ours((b) => assembleAdd(b, { extra: true })), REAL_ADD);
    expect(result.opcodes).toBe(false);
    expect(result.exact).toBe(false);
    expect(result.diffs.length).toBeGreaterThan(0);
  });

  it("reports a missing opcode as an opcode difference", () => {
    const result = compareBytecode(
      ours((b) => {
        b.emit("Return");
      }),
      REAL_ADD,
    );
    expect(result.opcodes).toBe(false);
    expect(result.diffs).toContain("offset 0: ours `Return`, V8 `Ldar a0`");
    expect(result.diffs).toContain("offset 11: V8 has `Return`, ours ends");
  });

  it("compares opcodes without their Wide prefix", () => {
    const real: RealFunctionBytecode = {
      ...REAL_ADD,
      header: { ...REAL_ADD.header, length: 4 },
      instructions: [{ offset: 0, text: "LdaSmi [3]" }],
    };
    const result = compareBytecode(ours((b) => b.emit("LdaSmi", 300)), real);
    expect(result.opcodes).toBe(true);
    expect(result.exact).toBe(false);
  });

  it("compares source positions", () => {
    const moved: RealFunctionBytecode = {
      ...REAL_ADD,
      instructions: REAL_ADD.instructions.map((i) => (i.offset === 2 ? { ...i, position: { at: 44, kind: "S" as const } } : i)),
    };
    const result = compareBytecode(ours((b) => assembleAdd(b)), moved);
    expect(result.opcodes).toBe(true);
    expect(result.exact).toBe(false);
    expect(result.diffs).toEqual(["offset 2: position ours E>44, V8 S>44"]);
  });

  it("compares the header, name, constant pool and handler table", () => {
    const real: RealFunctionBytecode = {
      ...REAL_ADD,
      name: "plus",
      header: { length: 12, parameterCount: 2, registerCount: 1, frameSize: 8 },
      constantPool: ["<String[1]: #x>"],
      handlerTable: ["(3, 14) -> 14 (prediction=1, data=0)"],
    };
    const result = compareBytecode(ours((b) => assembleAdd(b)), real);
    expect(result.opcodes).toBe(true);
    expect(result.exact).toBe(false);
    expect(result.diffs).toEqual([
      "name: ours `add`, V8 `plus`",
      "header.parameterCount: ours 3, V8 2",
      "constant pool[0]: ours is missing, V8 `<String[1]: #x>`",
      "handler table[0]: ours is missing, V8 `(3, 14) -> 14 (prediction=1, data=0)`",
    ]);
  });
});
