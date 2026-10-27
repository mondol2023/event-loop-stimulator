import { BoxGeometry, Color, InstancedMesh, MeshBasicMaterial } from "three";
import { describe, expect, it } from "vitest";
import { machineStateAt } from "@/core/baseline/machineState";
import { RegisterRoles } from "@/core/baseline/x64/registers";
import { createPlaygroundStore } from "../playground/store/playgroundStore";
import { getTimeline } from "../playground/store/timelineHolder";
import { fixtureRun } from "../playground/test/fixtureTimeline";
import { CellPaint } from "./board/cellPaint";
import { placeLines } from "./board/cachePlacement";
import { Flashes } from "./board/flashes";
import { frameloopMode } from "./board/frameloop";
import { RAM_CELL_COUNT, REGION_CELLS, REGION_OFFSET, boardLayout, compositionFor, type BoardLayout, type Vec2 } from "./board/layout";
import { pathLength, pointAlong } from "./board/pulsePath";
import { ramCell, ramFill } from "./board/ramFill";
import { servedFlash } from "./board/served";
import { REGISTER_NAMES, roleOf } from "./board/registerRoles";
import { instructionText, readout } from "./readout";

function recursiveFactorial() {
  const { compiled, simulated } = fixtureRun("recursion-factorial");
  const store = createPlaygroundStore();
  store.getState().applyPipelineEvent({ kind: "response", response: compiled });
  store.getState().applyPipelineEvent({ kind: "response", response: simulated });
  const timeline = getTimeline(store);
  const { baselines } = store.getState().compile;
  if (!timeline || !baselines) throw new Error("the fixture holds no timeline or baselines");
  return { timeline, baselines };
}

describe("placeLines", () => {
  it("gives each tag its own cell, probing past a taken one, and is a pure function of the list", () => {
    expect(placeLines([0, 8, 16], 8)).toEqual([0, 1, 2]);
    expect(placeLines([3, 11, 5], 8)).toEqual([3, 4, 5]);
    const tags = Array.from({ length: 32 }, (_, i) => i * 37 + 5);
    const cells = placeLines(tags, 32);
    expect(new Set(cells).size).toBe(32);
    expect(placeLines(tags, 32)).toEqual(cells);
  });

  it("keeps an older line in its cell when a newer one is added", () => {
    const before = placeLines([10, 18], 8);
    const after = placeLines([10, 18, 26], 8);
    expect(after.slice(0, 2)).toEqual(before);
  });
});

describe("Flashes", () => {
  it("fades from 1 to 0 over the duration, scaled by delta", () => {
    const f = new Flashes(3, 0.15);
    f.start(1);
    expect(f.level(1)).toBe(1);
    expect(f.level(0)).toBe(0);
    expect(f.advance(0.075, false)).toBe(true);
    expect(f.level(1)).toBeCloseTo(0.5, 5);
    expect(f.advance(0.1, false)).toBe(false);
    expect(f.level(1)).toBe(0);
  });

  it("holds a started flash at full level under reduced motion until cleared, without asking for frames", () => {
    const f = new Flashes(2, 0.15);
    f.start(0);
    expect(f.advance(1, true)).toBe(false);
    expect(f.level(0)).toBe(1);
    f.clear();
    expect(f.level(0)).toBe(0);
  });
});

describe("pointAlong", () => {
  const path: Vec2[] = [
    [0, 0],
    [4, 0],
    [4, 3],
  ];
  it("walks the polyline by arc length and reports the heading", () => {
    expect(pathLength(path)).toBe(7);
    expect(pointAlong(path, 0)).toEqual({ x: 0, y: 0, angle: 0 });
    const mid = pointAlong(path, 4 / 7);
    expect(mid.x).toBeCloseTo(4, 5);
    expect(mid.y).toBeCloseTo(0, 5);
    const end = pointAlong(path, 1);
    expect(end).toEqual({ x: 4, y: 3, angle: Math.PI / 2 });
    expect(pointAlong(path, 2).y).toBe(3);
  });
});

describe("CellPaint", () => {
  it("marks instanceColor dirty only when a colour actually changes", () => {
    const mesh = new InstancedMesh(new BoxGeometry(), new MeshBasicMaterial(), 4);
    const paint = new CellPaint(mesh);
    paint.paint(0, new Color("#ff0000"));
    paint.paint(1, new Color("#00ff00"));
    paint.commit();
    const version = mesh.instanceColor?.version ?? -1;
    expect(version).toBeGreaterThan(0);

    paint.paint(0, new Color("#ff0000"));
    paint.commit();
    expect(mesh.instanceColor?.version).toBe(version);

    paint.paint(0, new Color("#0000ff"));
    paint.commit();
    expect(mesh.instanceColor?.version).toBe(version + 1);
    paint.reset();
    paint.paint(0, new Color("#0000ff"));
    paint.commit();
    expect(mesh.instanceColor?.version).toBe(version + 2);
  });
});

describe("servedFlash", () => {
  it("gives every answered access a hit or miss word on a cache level, and a miss also lights RAM", () => {
    expect(servedFlash("l1")).toEqual({ l1: "hit", l2: null, ram: false });
    expect(servedFlash("l2")).toEqual({ l1: null, l2: "hit", ram: false });
    expect(servedFlash("ram")).toEqual({ l1: "miss", l2: "miss", ram: true });
    expect(servedFlash(null)).toEqual({ l1: null, l2: null, ram: false });
  });
});

describe("frameloopMode", () => {
  it("is never while hidden, always while playing and demand while paused", () => {
    expect(frameloopMode({ playing: true, hidden: true })).toBe("never");
    expect(frameloopMode({ playing: false, hidden: true })).toBe("never");
    expect(frameloopMode({ playing: true, hidden: false })).toBe("always");
    expect(frameloopMode({ playing: false, hidden: false })).toBe("demand");
  });
});

describe("registerRoles", () => {
  it("lists the 16 registers in encoding order, each named by its first V8 role", () => {
    expect(REGISTER_NAMES).toHaveLength(16);
    expect(REGISTER_NAMES.slice(0, 8)).toEqual(["rax", "rcx", "rdx", "rbx", "rsp", "rbp", "rsi", "rdi"]);
    expect(roleOf("rax")).toBe("accumulator");
    expect(roleOf("rsi")).toBe("context");
    expect(roleOf("rdi")).toBe("JS function");
    expect(roleOf("r13")).toBe("root");
    expect(roleOf("r14")).toBe("cage base");
    expect(roleOf("rcx")).toBe("");
    for (const reg of Object.values(RegisterRoles)) expect(REGISTER_NAMES).toContain(reg);
  });
});

describe("layout", () => {
  const cellCount = (l: BoardLayout) => l.l1.positions.length + l.l2.positions.length + Object.values(l.ram).reduce((n, g) => n + g.positions.length, 0);

  it.each(["wide", "tall"] as const)("%s: has every element, every cell inside the board, and a bus path to each region", (name) => {
    const l = boardLayout(name);
    expect(l.registers).toHaveLength(16);
    expect(l.l1.positions).toHaveLength(8);
    expect(l.l2.positions).toHaveLength(32);
    expect(cellCount(l)).toBe(8 + 32 + RAM_CELL_COUNT);
    const [w, h] = l.size;
    const inside = ([x, y]: Vec2) => Math.abs(x) <= w / 2 && Math.abs(y) <= h / 2;
    for (const g of [l.l1, l.l2, ...Object.values(l.ram)]) expect(g.positions.every(inside)).toBe(true);
    expect(l.registers.every((r) => inside([r.x, r.y]))).toBe(true);
    for (const region of ["code", "stack", "young", "old"] as const) {
      const path = l.memoryBus[region];
      expect(path.length).toBeGreaterThan(2);
      expect(path[0]).toEqual(l.memoryBus.stack[0]);
      expect(l.ram[region].positions).toHaveLength(REGION_CELLS[region]);
    }
  });

  it("packs the four RAM regions into one 208-cell range with no overlap", () => {
    const spans = (["stack", "young", "old", "code"] as const).map((r) => [REGION_OFFSET[r], REGION_OFFSET[r] + REGION_CELLS[r]] as const).sort((a, b) => a[0] - b[0]);
    expect(spans[0]?.[0]).toBe(0);
    for (let i = 1; i < spans.length; i++) expect(spans[i]?.[0]).toBe(spans[i - 1]?.[1]);
    expect(spans.at(-1)?.[1]).toBe(RAM_CELL_COUNT);
  });

  it("chooses the wide composition from an aspect of 1.6 up", () => {
    expect(compositionFor(1.6)).toBe("wide");
    expect(compositionFor(5)).toBe("wide");
    expect(compositionFor(1.59)).toBe("tall");
  });
});

describe("ramFill and readout on recursive factorial", () => {
  const { timeline, baselines } = recursiveFactorial();
  const ticks = Array.from({ length: timeline.length }, (_, i) => timeline.at(i));

  it("fills the stack region deeper as the call stack grows, and each region within its cell count", () => {
    const shallow = ticks.reduce((a, b) => (b.callStack.length < a.callStack.length ? b : a));
    const deep = ticks.reduce((a, b) => (b.callStack.length > a.callStack.length ? b : a));
    expect(deep.callStack.length).toBeGreaterThan(shallow.callStack.length);
    expect(ramFill(deep).stack).toBeGreaterThan(ramFill(shallow).stack);
    for (const t of ticks) {
      const fill = ramFill(t);
      expect(fill.stack).toBeLessThanOrEqual(64);
      expect(fill.young).toBeLessThanOrEqual(64);
      expect(fill.old).toBeLessThanOrEqual(64);
    }
  });

  it("maps a cache line tag to a stable cell inside its region", () => {
    expect(ramCell("code", 21)).toBe(REGION_OFFSET.code + (21 % 16));
    expect(ramCell("stack", 70)).toBe(REGION_OFFSET.stack + (70 % 64));
    expect(ramCell("old", 130)).toBe(REGION_OFFSET.old + (130 % 64));
  });

  it("reads rax, rsi and the instruction in the syntax the pane shows", () => {
    const at = ticks.find((t) => {
      const baseline = t.pos ? baselines[t.pos.functionId] : undefined;
      return baseline !== undefined && machineStateAt(t, baseline) !== null;
    });
    if (!at?.pos) throw new Error("no tick inside baseline code");
    const baseline = baselines[at.pos.functionId];
    const machine = baseline ? machineStateAt(at, baseline) : null;
    if (!baseline || !machine) throw new Error("no machine state");

    const att = instructionText(baseline, machine.asmLine, "att");
    const intel = instructionText(baseline, machine.asmLine, "intel");
    expect(att).toBe(baseline.instructions[machine.asmLine]?.asm);
    expect(intel).not.toBe("");
    const hex = (v: bigint) => `0x${v.toString(16)}`;
    expect(readout({ tick: at, machine, hw: null }, baseline, "att")).toBe(`${att}; rax=${hex(machine.registers.rax)}, rsi=${hex(machine.registers.rsi)}`);
    expect(readout({ tick: at, machine, hw: null }, baseline, "intel")).toBe(`${intel}; rax=${hex(machine.registers.rax)}, rsi=${hex(machine.registers.rsi)}`);
  });

  it("reads as idle with no machine state", () => {
    expect(readout(null, undefined, "att")).toBe("No baseline code on this tick: Node is between tasks, so the CPU waits.");
    expect(readout({ tick: ticks[0]!, machine: null, hw: null }, undefined, "att")).toBe("No baseline code on this tick: Node is between tasks, so the CPU waits.");
  });
});
