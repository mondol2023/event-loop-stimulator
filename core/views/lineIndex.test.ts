import { describe, expect, it } from "vitest";
import { CompilationManager } from "@/core/compile/CompilationManager";
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
const index = buildLineIndex(r.program, r.views, r.strippedJs);

describe("LineIndex", () => {
  it("round-trips every populated bytecode line", () => {
    let populated = 0;
    index.panes.bytecode.forEach((_, line) => {
      const pos = positionsForLine(index, "bytecode", line);
      if (pos.length === 0) return;
      populated++;
      expect(linesForPositions(index, "bytecode", pos)).toContain(line);
    });
    expect(populated).toBeGreaterThan(0);
  });

  it("maps a console.log call position to its 0-based source line", () => {
    const lines = r.strippedJs?.split("\n") ?? [];
    const want = lines.findIndex((l) => l.includes('console.log("sync 2")'));
    expect(want).toBeGreaterThan(0);
    const pos = positionsForLine(index, "source", want);
    expect(pos.length).toBeGreaterThan(0);
    expect(linesForPositions(index, "source", pos)).toContain(want);
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
