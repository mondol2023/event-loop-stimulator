import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseExpectation } from "../../scripts/conformance/expectation.mts";
import { checkIntegrity, discoverFixtures } from "../../scripts/conformance/fixtures.mts";
import { readTarget } from "../../scripts/conformance/target.mts";

// None of these tests spawn real node: the integrity of the committed
// fixtures/expectations is checked against the repo, and every failure mode is
// proven on a throwaway directory so each message can be asserted to name the
// offending file.

const CONFORMANCE_ROOT = dirname(fileURLToPath(import.meta.url));
const target = readTarget();

function expectation(name: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema: 1,
    fixture: name,
    kind: "program",
    lang: "js",
    target,
    nondeterministic: false,
    outcomes: [{ stdout: "1\n", stderr: "", exitCode: 0 }],
    ...overrides,
  };
}

describe("committed conformance fixtures", () => {
  it("every fixture has an expectation, there are no orphans, and each matches the pinned target", () => {
    expect(checkIntegrity(CONFORMANCE_ROOT, target)).toEqual([]);
  });

  it("every fixture discovered in the repo is well formed", () => {
    for (const f of discoverFixtures(CONFORMANCE_ROOT)) {
      expect(f.name).toMatch(/^[a-z0-9][a-z0-9-]*$/);
      expect(f.source.length).toBeGreaterThan(0);
    }
  });
});

describe("checkIntegrity and discoverFixtures on a temp tree", () => {
  let root: string;
  const put = (rel: string, content: string | Record<string, unknown>) => {
    const full = join(root, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, typeof content === "string" ? content : `${JSON.stringify(content, null, 2)}\n`);
  };

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "sl-integrity-"));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("passes with no fixtures dirs and no expectations at all", () => {
    expect(discoverFixtures(root)).toEqual([]);
    expect(checkIntegrity(root, target)).toEqual([]);
  });

  it("discovers .cjs and .cts fixtures under fixtures/ and internals/, with kind and lang from where and what they are", () => {
    put("fixtures/a-js.cjs", "console.log(1)");
    put("fixtures/b-ts.cts", "const n: number = 1");
    put("internals/c.cjs", "1");
    const found = discoverFixtures(root).map((f) => [f.name, f.kind, f.lang, f.file]);
    expect(found).toEqual([
      ["a-js", "program", "js", "fixtures/a-js.cjs"],
      ["b-ts", "program", "ts", "fixtures/b-ts.cts"],
      ["c", "internals", "js", "internals/c.cjs"],
    ]);
    expect(discoverFixtures(root)[0]?.source).toBe("console.log(1)");
    expect(discoverFixtures(root)[0]?.meta).toEqual({});
  });

  it("reads an optional <name>.meta.json (strict)", () => {
    put("fixtures/a.cjs", "1");
    put("fixtures/a.meta.json", { nondeterministic: true, runs: 3, nodeArgs: ["--expose-gc"], expect: "run" });
    expect(discoverFixtures(root)[0]?.meta).toEqual({
      nondeterministic: true,
      runs: 3,
      nodeArgs: ["--expose-gc"],
      expect: "run",
    });
    put("fixtures/a.meta.json", { bogus: 1 });
    expect(() => discoverFixtures(root)).toThrow(/fixtures\/a\.meta\.json/);
  });

  it("rejects a .cjs and a .cts with the same stem, naming both files", () => {
    put("fixtures/dup.cjs", "1");
    put("fixtures/dup.cts", "1");
    expect(() => discoverFixtures(root)).toThrow(/fixtures\/dup\.cjs.*fixtures\/dup\.cts/s);
    expect(checkIntegrity(root, target).join("\n")).toMatch(/dup/);
  });

  it("reports a fixture with no expectation, naming the fixture file", () => {
    put("fixtures/a.cjs", "1");
    const problems = checkIntegrity(root, target);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/^fixtures\/a\.cjs: no expectation/);
  });

  it("reports an orphan .expected.json, naming it", () => {
    put("fixtures/gone.expected.json", expectation("gone"));
    const problems = checkIntegrity(root, target);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/^fixtures\/gone\.expected\.json: orphan/);
  });

  it("reports an expectation that does not parse, naming the file", () => {
    put("fixtures/a.cjs", "1");
    put("fixtures/a.expected.json", { ...expectation("a"), extra: true });
    const problems = checkIntegrity(root, target);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/^fixtures\/a\.expected\.json: invalid expectation/);
  });

  it("reports an expectation that is not even JSON, naming the file", () => {
    put("fixtures/a.cjs", "1");
    put("fixtures/a.expected.json", "{ not json");
    expect(checkIntegrity(root, target)[0]).toMatch(/^fixtures\/a\.expected\.json: /);
  });

  it("reports an expectation recorded on another target, naming the file and both versions", () => {
    put("fixtures/a.cjs", "1");
    put("fixtures/a.expected.json", expectation("a", { target: { node: "0.0.1", v8: target.v8 } }));
    const problems = checkIntegrity(root, target);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/^fixtures\/a\.expected\.json: recorded on Node\.js 0\.0\.1.*pinned/);
  });

  it("reports an expectation whose fixture, kind or lang disagrees with the file it sits next to", () => {
    put("fixtures/a.cjs", "1");
    put("fixtures/a.expected.json", expectation("other", { kind: "internals", lang: "ts" }));
    const problems = checkIntegrity(root, target).join("\n");
    expect(problems).toMatch(/fixtures\/a\.expected\.json: fixture "other" is not "a"/);
    expect(problems).toMatch(/fixtures\/a\.expected\.json: kind "internals" is not "program"/);
    expect(problems).toMatch(/fixtures\/a\.expected\.json: lang "ts" is not "js"/);
  });

  it("accepts a fully consistent tree", () => {
    put("fixtures/a.cjs", "1");
    put("fixtures/a.expected.json", expectation("a"));
    put("internals/b.cts", "1");
    put("internals/b.expected.json", expectation("b", { kind: "internals", lang: "ts" }));
    expect(checkIntegrity(root, target)).toEqual([]);
  });

  it("reports a meta file with no fixture, naming it", () => {
    put("fixtures/lonely.meta.json", { runs: 2 });
    const problems = checkIntegrity(root, target);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/^fixtures\/lonely\.meta\.json: orphan/);
  });
});

describe("parseExpectation", () => {
  it("accepts a complete expectation and returns it", () => {
    const e = expectation("a");
    expect(parseExpectation(e)).toEqual(e);
  });

  it("rejects unknown keys at every level", () => {
    expect(() => parseExpectation({ ...expectation("a"), extra: 1 })).toThrow();
    expect(() => parseExpectation(expectation("a", { target: { node: "1", v8: "2", x: 3 } }))).toThrow();
    expect(() =>
      parseExpectation(expectation("a", { outcomes: [{ stdout: "", stderr: "", exitCode: 0, extra: 1 }] })),
    ).toThrow();
  });

  it("rejects schema 2", () => {
    expect(() => parseExpectation(expectation("a", { schema: 2 }))).toThrow();
  });
});
