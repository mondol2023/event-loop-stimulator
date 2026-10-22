import { describe, expect, it } from "vitest";
import { NODE_MEMBERS } from "@/core/runtime/builtins/nodeMembers";
import { checkPinnedRuntime, readTarget } from "../../scripts/conformance/target.mts";

// NODE_MEMBERS lists the members of Node's builtins that the realm halts on when it does not
// implement them. It must equal what the pinned runtime really has.

const problems = checkPinnedRuntime({ node: process.versions.node, v8: process.versions.v8 }, readTarget());
const pinned = problems.length === 0;
if (!pinned) console.warn(`Skipping the Node members check: ${problems.join("; ")} (docs/TARGET.md)`);

const HOLDERS: Readonly<Record<string, object>> = {
  Object,
  "Object.prototype": Object.prototype,
  "Function.prototype": Object.getPrototypeOf(() => 1),
  Array,
  "Array.prototype": Array.prototype,
  Promise,
  "Promise.prototype": Promise.prototype,
  String,
  "String.prototype": String.prototype,
  Number,
  "Number.prototype": Number.prototype,
  Boolean,
  "Boolean.prototype": Boolean.prototype,
  Error,
  "Error.prototype": Error.prototype,
  Math,
};
const SKIPPED = new Set(["constructor", "length", "name", "prototype", "caller", "arguments"]);

describe.skipIf(!pinned)("NODE_MEMBERS against the pinned runtime", () => {
  it("has an entry for every holder and no other", () => {
    expect(Object.keys(NODE_MEMBERS).sort()).toEqual(Object.keys(HOLDERS).sort());
  });

  it.each(Object.entries(HOLDERS))("%s lists exactly the string-keyed own properties Node has", (name, holder) => {
    const real = Object.getOwnPropertyNames(holder)
      .filter((key) => !SKIPPED.has(key))
      .sort();
    expect([...(NODE_MEMBERS[name] ?? [])].sort()).toEqual(real);
  });
});
