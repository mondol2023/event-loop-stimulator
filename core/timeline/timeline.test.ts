import { describe, expect, it } from "vitest";
import { simulate } from "./simulate";

const ticksOf = (source: string) => simulate(source, "js").ticks;
const narrations = (source: string) => ticksOf(source).map((t) => t.narration);

describe("the recorded timeline", () => {
  it("numbers ticks from 0, starts in the script and ends with the exit", () => {
    const ticks = ticksOf("console.log(1);");
    expect(ticks.map((t) => t.index)).toEqual(ticks.map((_, i) => i));
    expect(ticks[0]?.phase).toBe("script");
    expect(ticks.at(-1)?.phase).toBe("exit");
    expect(ticks.at(-1)?.narration).toMatch(/exits with code 0/);
  });

  it("records no ticks for a refused program", () => {
    const r = simulate("enum E { A }", "ts");
    expect(r.ticks).toEqual([]);
    expect(r.tickCount).toBe(0);
  });

  it("points each dispatch tick at its instruction and source line", () => {
    const ticks = ticksOf("let a = 1;\nlet b = 2;\nconsole.log(a + b);");
    const lines = ticks.flatMap((t) => (t.pos && t.currentLine !== null ? [t.currentLine] : []));
    expect(lines).toContain(1);
    expect(lines).toContain(3);
    expect(ticks.find((t) => t.pos === null)?.currentLine).toBeNull();
  });

  it("shows the call stack with registers and the accumulator as value snapshots", () => {
    const ticks = ticksOf("function f(n) { const s = 'hi'; return n + s.length; }\nf(41);");
    const inF = ticks.find((t) => t.callStack.at(-1)?.functionName === "f");
    expect(inF).toBeDefined();
    expect(inF?.callStack.map((f) => f.functionName)).toEqual(["", "f"]);
    const frame = inF?.callStack.at(-1);
    expect(frame?.accumulator).toEqual({ kind: "oddball", name: "undefined" });
    expect(frame?.functionId).toBe(1);
  });

  it("snapshots a Smi with its tagged word and an object with its Map", () => {
    const ticks = ticksOf("const o = { x: 1 };\nconst n = 21;\nconsole.log(o, n);");
    const values = ticks.flatMap((t) => t.callStack.flatMap((f) => [f.accumulator, ...f.registers]));
    expect(values).toContainEqual({ kind: "smi", value: 21, tagged: "0x0000002a" });
    expect(values.some((v) => v.kind === "object" && v.preview === "Object")).toBe(true);
  });

  it("keeps the console lines, the virtual time and the loop phase", () => {
    const ticks = ticksOf("setTimeout(() => console.log('late'), 100);\nconsole.log('early');");
    const last = ticks.at(-1);
    expect(last?.console).toEqual([
      { stream: "stdout", text: "early\n", origin: "console" },
      { stream: "stdout", text: "late\n", origin: "console" },
    ]);
    expect(last?.virtualTimeMs).toBe(100);
    const phases = ticks.map((t) => t.loopPhase);
    expect(phases[0]).toBeNull();
    expect(phases).toContain("timers");
    expect(phases).toContain("poll");
  });

  it("lists pending timers and immediates with their virtual due time", () => {
    const ticks = ticksOf("setTimeout(function later() {}, 250);\nsetImmediate(function soon() {});\nconsole.log('x');");
    const withHosts = ticks.find((t) => t.hostApis.length === 2);
    expect(withHosts?.hostApis).toEqual([
      expect.objectContaining({ kind: "timeout", dueMs: 250, label: "setTimeout(later, 250)" }),
      expect.objectContaining({ kind: "immediate", dueMs: null, label: "setImmediate(soon)" }),
    ]);
    expect(withHosts?.timerQueue.map((t) => t.label)).toEqual(["setTimeout(later, 250)"]);
    expect(withHosts?.immediateQueue.map((t) => t.label)).toEqual(["setImmediate(soon)"]);
  });

  it("shows the nextTick and microtask queues, and runs nextTicks first", () => {
    const ticks = ticksOf("Promise.resolve().then(function p() {});\nprocess.nextTick(function t() {});\nconsole.log('s');");
    const queued = ticks.find((t) => t.microtaskQueue.length === 1 && t.nextTickQueue.some((x) => x.label.includes("t")));
    expect(queued).toBeDefined();
    const starts = ticks.filter((t) => t.phase === "nextTick" || t.phase === "microtask").map((t) => t.phase);
    expect(starts.indexOf("nextTick")).toBeLessThan(starts.indexOf("microtask"));
  });

  it("is deterministic: two runs give deeply equal timelines", () => {
    const src = "const o = { a: 1 }; o.b = [1, 2.5]; Promise.resolve(o).then((v) => console.log(v)); setTimeout(() => process.nextTick(() => console.log('t')), 5);";
    expect(simulate(src, "js").ticks).toStrictEqual(simulate(src, "js").ticks);
  });

  it("shares unchanged sub-objects between neighbouring ticks", () => {
    const ticks = ticksOf("let a = 1; let b = 2; let c = 3; console.log(a + b + c);");
    const same = ticks.slice(1).filter((t, i) => t.v8.maps === ticks[i]?.v8.maps);
    expect(same.length).toBeGreaterThan(ticks.length / 2);
  });

  it("never records more than the tick limit and counts the same with recording off", () => {
    const on = simulate("while (true) {}", "js");
    const off = simulate("while (true) {}", "js", { record: false });
    expect(on.stop).toEqual({ kind: "limit", limit: "ticks" });
    expect(on.ticks.length).toBe(5000);
    expect(off.ticks).toEqual([]);
    expect(off.tickCount).toBe(5000);
    expect(on.tickCount).toBe(5000);
  });
});

describe("narration", () => {
  it("names the Map transition when a property is added", () => {
    const text = narrations("const o = { x: 1 };\no.y = 2;\nconsole.log(o);").join("\n");
    expect(text).toMatch(/Property `y` added → new hidden class Map#\d+ \(transition from Map#\d+\)\./);
  });

  it("names the elements-kind transition and why", () => {
    const text = narrations("const a = [1, 2];\na.push(1.5);\nconsole.log(a);").join("\n");
    expect(text).toMatch(/PACKED_SMI_ELEMENTS to PACKED_DOUBLE_ELEMENTS because `1\.5` isn't a Smi/);
  });

  it("names an inline-cache state change", () => {
    const text = narrations("function get(o) { return o.x; }\nget({ x: 1 });\nget({ x: 2 });\nget({ x: 1, y: 2 });").join("\n");
    expect(text).toMatch(/LoadProperty slot #\d+ in `get` went UNINITIALIZED → MONOMORPHIC/);
    expect(text).toMatch(/MONOMORPHIC → POLYMORPHIC/);
  });

  it("explains that PerformPromiseThen queued a PromiseReactionJob", () => {
    const text = narrations("Promise.resolve().then(() => {});").join("\n");
    expect(text).toContain("PerformPromiseThen queued a PromiseReactionJob; V8 runs microtasks before Node's timers phase.");
  });

  it("says Node (not V8) owns nextTick, timers and immediates", () => {
    const text = narrations("process.nextTick(() => {}); setTimeout(() => {}, 5); setImmediate(() => {});").join("\n");
    expect(text).toMatch(/process\.nextTick queued/);
    expect(text).toMatch(/Node's timers/);
    expect(text).toMatch(/Node's check phase/);
  });

  it("narrates the console write, the loop phases and the exit", () => {
    const text = narrations("setTimeout(() => console.log('hi'), 1);").join("\n");
    expect(text).toMatch(/console\.log wrote `hi\\n` to stdout/);
    expect(text).toMatch(/libuv enters the timers phase/);
    expect(text).toMatch(/Node exits with code 0/);
  });

  it("gives every tick a non-empty narration", () => {
    const src = "async function f() { await 1; throw new Error('x'); }\nf().catch(() => {}); setTimeout(() => {}, 1);";
    for (const t of ticksOf(src)) expect(t.narration.length, `tick ${t.index}`).toBeGreaterThan(0);
  });
});
