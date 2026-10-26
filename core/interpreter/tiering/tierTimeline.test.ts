import { describe, expect, it } from "vitest";
import { simulate } from "@/core/timeline/simulate";
import { TieringModel } from "./TieringModel";
import { tierTimeline } from "./tierTimeline";

// A hot function that a second Map deopts: the program TieringModel.test.ts attaches the model to.
const SOURCE = `
  function f(o) { return o.x + 1; }
  var o = { x: 1 };
  for (var k = 0; k < 600; k++) f(o);
  f({ y: 0, x: 2 });
  console.log(f(o));
`;

describe("tierTimeline", () => {
  it("is empty for no ticks and for ticks recorded without a TieringModel", () => {
    expect(tierTimeline([])).toEqual([]);
    expect(tierTimeline(simulate("console.log(1);", "js").ticks)).toEqual([]);
  });

  const { ticks } = simulate(SOURCE, "js", { tiering: new TieringModel() });
  const tracks = tierTimeline(ticks);
  const track = tracks.find((t) => t.functionName === "f");

  it("starts each track in ignition and sorts tracks by the tick they first appear on", () => {
    expect(tracks[0]?.segments[0]).toEqual({ from: 0, tier: "ignition" });
    for (const t of tracks) expect(t.segments[0]?.tier).toBe("ignition");
    const firsts = tracks.map((t) => t.segments[0]?.from ?? -1);
    expect(firsts).toEqual([...firsts].sort((a, b) => a - b));
  });

  it("opens a segment where the tier changes, in order", () => {
    if (!track) throw new Error("no track for f");
    expect(track.segments.map((s) => s.tier).slice(0, 3)).toEqual(["ignition", "sparkplug", "maglev"]);
    const froms = track.segments.map((s) => s.from);
    expect(froms).toEqual([...froms].sort((a, b) => a - b));
    expect(new Set(froms).size).toBe(froms.length);
  });

  it("puts a deopt on the tick that carries its TierEvent", () => {
    if (!track) throw new Error("no track for f");
    expect(track.deopts).toHaveLength(1);
    const deopt = track.deopts[0];
    const events = ticks[deopt?.index ?? -1]?.v8.tierEvents ?? [];
    expect(events.some((e) => e.kind === "deopt" && e.functionId === track.functionId && e.reason === deopt?.reason)).toBe(true);
    expect(deopt?.reason).toBe("kWrongMap");
  });
});
