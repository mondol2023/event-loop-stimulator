import { describe, expect, it } from "vitest";
import { runSource } from "@/core/interpreter/interpreterTestWorld";
import { asFunctionId, type MapId } from "@/core/shared/ids";
import { type BinaryOpSite, type DeoptEvent, type IcTransitionSite, TieringModel, type TierEvent, type TierUpEvent } from "./TieringModel";

const F = asFunctionId(1);
const LENGTH = 20;

const invoke = (model: TieringModel, times: number, functionId = F, bytecodeLength = LENGTH): void => {
  for (let i = 0; i < times; i++) model.onInvoke({ functionId, bytecodeLength });
};

const tierOf = (model: TieringModel, functionId = F) => model.tiers().byFunction[functionId];

/** Calls `F` until Maglev has it, then drops the events so far. */
function inMaglev(model: TieringModel): void {
  for (let i = 0; i < 2000 && tierOf(model) !== "maglev"; i++) invoke(model, 1);
  expect(tierOf(model)).toBe("maglev");
  model.drainEvents();
}

const icSite = (over: Partial<IcTransitionSite> = {}): IcTransitionSite => ({
  functionId: F,
  bytecodeOffset: 12,
  slot: 3,
  from: "UNINITIALIZED",
  to: "MONOMORPHIC",
  mapId: 1 as MapId,
  mapCount: 1,
  ...over,
});

const secondMap = (): IcTransitionSite => icSite({ from: "MONOMORPHIC", to: "POLYMORPHIC", mapId: 2 as MapId, mapCount: 2 });

const opSite = (over: Partial<BinaryOpSite> = {}): BinaryOpSite => ({
  functionId: F,
  bytecodeOffset: 30,
  opcode: "Add",
  left: 1,
  right: 2,
  result: 3,
  ...over,
});

const tierUps = (events: readonly TierEvent[]): TierUpEvent[] => events.filter((e): e is TierUpEvent => e.kind === "tier-up");
const deopts = (events: readonly TierEvent[]): DeoptEvent[] => events.filter((e): e is DeoptEvent => e.kind === "deopt");

describe("tier-up by invocation count", () => {
  it("moves from Ignition to Sparkplug on the 8th call", () => {
    const model = new TieringModel();
    invoke(model, 7);
    expect(tierOf(model)).toBe("ignition");
    expect(model.drainEvents()).toEqual([]);
    invoke(model, 1);
    expect(tierOf(model)).toBe("sparkplug");
    expect(model.drainEvents()).toMatchObject([{ kind: "tier-up", functionId: F, from: "ignition", to: "sparkplug", osr: false }]);
  });

  it("moves from Sparkplug to Maglev on the 400th call", () => {
    const model = new TieringModel();
    invoke(model, 399);
    expect(tierOf(model)).toBe("sparkplug");
    model.drainEvents();
    invoke(model, 1);
    expect(tierOf(model)).toBe("maglev");
    expect(model.drainEvents()).toMatchObject([{ kind: "tier-up", from: "sparkplug", to: "maglev", osr: false }]);
  });

  it("moves from Maglev to Turbofan on the 3000th call", () => {
    const model = new TieringModel();
    invoke(model, 2999);
    expect(tierOf(model)).toBe("maglev");
    invoke(model, 1);
    expect(tierOf(model)).toBe("turbofan");
    expect(tierUps(model.drainEvents()).map((e) => e.to)).toEqual(["sparkplug", "maglev", "turbofan"]);
  });

  it("counts bytes: a back edge charges its loop's length toward the same budget the calls spend", () => {
    const model = new TieringModel();
    invoke(model, 4, F, 100);
    expect(tierOf(model)).toBe("ignition");
    // 4 calls spent 400 bytes; one back edge over a 400-byte loop spends 400 more, the 8 calls' worth.
    model.onBackEdge({ functionId: F, bytecodeLength: 100, bytecodeOffset: 450, loopHeaderOffset: 50 });
    expect(tierOf(model)).toBe("sparkplug");
    expect(model.drainEvents()).toMatchObject([{ kind: "tier-up", to: "sparkplug", osr: true }]);
  });

  it("lists a function from its first invocation and tracks functions apart", () => {
    const model = new TieringModel();
    expect(model.tiers().byFunction).toEqual({});
    invoke(model, 1);
    invoke(model, 8, asFunctionId(2));
    expect(model.tiers().byFunction).toEqual({ 1: "ignition", 2: "sparkplug" });
  });
});

describe("on-stack replacement", () => {
  const length = 100;
  const back = (model: TieringModel): void => model.onBackEdge({ functionId: F, bytecodeLength: length, bytecodeOffset: 150, loopHeaderOffset: 50 });

  it("replaces a hot loop's code from its back edges: Sparkplug, Maglev at 100 and Turbofan at 500 loop lengths", () => {
    const model = new TieringModel();
    model.onInvoke({ functionId: F, bytecodeLength: length });
    const events: TierEvent[] = [];
    // One back edge charges the loop's 100 bytes, which is one invocation's worth of this function.
    for (let i = 0; i < 510; i++) {
      back(model);
      events.push(...model.drainEvents());
    }
    expect(tierUps(events).map((e) => [e.from, e.to, e.osr])).toEqual([
      ["ignition", "sparkplug", true],
      ["sparkplug", "maglev", true],
      ["maglev", "turbofan", true],
    ]);
  });

  it("fires Maglev OSR after 100 loop lengths of back edges, not before", () => {
    const model = new TieringModel();
    model.onInvoke({ functionId: F, bytecodeLength: length });
    for (let i = 0; i < 99; i++) back(model);
    expect(tierOf(model)).toBe("sparkplug");
    back(model);
    expect(tierOf(model)).toBe("maglev");
  });

  it("waits for an IC change's budget before replacing code", () => {
    const model = new TieringModel();
    model.onInvoke({ functionId: F, bytecodeLength: length });
    model.onIcTransition(icSite());
    for (let i = 0; i < 499; i++) back(model);
    expect(tierOf(model)).toBe("sparkplug");
    back(model);
    expect(tierOf(model)).toBe("maglev");
  });
});

describe("an IC change", () => {
  it("raises the optimization budget to 500 invocations, so Maglev waits for the 501st call", () => {
    const model = new TieringModel();
    invoke(model, 1);
    model.onIcTransition(icSite());
    invoke(model, 499);
    expect(tierOf(model)).toBe("sparkplug");
    invoke(model, 1);
    expect(tierOf(model)).toBe("maglev");
  });

  it("deopts Maglev code with kWrongMap when a second Map reaches the IC", () => {
    const model = new TieringModel();
    invoke(model, 1);
    model.onIcTransition(icSite());
    inMaglev(model);
    model.onIcTransition(secondMap());
    expect(model.drainEvents()).toEqual([
      { kind: "deopt", truth: "modeled", functionId: F, from: "maglev", to: "sparkplug", reason: "kWrongMap", bytecodeOffset: 12 },
    ]);
    expect(tierOf(model)).toBe("sparkplug");
  });

  it("deopts Turbofan code the same way", () => {
    const model = new TieringModel();
    invoke(model, 3000);
    model.drainEvents();
    expect(tierOf(model)).toBe("turbofan");
    model.onIcTransition(secondMap());
    expect(deopts(model.drainEvents())).toMatchObject([{ from: "turbofan", to: "sparkplug", reason: "kWrongMap" }]);
  });

  it("does not deopt unoptimized code, nor a site that had no feedback yet", () => {
    const model = new TieringModel();
    invoke(model, 20);
    model.drainEvents();
    model.onIcTransition(secondMap());
    expect(model.drainEvents()).toEqual([]);
    inMaglev(model);
    model.onIcTransition(icSite({ bytecodeOffset: 40, slot: 7 }));
    expect(model.drainEvents()).toEqual([]);
    expect(tierOf(model)).toBe("maglev");
  });

  it("does not reach Turbofan on the call after a re-Maglev that follows a Turbofan deopt", () => {
    const model = new TieringModel();
    invoke(model, 3000);
    expect(tierOf(model)).toBe("turbofan");
    model.onIcTransition(secondMap());
    model.drainEvents();
    invoke(model, 500);
    expect(tierOf(model)).toBe("maglev");
    invoke(model, 1);
    expect(tierOf(model)).toBe("maglev");
    invoke(model, 2598);
    expect(tierOf(model)).toBe("maglev");
    invoke(model, 1);
    expect(tierOf(model)).toBe("turbofan");
  });

  it("re-arms after a deopt, so the function is optimized again only 500 calls later", () => {
    const model = new TieringModel();
    inMaglev(model);
    model.onIcTransition(secondMap());
    model.drainEvents();
    invoke(model, 499);
    expect(tierOf(model)).toBe("sparkplug");
    invoke(model, 1);
    expect(tierOf(model)).toBe("maglev");
  });
});

describe("the call count on a tier-up", () => {
  it("is the threshold when nothing delays the tier-up, and the real count when a re-Maglev does", () => {
    const model = new TieringModel();
    invoke(model, 3000);
    expect(tierUps(model.drainEvents()).map((e) => e.invocations)).toEqual([8, 400, 3000]);
    model.onIcTransition(secondMap());
    model.drainEvents();
    invoke(model, 500);
    expect(tierUps(model.drainEvents()).map((e) => [e.to, e.invocations])).toEqual([["maglev", 3500]]);
  });
});

describe("binary-operation hints", () => {
  it("deopts Maglev code with kNotASmi when a non-Smi Number widens a SignedSmall hint", () => {
    const model = new TieringModel();
    model.onBinaryOp(opSite());
    inMaglev(model);
    model.onBinaryOp(opSite({ left: 1.5, result: 3.5 }));
    expect(model.drainEvents()).toEqual([
      { kind: "deopt", truth: "modeled", functionId: F, from: "maglev", to: "sparkplug", reason: "kNotASmi", bytecodeOffset: 30 },
    ]);
  });

  it("deopts with kOverflow when Smi operands leave the Smi range", () => {
    const model = new TieringModel();
    model.onBinaryOp(opSite());
    inMaglev(model);
    model.onBinaryOp(opSite({ left: 2 ** 30 - 1, right: 1, result: 2 ** 30 }));
    expect(deopts(model.drainEvents())).toMatchObject([{ reason: "kOverflow" }]);
  });

  it("deopts with kLostPrecision when Smi operands give a fraction and kMinusZero for -0", () => {
    const model = new TieringModel();
    model.onBinaryOp(opSite());
    model.onBinaryOp(opSite({ bytecodeOffset: 50, opcode: "Mul", left: 0, right: 1, result: 0 }));
    inMaglev(model);
    model.onBinaryOp(opSite({ opcode: "Div", left: 1, right: 2, result: 0.5 }));
    expect(deopts(model.drainEvents())).toMatchObject([{ reason: "kLostPrecision", bytecodeOffset: 30 }]);
    inMaglev(model);
    model.onBinaryOp(opSite({ bytecodeOffset: 50, opcode: "Mul", left: 0, right: -1, result: -0 }));
    expect(deopts(model.drainEvents())).toMatchObject([{ reason: "kMinusZero", bytecodeOffset: 50 }]);
  });

  it("deopts with kNotANumber when a non-Number reaches a Number hint", () => {
    const model = new TieringModel();
    model.onBinaryOp(opSite({ left: 1.5, result: 3.5 }));
    inMaglev(model);
    model.onBinaryOp(opSite({ left: "other", result: "other" }));
    expect(deopts(model.drainEvents())).toMatchObject([{ reason: "kNotANumber", bytecodeOffset: 30 }]);
  });

  it("keeps a hint per function and offset, and only ever widens it", () => {
    const model = new TieringModel();
    model.onBinaryOp(opSite({ left: 1.5, result: 3.5 }));
    inMaglev(model);
    model.onBinaryOp(opSite());
    model.onBinaryOp(opSite({ bytecodeOffset: 44 }));
    model.onBinaryOp(opSite({ functionId: asFunctionId(9) }));
    expect(model.drainEvents()).toEqual([]);
    expect(tierOf(model)).toBe("maglev");
  });

  it("does not deopt unoptimized code or a site's first hint", () => {
    const model = new TieringModel();
    invoke(model, 10);
    model.drainEvents();
    model.onBinaryOp(opSite());
    model.onBinaryOp(opSite({ left: 1.5, result: 3.5 }));
    expect(model.drainEvents()).toEqual([]);
    inMaglev(model);
    model.onBinaryOp(opSite({ bytecodeOffset: 90, left: "other", result: "other" }));
    expect(model.drainEvents()).toEqual([]);
  });
});

describe("outputs", () => {
  it("drains the events since the last drain, oldest first", () => {
    const model = new TieringModel();
    invoke(model, 400);
    expect(model.drainEvents().map((e) => (e.kind === "tier-up" ? e.to : e.kind))).toEqual(["sparkplug", "maglev"]);
    expect(model.drainEvents()).toEqual([]);
    invoke(model, 2600);
    expect(model.drainEvents().map((e) => (e.kind === "tier-up" ? e.to : e.kind))).toEqual(["turbofan"]);
  });

  it("carries truth modeled on the tiers and on every event", () => {
    const model = new TieringModel();
    invoke(model, 3000);
    model.onIcTransition(secondMap());
    const events = model.drainEvents();
    expect(events.map((e) => e.kind)).toEqual(["tier-up", "tier-up", "tier-up", "deopt"]);
    expect(events.map((e) => e.truth)).toEqual(events.map(() => "modeled"));
    expect(model.tiers().truth).toBe("modeled");
  });

  it("returns void from every hook", () => {
    const model = new TieringModel();
    expect(model.onInvoke({ functionId: F, bytecodeLength: LENGTH })).toBeUndefined();
    expect(model.onBackEdge({ functionId: F, bytecodeLength: LENGTH, bytecodeOffset: 5, loopHeaderOffset: 9 })).toBeUndefined();
    expect(model.onIcTransition(icSite())).toBeUndefined();
    expect(model.onBinaryOp(opSite())).toBeUndefined();
  });
});

describe("attached to the interpreter", () => {
  const source = `
    function f(o) { return o.x + 1; }
    function g(n) { var s = 0; for (var i = 0; i < n; i++) s += i; return s; }
    async function a() { ${"await 0; ".repeat(20)} }
    var o = { x: 1 };
    for (var k = 0; k < 600; k++) f(o);
    f({ y: 0, x: 2 });
    g(2000);
    a();
    console.log(f(o), g(10));
  `;

  it("tiers functions by their calls and loops, and a second Map deopts the hot one", () => {
    const model = new TieringModel();
    const run = runSource(source, undefined, {}, model);
    expect(run.completion.type).toBe("normal");
    const idOf = (name: string) => run.program.functions.find((fn) => fn.name === name)?.id;
    const f = idOf("f");
    const g = idOf("g");
    const a = idOf("a");
    if (f === undefined || g === undefined || a === undefined) throw new Error("functions not found");
    const events = model.drainEvents();
    expect(tierUps(events).filter((e) => e.functionId === f).map((e) => e.to)).toEqual(["sparkplug", "maglev"]);
    expect(deopts(events)).toMatchObject([{ functionId: f, from: "maglev", to: "sparkplug", reason: "kWrongMap" }]);
    const loopTiers = tierUps(events).filter((e) => e.functionId === g);
    expect(loopTiers.length).toBeGreaterThan(0);
    expect(loopTiers.every((e) => e.osr)).toBe(true);
    // Each await resumes the function without an invocation: `a` was called once.
    expect(model.tiers().byFunction[a]).toBe("ignition");
  });

  it("prints and records what the same program does without a model", () => {
    const withModel = runSource(source, undefined, {}, new TieringModel());
    const without = runSource(source);
    expect(withModel.stdout).toBe(without.stdout);
    expect(withModel.stderr).toBe(without.stderr);
    expect(withModel.commands).toEqual(without.commands);
  });
});
