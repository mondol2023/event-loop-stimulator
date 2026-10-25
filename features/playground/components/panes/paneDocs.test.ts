import { describe, expect, it } from "vitest";
import type { Pane } from "@/core/views/lineIndex";
import { fixtureRun, runSource } from "../../test/fixtureTimeline";
import { paneDoc } from "./paneDocs";

const PANES: readonly Exclude<Pane, "source">[] = ["ast", "bytecode", "asm", "binary"];

describe("paneDoc", () => {
  const { compiled } = fixtureRun("nexttick-vs-promise");
  const { views, lineIndex } = compiled;
  if (!views || !lineIndex) throw new Error("the fixture must compile");

  // Highlights address document lines by LineIndex line, so the two must count the same lines.
  it.each(PANES)("%s has exactly the lines the LineIndex counts", (pane) => {
    expect(paneDoc(views, pane).split("\n")).toHaveLength(lineIndex.panes[pane].length);
  });

  it("keeps the line count when asm switches to Intel syntax", () => {
    const att = paneDoc(views, "asm", { asmSyntax: "att" });
    const intel = paneDoc(views, "asm", { asmSyntax: "intel" });
    expect(intel.split("\n")).toHaveLength(att.split("\n").length);
    expect(intel).not.toBe(att);
  });
});

// A string literal's raw text can contain a line break (a line continuation, or a raw U+2028); the AST view copies it.
describe("paneDoc with line breaks inside a literal", () => {
  const backslash = String.fromCharCode(92);
  const source = [`console.log("a${backslash}`, `b");`, `console.log("c${String.fromCharCode(0x2028)}d");`, "console.log(1);"].join("\n");
  const compiled = runSource(source, 1).find((r) => r.type === "compiled");
  if (compiled?.type !== "compiled" || !compiled.views || !compiled.lineIndex) throw new Error("the source must compile");
  const { views, lineIndex } = compiled;

  it.each(PANES)("%s still has exactly the lines the LineIndex counts", (pane) => {
    expect(paneDoc(views, pane).split("\n")).toHaveLength(lineIndex.panes[pane].length);
  });

  it("escapes the break instead of splitting the line", () => {
    const literal = paneDoc(views, "ast")
      .split("\n")
      .find((l) => l.includes("Literal") && l.includes("a"));
    expect(literal).toContain(`${backslash}u000a`);
  });
});
