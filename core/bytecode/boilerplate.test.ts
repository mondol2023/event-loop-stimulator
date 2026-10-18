import { describe, expect, it } from "vitest";
import { compileOrThrow } from "@/core/interpreter/interpreterTestWorld";
import type { ConstantEntry } from "./ConstantPool";

// The interpreter builds a literal from the data its boilerplate constant carries. The printed
// text of the entry (what the listings compare) does not change.

function boilerplates(source: string): Extract<ConstantEntry, { kind: "boilerplate" }>[] {
  const program = compileOrThrow(source);
  return (program.functions[0]?.constantPool.entries ?? []).filter((e): e is Extract<ConstantEntry, { kind: "boilerplate" }> => e.kind === "boilerplate");
}

describe("object boilerplates", () => {
  it("hold constant values, nested constant literals and placeholders for run-time values", () => {
    const [entry] = boilerplates(`var x = 1; var o = { a: 1, b: "s", c: x, d: { e: null }, f: true };`);
    expect(entry?.text).toBe("ObjectBoilerplateDescription[10]");
    expect(entry?.literal).toEqual({
      kind: "object",
      properties: [
        { key: "a", value: { kind: "value", value: 1 } },
        { key: "b", value: { kind: "value", value: "s" } },
        { key: "c", value: { kind: "placeholder" } },
        { key: "d", value: { kind: "object", properties: [{ key: "e", value: { kind: "value", value: null } }] } },
        { key: "f", value: { kind: "value", value: true } },
      ],
    });
  });

  it("name numeric and string keys by their canonical text", () => {
    const [entry] = boilerplates(`var o = { 2: "two", "quoted key": 3, 1.5: 4 };`);
    expect(entry?.literal).toMatchObject({ properties: [{ key: "2" }, { key: "quoted key" }, { key: "1.5" }] });
  });
});

describe("array boilerplates", () => {
  it("hold constants, holes, nested constant literals and placeholders", () => {
    const [entry] = boilerplates(`var x = 1; var a = [1, , x, [2], -0];`);
    expect(entry?.literal).toEqual({
      kind: "array",
      elements: [
        { kind: "value", value: 1 },
        "hole",
        { kind: "placeholder" },
        { kind: "array", elements: [{ kind: "value", value: 2 }] },
        { kind: "value", value: -0 },
      ],
    });
  });
});
