import { describe, expect, it } from "vitest";
import { runSource } from "./interpreterTestWorld";

// Async functions on the generator machinery (SwitchOnGeneratorState, SuspendGenerator,
// ResumeGenerator and the _AsyncFunction* intrinsics). The host is minimal: the microtask queue is
// drained once after the script. Whole fixtures are replayed in tests/conformance.

const stdoutOf = (source: string): string => runSource(source).stdout;

function jobKinds(source: string): string[] {
  return runSource(source).commands.flatMap((c) => (c.kind === "job-start" ? [c.task.kind] : []));
}

describe("an async function", () => {
  it("runs synchronously up to its first await and returns a pending promise", () => {
    expect(
      stdoutOf(`
        async function f() { console.log("in f"); await null; console.log("resumed"); }
        const p = f();
        console.log("after call", p);`),
    ).toBe("in f\nafter call Promise { <pending> }\nresumed\n");
  });

  it("is inspected as an AsyncFunction", () => {
    expect(stdoutOf(`async function f() {} const g = async () => {}; const o = { async m() {} }; console.log(f, g, [o.m]);`)).toBe(
      "[AsyncFunction: f] [AsyncFunction: g] [ [AsyncFunction: m] ]\n",
    );
  });

  it("resolves its promise with the returned value, and rejects it with a throw", () => {
    expect(
      stdoutOf(`
        async function value() { return 1; }
        async function fails() { throw new Error("async failure"); }
        console.log(typeof value(), value() === value());
        value().then((v) => console.log("value", v));
        fails().catch((e) => console.log("caught", e.message));`),
    ).toBe("object false\nvalue 1\ncaught async failure\n");
  });

  it("keeps its registers, parameters and context across two suspends", () => {
    expect(
      stdoutOf(`
        async function f(a, b) {
          let local = a * 10;
          const first = await b;
          local += first;
          const second = await (b + 1);
          console.log(a, b, first, second, local, (() => local)());
        }
        f(3, 4);
        f(5, 6);`),
    ).toBe("3 4 4 5 34 34\n5 6 6 7 56 56\n");
  });

  it("interleaves two async functions at every await", () => {
    expect(
      stdoutOf(`
        async function a() { console.log("a1"); await null; console.log("a2"); await null; console.log("a3"); }
        async function b() { console.log("b1"); await null; console.log("b2"); await null; console.log("b3"); }
        a(); b();`),
    ).toBe("a1\nb1\na2\nb2\na3\nb3\n");
  });

  it("routes an awaited rejection to its catch and finally blocks", () => {
    expect(
      stdoutOf(`
        async function t() {
          try { await Promise.reject(new Error("awaited")); console.log("not reached"); }
          catch (e) { console.log("caught", e.message); }
          finally { console.log("finally"); }
          return "done";
        }
        t().then(console.log);`),
    ).toBe("caught awaited\nfinally\ndone\n");
  });

  it("rejects its promise when an awaited rejection is not caught", () => {
    expect(
      stdoutOf(`
        async function t() { await Promise.reject(new Error("passes through")); }
        t().catch((e) => console.log("rejected with", e.message));`),
    ).toBe("rejected with passes through\n");
  });

  it("only catches the rejection of a promise it awaits, not one it returns", () => {
    expect(
      stdoutOf(`
        async function awaits() { try { return await Promise.reject(new Error("r")); } catch (e) { return "caught inside"; } }
        async function returns() { try { return Promise.reject(new Error("r")); } catch (e) { return "caught inside"; } }
        awaits().then(console.log);
        returns().then(console.log, (e) => console.log("rejected outside", e.message));`),
    ).toBe("caught inside\nrejected outside r\n");
  });
});

describe("await", () => {
  it("of a native promise or a plain value costs one job", () => {
    expect(jobKinds(`(async () => { await 1; })();`)).toEqual(["PromiseReactionJob"]);
    expect(jobKinds(`const p = Promise.resolve(2); (async () => { await p; })();`)).toEqual(["PromiseReactionJob"]);
  });

  it("of a thenable first adopts it: the thenable job, its then's reaction, then the resume", () => {
    expect(jobKinds(`(async () => { await { then(r) { r(1); } }; })();`)).toEqual(["PromiseResolveThenableJob", "PromiseReactionJob"]);
  });

  it("resumes with the value a thenable resolved", () => {
    expect(stdoutOf(`(async () => { console.log(await { then(r) { r("from thenable"); } }); })();`)).toBe("from thenable\n");
  });

  it("returns of a promise take two more turns than return await", () => {
    expect(
      stdoutOf(`
        let turn = 0;
        (function step() { turn++; console.log("turn " + turn); if (turn < 4) Promise.resolve().then(step); })();
        const inner = () => Promise.resolve("v");
        (async () => await inner())().then(() => console.log("return await"));
        (async () => inner())().then(() => console.log("return promise"));`),
    ).toBe("turn 1\nturn 2\nturn 3\nreturn await\nturn 4\nreturn promise\n");
  });
});
