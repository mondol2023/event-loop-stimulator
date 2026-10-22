import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { discoverFixtures } from "../../scripts/conformance/fixtures.mts";
import { simulate } from "@/core/timeline/simulate";

// Garbage collection is Illustrative: the modeled young generation only reads the heap, so its
// size must never change what a program prints (the exactness firewall).

const ROOT = dirname(fileURLToPath(import.meta.url));
const RUNNABLE = discoverFixtures(ROOT).filter((f) => f.kind === "program" && f.meta.expect !== "refused");
const YOUNG_SIZES = [1024, 16 * 1024, 1024 * 1024] as const;

describe("the young-generation size and the program fixtures", () => {
  it("covers a real set of fixtures", () => {
    expect(RUNNABLE.length).toBeGreaterThan(20);
  });

  it.each(RUNNABLE.map((f) => f.name))("%s: stdout, stderr and exit code are the same at 1 KB, 16 KB and 1 MB", (name) => {
    const fixture = RUNNABLE.find((f) => f.name === name);
    if (!fixture) throw new Error(name);
    const [small, medium, large] = YOUNG_SIZES.map((youngBytes) => simulate(fixture.source, fixture.lang, { gc: { youngBytes } }));
    for (const r of [small, medium]) {
      expect({ stdout: r?.stdout, stderr: r?.stderr, exitCode: r?.exitCode }).toEqual({ stdout: large?.stdout, stderr: large?.stderr, exitCode: large?.exitCode });
    }
  });
});

describe("garbage collection in a recorded run", () => {
  const SOURCE = "const keep = [];\nfor (let i = 0; i < 120; i++) { keep.push({ i }); const scratch = { t: i, u: [i] }; }\nconsole.log(keep.length);";

  it("adds gc ticks that carry the event, and moves kept objects to the old generation", () => {
    const r = simulate(SOURCE, "js", { gc: { youngBytes: 1024 } });
    expect(r.stdout).toBe("120\n");
    const gcTicks = r.ticks.filter((t) => t.phase === "gc");
    expect(gcTicks.length).toBeGreaterThan(1);
    expect(gcTicks[0]?.narration).toMatch(/scavenge \(Illustrative\)/);
    expect(gcTicks[0]?.v8.heap.lastGc?.type).toBe("scavenge");
    const last = r.ticks.at(-1);
    expect(last?.v8.heap.old.objectCount).toBeGreaterThan(0);
    expect(last?.v8.heap.young.usedBytes).toBeLessThanOrEqual(last?.v8.heap.young.capacityBytes ?? 0);
  });

  it("counts gc ticks the same with recording off, so a limit stops the run at the same place", () => {
    const options = { gc: { youngBytes: 1024 } };
    const recorded = simulate(SOURCE, "js", options);
    const unrecorded = simulate(SOURCE, "js", { ...options, record: false });
    expect(unrecorded.tickCount).toBe(recorded.tickCount);
    expect(unrecorded.stdout).toBe(recorded.stdout);
    const loop = "const keep = []; while (true) { keep.push({}); keep.length = 0; }";
    const a = simulate(loop, "js", options);
    const b = simulate(loop, "js", { ...options, record: false });
    expect(b.stop).toEqual(a.stop);
    expect(b.tickCount).toBe(a.tickCount);
  });

  it("does not keep a gc tick out of the exit", () => {
    const r = simulate(SOURCE, "js", { gc: { youngBytes: 1024 } });
    expect(r.ticks.at(-1)?.phase).toBe("exit");
  });
});
