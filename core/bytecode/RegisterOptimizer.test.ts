import { describe, expect, it } from "vitest";
import { BytecodeArrayBuilder } from "./BytecodeArrayBuilder";
import { argument, local } from "./bytecodes";
import { formatInstruction } from "./printer";

// Every expected listing below is what real Node (V8 13.6.233.17) prints for the source quoted in
// the test, read with `npm run conformance:diff`; the optimizer exists to reproduce them.

function optimizing(locals: number): BytecodeArrayBuilder {
  return new BytecodeArrayBuilder({ parameterCount: 6, localCount: locals, optimizeRegisters: true });
}

const texts = (b: BytecodeArrayBuilder): string[] => b.build().array.instructions.map(formatInstruction);

describe("register optimizer: elided transfers", () => {
  it("copies a local that is already in the accumulator with one Star", () => {
    // var a = 1; var b = a;
    const b = optimizing(2);
    b.emit("LdaSmi", 1);
    b.emit("Star", local(0));
    b.emit("Ldar", local(0));
    b.emit("Star", local(1));
    b.emit("LdaUndefined");
    b.emit("Return");
    expect(texts(b)).toEqual(["LdaSmi [1]", "Star0", "Star1", "LdaUndefined", "Return"]);
  });

  it("emits nothing for an assignment between two locals that already hold the same value", () => {
    // var a = 1; var b; b = a; a = b;
    const b = optimizing(2);
    b.emit("LdaSmi", 1);
    b.emit("Star", local(0));
    b.emit("Ldar", local(0));
    b.emit("Star", local(1));
    b.emit("Ldar", local(1));
    b.emit("Star", local(0));
    b.emit("LdaUndefined");
    b.emit("Return");
    expect(texts(b)).toEqual(["LdaSmi [1]", "Star0", "Star1", "LdaUndefined", "Return"]);
  });

  it("never stores into a temporary that nothing needs: a * b reads b then multiplies by a", () => {
    // var a = 1, b = 2; var c = a * b;
    const b = optimizing(3);
    b.emit("LdaSmi", 1);
    b.emit("Star", local(0));
    b.emit("LdaSmi", 2);
    b.emit("Star", local(1));
    const t = b.allocateRegister();
    b.emit("Ldar", local(0));
    b.emit("Star", local(t));
    b.emit("Ldar", local(1));
    b.emit("Mul", local(t), 0);
    b.releaseRegisters(t);
    b.emit("Star", local(2));
    expect(texts(b)).toEqual(["LdaSmi [1]", "Star0", "LdaSmi [2]", "Star1", "Ldar r1", "Mul r0, [0]", "Star2"]);
  });

  it("stores a temporary only when the accumulator moves on, then reloads the accumulator", () => {
    // var a = ...; var r = 300 + a;  (a is r0 of 18 locals; the temporary is r18)
    const b = optimizing(18);
    const t = b.allocateRegister();
    expect(t).toBe(18);
    b.emit("LdaSmi", 300);
    b.emit("Star", local(t));
    b.emit("Ldar", local(0));
    b.emit("Add", local(t), 0);
    expect(texts(b)).toEqual(["LdaSmi.Wide [300]", "Star r18", "Ldar r0", "Add r18, [0]"]);
  });

  it("copies a local with Mov when the accumulator holds something else", () => {
    // var a = 1; var b = 2; var c = a;  with the accumulator unrelated to a
    const b = optimizing(3);
    b.emit("LdaSmi", 1);
    b.emit("Star", local(0));
    b.emit("LdaSmi", 2);
    b.emit("Star", local(1));
    b.emit("Ldar", local(0));
    b.emit("Star", local(2));
    expect(texts(b)).toEqual(["LdaSmi [1]", "Star0", "LdaSmi [2]", "Star1", "Mov r0, r2"]);
  });

  it("loads the accumulator again for an instruction that reads it", () => {
    // var a = 1; var b = 2; var c = a; return c
    const b = optimizing(3);
    b.emit("LdaSmi", 1);
    b.emit("Star", local(0));
    b.emit("LdaSmi", 2);
    b.emit("Star", local(1));
    b.emit("Ldar", local(0));
    b.emit("Return");
    expect(texts(b)).toEqual(["LdaSmi [1]", "Star0", "LdaSmi [2]", "Star1", "Ldar r0", "Return"]);
  });

  it("names a parameter when the accumulator and a temporary both held it", () => {
    // function f(a, b) { return a + b }  ->  Ldar a1; Add a0, [0]
    const b = optimizing(0);
    const t = b.allocateRegister();
    b.emit("Ldar", argument(0));
    b.emit("Star", local(t));
    b.emit("Ldar", argument(1));
    b.emit("Add", local(t), 0);
    b.emit("Return");
    expect(texts(b)).toEqual(["Ldar a1", "Add a0, [0]", "Return"]);
  });
});

describe("register optimizer: source positions of elided transfers", () => {
  it("gives the position of an elided Ldar to the instruction that follows", () => {
    // var a = 1; a;   -- the statement position lands on the implicit return value
    const b = optimizing(1);
    b.setStatementPosition(6);
    b.emit("LdaSmi", 1);
    b.emit("Star", local(0));
    b.setStatementPosition(9);
    b.emit("Ldar", local(0));
    b.emit("LdaUndefined");
    b.setStatementPosition(10);
    b.emit("Return");
    expect(b.build().positions.entries).toEqual([
      { offset: 0, position: 6, kind: "statement" },
      { offset: 3, position: 9, kind: "statement" },
      { offset: 4, position: 10, kind: "statement" },
    ]);
  });

  it("lets a later statement replace the position of an elided Ldar nobody used", () => {
    // var a = 1; a; a;
    const b = optimizing(1);
    b.emit("LdaSmi", 1);
    b.emit("Star", local(0));
    b.setStatementPosition(9);
    b.emit("Ldar", local(0));
    b.setStatementPosition(12);
    b.emit("Ldar", local(0));
    b.emit("LdaUndefined");
    expect(b.build().positions.entries).toEqual([{ offset: 3, position: 12, kind: "statement" }]);
  });

  it("puts a statement position on the instruction's own expression position: a = a + 3", () => {
    // var a = 1; a = a + 3;  -> `15 S> AddSmi [3], [0]`
    const b = optimizing(1);
    b.emit("LdaSmi", 1);
    b.emit("Star", local(0));
    b.setStatementPosition(9);
    b.emit("Ldar", local(0));
    b.setExpressionPosition(15);
    b.emit("AddSmi", 3, 0);
    expect(b.build().positions.entries).toEqual([{ offset: 3, position: 15, kind: "statement" }]);
  });

  it("keeps the position of an elided Ldar on the store that replaces it: var b = a", () => {
    // var a = 1; var b = a;  -> `17 S> Star1`
    const b = optimizing(2);
    b.emit("LdaSmi", 1);
    b.emit("Star", local(0));
    b.setStatementPosition(17);
    b.emit("Ldar", local(0));
    b.emit("Star", local(1));
    expect(b.build().positions.entries).toEqual([{ offset: 3, position: 17, kind: "statement" }]);
  });
});
