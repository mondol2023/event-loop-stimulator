import { describe, expect, it } from "vitest";
import { compileOrThrow } from "@/core/interpreter/interpreterTestWorld";
import { TransitionTree } from "../objects/TransitionTree";
import type { V8Map } from "../objects/V8Map";
import { type IcSlotKind, FeedbackVector, slotKindName } from "./FeedbackVector";
import { InlineCache, MAX_POLYMORPHIC_MAPS } from "./InlineCache";

// Inline-cache states follow src/ic/ic.cc: a slot starts UNINITIALIZED, the first map makes it
// MONOMORPHIC, up to four maps POLYMORPHIC, and the fifth MEGAMORPHIC. A state never moves back.

/** `count` distinct Maps: each is the root plus one differently named field. */
function distinctMaps(count: number): V8Map[] {
  const tree = new TransitionTree();
  const root = tree.rootFor("object-literal", 4);
  return Array.from({ length: count }, (_, i) => tree.addProperty(root, `p${i}`, 1));
}

function cacheWithOneSlot(kind: IcSlotKind = "kLoadProperty"): InlineCache {
  return new InlineCache(FeedbackVector.fromSlots([{ index: 0, kind }]));
}

describe("InlineCache.update", () => {
  it("starts UNINITIALIZED", () => {
    expect(cacheWithOneSlot().state(0)).toBe("UNINITIALIZED");
  });

  it("becomes MONOMORPHIC on the first map and stays so for the same map", () => {
    const [a] = distinctMaps(1);
    const ic = cacheWithOneSlot();
    expect(ic.update(0, a!)).toBe("MONOMORPHIC");
    expect(ic.update(0, a!)).toBe("MONOMORPHIC");
    expect(ic.maps(0)).toEqual([a]);
  });

  it("becomes POLYMORPHIC for two to four maps", () => {
    const maps = distinctMaps(4);
    const ic = cacheWithOneSlot();
    const states = maps.map((m) => ic.update(0, m));
    expect(states).toEqual(["MONOMORPHIC", "POLYMORPHIC", "POLYMORPHIC", "POLYMORPHIC"]);
    expect(ic.maps(0)).toEqual(maps);
  });

  it("becomes MEGAMORPHIC on the fifth map (max_valid_polymorphic_map_count is 4)", () => {
    expect(MAX_POLYMORPHIC_MAPS).toBe(4);
    const maps = distinctMaps(5);
    const ic = cacheWithOneSlot();
    expect(maps.map((m) => ic.update(0, m)).at(-1)).toBe("MEGAMORPHIC");
    expect(ic.maps(0)).toEqual([]);
  });

  it("does not count a map it has already seen", () => {
    const maps = distinctMaps(2);
    const ic = cacheWithOneSlot();
    for (const m of [maps[0]!, maps[1]!, maps[0]!, maps[1]!, maps[0]!, maps[1]!]) ic.update(0, m);
    expect(ic.state(0)).toBe("POLYMORPHIC");
    expect(ic.maps(0)).toHaveLength(2);
  });

  it("never moves back once MEGAMORPHIC, whichever map arrives", () => {
    const maps = distinctMaps(6);
    const ic = cacheWithOneSlot();
    for (const m of maps) ic.update(0, m);
    expect(ic.update(0, maps[0]!)).toBe("MEGAMORPHIC");
    expect(ic.state(0)).toBe("MEGAMORPHIC");
  });

  it("keeps each slot's state apart", () => {
    const maps = distinctMaps(2);
    const ic = new InlineCache(
      FeedbackVector.fromSlots([
        { index: 0, kind: "kLoadProperty" },
        { index: 2, kind: "kLoadKeyed" },
      ]),
    );
    ic.update(0, maps[0]!);
    expect(ic.state(0)).toBe("MONOMORPHIC");
    expect(ic.state(2)).toBe("UNINITIALIZED");
  });

  it("rejects a slot the vector does not have", () => {
    expect(() => cacheWithOneSlot().update(7, distinctMaps(1)[0]!)).toThrow(/slot 7/);
  });
});

describe("slotKindName", () => {
  it("names each kind the way %DebugPrint prints it", () => {
    const names: Record<IcSlotKind, string> = {
      kLoadProperty: "LoadProperty",
      kLoadKeyed: "LoadKeyed",
      kSetNamedSloppy: "SetNamedSloppy",
      kSetNamedStrict: "SetNamedStrict",
      kSetKeyedSloppy: "SetKeyedSloppy",
      kSetKeyedStrict: "SetKeyedStrict",
      kDefineNamedOwn: "DefineNamedOwn",
      kStoreInArrayLiteral: "StoreInArrayLiteral",
    };
    for (const [kind, name] of Object.entries(names)) expect(slotKindName(kind as IcSlotKind)).toBe(name);
  });
});

describe("FeedbackVector.forFunction", () => {
  it("lays out the slots the bytecode names, with the kind of the instruction that uses each", () => {
    const program = compileOrThrow(`
      var o = { a: 1 };
      var k = "a";
      o.a;
      o[k];
      o.b = 2;
      o[k] = 3;
    `);
    const vector = FeedbackVector.forFunction(program.functions[0]!);
    const kinds = vector.slotIndices().map((i) => `${i}:${slotKindName(vector.slot(i).kind)}`);
    expect(kinds).toEqual(expect.arrayContaining([expect.stringMatching(/LoadProperty$/), expect.stringMatching(/LoadKeyed$/), expect.stringMatching(/SetNamedSloppy$/), expect.stringMatching(/SetKeyedSloppy$/)]));
    expect(vector.slotIndices().every((i) => vector.slot(i).state === "UNINITIALIZED")).toBe(true);
  });

  it("uses the strict store kinds in strict code", () => {
    const program = compileOrThrow(`"use strict"; var o = {}; var k = "a"; o.a = 1; o[k] = 2;`);
    const vector = FeedbackVector.forFunction(program.functions[0]!);
    const kinds = vector.slotIndices().map((i) => slotKindName(vector.slot(i).kind));
    expect(kinds).toContain("SetNamedStrict");
    expect(kinds).toContain("SetKeyedStrict");
    expect(kinds).not.toContain("SetNamedSloppy");
  });

  it("gives literal property definitions the DefineNamedOwn kind", () => {
    const program = compileOrThrow(`var x = 1; var o = { a: x };`);
    const vector = FeedbackVector.forFunction(program.functions[0]!);
    expect(vector.slotIndices().map((i) => slotKindName(vector.slot(i).kind))).toContain("DefineNamedOwn");
  });

  it("keeps the slot indices the bytecode uses (a load or store spans two entries)", () => {
    const program = compileOrThrow(`var o = { a: 1 }; o.a; o.a = 2;`);
    const fn = program.functions[0]!;
    const vector = FeedbackVector.forFunction(fn);
    const used = fn.array.instructions
      .filter((i) => i.opcode === "GetNamedProperty" || i.opcode === "SetNamedProperty")
      .map((i) => i.operands[2]);
    for (const slot of used) expect(vector.slotIndices()).toContain(slot);
  });
});
