import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { classify, type ExclusionReason } from "../../tests/conformance/test262/classify.ts";
import { type Metadata, parseMetadata } from "../../tests/conformance/test262/metadata.ts";

// Vendors the in-subset part of test262 into vendor/test262 (PROMPT.md §3.4).
//
//   npm run conformance:vendor-test262 -- --from <test262 checkout> --commit <sha>
//
// Runs under tsx, not plain Node: the classifier is the real subset validator, which
// uses the `@/` alias. Every test that is NOT copied is written to exclusions.json with
// the reason, so the vendored set is reproducible; both files are generated, never hand-edited.

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUT = join(ROOT, "vendor", "test262");

/** Directories of test262's `test/` that the subset can plausibly cover (test262 calls `%` "modulus"). */
const SCAN = [
  "built-ins/Promise",
  "language/expressions/await",
  "language/expressions/async-function",
  "language/statements/async-function",
  ...["addition", "subtraction", "multiplication", "division", "modulus", "logical-and", "logical-or", "coalesce", "typeof", "strict-equals", "equals"].map(
    (name) => `language/expressions/${name}`,
  ),
  ...["let", "const", "try", "for", "while", "if", "function"].map((name) => `language/statements/${name}`),
  ...["push", "pop", "map", "filter", "forEach", "reduce"].map((name) => `built-ins/Array/prototype/${name}`),
  "built-ins/Object/keys",
];

function argument(name: string): string {
  const at = process.argv.indexOf(name);
  const value = at === -1 ? undefined : process.argv[at + 1];
  if (!value) throw new Error(`usage: vendor-test262 --from <test262 checkout> --commit <sha> (missing ${name})`);
  return value;
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    // `*_FIXTURE.js` files are helpers for module tests, not tests.
    else if (name.endsWith(".js") && !name.includes("_FIXTURE")) out.push(full);
  }
  return out;
}

function main(): void {
  const from = argument("--from");
  const commit = argument("--commit");
  const head = spawnSync("git", ["-C", from, "rev-parse", "HEAD"], { encoding: "utf8" });
  if (head.status !== 0 || head.stdout.trim() !== commit) {
    throw new Error(`${from} is at ${head.stdout.trim() || "an unknown commit"}, not ${commit}: check out the commit first`);
  }

  rmSync(join(OUT, "test"), { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });

  const exclusions: { path: string; reason: ExclusionReason }[] = [];
  const counts = new Map<string, { kept: number; excluded: number }>();
  let kept = 0;

  for (const scan of SCAN) {
    const base = join(from, "test", scan);
    if (!existsSync(base)) throw new Error(`test262 has no test/${scan}: update SCAN in vendor-test262.mts`);
    const count = { kept: 0, excluded: 0 };
    counts.set(scan, count);
    for (const file of walk(base)) {
      const rel = file.slice(join(from, "test").length + 1).replaceAll("\\", "/");
      const source = readFileSync(file, "utf8");
      let meta: Metadata | undefined;
      try {
        meta = parseMetadata(source);
      } catch {
        meta = undefined;
      }
      const verdict = classify(source, meta);
      if (verdict.inSubset) {
        const target = join(OUT, "test", rel);
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, source);
        count.kept++;
        kept++;
      } else {
        exclusions.push({ path: rel, reason: verdict.reason });
        count.excluded++;
      }
    }
  }

  exclusions.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  writeFileSync(join(OUT, "COMMIT"), `${commit}\n`);
  writeFileSync(join(OUT, "exclusions.json"), `[\n${exclusions.map((e) => JSON.stringify(e)).join(",\n")}\n]\n`);
  copyFileSync(join(from, "LICENSE"), join(OUT, "LICENSE"));

  const byReason = new Map<string, number>();
  for (const e of exclusions) byReason.set(e.reason, (byReason.get(e.reason) ?? 0) + 1);
  console.log(`vendored ${kept} tests, excluded ${exclusions.length} (commit ${commit})`);
  for (const [scan, c] of counts) console.log(`  ${scan}: ${c.kept} kept, ${c.excluded} excluded`);
  console.log(`  excluded by reason: ${[...byReason].map(([r, n]) => `${r}=${n}`).join(", ")}`);
}

main();
