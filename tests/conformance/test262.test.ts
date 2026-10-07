import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { classify, EXCLUSION_REASONS } from "./test262/classify";
import { parseMetadata } from "./test262/metadata";
import { runTest262, type Test262Case } from "./test262/runner";
import type { SimOutput, Simulator } from "./support/simulator";

// Three real test262 shapes (licensed BSD, https://github.com/tc39/test262), trimmed.
const PLAIN = `// Copyright (C) 2016 the V8 project authors. All rights reserved.
// This code is governed by the BSD license found in the LICENSE file.
/*---
esid: sec-addition-operator-plus-runtime-semantics-evaluation
description: >
  Addition of two numbers
info: |
  1. Let lref be the result of evaluating AdditiveExpression.
  Note: a colon here: is part of a block scalar.
includes: [assert.js, sta.js]
features: [arrow-function]
---*/

assert.sameValue(1 + 1, 2);
`;

const ASYNC = `/*---
description: await resolves a promise
flags: [async]
includes: [asyncHelpers.js]
features: [async-functions]
---*/

asyncTest(async function () {
  assert.sameValue(await Promise.resolve(1), 1);
});
`;

const NEGATIVE = `/*---
description: duplicate lexical declarations are an early error
negative:
  phase: parse
  type: SyntaxError
flags: [onlyStrict]
---*/

$DONOTEVALUATE();
let x;
let x;
`;

const body = (frontMatter: string[], code: string) => `/*---\n${frontMatter.join("\n")}\n---*/\n${code}\n`;

describe("parseMetadata", () => {
  it("reads a plain test", () => {
    expect(parseMetadata(PLAIN)).toEqual({
      includes: ["assert.js", "sta.js"],
      flags: [],
      features: ["arrow-function"],
      description: "Addition of two numbers\n",
    });
  });

  it("reads an async test with includes and flags", () => {
    expect(parseMetadata(ASYNC)).toEqual({
      includes: ["asyncHelpers.js"],
      flags: ["async"],
      features: ["async-functions"],
      description: "await resolves a promise",
    });
  });

  it("reads a negative test", () => {
    const meta = parseMetadata(NEGATIVE);
    expect(meta.negative).toEqual({ phase: "parse", type: "SyntaxError" });
    expect(meta.flags).toEqual(["onlyStrict"]);
  });

  it("has no `negative` key when the test is not negative", () => {
    expect("negative" in parseMetadata(PLAIN)).toBe(false);
  });

  it("throws on a file without front matter, naming the problem", () => {
    expect(() => parseMetadata("assert.sameValue(1, 1);")).toThrow(/front matter/);
  });

  it("throws on front matter that is not valid YAML", () => {
    expect(() => parseMetadata("/*---\nincludes: [unclosed\n---*/")).toThrow(/test262 metadata/);
  });
});

describe("classify", () => {
  const classifySource = (source: string) => classify(source, parseMetadata(source));

  it("accepts a simple test", () => {
    expect(classifySource(PLAIN)).toEqual({ inSubset: true });
  });

  it("rejects an include outside the harness we provide, with reason `include`", () => {
    const source = body(["includes: [propertyHelper.js]"], "verifyProperty(Promise, 'x', {});");
    expect(classifySource(source)).toMatchObject({ inSubset: false, reason: "include" });
    expect(classifySource(ASYNC)).toMatchObject({ inSubset: false, reason: "include" });
  });

  it("rejects a feature outside the allow-list, with reason `feature`", () => {
    const source = body(["features: [Symbol]"], "assert.sameValue(1, 1);");
    expect(classifySource(source)).toMatchObject({ inSubset: false, reason: "feature" });
  });

  it("rejects module, raw and other unsupported flags, with reason `flag`", () => {
    for (const flag of ["module", "raw", "CanBlockIsFalse", "CanBlockIsTrue"]) {
      const source = body([`flags: [${flag}]`], "assert.sameValue(1, 1);");
      expect(classifySource(source), flag).toMatchObject({ inSubset: false, reason: "flag" });
    }
  });

  it("rejects a test the subset validator refuses, with reason `validator`", () => {
    const source = body(["description: proxies"], "var p = new Proxy({}, {});\nassert.sameValue(typeof p, 'object');");
    expect(classifySource(source)).toMatchObject({ inSubset: false, reason: "validator" });
  });

  it("rejects a test that does not parse, with reason `parse`", () => {
    const source = body(["description: broken"], "var = ;");
    expect(classifySource(source)).toMatchObject({ inSubset: false, reason: "parse" });
  });

  it("rejects a test over the source limits, with reason `size`", () => {
    const source = body(["description: long"], "// x\n".repeat(401));
    expect(classifySource(source)).toMatchObject({ inSubset: false, reason: "size" });
  });

  it("rejects front matter it cannot read, with reason `metadata`", () => {
    const source = "/*---\nincludes: [unclosed\n---*/\nassert.sameValue(1, 1);";
    expect(classify(source, undefined)).toMatchObject({ inSubset: false, reason: "metadata" });
  });

  it("accepts a parse-negative test only when our parser also rejects it", () => {
    expect(classifySource(NEGATIVE)).toEqual({ inSubset: true });
    const accepted = body(["negative:", "  phase: parse", "  type: SyntaxError"], "var x = 1;");
    expect(classifySource(accepted)).toMatchObject({ inSubset: false, reason: "parse" });
  });

  it("rejects a negative test outside the parse and runtime phases, with reason `negative`", () => {
    const source = body(["negative:", "  phase: resolution", "  type: SyntaxError"], "assert.sameValue(1, 1);");
    expect(classifySource(source)).toMatchObject({ inSubset: false, reason: "negative" });
  });

  it("only uses reasons from the closed enum", () => {
    expect(new Set(EXCLUSION_REASONS)).toEqual(new Set(["include", "flag", "feature", "negative", "parse", "validator", "size", "metadata"]));
  });
});

describe("runTest262 with a fake simulator", () => {
  const output = (o: Partial<SimOutput> = {}): SimOutput => ({ stdout: "", stderr: "", exitCode: 0, warnings: [], ...o });
  const fake = (run: (source: string) => SimOutput): Simulator & { seen: string[] } => {
    const seen: string[] = [];
    return {
      seen,
      run(source) {
        seen.push(source);
        return run(source);
      },
    };
  };
  const test = (source: string, path = "demo.js"): Test262Case => ({ path, source, meta: parseMetadata(source) });

  it("runs a test in both sloppy and strict mode, prepending \"use strict\" for the second", () => {
    const sim = fake(() => output());
    expect(runTest262(sim, test(PLAIN))).toEqual({ status: "pass" });
    expect(sim.seen).toHaveLength(2);
    expect(sim.seen[0]).toBe(PLAIN);
    expect(sim.seen[1]).toBe(`"use strict";\n${PLAIN}`);
  });

  it("honours onlyStrict and noStrict", () => {
    const onlyStrict = fake(() => output());
    runTest262(onlyStrict, test(body(["flags: [onlyStrict]"], "1;")));
    expect(onlyStrict.seen).toHaveLength(1);
    expect(onlyStrict.seen[0]).toMatch(/^"use strict";/);
    const noStrict = fake(() => output());
    runTest262(noStrict, test(body(["flags: [noStrict]"], "1;")));
    expect(noStrict.seen).toHaveLength(1);
    expect(noStrict.seen[0]).not.toMatch(/^"use strict";/);
  });

  it("fails when the program exits non-zero, naming the mode and the stderr", () => {
    const sim = fake((source) => (source.startsWith('"use strict"') ? output({ exitCode: 1, stderr: "Test262Error: boom\n" }) : output()));
    expect(runTest262(sim, test(PLAIN))).toMatchObject({ status: "fail", mode: "strict" });
    const failed = runTest262(sim, test(PLAIN));
    expect(failed.status === "fail" && failed.message).toContain("boom");
  });

  it("a parse-negative test passes only when the simulator reports E_SYNTAX", () => {
    const reports = fake(() => output({ exitCode: 1, stderr: "E_SYNTAX: Identifier 'x' has already been declared\n" }));
    expect(runTest262(reports, test(NEGATIVE))).toEqual({ status: "pass" });
    const runsIt = fake(() => output());
    expect(runTest262(runsIt, test(NEGATIVE))).toMatchObject({ status: "fail" });
    const otherError = fake(() => output({ exitCode: 1, stderr: "E_EXCLUDED_API: nope\n" }));
    expect(runTest262(otherError, test(NEGATIVE))).toMatchObject({ status: "fail" });
  });

  it("a runtime-negative test passes only when the named error is thrown", () => {
    const source = body(["negative:", "  phase: runtime", "  type: TypeError"], "null.x;");
    const right = fake(() => output({ exitCode: 1, stderr: "main.cjs:1\n\nTypeError: Cannot read properties of null\n    at x\n" }));
    expect(runTest262(right, test(source))).toEqual({ status: "pass" });
    const wrong = fake(() => output({ exitCode: 1, stderr: "ReferenceError: x is not defined\n" }));
    expect(runTest262(wrong, test(source))).toMatchObject({ status: "fail" });
    const none = fake(() => output());
    expect(runTest262(none, test(source))).toMatchObject({ status: "fail" });
  });

  it("an async test needs Test262:AsyncTestComplete on stdout", () => {
    const source = body(["flags: [async]"], "Promise.resolve().then($DONE, $DONE);");
    const done = fake(() => output({ stdout: "Test262:AsyncTestComplete\n" }));
    expect(runTest262(done, test(source))).toEqual({ status: "pass" });
    const silent = fake(() => output());
    expect(runTest262(silent, test(source))).toMatchObject({ status: "fail" });
    const failure = fake(() => output({ stdout: "Test262:AsyncTestFailure:Test262Error: nope\n" }));
    const failed = runTest262(failure, test(source));
    expect(failed).toMatchObject({ status: "fail" });
    expect(failed.status === "fail" && failed.message).toContain("nope");
  });
});

// The vendored tests: every one is in the subset, and every exclusion is recorded.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "vendor", "test262");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (name.endsWith(".js")) out.push(full);
  }
  return out;
}

describe("vendor/test262", () => {
  it("records the commit it was taken from", () => {
    expect(readFileSync(join(ROOT, "COMMIT"), "utf8").trim()).toMatch(/^[0-9a-f]{40}$/);
  });

  const vendored = existsSync(join(ROOT, "test")) ? walk(join(ROOT, "test")) : [];

  it("contains tests", () => {
    expect(vendored.length).toBeGreaterThan(100);
  });

  // Classifying ~1000 tests parses and validates each one twice: seconds on a quiet machine, more under load.
  it("every vendored test is in the subset", () => {
    const outside: string[] = [];
    for (const file of vendored) {
      const source = readFileSync(file, "utf8");
      const verdict = classify(source, parseMetadata(source));
      if (!verdict.inSubset) outside.push(`${file}: ${verdict.reason}`);
    }
    expect(outside).toEqual([]);
  }, 60_000);

  it("every exclusion has a reason from the closed enum and is not vendored", () => {
    const exclusions = JSON.parse(readFileSync(join(ROOT, "exclusions.json"), "utf8")) as { path: string; reason: string }[];
    expect(exclusions.length).toBeGreaterThan(0);
    const bad = exclusions.filter(
      (e) => !(EXCLUSION_REASONS as readonly string[]).includes(e.reason) || existsSync(join(ROOT, "test", e.path)),
    );
    expect(bad).toEqual([]);
  });

  it("the vendored tests and the exclusions are sorted and free of duplicates", () => {
    const exclusions = JSON.parse(readFileSync(join(ROOT, "exclusions.json"), "utf8")) as { path: string }[];
    const paths = exclusions.map((e) => e.path);
    expect(paths).toEqual([...new Set(paths)].sort());
  });
});

// Phase 3 replaces this with `runTest262(SIMULATOR, ...)` over every vendored test.
describe("simulator passes the vendored test262 subset", () => {
  it.todo("runs every vendored test in sloppy and strict mode against the Phase 3 simulator");
});
