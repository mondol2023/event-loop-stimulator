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
    b.bindLoopHeader(top);
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

  // V8's BytecodeArrayWriter reserves a constant-pool entry for every forward jump it writes. When
  // the label is bound, a distance that fits the operand goes into the instruction and the
  // reservation is given back; a longer one is committed to the pool as a Smi and the jump becomes
  // its `Constant` form (the bc-far-jumps fixture prints `JumpIfFalseConstant [1]`).
  function farJump(stars: number): BytecodeArrayBuilder {
    const b = new BytecodeArrayBuilder({ parameterCount: 1 });
    b.constantPool.add({ kind: "string", value: "s" });
    const end = b.newLabel();
    b.emit("LdaTrue");
    b.jump("JumpIfFalse", end);
    for (let i = 0; i < stars; i++) b.emit("Star0");
    b.bind(end);
    b.constantPool.add({ kind: "string", value: "t" });
    b.emit("Return");
    return b;
  }

  it("reaches a far forward label through a pool entry committed when the label is bound", () => {
    const b = farJump(260);
    const built = b.build();
    const [, jump, first, ...rest] = built.array.instructions;
    expect(formatInstruction(jump!)).toBe("JumpIfFalseConstant [1] (@263)");
    expect(jump).toMatchObject({ offset: 1, size: 2, jumpTarget: 263 });
    expect(first?.offset).toBe(3);
    expect(rest.at(-1)).toMatchObject({ offset: 263, opcode: "Return" });
    expect(built.array.length).toBe(264);
    // The distance is the entry; it lands before anything added after the bind.
    expect(b.constantPool.printEntries()).toEqual(["<String[1]: #s>", "262", "<String[1]: #t>"]);
  });

  it("keeps a forward distance of 255 in the instruction and gives the reservation back", () => {
    const b = farJump(253);
    expect(texts(b)).toContain("JumpIfFalse [255] (@256)");
    expect(b.constantPool.printEntries()).toEqual(["<String[1]: #s>", "<String[1]: #t>"]);
  });

  it("goes through the pool from a distance of 256", () => {
    expect(texts(farJump(254))).toContain("JumpIfFalseConstant [1] (@257)");
  });

  it("shares one pool entry between far jumps of the same distance", () => {
    const b = new BytecodeArrayBuilder({ parameterCount: 1 });
    for (let block = 0; block < 2; block++) {
      const end = b.newLabel();
      b.emit("LdaTrue");
      b.jump("JumpIfToBooleanFalse", end);
      for (let i = 0; i < 260; i++) b.emit("Star0");
      b.bind(end);
    }
    const jumps = b.build().array.instructions.filter((i) => i.opcode.startsWith("Jump"));
    expect(jumps.map(formatInstruction)).toEqual(["JumpIfToBooleanFalseConstant [0] (@263)", "JumpIfToBooleanFalseConstant [0] (@526)"]);
    expect(b.constantPool.printEntries()).toEqual(["262"]);
  });

  it("measures a far jump over a wide backward jump at the size that jump finally has", () => {
    const b = new BytecodeArrayBuilder({ parameterCount: 1 });
    const end = b.newLabel();
    const top = b.newLabel();
    b.emit("LdaTrue");
    b.jump("JumpIfFalse", end);
    b.bindLoopHeader(top);
    for (let i = 0; i < 256; i++) b.emit("Star0");
    b.jumpLoop(top, 0, 0); // 256 bytes back: JumpLoop.Wide, 8 bytes, and the jump over it grows with it
    b.bind(end);
    b.emit("Return");
    const built = b.build();
    expect(formatInstruction(built.array.instructions[1]!)).toBe("JumpIfFalseConstant [0] (@267)");
    expect(formatInstruction(built.array.instructions.at(-2)!)).toBe("JumpLoop.Wide [257], [0], [0] (@3)");
    expect(b.constantPool.printEntries()).toEqual(["266"]);
  });

  it("writes a forward jump Wide once the pool's first 256 indexes are spoken for", () => {
    const b = new BytecodeArrayBuilder({ parameterCount: 1 });
    for (let i = 0; i < 256; i++) b.constantPool.add({ kind: "number", value: i + 0.5 });
    const end = b.newLabel();
    b.emit("LdaTrue");
    b.jump("JumpIfFalse", end);
    b.emit("Star0");
    b.emit("Star1");
    b.bind(end);
    b.emit("Return");
    expect(texts(b)).toEqual(["LdaTrue", "JumpIfFalse.Wide [5] (@7)", "Star0", "Star1", "Return"]);
  });

  it("does not reserve anything for a jump written in dead code", () => {
    const b = new BytecodeArrayBuilder({ parameterCount: 1 });
    b.emit("Return");
    b.jump("Jump", b.newLabel());
    expect(texts(b)).toEqual(["Return"]);
  });

  it("widens a backward jump the same way", () => {
    const b = new BytecodeArrayBuilder({ parameterCount: 1 });
    const top = b.newLabel();
    b.bindLoopHeader(top);
    for (let i = 0; i < 260; i++) b.emit("Star0");
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
    b.emit("LdaTrue");
    b.jump("JumpIfFalse", label);
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

  it("reports the highest register an instruction names as the register count, eight bytes each in the frame", () => {
    const b = new BytecodeArrayBuilder({ parameterCount: 2 });
    b.allocateRegister();
    const mark = b.registerTop;
    b.allocateRegister();
    const last = b.allocateRegister();
    b.releaseRegisters(mark);
    b.allocateRegister();
    b.emit("Star", local(last));
    const { header } = b.build();
    expect(header).toMatchObject({ parameterCount: 2, registerCount: 3, frameSize: 24 });
  });

  it("does not count a temporary that the register optimizer left out of the instructions", () => {
    // V8 gives `a + (b + c)` with three locals and one local result no frame beyond the four locals.
    const b = new BytecodeArrayBuilder({ parameterCount: 6, localCount: 4, optimizeRegisters: true });
    const t = b.allocateRegister();
    b.emit("Ldar", local(0));
    b.emit("Star", local(t));
    b.emit("Ldar", local(1));
    b.emit("Add", local(t), 0);
    expect(b.build().header).toMatchObject({ registerCount: 4, frameSize: 32 });
  });

  it("counts every register of a list operand", () => {
    const b = new BytecodeArrayBuilder({ parameterCount: 1 });
    const callee = b.allocateRegister();
    const first = b.allocateRegisterList(3);
    b.allocateRegisterList(5); // taken, never named
    b.emit("CallUndefinedReceiver", local(callee), local(first), 3, 0);
    expect(b.build().header).toMatchObject({ registerCount: 4 });
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
    b.emit("LdaTrue");
    b.jump("JumpIfFalse", end);
    for (let i = 0; i < 260; i++) b.emit("Star0");
    b.bind(end);
    b.setStatementPosition(7);
    b.emit("Return");
    expect(b.build().positions.entries).toEqual([{ offset: 263, position: 7, kind: "statement" }]);
  });

  it("drops a position left over after the last instruction", () => {
    const b = new BytecodeArrayBuilder({ parameterCount: 1 });
    b.emit("Return");
    b.setStatementPosition(9);
    expect(b.build().positions.entries).toEqual([]);
  });
});

describe("BytecodeArrayBuilder: what the writer leaves out", () => {
  it("drops everything after an instruction that leaves the block", () => {
    const b = new BytecodeArrayBuilder({ parameterCount: 1 });
    b.emit("LdaZero");
    b.emit("Return");
    b.emit("LdaSmi", 1);
    b.emit("Return");
    expect(texts(b)).toEqual(["LdaZero", "Return"]);
    expect(b.remainderOfBlockIsDead).toBe(true);
  });

  it("leaves a block after a Throw, a ReThrow and a Jump too", () => {
    for (const exit of ["Throw", "ReThrow"] as const) {
      const b = new BytecodeArrayBuilder({ parameterCount: 1 });
      b.emit(exit);
      b.emit("LdaZero");
      expect(texts(b)).toEqual([exit]);
    }
    const b = new BytecodeArrayBuilder({ parameterCount: 1 });
    const end = b.newLabel();
    b.jump("Jump", end);
    b.emit("LdaZero");
    b.bind(end);
    b.emit("Return");
    expect(texts(b)).toEqual(["Jump [2] (@2)", "Return"]);
  });

  it("does not bring code back to life by binding a label nothing jumps to", () => {
    const b = new BytecodeArrayBuilder({ parameterCount: 1 });
    b.emit("Return");
    b.bind(b.newLabel());
    b.emit("LdaZero");
    expect(texts(b)).toEqual(["Return"]);
  });

  it("does not count a jump that was dropped as dead code as a reference to its label", () => {
    const b = new BytecodeArrayBuilder({ parameterCount: 1 });
    const end = b.newLabel();
    b.emit("Return");
    b.jump("Jump", end);
    b.bind(end);
    b.emit("LdaZero");
    expect(texts(b)).toEqual(["Return"]);
  });

  it("brings code back to life at a label that a live jump targets", () => {
    const b = new BytecodeArrayBuilder({ parameterCount: 1 });
    const end = b.newLabel();
    b.emit("LdaTrue");
    b.jump("JumpIfFalse", end);
    b.emit("Return");
    b.bind(end);
    b.emit("LdaZero");
    b.emit("Return");
    expect(texts(b)).toEqual(["LdaTrue", "JumpIfFalse [3] (@4)", "Return", "LdaZero", "Return"]);
    expect(b.remainderOfBlockIsDead).toBe(true);
  });

  it("brings code back to life at a loop header", () => {
    const b = new BytecodeArrayBuilder({ parameterCount: 1 });
    b.emit("Return");
    b.bindLoopHeader(b.newLabel());
    b.emit("LdaZero");
    expect(texts(b)).toEqual(["Return", "LdaZero"]);
  });

  it("elides an accumulator load that the next load overwrites", () => {
    const b = new BytecodeArrayBuilder({ parameterCount: 1 });
    b.emit("LdaZero");
    b.emit("LdaSmi", 3);
    b.emit("Return");
    expect(texts(b)).toEqual(["LdaSmi [3]", "Return"]);
  });

  it("moves the position of an elided load to the instruction that replaces it", () => {
    const b = new BytecodeArrayBuilder({ parameterCount: 1 });
    b.setStatementPosition(8);
    b.emit("LdaZero");
    b.emit("LdaSmi", 3);
    expect(b.build().positions.entries).toEqual([{ offset: 0, position: 8, kind: "statement" }]);
  });

  it("keeps both loads when both carry a position", () => {
    const b = new BytecodeArrayBuilder({ parameterCount: 1 });
    b.setStatementPosition(8);
    b.emit("LdaZero");
    b.setStatementPosition(9);
    b.emit("LdaSmi", 3);
    expect(texts(b)).toEqual(["LdaZero", "LdaSmi [3]"]);
  });

  it("does not elide a load that can throw or one that something reads", () => {
    const b = new BytecodeArrayBuilder({ parameterCount: 1 });
    b.emit("LdaGlobal", 0, 0);
    b.emit("LdaSmi", 3);
    b.emit("Add", local(0), 0);
    b.emit("LdaZero");
    expect(texts(b)).toEqual(["LdaGlobal [0], [0]", "LdaSmi [3]", "Add r0, [0]", "LdaZero"]);
  });

  it("does not elide a load across a label", () => {
    const b = new BytecodeArrayBuilder({ parameterCount: 1 });
    const mid = b.newLabel();
    b.emit("LdaTrue");
    b.jump("JumpIfTrue", mid);
    b.emit("LdaZero");
    b.bind(mid);
    b.emit("LdaSmi", 3);
    expect(texts(b)).toEqual(["LdaTrue", "JumpIfTrue [3] (@4)", "LdaZero", "LdaSmi [3]"]);
  });

  it("writes Star r0..r15 as the one-byte Star0..Star15", () => {
    const b = new BytecodeArrayBuilder({ parameterCount: 1, localCount: 20 });
    b.emit("Star", local(15));
    b.emit("Star", local(16));
    b.emit("Star", argument(0));
    expect(texts(b)).toEqual(["Star15", "Star r16", "Star a0"]);
  });
});

describe("BytecodeArrayBuilder: fixed registers", () => {
  it("starts temporaries after the locals and counts the locals in the frame", () => {
    const b = new BytecodeArrayBuilder({ parameterCount: 6, localCount: 18 });
    const t = b.allocateRegister();
    expect(t).toBe(18);
    b.emit("Star", local(t));
    expect(b.build().header).toMatchObject({ registerCount: 19, frameSize: 152 });
  });

  it("counts locals that are never used", () => {
    expect(new BytecodeArrayBuilder({ parameterCount: 1, localCount: 3 }).build().header).toMatchObject({ registerCount: 3, frameSize: 24 });
  });
});

describe("BytecodeArrayBuilder: handler table", () => {
  it("records where a try range starts and ends, where its handler is and which register holds the context", () => {
    const b = new BytecodeArrayBuilder({ parameterCount: 1 });
    const handler = b.newHandlerEntry();
    b.emit("LdaUndefined");
    b.markTryBegin(handler, 3);
    b.emit("LdaSmi", 1);
    b.emit("Throw");
    b.markTryEnd(handler);
    b.markHandler(handler, 1);
    b.emit("Star0");
    const built = b.build();
    expect(built.array.instructions.map(formatInstruction)).toEqual(["LdaUndefined", "LdaSmi [1]", "Throw", "Star0"]);
    expect(built.handlerTable).toEqual([{ start: 1, end: 4, handler: 4, prediction: 1, data: 3 }]);
  });

  it("lists the entries in the order they were created, not the order they were closed", () => {
    const b = new BytecodeArrayBuilder({ parameterCount: 1 });
    const outer = b.newHandlerEntry();
    const inner = b.newHandlerEntry();
    b.markTryBegin(outer, 2);
    b.markTryBegin(inner, 3);
    b.emit("Throw");
    b.markTryEnd(inner);
    b.markHandler(inner, 1);
    b.emit("Throw");
    b.markTryEnd(outer);
    b.markHandler(outer, 0);
    b.emit("ReThrow");
    expect(b.build().handlerTable).toEqual([
      { start: 0, end: 2, handler: 2, prediction: 0, data: 2 },
      { start: 0, end: 1, handler: 1, prediction: 1, data: 3 },
    ]);
  });

  it("keeps the load before a try range, which would otherwise be elided by the instruction after it", () => {
    const b = new BytecodeArrayBuilder({ parameterCount: 1 });
    const handler = b.newHandlerEntry();
    b.emit("LdaTheHole");
    b.markTryBegin(handler, 0);
    b.emit("LdaZero");
    expect(texts(b)).toEqual(["LdaTheHole", "LdaZero"]);
  });

  it("starts a handler a new basic block, so code after a throw is live there", () => {
    const b = new BytecodeArrayBuilder({ parameterCount: 1 });
    const handler = b.newHandlerEntry();
    b.markTryBegin(handler, 0);
    b.emit("Throw");
    b.emit("LdaZero"); // dead: nothing can reach it
    b.markTryEnd(handler);
    b.markHandler(handler, 0);
    b.emit("Star0");
    expect(texts(b)).toEqual(["Throw", "Star0"]);
  });
});

describe("BytecodeArrayBuilder: jump tables", () => {
  // Ldar r0; switch on it; case 0 returns 1, case 1 returns 2, anything else falls out of the switch.
  function assembleSwitch(): BytecodeArrayBuilder {
    const b = new BytecodeArrayBuilder({ parameterCount: 1, localCount: 1 });
    const table = b.allocateJumpTable(2, 0);
    const other = b.newLabel();
    b.emit("Ldar", local(0));
    b.switchOnSmiNoFeedback(table);
    b.jump("Jump", other);
    b.bindJumpTableEntry(table, 0);
    b.emit("LdaSmi", 1);
    b.emit("Return");
    b.bindJumpTableEntry(table, 1);
    b.emit("LdaSmi", 2);
    b.emit("Return");
    b.bind(other);
    b.emit("LdaUndefined");
    b.emit("Return");
    return b;
  }

  it("prints the switch with the absolute target of every case", () => {
    expect(texts(assembleSwitch())).toEqual([
      "Ldar r0",
      "SwitchOnSmiNoFeedback [0], [2], [0] { 0: @8, 1: @11 }",
      "Jump [8] (@14)",
      "LdaSmi [1]",
      "Return",
      "LdaSmi [2]",
      "Return",
      "LdaUndefined",
      "Return",
    ]);
  });

  it("stores each case as its distance from the switch in consecutive constant-pool entries", () => {
    const b = assembleSwitch();
    b.build();
    expect(b.constantPool.printEntries()).toEqual(["6", "9"]);
  });

  it("numbers the cases from the base, and skips the entries that were never bound", () => {
    const b = new BytecodeArrayBuilder({ parameterCount: 1 });
    const table = b.allocateJumpTable(3, 1);
    b.emit("Ldar", argument(0));
    b.switchOnSmiNoFeedback(table);
    b.bindJumpTableEntry(table, 3);
    b.emit("Return");
    b.bindJumpTableEntry(table, 1);
    b.emit("Return");
    expect(texts(b)[1]).toBe("SwitchOnSmiNoFeedback [0], [3], [1] { 1: @7, 3: @6 }");
  });

  it("switches on the generator state with no case base, resuming at the bound suspend points", () => {
    const b = new BytecodeArrayBuilder({ parameterCount: 1, localCount: 1 });
    const table = b.allocateJumpTable(2, 0);
    b.switchOnGeneratorState(local(0), table);
    b.emit("LdaUndefined");
    b.emit("Return");
    b.bindJumpTableEntry(table, 0);
    b.emit("Return");
    b.bindJumpTableEntry(table, 1);
    b.emit("Return");
    expect(texts(b)[0]).toBe("SwitchOnGeneratorState r0, [0], [2] { 0: @6, 1: @7 }");
    b.build();
    expect(b.constantPool.printEntries()).toEqual(["6", "7"]);
  });

  it("flushes the register optimizer before the switch, so a register that only stood in for another is real at every target", () => {
    const b = new BytecodeArrayBuilder({ parameterCount: 1, optimizeRegisters: true });
    const table = b.allocateJumpTable(1, 0);
    const standIn = b.allocateRegister();
    b.emit("Mov", argument(0), local(standIn));
    b.emit("Ldar", argument(0));
    b.switchOnSmiNoFeedback(table);
    b.bindJumpTableEntry(table, 0);
    b.emit("Return");
    const listing = texts(b);
    const at = listing.findIndex((t) => t.startsWith("SwitchOnSmiNoFeedback"));
    expect(listing.slice(0, at)).toContain("Mov a0, r0");
  });
});
