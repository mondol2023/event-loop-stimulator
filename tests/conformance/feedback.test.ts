import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { extractFeedback } from "../../scripts/conformance/feedback.mts";

// `debugprint.sample.txt` is the stdout of real node 24.19.0 (CRLF folded to LF, as the recorder's
// normalizeOutput does before extraction) running
// `%DebugPrint(f)` under --allow-natives-syntax --no-lazy-feedback-allocation
// on a function with a store, a keyed load, a call and two named loads (one of
// them never reached).
const HERE = dirname(fileURLToPath(import.meta.url));
const SAMPLE = readFileSync(join(HERE, "support", "debugprint.sample.txt"), "utf8");

describe("extractFeedback (D2)", () => {
  it("keeps the function name and the property-IC slots of a real %DebugPrint, in print order", () => {
    expect(extractFeedback(SAMPLE)).toBe(
      "function f\n" +
        "slot #0 SetNamedSloppy MONOMORPHIC\n" +
        "slot #2 LoadKeyed MONOMORPHIC\n" +
        "slot #6 LoadProperty UNINITIALIZED\n" +
        "slot #8 LoadProperty MONOMORPHIC\n",
    );
  });

  it("drops slots of every other kind, such as Call", () => {
    expect(SAMPLE).toContain("slot #4 Call MONOMORPHIC");
    expect(extractFeedback(SAMPLE)).not.toContain("Call");
  });

  it("drops a trailing ` {` from a slot line", () => {
    expect(SAMPLE).toMatch(/slot #6 LoadProperty UNINITIALIZED \{/);
    expect(extractFeedback(SAMPLE)).not.toContain("{");
  });

  it("keeps all seven slot kinds and the four IC states", () => {
    const kinds = ["LoadProperty", "LoadKeyed", "SetNamedSloppy", "SetNamedStrict", "SetKeyedSloppy", "SetKeyedStrict", "DefineNamedOwn"];
    const states = ["UNINITIALIZED", "MONOMORPHIC", "POLYMORPHIC", "MEGAMORPHIC"];
    const text = [
      " - shared_info: 0x1 <SharedFunctionInfo k>",
      ...kinds.map((kind, i) => ` - slot #${i} ${kind} ${states[i % 4]}`),
    ].join("\n");
    expect(extractFeedback(text)).toBe(
      `function k\n${kinds.map((kind, i) => `slot #${i} ${kind} ${states[i % 4]}\n`).join("")}`,
    );
  });

  it("starts a new `function NAME` block for each %DebugPrint in the output", () => {
    const two = `${SAMPLE.replace(/<SharedFunctionInfo f>/g, "<SharedFunctionInfo g>")}${SAMPLE}`;
    const out = extractFeedback(two);
    expect(out.startsWith("function g\n")).toBe(true);
    expect(out.split("\n").filter((l) => l.startsWith("function "))).toEqual(["function g", "function f"]);
  });

  it("returns the empty string when nothing matches", () => {
    expect(extractFeedback("")).toBe("");
    expect(extractFeedback("hello\nworld\n")).toBe("");
  });

  it("ignores a nested `shared_info` line that is not at the top level", () => {
    const text = " - shared_info: 0x1 <SharedFunctionInfo outer>\n     - shared_info: 0x2 <SharedFunctionInfo inner>\n";
    expect(extractFeedback(text)).toBe("function outer\n");
  });
});
