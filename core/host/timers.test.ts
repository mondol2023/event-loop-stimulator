import { describe, expect, it } from "vitest";
import { simulate } from "@/core/timeline/simulate";

// lib/internal/timers.js and lib/timers.js at v24.19.0, through the whole pipeline.

const run = (source: string) => simulate(source, "js");

describe("setTimeout delay coercion (Timeout constructor)", () => {
  it("makes < 1, NaN, non-numeric and > 2**31-1 all 1 ms, in creation order with real 1 ms timers", () => {
    const r = run(`setTimeout(() => console.log("five"), 5); setTimeout(() => console.log("zero"), 0);
setTimeout(() => console.log("abc"), "abc"); setTimeout(() => console.log("one"), 1); setTimeout(() => console.log("big"), 2 ** 31);`);
    expect(r.stdout).toBe("zero\nabc\none\nbig\nfive\n");
  });

  it("truncates a fractional delay to pick its list, and coerces numeric strings", () => {
    const r = run(`setTimeout(() => console.log("2.9"), 2.9); setTimeout(() => console.log("'2'"), "2"); setTimeout(() => console.log("1.5"), 1.5);`);
    expect(r.stdout).toBe("1.5\n2.9\n'2'\n");
  });

  it("warns once each for a negative and a NaN delay, and for every overflowing delay", () => {
    const r = run(`setTimeout(() => {}, -5); setTimeout(() => {}, -6); setTimeout(() => {}, NaN); setTimeout(() => {}, "x");
setTimeout(() => {}, 2 ** 31); setTimeout(() => {}, 2 ** 31);`);
    expect(r.stderr).toBe(
      "(node:PID) TimeoutNegativeWarning: -5 is a negative number.\nTimeout duration was set to 1.\n" +
        "(Use `node --trace-warnings ...` to show where the warning was created)\n" +
        "(node:PID) TimeoutNaNWarning: NaN is not a number.\nTimeout duration was set to 1.\n" +
        "(node:PID) TimeoutOverflowWarning: 2147483648 does not fit into a 32-bit signed integer.\nTimeout duration was set to 1.\n" +
        "(node:PID) TimeoutOverflowWarning: 2147483648 does not fit into a 32-bit signed integer.\nTimeout duration was set to 1.\n",
    );
  });

  it("emits a warning from a nextTick (process.emitWarning), so an uncaught error in the script suppresses it", () => {
    const r = run(`setTimeout(() => {}, -1);\nthrow "stop";`);
    expect(r.stderr).not.toContain("TimeoutNegativeWarning");
    expect(r.exitCode).toBe(1);
  });

  it("passes extra arguments to the callback", () => {
    expect(run(`setTimeout((a, b) => console.log(a + b), 1, 2, 3);`).stdout).toBe("5\n");
  });

  it("calls the callback with the Timeout as the receiver", () => {
    expect(run(`setTimeout(function () { console.log(this === t); }, 1); const t = setTimeout(() => {}, 1);`).stdout).toBe("false\n");
    expect(run(`const t = setTimeout(function () { console.log(this === t); }, 1);`).stdout).toBe("true\n");
  });
});

describe("timer lists", () => {
  it("re-arms an interval from its callback's start time", () => {
    const r = run(`let n = 0; const i = setInterval(() => { n++; console.log("i", n); if (n === 3) clearInterval(i); }, 10);
setTimeout(() => console.log("t25"), 25);`);
    expect(r.stdout).toBe("i 1\ni 2\nt25\ni 3\n");
  });

  it("clearTimeout before the timer fires cancels it; clearing twice or clearing junk is harmless", () => {
    const r = run(`const t = setTimeout(() => console.log("never"), 1); clearTimeout(t); clearTimeout(t); clearTimeout(42); clearTimeout(undefined); clearInterval("x");
setTimeout(() => console.log("runs"), 2);`);
    expect(r.stdout).toBe("runs\n");
  });

  it("an unref'd timer does not keep the loop alive; ref() restores it", () => {
    expect(run(`setTimeout(() => console.log("never"), 5).unref(); console.log("end");`).stdout).toBe("end\n");
    expect(run(`const t = setTimeout(() => console.log("runs"), 5); t.unref(); t.ref(); console.log(t.hasRef());`).stdout).toBe("true\nruns\n");
  });

  it("an unref'd timer still fires while something else keeps the loop alive", () => {
    expect(run(`setTimeout(() => console.log("unref"), 1).unref(); setTimeout(() => console.log("ref"), 5);`).stdout).toBe("unref\nref\n");
  });

  it("a timer that clears itself from inside its own callback does not repeat", () => {
    expect(run(`const i = setInterval(() => { console.log("once"); clearInterval(i); }, 1);`).stdout).toBe("once\n");
  });
});

describe("immediates", () => {
  it("run in insertion order; one queued during the check phase waits for the next iteration", () => {
    const r = run(`setImmediate(() => { console.log("a"); setImmediate(() => console.log("c")); process.nextTick(() => console.log("tick")); });
setImmediate(() => console.log("b"));
setTimeout(() => console.log("t"), 5);`);
    expect(r.stdout).toBe("a\ntick\nb\nc\nt\n");
  });

  it("clearImmediate cancels a pending immediate, also from an earlier immediate", () => {
    const r = run(`let b; setImmediate(() => { console.log("a"); clearImmediate(b); }); b = setImmediate(() => console.log("b"));
const c = setImmediate(() => console.log("c")); clearImmediate(c); clearImmediate(undefined);`);
    expect(r.stdout).toBe("a\n");
  });

  it("passes extra arguments", () => {
    expect(run(`setImmediate((x) => console.log(x), "arg");`).stdout).toBe("arg\n");
  });
});

describe("host objects", () => {
  it("printing a Timeout or Immediate stops the run (their full shape is not modeled)", () => {
    const r = run(`console.log("before"); console.log(setTimeout(() => {}, 1));`);
    expect(r.stdout).toBe("before\n");
    expect(r.stop).toMatchObject({ kind: "unsupported" });
  });

  it("a callback that is not a function stops the run (ERR_INVALID_ARG_TYPE is not modeled)", () => {
    expect(run(`setTimeout(1, 1);`).stop).toMatchObject({ kind: "unsupported" });
    expect(run(`setImmediate("x");`).stop).toMatchObject({ kind: "unsupported" });
  });
});
