import { describe, expect, it } from "vitest";
import { TransitionTree } from "./TransitionTree";

function literal(tree: TransitionTree, ...entries: [string, number | string | object][]) {
  let map = tree.rootFor("object-literal", entries.length);
  for (const [key, value] of entries) map = tree.addProperty(map, key, value as never);
  return map;
}

describe("TransitionTree", () => {
  it("gives the same Map to the same transitions and ids from 1", () => {
    const tree = new TransitionTree();
    const a = literal(tree, ["x", 1], ["y", 2]);
    const b = literal(tree, ["x", 3], ["y", 4]);
    expect(a).toBe(b);
    expect(tree.rootFor("object-literal", 2).id).toBe(1);
  });

  it("gives other property orders and other families different Maps", () => {
    const tree = new TransitionTree();
    expect(literal(tree, ["x", 1], ["y", 2])).not.toBe(literal(tree, ["y", 1], ["x", 2]));
    let viaEmpty = tree.rootFor("empty-object-literal", 4);
    viaEmpty = tree.addProperty(tree.addProperty(viaEmpty, "x", 1), "y", 2);
    expect(viaEmpty).not.toBe(literal(tree, ["x", 1], ["y", 2]));
  });

  it("places fields beyond the in-object capacity in the backing store", () => {
    const tree = new TransitionTree();
    const map = literal(tree, ["x", 1], ["y", 2]);
    const grown = tree.addProperty(map, "z", 3);
    expect(grown.descriptors.map((d) => [d.key, d.location])).toEqual([
      ["x", "in-object"],
      ["y", "in-object"],
      ["z", "backing-store"],
    ]);
    expect(grown.back).toBe(map);
  });

  it("generalizes Smi to tagged in place, keeping the Map", () => {
    const tree = new TransitionTree();
    const smi = literal(tree, ["f", 1]);
    const tagged = literal(tree, ["f", "text"]);
    expect(tagged).toBe(smi);
    expect(smi.descriptors[0]?.representation).toBe("Tagged");
    expect(smi.deprecated).toBe(false);
  });

  it("generalizes Smi to Double with a new Map and deprecates the old one", () => {
    const tree = new TransitionTree();
    const smi = literal(tree, ["f", 1]);
    const migrated = tree.generalizeField(smi, 0, 1.5);
    expect(migrated).not.toBe(smi);
    expect(smi.deprecated).toBe(true);
    expect(migrated.descriptors[0]?.representation).toBe("Double");
    expect(literal(tree, ["f", 3])).toBe(migrated);
    expect(tree.updateMap(smi)).toBe(migrated);
    expect(tree.updateMap(migrated)).toBe(migrated);
  });

  it("replays the whole descriptor chain when updating a deprecated Map", () => {
    const tree = new TransitionTree();
    const old = literal(tree, ["a", 1], ["b", 2]);
    const current = tree.generalizeField(old, 0, 0.5);
    expect(current.descriptors.map((d) => d.key)).toEqual(["a", "b"]);
    expect(current.descriptors.map((d) => d.representation)).toEqual(["Double", "Smi"]);
    expect(old.deprecated).toBe(true);
  });

  it("normalizes to a dictionary Map that is no longer shared", () => {
    const tree = new TransitionTree();
    const fast = literal(tree, ["x", 1]);
    const dict = tree.normalize(fast);
    expect(dict.isDictionary).toBe(true);
    expect(dict).not.toBe(fast);
    expect(dict.instanceType).toBe(fast.instanceType);
    expect(() => tree.addProperty(dict, "y", 1)).toThrow();
  });

  it("shares one initial array Map per elements kind", () => {
    const tree = new TransitionTree();
    const smi = tree.rootFor("array", 0, "PACKED_SMI_ELEMENTS");
    expect(tree.rootFor("array", 0, "PACKED_SMI_ELEMENTS")).toBe(smi);
    expect(tree.rootFor("array", 0, "PACKED_ELEMENTS")).not.toBe(smi);
    expect(smi.instanceType).toBe("JS_ARRAY_TYPE");
    expect(smi.elementsKind).toBe("PACKED_SMI_ELEMENTS");
  });

  it("moves an object to the Map of another elements kind, keeping its properties", () => {
    const tree = new TransitionTree();
    const root = tree.rootFor("array", 0, "PACKED_SMI_ELEMENTS");
    expect(tree.withElementsKind(root, "HOLEY_SMI_ELEMENTS")).toBe(tree.rootFor("array", 0, "HOLEY_SMI_ELEMENTS"));
    const named = tree.addProperty(root, "tag", "t");
    const holey = tree.withElementsKind(named, "HOLEY_SMI_ELEMENTS");
    expect(holey.elementsKind).toBe("HOLEY_SMI_ELEMENTS");
    expect(holey.descriptors.map((d) => d.key)).toEqual(["tag"]);
    expect(tree.withElementsKind(named, "PACKED_SMI_ELEMENTS")).toBe(named);
  });
});
