import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Heap } from "@/core/runtime/heap/Heap";
import { JSArray } from "@/core/runtime/objects/JSArray";
import { JSObject } from "@/core/runtime/objects/JSObject";
import { TransitionTree } from "@/core/runtime/objects/TransitionTree";
import { OrdinaryDelete, OrdinarySet } from "@/core/runtime/spec/objectOps";
import type { JSValue } from "@/core/runtime/values/JSValue";
import { TheHole } from "@/core/runtime/values/TheHole";

// Task 4: the Map and elements-kind model, driven through its direct API with the same operations
// the internals fixtures perform, must agree with the answers V8's natives gave on the pinned Node.
// The expectations are read from the recorded `*.expected.json`; nothing here restates them.

const INTERNALS = join(__dirname, "internals");

function recordedStdout(fixture: string): string[] {
  const file = JSON.parse(readFileSync(join(INTERNALS, `${fixture}.expected.json`), "utf8")) as {
    outcomes: { stdout: string }[];
  };
  const outcome = file.outcomes[0];
  if (!outcome) throw new Error(`${fixture} has no recorded outcome`);
  return outcome.stdout.split("\n").filter((line) => line !== "");
}

/** The values printed after the label: `label: true false` gives `["true", "false"]`. */
function printedAnswers(lines: string[]): string[] {
  return lines.flatMap((line) => line.slice(line.indexOf(": ") + 2).split(" "));
}

function newWorld() {
  const heap = new Heap();
  const maps = new TransitionTree();
  const ctx = { maps };
  const literal = (...entries: [string, JSValue][]): JSObject => {
    const o = heap.allocate((id) => new JSObject(id, maps.rootFor("object-literal", entries.length), null));
    for (const [k, v] of entries) OrdinarySet(ctx, o, k, v);
    return o;
  };
  const empty = (): JSObject => heap.allocate((id) => new JSObject(id, maps.rootFor("empty-object-literal", 4), null));
  const array = (...values: (JSValue | typeof TheHole)[]): JSArray =>
    heap.allocate((id) => JSArray.fromElements(id, maps, null, values));
  const same = (a: JSObject, b: JSObject): string => String(a.map === b.map);
  const fast = (o: JSObject): string => String(o.hasFastProperties);
  return { ctx, literal, empty, array, same, fast };
}

describe("maps-same-shape-vs-order replayed through the Map model", () => {
  it("answers every %HaveSameMap / %HasFastProperties like V8", () => {
    const { ctx, literal, empty, array, same, fast } = newWorld();
    const make = (props: [string, JSValue][]): JSObject => {
      const o = empty();
      for (const [k, v] of props) OrdinarySet(ctx, o, k, v);
      return o;
    };
    const a = literal(["x", 1], ["y", 2]);
    const b = literal(["x", 3], ["y", 4]);
    const c = literal(["y", 2], ["x", 1]);
    const d = make([["x", 1], ["y", 2]]);
    const e = make([["x", 3], ["y", 4]]);
    const f = literal(["x", 1], ["y", 2]);
    OrdinarySet(ctx, f, "z", 3);
    const g = literal(["x", 1], ["y", 2]);
    OrdinarySet(ctx, g, "z", 3);
    const h = literal(["x", "string"], ["y", array(1)]);
    const i = literal(["x", 1], ["y", 2]);
    OrdinarySet(ctx, i, "z", 3);
    OrdinaryDelete(ctx, i, "z");
    const j = literal(["x", 1], ["y", 2], ["z", 3]);
    OrdinaryDelete(ctx, j, "x");

    const answers = [
      same(a, b),
      same(a, c),
      same(d, e),
      same(a, d),
      same(d, make([["y", 1], ["x", 2]])),
      same(a, f),
      same(f, g),
      same(a, h),
      same(a, i),
      fast(i),
      same(f, j),
      fast(j),
      same(array(), empty()),
      same(array(1), array(2)),
    ];
    expect(answers).toEqual(printedAnswers(recordedStdout("maps-same-shape-vs-order")));
  });
});

describe("maps-field-generalization replayed through the Map model", () => {
  it("shares and splits Maps like V8 as a field goes Smi, Double, Tagged", () => {
    const { ctx, literal, same, fast } = newWorld();
    const a = literal(["f", 1]);
    const b = literal(["f", 2]);
    const answers = [same(a, b), fast(a)];
    OrdinarySet(ctx, a, "f", 1.5);
    answers.push(same(a, b), fast(a));
    OrdinarySet(ctx, a, "f", "text");
    answers.push(same(a, b), fast(a));
    const c = literal(["f", 3]);
    answers.push(same(a, c), same(b, c));
    OrdinarySet(ctx, b, "f", literal());
    answers.push(same(a, b), same(b, c));
    expect(answers).toEqual(printedAnswers(recordedStdout("maps-field-generalization")));
  });
});

describe("elements-kinds-transitions replayed through the Map model", () => {
  it("reaches the same elements kind as V8 after every operation", () => {
    const { ctx, array, literal } = newWorld();
    const kind = (a: JSArray): string => a.map.elementsKind;
    const push = (a: JSArray, v: JSValue): void => void OrdinarySet(ctx, a, String(a.length), v);
    // Array.prototype.pop takes V8's fast path: it shrinks the length and leaves no hole behind.
    const pop = (a: JSArray): void => a.setLength(ctx.maps, a.length - 1);
    const kinds: string[] = [];

    const arr = array(1, 2, 3);
    kinds.push(kind(arr));
    push(arr, 4);
    kinds.push(kind(arr));
    push(arr, 4.5);
    kinds.push(kind(arr));
    push(arr, "x");
    kinds.push(kind(arr));
    pop(arr);
    pop(arr);
    kinds.push(kind(arr));

    const doubles = array(1.5, 2.5);
    kinds.push(kind(doubles));
    push(doubles, 3);
    kinds.push(kind(doubles));
    push(doubles, literal());
    kinds.push(kind(doubles));

    kinds.push(kind(array(literal(), "s")));
    const empty = array();
    kinds.push(kind(empty));
    push(empty, 1);
    kinds.push(kind(empty));

    const holey = array(1, 2, 3);
    OrdinarySet(ctx, holey, "5", 6);
    kinds.push(kind(holey));
    OrdinarySet(ctx, holey, "3", 4);
    OrdinarySet(ctx, holey, "4", 5);
    kinds.push(kind(holey));

    kinds.push(kind(array(1, TheHole, 3)));
    const deleted = array(1, 2, 3);
    OrdinaryDelete(ctx, deleted, "1");
    kinds.push(kind(deleted));
    const holeyDouble = array(1.5, 2.5, 3.5);
    OrdinarySet(ctx, holeyDouble, "4", 5.5);
    kinds.push(kind(holeyDouble));

    const sparse = array(1);
    OrdinarySet(ctx, sparse, "100000", 2);
    kinds.push(kind(sparse));
    const shrunk = array(1, 2, 3);
    OrdinarySet(ctx, shrunk, "length", 1);
    kinds.push(kind(shrunk));

    kinds.push(kind(array(NaN, 1)), kind(array(1, -0)), kind(array(1, 2 ** 31)));
    // [1, 2, 3].map(n => n / 2): the result is built packed by V8's fast path (Task 14's builtin).
    kinds.push(kind(array(0.5, 1, 1.5)));

    const recorded = recordedStdout("elements-kinds-transitions").map((line) => line.trim().split(/\s+/).at(-1));
    expect(kinds).toEqual(recorded);
  });
});
