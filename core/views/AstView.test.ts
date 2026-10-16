import { describe, expect, it } from "vitest";
import { CompilationManager } from "@/core/compile/CompilationManager";

const SOURCE = "var a = 1;\nfunction f(x) { return x + a; }\nf(2);\n";

describe("AstView", () => {
  const result = new CompilationManager().compile(SOURCE, "js");
  const lines = result.views?.ast.lines ?? [];

  it("prints the tree one node per line, indented by depth", () => {
    expect(lines[0]).toMatchObject({ text: "Program", depth: 0 });
    expect(lines.map((l) => `${"  ".repeat(l.depth)}${l.text}`).slice(0, 6)).toEqual([
      "Program",
      "  VariableDeclaration var",
      "    VariableDeclarator",
      "      Identifier a",
      "      Literal 1",
      "  FunctionDeclaration f",
    ]);
  });

  it("gives each line the source range of its node", () => {
    const declarator = lines.find((l) => l.text === "VariableDeclarator");
    expect(SOURCE.slice(declarator?.range.start, declarator?.range.end)).toBe("a = 1");
  });

  it("links a node to the bytecode generated for its source", () => {
    const statement = lines.find((l) => l.text === "VariableDeclaration var");
    expect(statement?.positions.length).toBeGreaterThan(0);
    expect(lines[0]?.positions.length).toBeGreaterThanOrEqual(statement?.positions.length ?? 0);
  });

  it("is deterministic", () => {
    const again = new CompilationManager().compile(SOURCE, "js").views?.ast.lines;
    expect(again).toEqual(lines);
  });
});
