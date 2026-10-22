import { describe, expect, it } from "vitest";
import { runSource } from "@/core/interpreter/interpreterTestWorld";
import type { Completion } from "@/core/interpreter/Completion";
import type { JSFunction } from "@/core/runtime/objects/JSFunction";
import type { JSObject } from "@/core/runtime/objects/JSObject";
import type { JSPromise } from "@/core/runtime/objects/JSPromise";
import { OrdinaryGet, OrdinaryGetOwnProperty } from "@/core/runtime/spec/objectOps";
import type { Realm } from "@/core/runtime/Realm";

// Promise, the job queue and queueMicrotask against their spec steps. The host is minimal: the
// microtask queue is drained once after the script. Whole-program order against real Node is
// checked in tests/conformance/promise-fixtures.test.ts.

const stdoutOf = (source: string): string => runSource(source).stdout;

/** Runs `source`, then hands the realm back so a test can call builtins the subset has no syntax for. */
function inRealm(source = ""): Realm {
  let realm: Realm | undefined;
  runSource(source, (r) => {
    realm = r;
  });
  if (!realm) throw new Error("setup did not run");
  return realm;
}

function thrown(completion: Completion): string {
  if (completion.type !== "throw") throw new Error("expected a throw");
  const error = completion.value as JSObject;
  return `${String(OrdinaryGet(error, "name"))}: ${String(OrdinaryGet(error, "message"))}`;
}

function jobKinds(source: string): string[] {
  return runSource(source).commands.flatMap((c) => (c.kind === "job-start" ? [c.task.kind] : []));
}

describe("the Promise constructor", () => {
  it("calls the executor synchronously and the reaction only after the script", () => {
    expect(stdoutOf(`new Promise((r) => { console.log("executor"); r(1); }).then((v) => console.log("then", v)); console.log("sync");`)).toBe(
      "executor\nsync\nthen 1\n",
    );
  });

  it("settles once: later resolve and reject calls are ignored", () => {
    expect(stdoutOf(`new Promise((res, rej) => { res("first"); res("second"); rej(new Error("x")); }).then((v) => console.log(v));`)).toBe("first\n");
  });

  it("rejects when the executor throws, unless it already resolved", () => {
    expect(
      stdoutOf(`
        new Promise(() => { throw new Error("boom"); }).catch((e) => console.log("rejected", e.message));
        new Promise((r) => { r("kept"); throw new Error("ignored"); }).then((v) => console.log(v));`),
    ).toBe("rejected boom\nkept\n");
  });

  it("throws the V8 TypeError for a non-callable executor, as V8 prints the value", () => {
    expect(
      stdoutOf(`
        const t = (f) => { try { f(); } catch (e) { console.log(e.name + ": " + e.message); } };
        t(() => new Promise(1));
        t(() => new Promise());
        t(() => new Promise({}));`),
    ).toBe(
      "TypeError: Promise resolver 1 is not a function\n" +
        "TypeError: Promise resolver undefined is not a function\n" +
        "TypeError: Promise resolver #<Object> is not a function\n",
    );
  });

  it("throws when called without new (the subset cannot spell this call, so the test calls the builtin)", () => {
    const realm = inRealm();
    expect(thrown(realm.call(realm.promise.constructor, undefined, []))).toBe("TypeError: Promise constructor cannot be invoked without 'new'");
  });

  it("gives the resolving functions V8's shape: anonymous, length 1, no prototype, not constructors", () => {
    const realm = inRealm(`
      new Promise((res, rej) => { resolveFn = res; rejectFn = rej; });`);
    for (const key of ["resolveFn", "rejectFn"]) {
      const fn = OrdinaryGet(realm.globalObject, key) as JSFunction;
      expect([OrdinaryGet(fn, "name"), OrdinaryGet(fn, "length"), OrdinaryGetOwnProperty(fn, "prototype"), fn.construct]).toEqual(["", 1, undefined, undefined]);
    }
  });

  it("rejects a promise resolved with itself with the cycle TypeError", () => {
    expect(
      stdoutOf(`
        let resolveSelf;
        const self = new Promise((r) => { resolveSelf = r; });
        resolveSelf(self);
        self.catch((e) => console.log(e.name + ": " + e.message));`),
    ).toBe("TypeError: Chaining cycle detected for promise #<Promise>\n");
  });
});

describe("jobs", () => {
  it("resolving with a thenable costs exactly 2 extra jobs (NewPromiseResolveThenableJob, then the then)", () => {
    const plain = jobKinds(`new Promise((r) => r(1)).then(() => {});`);
    const adopted = jobKinds(`const p = Promise.resolve(1); new Promise((r) => r(p)).then(() => {});`);
    expect(plain).toEqual(["PromiseReactionJob"]);
    expect(adopted).toEqual(["PromiseResolveThenableJob", "PromiseReactionJob", "PromiseReactionJob"]);
    expect(adopted.length - plain.length).toBe(2);
  });

  it("calls a non-native thenable's then in a PromiseResolveThenableJob, not synchronously", () => {
    expect(stdoutOf(`Promise.resolve({ then(res) { console.log("then called"); res("t"); } }).then((v) => console.log("got", v)); console.log("sync");`)).toBe(
      "sync\nthen called\ngot t\n",
    );
  });

  it("queueMicrotask runs a CallbackJob in the same FIFO queue as promise jobs", () => {
    const src = `queueMicrotask(() => console.log("A")); Promise.resolve().then(() => console.log("B")); queueMicrotask(() => console.log("C"));`;
    expect(stdoutOf(src)).toBe("A\nB\nC\n");
    expect(jobKinds(src)).toEqual(["CallbackJob", "PromiseReactionJob", "CallbackJob"]);
  });

  it("a job queued while draining goes to the back and still runs before the drain ends", () => {
    expect(stdoutOf(`queueMicrotask(() => { console.log("one"); queueMicrotask(() => console.log("three")); }); queueMicrotask(() => console.log("two"));`)).toBe(
      "one\ntwo\nthree\n",
    );
  });

  it("reports job-start and job-end for every job, in order, with unique ids", () => {
    const { commands } = runSource(`queueMicrotask(() => {}); Promise.resolve().then(() => {});`);
    const jobs = commands.filter((c) => c.kind === "job-start" || c.kind === "job-end");
    expect(jobs.map((c) => c.kind)).toEqual(["job-start", "job-end", "job-start", "job-end"]);
    const ids = jobs.flatMap((c) => (c.kind === "job-start" ? [c.task.id] : []));
    expect(new Set(ids).size).toBe(2);
  });
});

describe("Promise.prototype", () => {
  it("then returns a new promise and passes values and rejections through missing handlers", () => {
    expect(
      stdoutOf(`
        const p = Promise.resolve(1);
        console.log(p.then() === p);
        p.then().then((v) => console.log("value", v));
        Promise.reject(new Error("no")).then(1, undefined).catch((e) => console.log("rejection", e.message));`),
    ).toBe("false\nvalue 1\nrejection no\n");
  });

  it("a handler returning a promise is adopted after 2 more turns", () => {
    expect(
      stdoutOf(`
        const order = [];
        Promise.resolve().then(() => Promise.resolve("inner")).then((v) => order.push("outer " + v));
        Promise.resolve().then(() => order.push(1)).then(() => order.push(2)).then(() => order.push(3)).then(() => console.log(order));`),
    ).toBe("[ 1, 2, 3, 'outer inner' ]\n");
  });

  it("finally passes the result through, ignores its return and lets a throw replace it", () => {
    expect(
      stdoutOf(`
        Promise.resolve("v").finally(() => "ignored").then((v) => console.log("kept", v));
        Promise.reject(new Error("r")).finally(() => {}).catch((e) => console.log("rethrown", e.message));
        Promise.resolve("v").finally(() => { throw new Error("t"); }).catch((e) => console.log("replaced", e.message));
        Promise.resolve("x").finally((a) => console.log("argument", a));`),
    ).toBe("argument undefined\nreplaced t\nkept v\nrethrown r\n");
  });

  it("then on a receiver that is not a promise is the V8 incompatible-receiver TypeError", () => {
    const realm = inRealm();
    const ctor = realm.promise.constructor;
    const prototype = OrdinaryGet(ctor, "prototype") as JSObject;
    const method = (target: JSObject, name: string) => OrdinaryGet(target, name) as JSFunction;
    expect([
      thrown(realm.call(realm.promise.then, realm.newObject(), [])),
      thrown(realm.call(realm.promise.then, 1, [])),
      thrown(realm.call(method(ctor, "resolve"), 1, [])),
      thrown(realm.call(method(prototype, "finally"), 1, [])),
    ]).toEqual([
      "TypeError: Method Promise.prototype.then called on incompatible receiver #<Object>",
      "TypeError: Method Promise.prototype.then called on incompatible receiver 1",
      "TypeError: PromiseResolve called on non-object",
      "TypeError: Promise.prototype.finally called on non-object",
    ]);
  });

  it("has the property shape V8 installs: lengths, hidden methods, a constant prototype", () => {
    const realm = inRealm();
    const ctor = realm.promise.constructor;
    const prototype = OrdinaryGet(ctor, "prototype") as JSObject;
    const length = (target: JSObject, name: string) => OrdinaryGet(OrdinaryGet(target, name) as JSObject, "length");
    expect([OrdinaryGet(ctor, "length"), OrdinaryGet(ctor, "name")]).toEqual([1, "Promise"]);
    expect([length(prototype, "then"), length(prototype, "catch"), length(prototype, "finally"), length(ctor, "all"), length(ctor, "resolve")]).toEqual([2, 1, 1, 1, 1]);
    expect(OrdinaryGet(prototype, "constructor")).toBe(ctor);
    expect(OrdinaryGetOwnProperty(prototype, "then")).toMatchObject({ writable: true, enumerable: false, configurable: true });
    expect(OrdinaryGetOwnProperty(ctor, "prototype")).toMatchObject({ writable: false, enumerable: false, configurable: false });
  });

  it("shows the builtin's own frame between a finally handler and the microtask checkpoint", () => {
    const run = runSource(`Promise.resolve(1).finally(function f() { console.log(new Error("e").stack); });`, undefined, {
      entryPoint: () => "microtask",
    });
    expect(run.stdout).toBe(
      "Error: e\n    at f (main.cjs:1:55)\n    at <anonymous>\n    at process.processTicksAndRejections (node:internal/process/task_queues:104:5)\n",
    );
  });
});

describe("Promise statics", () => {
  it("Promise.resolve returns a native promise itself, wraps anything else", () => {
    expect(
      stdoutOf(`
        const p = Promise.resolve(1);
        console.log(Promise.resolve(p) === p, Promise.reject(2).catch(() => {}) === p);
        const f = Promise.reject(new Error("f")); f.catch(() => {});
        console.log(Promise.resolve(f) === f);`),
    ).toBe("true false\ntrue\n");
  });

  it("all, race, allSettled and any follow input order and the first settlement", () => {
    expect(
      stdoutOf(`
        const ok = (v) => Promise.resolve(v);
        const no = (v) => Promise.reject(v);
        Promise.all([1, ok(2), 3]).then((v) => console.log("all", v));
        Promise.all([ok(1), no("x"), no("y")]).catch((v) => console.log("all rejects", v));
        Promise.all([]).then((v) => console.log("all empty", v));
        Promise.race([ok("a"), no("b")]).then((v) => console.log("race", v));
        Promise.allSettled([ok(1), no(2)]).then((v) => console.log("allSettled", v));
        Promise.any([no(1), ok(2)]).then((v) => console.log("any", v));`),
    ).toBe(
      "all empty []\n" +
        "all [ 1, 2, 3 ]\n" +
        "all rejects x\n" +
        "race a\n" +
        "allSettled [\n  { status: 'fulfilled', value: 1 },\n  { status: 'rejected', reason: 2 }\n]\n" +
        "any 2\n",
    );
  });

  it("Promise.any rejects with an AggregateError that holds every reason", () => {
    expect(
      stdoutOf(`
        Promise.any([Promise.reject(1), Promise.reject(2)]).catch((e) => console.log(e.name, e.message, e.errors, Object.keys(e).length));
        Promise.any([]).catch((e) => console.log(e.name, e.message, e.errors));`),
    ).toBe("AggregateError All promises were rejected []\nAggregateError All promises were rejected [ 1, 2 ] 0\n");
  });
});

describe("inspect and the realm", () => {
  it("prints a promise with its state and result", () => {
    expect(
      stdoutOf(`
        const rejected = Promise.reject(3); rejected.catch(() => {});
        console.log(Promise.resolve(1), new Promise(() => {}), rejected);`),
    ).toBe("Promise { 1 } Promise { <pending> } Promise { <rejected> 3 }\n");
  });

  it("calls the host's rejection tracker: reject when nobody listens, handle when a listener arrives later", () => {
    const events: string[] = [];
    let realmRef: Realm | undefined;
    runSource(
      `
        const a = Promise.reject("a");
        const b = Promise.reject("b");
        b.catch(() => {});
        Promise.reject("c").catch(() => {});
        const d = new Promise((_, rej) => rej("d")); d.then(() => {}, () => {});`,
      (realm) => {
        realmRef = realm;
      },
      {
        promiseRejectionTracker(promise: JSPromise, operation) {
          const details = realmRef?.promiseDetails(promise);
          events.push(`${operation} ${details && details.state === "rejected" ? String(details.result) : "?"}`);
        },
      },
    );
    expect(events).toEqual(["reject a", "reject b", "handle b", "reject c", "handle c", "reject d", "handle d"]);
  });

  it("queueMicrotask with a non-function is an unsupported stop (Node's ERR_INVALID_ARG_TYPE is not modeled)", () => {
    expect(() => runSource(`queueMicrotask(1);`)).toThrow(/unsupported/);
  });
});
