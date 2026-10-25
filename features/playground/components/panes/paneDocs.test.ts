import { describe, expect, it } from "vitest";
import type { Pane } from "@/core/views/lineIndex";
import { fixtureRun } from "../../test/fixtureTimeline";
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
