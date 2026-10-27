import { describe, expect, it } from "vitest";
import { slotLinksOf } from "./slotLinks";

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
