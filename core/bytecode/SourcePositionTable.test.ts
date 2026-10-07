import { describe, expect, it } from "vitest";
import { SourcePositionTable } from "./SourcePositionTable";

describe("SourcePositionTable", () => {
  it("records entries in offset order", () => {
    const table = new SourcePositionTable();
    table.add(0, 35, "statement");
    table.add(2, 44, "expression");
    expect(table.entries).toEqual([
      { offset: 0, position: 35, kind: "statement" },
      { offset: 2, position: 44, kind: "expression" },
    ]);
  });

  it("lets a statement position replace an expression position at the same offset", () => {
    const table = new SourcePositionTable();
    table.add(5, 10, "expression");
    table.add(5, 20, "statement");
    expect(table.entries).toEqual([{ offset: 5, position: 20, kind: "statement" }]);
  });

  it("keeps the statement position when an expression position arrives later", () => {
    const table = new SourcePositionTable();
    table.add(5, 20, "statement");
    table.add(5, 10, "expression");
    expect(table.entries).toEqual([{ offset: 5, position: 20, kind: "statement" }]);
  });

  it("lets the later of two positions of the same kind win", () => {
    const table = new SourcePositionTable();
    table.add(5, 10, "expression");
    table.add(5, 12, "expression");
    table.add(9, 20, "statement");
    table.add(9, 22, "statement");
    expect(table.entries).toEqual([
      { offset: 5, position: 12, kind: "expression" },
      { offset: 9, position: 22, kind: "statement" },
    ]);
  });

  it("refuses an offset that goes backwards", () => {
    const table = new SourcePositionTable();
    table.add(8, 1, "statement");
    expect(() => table.add(3, 2, "statement")).toThrow(/offset 3 before 8/);
  });

  it("finds the entry at an offset", () => {
    const table = new SourcePositionTable();
    table.add(0, 35, "statement");
    table.add(7, 44, "expression");
    expect(table.at(7)).toEqual({ offset: 7, position: 44, kind: "expression" });
    expect(table.at(3)).toBeUndefined();
  });
});
