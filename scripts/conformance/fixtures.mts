import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "../../core/shared/zod.ts";
import { parseExpectation } from "./expectation.mts";
import type { Target } from "./target.mts";

// Fixture programs live beside their recorded expectations:
//   <root>/fixtures/<name>.cjs|.cts   kind "program"   (observable behaviour + bytecode)
//   <root>/internals/<name>.cjs|.cts  kind "internals" (V8 internals probes)
//   <name>.meta.json                  optional, strict
//   <name>.expected.json              written only by `npm run conformance:record`
// `root` is tests/conformance. File paths in results and messages are
// root-relative with forward slashes, so a message always names the file.

export const FixtureMetaSchema = z
  .object({
    nondeterministic: z.boolean().optional(),
    expect: z.enum(["run", "refused"]).optional(),
    runs: z.number().int().positive().optional(),
    nodeArgs: z.array(z.string()).optional(),
  })
  .strict();

export type FixtureMeta = z.infer<typeof FixtureMetaSchema>;

export type Fixture = {
  readonly name: string;
  readonly lang: "js" | "ts";
  readonly kind: "program" | "internals";
  /** Root-relative, forward slashes. */
  readonly file: string;
  readonly source: string;
  readonly meta: FixtureMeta;
};

const DIRS = [
  { dir: "fixtures", kind: "program" },
  { dir: "internals", kind: "internals" },
] as const;

const SOURCE = /^(.+)\.(cjs|cts)$/;
const EXPECTED = /^(.+)\.expected\.json$/;
const META = /^(.+)\.meta\.json$/;

function entries(root: string, dir: string): string[] {
  const full = join(root, dir);
  if (!existsSync(full)) return [];
  // Plain code-unit order: deterministic on every platform and locale.
  return readdirSync(full).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

function formatError(e: unknown): string {
  return e instanceof Error ? e.message.replace(/\s+/g, " ").trim() : String(e);
}

/** Throws (naming the file) on a duplicate stem or a malformed meta file. */
export function discoverFixtures(root: string): Fixture[] {
  const fixtures: Fixture[] = [];
  for (const { dir, kind } of DIRS) {
    const byStem = new Map<string, string>();
    for (const entry of entries(root, dir)) {
      const m = SOURCE.exec(entry);
      if (!m) continue;
      const name = m[1] as string;
      const prior = byStem.get(name);
      if (prior !== undefined) {
        throw new Error(`${dir}/${prior} and ${dir}/${entry} share the stem "${name}": use one language per fixture`);
      }
      byStem.set(name, entry);
      const lang = m[2] === "cts" ? "ts" : "js";
      const metaFile = `${dir}/${name}.meta.json`;
      let meta: FixtureMeta = {};
      if (existsSync(join(root, metaFile))) {
        try {
          meta = FixtureMetaSchema.parse(JSON.parse(readFileSync(join(root, metaFile), "utf8")));
        } catch (e) {
          throw new Error(`${metaFile}: invalid fixture meta: ${formatError(e)}`);
        }
      }
      fixtures.push({
        name,
        lang,
        kind,
        file: `${dir}/${entry}`,
        source: readFileSync(join(root, dir, entry), "utf8"),
        meta,
      });
    }
  }
  const seen = new Map<string, string>();
  for (const f of fixtures) {
    const prior = seen.get(f.name);
    if (prior !== undefined) throw new Error(`${prior} and ${f.file} share the fixture name "${f.name}"`);
    seen.set(f.name, f.file);
  }
  return fixtures;
}

/** Root-relative path of a fixture's recorded expectation. */
export function expectationFile(fixture: Fixture): string {
  return fixture.file.replace(SOURCE, "$1.expected.json");
}

/**
 * Every problem with the committed fixtures/expectations, one string per
 * problem, each starting with the offending root-relative file. Empty means
 * consistent. Never spawns node.
 */
export function checkIntegrity(root: string, target: Target): string[] {
  let fixtures: Fixture[];
  try {
    fixtures = discoverFixtures(root);
  } catch (e) {
    return [formatError(e)];
  }
  const problems: string[] = [];
  const byKey = new Map(fixtures.map((f) => [`${f.kind === "program" ? "fixtures" : "internals"}/${f.name}`, f]));

  for (const f of fixtures) {
    if (!existsSync(join(root, expectationFile(f)))) {
      problems.push(`${f.file}: no expectation ${expectationFile(f)} (run npm run conformance:record)`);
    }
  }

  for (const { dir } of DIRS) {
    for (const entry of entries(root, dir)) {
      const rel = `${dir}/${entry}`;
      const meta = META.exec(entry);
      if (meta && !byKey.has(`${dir}/${meta[1]}`)) {
        problems.push(`${rel}: orphan meta file, no fixture ${dir}/${meta[1]}.cjs or .cts`);
      }
      const exp = EXPECTED.exec(entry);
      if (!exp) continue;
      const fixture = byKey.get(`${dir}/${exp[1]}`);
      if (!fixture) {
        problems.push(`${rel}: orphan expectation, no fixture ${dir}/${exp[1]}.cjs or .cts`);
        continue;
      }
      let parsed;
      try {
        parsed = parseExpectation(JSON.parse(readFileSync(join(root, rel), "utf8")));
      } catch (e) {
        problems.push(`${rel}: invalid expectation: ${formatError(e)}`);
        continue;
      }
      if (parsed.target.node !== target.node || parsed.target.v8 !== target.v8) {
        problems.push(
          `${rel}: recorded on Node.js ${parsed.target.node} (V8 ${parsed.target.v8}), not the pinned ` +
            `${target.node} (V8 ${target.v8}); re-record`,
        );
      }
      if (parsed.fixture !== fixture.name) problems.push(`${rel}: fixture "${parsed.fixture}" is not "${fixture.name}"`);
      if (parsed.kind !== fixture.kind) problems.push(`${rel}: kind "${parsed.kind}" is not "${fixture.kind}"`);
      if (parsed.lang !== fixture.lang) problems.push(`${rel}: lang "${parsed.lang}" is not "${fixture.lang}"`);
    }
  }
  return problems;
}
