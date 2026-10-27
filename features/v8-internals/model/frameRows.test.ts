import { describe, expect, it } from "vitest";
import type { FrameSnapshot } from "@/core/timeline/Tick";
import type { FunctionId, MapId, ObjectId } from "@/core/shared/ids";
import { frameRows } from "./frameRows";

const frame = (accumulator: FrameSnapshot["accumulator"], registers: FrameSnapshot["registers"] = []): FrameSnapshot => ({
  functionName: "f",
  functionId: 0 as FunctionId,
  bytecodeOffset: 0,
  registers,
  accumulator,
  contextId: 1,
});

describe("frameRows", () => {
  it("shows a Smi with its tagged word", () => {
    const rows = frameRows(frame({ kind: "smi", value: 5, tagged: "0xa" }), { predictFirst: false });
    expect(rows[0]).toEqual({ name: "acc", text: "5", tag: "Smi", tagged: "0xa" });
  });

  it("withholds strings and object previews under predict-first only", () => {
    const f = frame({ kind: "string", value: "secret" }, [
      { kind: "object", id: 1 as ObjectId, mapId: 2 as MapId, preview: "{a: 1}" },
      { kind: "oddball", name: "undefined" },
      { kind: "heap-number", value: 1.5, text: "1.5" },
      { kind: "internal", name: "context" },
    ]);
    const hidden = frameRows(f, { predictFirst: true });
    expect(hidden.map((r) => r.name)).toEqual(["acc", "r0", "r1", "r2", "r3"]);
    expect(hidden[0]?.text).toBe('"…"');
    expect(hidden[1]?.text).toBe("{…}");
    expect(hidden[2]).toMatchObject({ text: "undefined", tag: "Oddball", tagged: null });
    expect(hidden[3]).toMatchObject({ text: "1.5", tag: "HeapObject" });
    expect(hidden[4]).toMatchObject({ tag: "internal" });
    const shown = frameRows(f, { predictFirst: false });
    expect(shown[0]?.text).toBe('"secret"');
    expect(shown[1]?.text).toBe("{a: 1}");
  });
});
