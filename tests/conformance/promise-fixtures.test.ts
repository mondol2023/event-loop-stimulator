import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { simulate } from "@/core/timeline/simulate";
import { runReal } from "../../scripts/conformance/run-real.mts";
import { checkPinnedRuntime, readTarget } from "../../scripts/conformance/target.mts";

// Promises and the microtask queue, before the Node loop exists (Task 15). Four recorded fixtures
// mix promises with timers or async functions; their microtask-only parts are cut out of the
// fixture source and run on real node and on the simulator, which must print the same bytes.
// (Whole fixtures replay against their recorded output once Tasks 16 and 17 land.)

const problems = checkPinnedRuntime({ node: process.versions.node, v8: process.versions.v8 }, readTarget());
const pinned = problems.length === 0;
if (!pinned) console.warn(`Skipping real-node promise comparisons: ${problems.join("; ")} (docs/TARGET.md)`);

const FIXTURES = join(__dirname, "fixtures");
const fixtureSource = (name: string): string => readFileSync(join(FIXTURES, `${name}.cjs`), "utf8");

/** The fixture text without the block that starts at `from` and ends just before `to`. */
function without(source: string, from: string, to: string): string {
  const start = source.indexOf(from);
  const end = source.indexOf(to, start);
  if (start === -1 || end === -1) throw new Error(`fixture no longer contains the block ${from} … ${to}`);
  return source.slice(0, start) + source.slice(end);
}

/** The fixture text from `from` to its end. */
function from(source: string, marker: string): string {
  const start = source.indexOf(marker);
  if (start === -1) throw new Error(`fixture no longer contains ${marker}`);
  return source.slice(start);
}

const finallyPassthrough = without(fixtureSource("finally-passthrough"), "// finally waits for the promise it returns", "// Turns:");
const queueMicrotaskOrder = without(fixtureSource("queuemicrotask-order"), "(async () => {", 'console.log("sync");');
const combinatorsSync = from(fixtureSource("promise-combinators"), "// The input is read synchronously");

const combinatorsOnSettledInputs = `
const ok = (v) => Promise.resolve(v);
const no = (v) => Promise.reject(v);
Promise.all([1, ok(2), 3]).then((v) => console.log("all", v));
Promise.all([ok(1), no("x"), no("y")]).catch((v) => console.log("all rejects", v));
Promise.all([]).then((v) => console.log("all empty", v));
Promise.race([ok("a"), no("b")]).then((v) => console.log("race", v));
Promise.race([no("b"), ok("a")]).catch((v) => console.log("race rejects", v));
Promise.race([]).then(() => console.log("never"));
Promise.allSettled([ok(1), no(2), 3]).then((v) => console.log("allSettled", v));
Promise.allSettled([]).then((v) => console.log("allSettled empty", v));
Promise.any([no(1), ok(2), ok(3)]).then((v) => console.log("any", v));
Promise.any([no(1), no(2)]).catch((e) => console.log("any rejects", e.name, e.message, e.errors));
Promise.any([]).catch((e) => console.log("any empty", e.name, e.message, e.errors));
const rejected = Promise.reject(3);
rejected.catch(() => {});
console.log(Promise.resolve(1), new Promise(() => {}), rejected);
`;

const thenableTurns = `
const thenable = { then(resolve) { console.log("then called"); resolve("t"); } };
Promise.resolve(thenable).then((v) => console.log("Promise.resolve(thenable)", v));
new Promise((resolve) => resolve(thenable)).then((v) => console.log("resolve(thenable)", v));
const native = Promise.resolve("n");
new Promise((resolve) => resolve(native)).then((v) => console.log("resolve(native)", v));
Promise.resolve().then(() => Promise.resolve("adopted")).then((v) => console.log("adopted after 2 more turns", v));
let turn = 0;
(function step() { turn++; console.log("turn " + turn); if (turn < 6) Promise.resolve().then(step); })();
`;

const PROGRAMS: Readonly<Record<string, string>> = {
  "finally-passthrough without its timer": finallyPassthrough,
  "queuemicrotask-order without its async function": queueMicrotaskOrder,
  "promise-combinators, the synchronous inputs": combinatorsSync,
  "combinators over settled inputs": combinatorsOnSettledInputs,
  "thenables, adoption and turn counts": thenableTurns,
};

describe("the derived programs stay inside Task 15", () => {
  it.each(Object.entries(PROGRAMS))("%s has no timer, nextTick or async function", (_name, source) => {
    expect(source).not.toMatch(/setTimeout|setInterval|setImmediate|nextTick|async |await /);
  });
});

describe.skipIf(!pinned)("promises equal real node", () => {
  it.each(Object.entries(PROGRAMS))("%s", (_name, source) => {
    const real = runReal(source, { lang: "js" });
    const sim = simulate(source, "js");
    expect(sim.stop, `the simulator stopped early: ${JSON.stringify(sim.stop)}`).toBeUndefined();
    expect({ stdout: sim.stdout, stderr: sim.stderr, exitCode: sim.exitCode }).toEqual(real);
  });
});
