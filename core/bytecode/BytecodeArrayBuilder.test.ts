import { describe, expect, it } from "vitest";
import { BytecodeArrayBuilder } from "./BytecodeArrayBuilder";
import { argument, local } from "./bytecodes";
import { formatInstruction } from "./printer";

const texts = (builder: BytecodeArrayBuilder): string[] => builder.build().array.instructions.map(formatInstruction);

describe("BytecodeArrayBuilder: assembling", () => {
  // function add(a, b) { let x = a + 1; return x + b }   (the bytecode V8 prints for it)
  function assembleAdd(): BytecodeArrayBuilder {
    const b = new BytecodeArrayBuilder({ parameterCount: 3 });
    const x = b.allocateRegister();
    b.emit("Ldar", argument(0));
    b.emit("AddSmi", 1, b.feedback.addSlot("binary-op"));
    b.emit("Star0");
    expect(x).toBe(0);
    b.emit("Ldar", argument(1));
    b.emit("Add", local(x), b.feedback.addSlot("binary-op"));
    b.emit("Return");
    return b;
  }

  it("prints the instruction texts of the real listing", () => {
    expect(texts(assembleAdd())).toEqual(["Ldar a0", "AddSmi [1], [0]", "Star0", "Ldar a1", "Add r0, [1]", "Return"]);
  });

  it("places the instructions at the real offsets and gives the real length", () => {
    const built = assembleAdd().build();
    expect(built.array.instructions.map((i) => i.offset)).toEqual([0, 2, 5, 6, 8, 11]);
    expect(built.array.length).toBe(12);
    expect(built.header).toEqual({ length: 12, parameterCount: 3, registerCount: 1, frameSize: 8 });
  });

  it("rejects an operand list that does not match the opcode", () => {
    const b = new BytecodeArrayBuilder({ parameterCount: 1 });
    expect(() => b.emit("Ldar")).toThrow(/Ldar takes 1 operand/);
  });
});

describe("BytecodeArrayBuilder: operand scaling", () => {
  it("inserts a Wide prefix when an operand exceeds a byte", () => {
    const b = new BytecodeArrayBuilder({ parameterCount: 1 });
    b.emit("LdaSmi", 300);
    b.emit("Return");
    const built = b.build();
    expect(built.array.instructions.map(formatInstruction)).toEqual(["LdaSmi.Wide [300]", "Return"]);
    const [wide, ret] = built.array.instructions;
    expect(wide).toMatchObject({ scale: 2, size: 4, offset: 0 });
    expect(ret?.offset).toBe(4);
    expect(built.array.length).toBe(5);
  });

  it("uses ExtraWide for an operand beyond 16 bits", () => {
    const b = new BytecodeArrayBuilder({ parameterCount: 1 });
    b.emit("LdaSmi", 70000);
    const [only] = b.build().array.instructions;
    expect(only).toMatchObject({ scale: 4, size: 6 });
    expect(formatInstruction(only!)).toBe("LdaSmi.ExtraWide [70000]");
  });

  it("scales the whole instruction by its widest operand and keeps fixed operands narrow", () => {
    const b = new BytecodeArrayBuilder({ parameterCount: 1 });
    b.emit("CreateClosure", 300, 2, 2);
    const [only] = b.build().array.instructions;
    expect(only).toMatchObject({ scale: 2, size: 1 + 1 + 2 + 2 + 1 });
    expect(formatInstruction(only!)).toBe("CreateClosure.Wide [300], [2], #2");
  });

  it("matches the recorded wide LdaSmi", () => {
    // `LdaSmi.Wide [255]` is in the recorded bytecode of the number-to-string fixture.
    const b = new BytecodeArrayBuilder({ parameterCount: 1 });
    b.emit("LdaSmi", 255);
    expect(texts(b)).toEqual(["LdaSmi.Wide [255]"]);
  });
});

describe("BytecodeArrayBuilder: jumps", () => {
  it("patches a forward jump to the offset of the bound label", () => {
    const b = new BytecodeArrayBuilder({ parameterCount: 1 });
    const end = b.newLabel();
    b.emit("LdaTrue");
    b.jump("JumpIfFalse", end);
    b.emit("LdaSmi", 1);
    b.bind(end);
    b.emit("Return");
    const built = b.build();
    expect(built.array.instructions.map(formatInstruction)).toEqual(["LdaTrue", "JumpIfFalse [4] (@5)", "LdaSmi [1]", "Return"]);
    expect(built.array.instructions[1]).toMatchObject({ offset: 1, jumpTarget: 5 });
  });

  it("patches a backward JumpLoop", () => {
    const b = new BytecodeArrayBuilder({ parameterCount: 1 });
    const top = b.newLabel();
    b.bind(top);
    b.emit("LdaZero");
    b.emit("Star0");
    b.jumpLoop(top, 0, b.feedback.addSlot("binary-op"));
    expect(texts(b)).toEqual(["LdaZero", "Star0", "JumpLoop [2], [0], [0] (@0)"]);
  });

  it("jumps to the end of the array when the label is bound last", () => {
    const b = new BytecodeArrayBuilder({ parameterCount: 1 });
    const end = b.newLabel();
    b.jump("Jump", end);
    b.bind(end);
    const built = b.build();
    expect(built.array.instructions.map(formatInstruction)).toEqual(["Jump [2] (@2)"]);
    expect(built.array.length).toBe(2);
  });

  it("widens a forward jump that cannot reach its label in one byte, and moves everything after it", () => {
    // V8 reaches far forward jumps with JumpConstant; whether that is what the pinned V8 prints
    // for this distance is checked against a micro-fixture with the control-flow family.
    const b = new BytecodeArrayBuilder({ parameterCount: 1 });
    const end = b.newLabel();
    b.jump("Jump", end);
    for (let i = 0; i < 130; i++) b.emit("LdaSmi", 1);
    b.bind(end);
    b.emit("Return");
    const built = b.build();
    const [jump, first, ...rest] = built.array.instructions;
    expect(formatInstruction(jump!)).toBe("Jump.Wide [263] (@264)");
    expect(jump).toMatchObject({ offset: 0, size: 4, jumpTarget: 264 });
    expect(first?.offset).toBe(4);
    expect(rest.at(-1)).toMatchObject({ offset: 264, opcode: "Return" });
    expect(built.array.length).toBe(265);
  });

  it("widens a backward jump the same way", () => {
    const b = new BytecodeArrayBuilder({ parameterCount: 1 });
    const top = b.newLabel();
    b.bind(top);
    for (let i = 0; i < 130; i++) b.emit("LdaSmi", 1);
    b.jumpLoop(top, 0, 0);
    const last = b.build().array.instructions.at(-1)!;
    expect(last).toMatchObject({ offset: 260, scale: 2, jumpTarget: 0 });
    expect(formatInstruction(last)).toBe("JumpLoop.Wide [261], [0], [0] (@0)");
  });

  it("refuses a label that is never bound", () => {
    const b = new BytecodeArrayBuilder({ parameterCount: 1 });
    b.jump("Jump", b.newLabel());
    expect(() => b.build()).toThrow(/unbound label/);
  });

  it("refuses to bind a label twice", () => {
    const b = new BytecodeArrayBuilder({ parameterCount: 1 });
    const label = b.newLabel();
    b.bind(label);
    expect(() => b.bind(label)).toThrow(/already bound/);
  });

  it("refuses jump for an opcode that is not a jump", () => {
    const b = new BytecodeArrayBuilder({ parameterCount: 1 });
    expect(() => b.jump("Ldar", b.newLabel())).toThrow(/not a jump/);
  });
});

describe("BytecodeArrayBuilder: registers", () => {
  it("hands out registers in order and reuses released ones", () => {
    const b = new BytecodeArrayBuilder({ parameterCount: 1 });
    expect(b.allocateRegister()).toBe(0);
    const mark = b.registerTop;
    expect(b.allocateRegister()).toBe(1);
    expect(b.allocateRegister()).toBe(2);
    b.releaseRegisters(mark);
    expect(b.allocateRegister()).toBe(1);
  });

  it("reports the high-water mark as the register count and eight bytes per register as the frame size", () => {
    const b = new BytecodeArrayBuilder({ parameterCount: 2 });
    b.allocateRegister();
    const mark = b.registerTop;
    b.allocateRegister();
    b.allocateRegister();
    b.releaseRegisters(mark);
    b.allocateRegister();
    const { header } = b.build();
    expect(header).toMatchObject({ parameterCount: 2, registerCount: 3, frameSize: 24 });
  });

  it("reports no registers for a function that needs none", () => {
    expect(new BytecodeArrayBuilder({ parameterCount: 1 }).build().header).toEqual({ length: 0, parameterCount: 1, registerCount: 0, frameSize: 0 });
  });

  it("refuses to release above the top", () => {
    const b = new BytecodeArrayBuilder({ parameterCount: 1 });
    expect(() => b.releaseRegisters(3)).toThrow(/above/);
  });
});

describe("BytecodeArrayBuilder: source positions", () => {
  it("attaches a statement position to the next instruction", () => {
    const b = new BytecodeArrayBuilder({ parameterCount: 2 });
    b.setStatementPosition(35);
    b.emit("Ldar", argument(0));
    expect(b.build().positions.entries).toEqual([{ offset: 0, position: 35, kind: "statement" }]);
  });

  it("attaches an expression position to the next instruction that can have side effects", () => {
    const b = new BytecodeArrayBuilder({ parameterCount: 2 });
    b.setStatementPosition(35);
    b.emit("Ldar", argument(0));
    b.setExpressionPosition(44);
    b.emit("Star0");
    b.emit("LdaZero");
    b.emit("Add", local(0), 0);
    expect(b.build().positions.entries).toEqual([
      { offset: 0, position: 35, kind: "statement" },
      { offset: 4, position: 44, kind: "expression" },
    ]);
  });

  it("keeps a statement position over an expression position set after it", () => {
    const b = new BytecodeArrayBuilder({ parameterCount: 1 });
    b.setStatementPosition(20);
    b.setExpressionPosition(10);
    b.emit("LdaZero");
    expect(b.build().positions.entries).toEqual([{ offset: 0, position: 20, kind: "statement" }]);
  });

  it("lets a statement position replace an expression position that is still waiting", () => {
    const b = new BytecodeArrayBuilder({ parameterCount: 1 });
    b.setExpressionPosition(10);
    b.setStatementPosition(20);
    b.emit("LdaZero");
    expect(b.build().positions.entries).toEqual([{ offset: 0, position: 20, kind: "statement" }]);
  });

  it("lets a later expression position replace an earlier one", () => {
    const b = new BytecodeArrayBuilder({ parameterCount: 1 });
    b.setExpressionPosition(10);
    b.setExpressionPosition(12);
    b.emit("Return");
    expect(b.build().positions.entries).toEqual([{ offset: 0, position: 12, kind: "expression" }]);
  });

  it("records positions at the final offsets after a jump is widened", () => {
    const b = new BytecodeArrayBuilder({ parameterCount: 1 });
    const end = b.newLabel();
    b.jump("Jump", end);
    for (let i = 0; i < 130; i++) b.emit("LdaSmi", 1);
    b.bind(end);
    b.setStatementPosition(7);
    b.emit("Return");
    expect(b.build().positions.entries).toEqual([{ offset: 264, position: 7, kind: "statement" }]);
  });

  it("drops a position left over after the last instruction", () => {
    const b = new BytecodeArrayBuilder({ parameterCount: 1 });
    b.emit("Return");
    b.setStatementPosition(9);
    expect(b.build().positions.entries).toEqual([]);
  });
});
