import { describe, expect, it } from "vitest";
import { type Opcode, bytecodeInfo } from "@/core/bytecode/bytecodes";
import { OWNS_FEEDBACK_SLOT, slotLinksOf } from "./slotLinks";

const fn = (functionId: number, lines: readonly string[]) => ({ functionId, lines: lines.map((text, i) => ({ text, offset: i })) });

describe("slotLinksOf", () => {
  it("links the last index operand of an instruction that owns a feedback slot", () => {
    const links = slotLinksOf([fn(3, ["GetNamedProperty r2, [2], [3]", "LdaGlobal [1], [1]", "CallProperty1 r1, r2, r0, [5]"])]);
    expect(links.map((l) => [l.line, l.functionId, l.slot, l.text])).toEqual([
      [0, 3, 3, "[3]"],
      [1, 3, 1, "[1]"],
      [2, 3, 5, "[5]"],
    ]);
  });

  it("links the slot of an instruction that ends in a flag", () => {
    const [link] = slotLinksOf([fn(0, ["CreateArrayLiteral [0], [4], #37"])]);
    expect(link).toMatchObject({ slot: 4, text: "[4]" });
    expect("   0  CreateArrayLiteral [0], [4], #37".slice(link?.from, link?.to)).toBe("[4]");
  });

  it("does not link constant-pool or context operands", () => {
    expect(slotLinksOf([fn(0, ["LdaConstant [4]", "LdaCurrentContextSlot [2]", "Star0", "LdaSmi [6]"])])).toEqual([]);
  });

  it("addresses the operand by its column in the document line", () => {
    // Offset 0 prints as "   0" and two spaces, six columns before the instruction.
    const doc = "   0  GetNamedProperty r2, [2], [3]";
    const [link] = slotLinksOf([fn(0, ["GetNamedProperty r2, [2], [3]"])]);
    expect(link).toBeDefined();
    expect(doc.slice(link?.from, link?.to)).toBe("[3]");
  });

  it("counts lines across functions", () => {
    const links = slotLinksOf([fn(0, ["Star0"]), fn(1, ["Add r0, [0]"])]);
    expect(links.map((l) => [l.line, l.functionId])).toEqual([[1, 1]]);
  });
});

describe("OWNS_FEEDBACK_SLOT", () => {
  it("names only opcodes whose last operand is an index, and no runtime or context opcode", () => {
    // The slot is the last Idx operand; only flags (printed as #n) may follow it.
    for (const name of OWNS_FEEDBACK_SLOT) {
      const operands = bytecodeInfo(name as Opcode).operands;
      const lastIdx = operands.lastIndexOf("Idx");
      expect(lastIdx, name).toBeGreaterThanOrEqual(0);
      expect(operands.slice(lastIdx + 1).every((t) => t === "Flag8" || t === "Flag16"), name).toBe(true);
    }
    expect(OWNS_FEEDBACK_SLOT.has("CallRuntime")).toBe(false);
    expect(OWNS_FEEDBACK_SLOT.has("LdaConstant")).toBe(false);
  });
});
