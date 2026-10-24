import { describe, expect, it } from "vitest";
import { jobBoundaries } from "./boundaries";
import { simulate } from "./simulate";

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



describe("jobBoundaries", () => {
  it("is [] for no ticks", () => {
    expect(jobBoundaries([])).toEqual([]);
  });
  it("starts at 0, increases, and lists only real phase changes", () => {
    const { ticks } = simulate(src, "js");
    const b = jobBoundaries(ticks);
    expect(b[0]).toBe(0);
    expect(b.length).toBeGreaterThan(1);
    for (let k = 1; k < b.length; k++) {
      const i = b[k] as number;
      expect(i).toBeGreaterThan(b[k - 1] as number);
      const [cur, prev] = [ticks[i], ticks[i - 1]];
      expect(cur?.phase !== prev?.phase || cur?.loopPhase !== prev?.loopPhase).toBe(true);
    }
  });
});
