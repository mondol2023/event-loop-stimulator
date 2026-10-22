import { describe, expect, it } from "vitest";
import { simulate } from "@/core/timeline/simulate";

// Each program was run on the pinned node 24.19.0 and the expected text is what it printed.

function stdoutOf(source: string): string {
  const r = simulate(source, "js", { record: false });
  expect(r.diagnostics).toEqual([]);
  expect(r.stop, r.stderr).toBeUndefined();
  expect(r.stderr).toBe("");
  return r.stdout;
}

describe("Promise statics with another constructor as `this`", () => {
  it("NewPromiseCapability, GetPromiseResolve and the abrupt completions follow node", () => {
    expect(
      stdoutOf(`const log = [];
function C(executor) {
  log.push("C");
  executor(function (v) { log.push("resolved " + v); }, function (r) { log.push("rejected " + r); });
}
const p = Promise.resolve.call(C, 5);
const q = Promise.reject.call(C, 6);
console.log(log.join("; "), p, q);
function D(executor) {
  executor(function (v) { console.log("resolve", v); }, function (r) { console.log("reject", r.message); });
}
D.resolve = function (v) { return { then(f) { f(v); } }; };
Promise.all.call(D, [1, 2]);
Promise.allSettled.call(D, ["x"]);
Promise.race.call(D, [3]);
Promise.any.call(D, "ab");
function attempt(f) { try { f(); console.log("no throw"); } catch (e) { console.log(e.name, e.message); } }
attempt(() => Promise.resolve.call(1));
attempt(() => Promise.reject.call(undefined));
attempt(() => Promise.all.call(1, []));
attempt(() => Promise.resolve.call({}));
attempt(() => Promise.resolve.call(function () {}));
attempt(() => Promise.resolve.call(function (e) { e(); }));
attempt(() => Promise.resolve.call(function (e) { e(function () {}, function () {}); e(function () {}, function () {}); }));
attempt(() => Promise.resolve.call(() => 1));
function E(executor) { executor(function () {}, function () { throw new RangeError("from reject"); }); }
attempt(() => Promise.reject.call(E, 1));
function F2(executor) { throw new SyntaxError("ctor"); }
attempt(() => Promise.all.call(F2, []));
Promise.any("xyz").then((v) => console.log("any", v));
Promise.all("ab").then((v) => console.log("all", v));
`),
    ).toBe(`C; resolved 5; C; rejected 6 C {} C {}
resolve [ 1, 2 ]
resolve [ { status: 'fulfilled', value: 'x' } ]
resolve 3
resolve a
resolve b
TypeError PromiseResolve called on non-object
TypeError PromiseReject called on non-object
TypeError Promise.all called on non-object
TypeError #<Object> is not a constructor
TypeError Promise resolve or reject function is not callable
TypeError Promise resolve or reject function is not callable
TypeError Promise executor has already been invoked with non-undefined arguments
TypeError () => 1 is not a constructor
RangeError from reject
SyntaxError ctor
any x
all [ 'a', 'b' ]
`);
  });
});
