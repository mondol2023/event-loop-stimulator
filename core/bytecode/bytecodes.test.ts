import { describe, expect, it } from "vitest";
import {
  BYTECODES,
  BYTECODE_COUNT,
  bytecodeInfo,
  CURRENT_CONTEXT,
  CLOSURE,
  THIS,
  argument,
  formatRegister,
  isJump,
  isWithoutExternalSideEffects,
  local,
  operandSizes,
  requiredScale,
  type Opcode,
} from "./bytecodes";

describe("BYTECODES", () => {
  it("has one entry per opcode of the pinned bytecodes.h", () => {
    expect(Object.keys(BYTECODES)).toHaveLength(BYTECODE_COUNT);
  });

  it("describes the operands the recorded listings show", () => {
    expect(BYTECODES.CreateClosure.operands).toEqual(["Idx", "Idx", "Flag8"]);
    expect(BYTECODES.CallProperty.operands).toEqual(["Reg", "RegList", "RegCount", "Idx"]);
    expect(BYTECODES.JumpLoop.operands).toEqual(["UImm", "Imm", "Idx"]);
    expect(BYTECODES.Return.operands).toEqual([]);
  });

  it("knows which opcodes read and write the accumulator", () => {
    expect(BYTECODES.Ldar.accumulator).toBe("write");
    expect(BYTECODES.Star.accumulator).toBe("read");
    expect(BYTECODES.Add.accumulator).toBe("readwrite");
    expect(BYTECODES.Mov.accumulator).toBe("none");
  });

  it("marks the sixteen short Star forms", () => {
    const short = (Object.keys(BYTECODES) as Opcode[]).filter((name) => bytecodeInfo(name).shortStar === true);
    expect(short).toHaveLength(16);
    expect(short).toContain("Star0");
    expect(short).toContain("Star15");
    expect(BYTECODES.Star.operands).toEqual(["RegOut"]);
  });
});

describe("operandSizes", () => {
  it("sizes scalable operands by the operand scale", () => {
    expect(operandSizes("LdaSmi", 1)).toEqual([1]);
    expect(operandSizes("LdaSmi", 2)).toEqual([2]);
    expect(operandSizes("LdaSmi", 4)).toEqual([4]);
    expect(operandSizes("JumpLoop", 2)).toEqual([2, 2, 2]);
  });

  it("keeps fixed-width operands at their own width under every scale", () => {
    expect(operandSizes("CreateClosure", 1)).toEqual([1, 1, 1]);
    expect(operandSizes("CreateClosure", 4)).toEqual([4, 4, 1]);
    expect(operandSizes("CallRuntime", 1)).toEqual([2, 1, 1]);
    expect(operandSizes("CallRuntime", 2)).toEqual([2, 2, 2]);
  });
});

describe("requiredScale", () => {
  it("is the smallest scale in which every operand fits", () => {
    expect(requiredScale("LdaSmi", [127])).toBe(1);
    expect(requiredScale("LdaSmi", [-128])).toBe(1);
    expect(requiredScale("LdaSmi", [128])).toBe(2);
    expect(requiredScale("LdaSmi", [255])).toBe(2);
    expect(requiredScale("LdaSmi", [300])).toBe(2);
    expect(requiredScale("LdaSmi", [70000])).toBe(4);
    expect(requiredScale("LdaSmi", [-32769])).toBe(4);
  });

  it("treats Idx and UImm as unsigned", () => {
    expect(requiredScale("LdaConstant", [255])).toBe(1);
    expect(requiredScale("LdaConstant", [256])).toBe(2);
    expect(requiredScale("LdaConstant", [65536])).toBe(4);
  });

  it("takes the widest operand", () => {
    expect(requiredScale("CreateClosure", [3, 300, 2])).toBe(2);
  });

  it("ignores runtime and intrinsic names", () => {
    expect(requiredScale("CallRuntime", ["DefineClass", local(5), 4])).toBe(1);
  });

  it("rejects an operand count that does not match the opcode", () => {
    expect(() => requiredScale("Ldar", [])).toThrow(/Ldar takes 1 operand/);
    expect(() => requiredScale("Return", [1])).toThrow(/Return takes 0 operands/);
  });

  it("rejects a fixed-width operand that does not fit", () => {
    expect(() => requiredScale("CreateClosure", [0, 0, 256])).toThrow(/does not fit/);
  });
});

describe("registers", () => {
  it("encodes locals, arguments and the special registers like the recorded bytes", () => {
    expect(local(0)).toBe(-7);
    expect(local(1)).toBe(-8);
    expect(THIS).toBe(2);
    expect(argument(0)).toBe(3);
    expect(CURRENT_CONTEXT).toBe(-1);
    expect(CLOSURE).toBe(-2);
  });

  it("prints them the way --print-bytecode does", () => {
    expect(formatRegister(local(0))).toBe("r0");
    expect(formatRegister(local(17))).toBe("r17");
    expect(formatRegister(THIS)).toBe("<this>");
    expect(formatRegister(argument(0))).toBe("a0");
    expect(formatRegister(argument(4))).toBe("a4");
    expect(formatRegister(CURRENT_CONTEXT)).toBe("<context>");
    expect(formatRegister(CLOSURE)).toBe("<closure>");
  });

  it("needs a wider scale for a register past r120", () => {
    expect(requiredScale("Ldar", [local(120)])).toBe(1);
    expect(requiredScale("Ldar", [local(121)])).toBe(1);
    expect(requiredScale("Ldar", [local(122)])).toBe(2);
  });
});

describe("opcode classes", () => {
  it("recognises jumps", () => {
    expect(isJump("Jump")).toBe(true);
    expect(isJump("JumpIfToBooleanFalse")).toBe(true);
    expect(isJump("JumpLoop")).toBe(true);
    expect(isJump("Ldar")).toBe(false);
  });

  it("knows which opcodes have no external side effects", () => {
    for (const name of ["Ldar", "Star", "Star3", "LdaZero", "LdaSmi", "LdaConstant", "Mov", "Jump", "JumpIfTrue"] as const) {
      expect(isWithoutExternalSideEffects(name), name).toBe(true);
    }
    for (const name of ["Add", "CallProperty0", "GetNamedProperty", "LdaGlobal", "StaCurrentContextSlot", "Return", "JumpLoop"] as const) {
      expect(isWithoutExternalSideEffects(name), name).toBe(false);
    }
  });
});
