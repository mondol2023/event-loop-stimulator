import { describe, expect, it } from "vitest";
import { CompilationManager } from "@/core/compile/CompilationManager";
import { positionsForSourceRange } from "./types";
import { buildLineIndex, linesForPositions, positionsForLine } from "./lineIndex";

// Copy of tests/conformance/fixtures/nexttick-vs-promise.cjs (core/ tests may not read files or import tests/).
const src = `// After the main script, process.nextTick callbacks drain first, then promise jobs; the two queues then alternate.
console.log("sync 1");

Promise.resolve()
  .then(() => {
    console.log("promise 1");
    process.nextTick(() => console.log("tick scheduled from a promise job"));
  })
  .then(() => console.log("promise 2"));

process.nextTick(() => {
  console.log("tick 1");
  Promise.resolve().then(() => console.log("promise scheduled from a tick"));
  process.nextTick(() => console.log("tick scheduled from a tick"));
});

process.nextTick(() => console.log("tick 2"));

Promise.resolve().then(() => console.log("promise 3"));

console.log("sync 2");
`;

const r = new CompilationManager().compile(src, "js");
if (!r.views || !r.program || r.strippedJs === undefined) throw new Error("not compiled");
const program = r.program;
const index = buildLineIndex(r.program, r.views, r.strippedJs);

describe("LineIndex", () => {
  it.each(["ast", "bytecode", "asm", "binary"] as const)("round-trips every populated %s line", (pane) => {
    let populated = 0;
    index.panes[pane].forEach((_, line) => {
      const pos = positionsForLine(index, pane, line);
      if (pos.length === 0) return;
      populated++;
      expect(linesForPositions(index, pane, pos)).toContain(line);
    });
    expect(populated).toBeGreaterThan(0);
  });

  it("maps the console.log(\"sync 2\") call to its 0-based source line", () => {
    const call = 'console.log("sync 2");';
    const start = src.indexOf(call);
    const want = src.split("\n").findIndex((l) => l.includes(call));
    expect(start).toBeGreaterThan(0);
    expect(want).toBeGreaterThan(0);
    const pos = positionsForSourceRange(program, { start, end: start + call.length });
    expect(pos.length).toBeGreaterThan(0);
    expect(linesForPositions(index, "source", pos)).toEqual([want]);
  });

  it("returns [] out of range", () => {
    expect(positionsForLine(index, "bytecode", 99999)).toEqual([]);
    expect(positionsForLine(index, "source", -1)).toEqual([]);
    expect(linesForPositions(index, "asm", [])).toEqual([]);
  });

  it("is plain data", () => {
    expect(JSON.parse(JSON.stringify(index))).toEqual(index);
  });
});
