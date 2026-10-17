import { inspect as hostInspect } from "node:util";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { inspect } from "@/core/runtime/builtins/inspect";
import { inspectTestWorld, type InspectTestWorld } from "@/core/runtime/builtins/inspectTestWorld";
import type { JSObject } from "@/core/runtime/objects/JSObject";
import { OrdinaryDefineOwnProperty } from "@/core/runtime/spec/objectOps";
import type { JSValue } from "@/core/runtime/values/JSValue";
import { checkPinnedRuntime, readTarget } from "../../scripts/conformance/target.mts";

// The oracle property: random *data* values (nested arrays and objects of primitives, holes and
// cycles) are built twice, once as host values and once as model values, and our inspect must
// print exactly what the pinned Node's util.inspect prints. No program text is evaluated.

const problems = checkPinnedRuntime({ node: process.versions.node, v8: process.versions.v8 }, readTarget());
const pinned = problems.length === 0;
if (!pinned) console.warn(`Skipping the util.inspect oracle: ${problems.join("; ")} (docs/TARGET.md)`);

type Primitive = undefined | null | boolean | number | string;
type Node =
  | { readonly t: "prim"; readonly v: Primitive }
  | { readonly t: "ref"; readonly up: number }
  | { readonly t: "arr"; readonly items: readonly (Node | "hole")[]; readonly extra: readonly (readonly [string, Node])[] }
  | { readonly t: "obj"; readonly entries: readonly (readonly [string, Node])[]; readonly nullProto: boolean };

// Text whose display width inspect can compute without ICU: ASCII, controls, C1, Latin-1 and
// combining marks, plus lone surrogates (escaped). Wider text stops the run (see inspect.ts).
const CHARS = [
  ..."abcXYZ09_ $-.,:;!?()[]{}<>=+*/|&^~@#",
  "'",
  '"',
  "`",
  "\\",
  "${",
  "\n",
  "\t",
  "\r",
  "\b",
  "\f",
  "\v",
  "\x00",
  "\x1b",
  "\x1f",
  "\x7f",
  "\x85",
  "\x9f",
  "\xa0",
  "\xad",
  "é",
  "ñ",
  "ÿ",
  "ǅ",
  "́",
  "ͯ",
  "\ud800",
  "\udbff",
  "\udc00",
  "\udfff",
];
const text = fc
  .array(fc.constantFrom(...CHARS), { maxLength: 24 })
  .map((parts) => parts.join(""))
  .filter((s) => !/[\ud800-\udbff][\udc00-\udfff]/.test(s));
const longText = fc.tuple(text, fc.integer({ min: 0, max: 90 }), text).map(([a, n, b]) => `${a}${"w".repeat(n)}\n${b}`);

const primitive: fc.Arbitrary<Primitive> = fc.oneof(
  fc.constantFrom<Primitive>(undefined, null, true, false, 0, -0, NaN, Infinity, -Infinity, 1e21, 0.1, -1.5),
  fc.integer({ min: -1000, max: 100000 }),
  fc.double(),
  text,
  longText,
);

const key = fc.oneof(
  fc.constantFrom("a", "b", "valid_id", "x1", "__proto__", "constructor", "0", "1", "7", "42", "4294967295", "", "a-b", "a b"),
  text,
);

const { node } = fc.letrec<{ node: Node }>((tie) => ({
  node: fc.oneof(
    { depthSize: "small", withCrossShrink: true },
    primitive.map((v): Node => ({ t: "prim", v })),
    fc.integer({ min: 0, max: 3 }).map((up): Node => ({ t: "ref", up })),
    fc
      .record({
        items: fc.array(fc.oneof({ weight: 1, arbitrary: fc.constant("hole" as const) }, { weight: 4, arbitrary: tie("node") }), {
          maxLength: 9,
        }),
        extra: fc.array(fc.tuple(key, tie("node")), { maxLength: 2 }),
      })
      .map((r): Node => ({ t: "arr", ...r })),
    fc
      .record({
        entries: fc.array(fc.tuple(key, tie("node")), { maxLength: 6 }),
        nullProto: fc.boolean(),
      })
      .map((r): Node => ({ t: "obj", ...r })),
  ),
}));

/** A long array of numbers or short strings, the shapes that are grouped into columns. */
const longArray: fc.Arbitrary<Node> = fc
  .array(fc.oneof(fc.integer({ min: -99999, max: 99999 }).map((v): Node => ({ t: "prim", v })), primitive.map((v): Node => ({ t: "prim", v }))), {
    minLength: 7,
    maxLength: 130,
  })
  .map((items): Node => ({ t: "arr", items, extra: [] }));

const DATA = { writable: true, enumerable: true, configurable: true } as const;

/** Builds the same value graph on the host and in the model; `ref` points at an enclosing container. */
function build(root: Node, w: InspectTestWorld): { host: unknown; model: JSValue } {
  const hostStack: object[] = [];
  const modelStack: JSObject[] = [];
  const go = (n: Node): { host: unknown; model: JSValue } => {
    switch (n.t) {
      case "prim":
        return { host: n.v, model: n.v };
      case "ref": {
        if (hostStack.length === 0) return { host: undefined, model: undefined };
        const i = hostStack.length - 1 - (n.up % hostStack.length);
        return { host: hostStack[i], model: modelStack[i] ?? null };
      }
      case "arr": {
        const host: unknown[] = [];
        const model = w.array([]);
        hostStack.push(host);
        modelStack.push(model);
        n.items.forEach((item, i) => {
          if (item === "hole") {
            host.length = i + 1;
            OrdinaryDefineOwnProperty(w.ctx, model, "length", { value: i + 1 });
            return;
          }
          const v = go(item);
          host[i] = v.host;
          OrdinaryDefineOwnProperty(w.ctx, model, String(i), { value: v.model, ...DATA });
        });
        for (const [k, item] of n.extra) {
          const v = go(item);
          if (k === "length") continue;
          Object.defineProperty(host, k, { value: v.host, ...DATA });
          OrdinaryDefineOwnProperty(w.ctx, model, k, { value: v.model, ...DATA });
        }
        hostStack.pop();
        modelStack.pop();
        return { host, model };
      }
      case "obj": {
        const host: object = n.nullProto ? Object.create(null) : {};
        const model = w.object({}, n.nullProto ? null : w.intrinsics.objectPrototype);
        hostStack.push(host);
        modelStack.push(model);
        for (const [k, item] of n.entries) {
          const v = go(item);
          Object.defineProperty(host, k, { value: v.host, ...DATA });
          OrdinaryDefineOwnProperty(w.ctx, model, k, { value: v.model, ...DATA });
        }
        hostStack.pop();
        modelStack.pop();
        return { host, model };
      }
    }
  };
  return go(root);
}

const value = fc.oneof({ weight: 4, arbitrary: node }, { weight: 1, arbitrary: longArray });
const depth = fc.option(fc.integer({ min: 0, max: 4 }), { nil: undefined });

describe("inspect oracle (no real node needed)", () => {
  it("builds host and model values with the same keys", () => {
    for (const n of fc.sample(value, { numRuns: 200, seed: 20261017 })) {
      const w = inspectTestWorld();
      const { host, model } = build(n, w);
      expect(typeof host === "object" && host !== null).toBe(typeof model === "object" && model !== null);
    }
  });
});

describe.skipIf(!pinned)("inspect oracle (host util.inspect on the pinned node)", () => {
  it("prints exactly what util.inspect prints for random data values", () => {
    fc.assert(
      fc.property(value, depth, (n, d) => {
        const w = inspectTestWorld();
        const { host, model } = build(n, w);
        const opts = d === undefined ? undefined : { depth: d };
        expect(inspect(w.realm, model, opts)).toBe(hostInspect(host, opts));
      }),
      { numRuns: 2000, seed: 20261017 },
    );
  });
});
