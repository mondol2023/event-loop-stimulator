import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildExpectation, serializeExpectation, type CaptureBytecode } from "./expectation.mts";
import { checkIntegrity, discoverFixtures, expectationFile } from "./fixtures.mts";
import { RealRunError, runReal } from "./run-real.mts";
import { checkPinnedRuntime, readTarget } from "./target.mts";

// `npm run conformance:record`: the ONLY entry point that spawns real node
// (PROMPT.md §3.4), and only on repo-owned or generated fixture programs. The
// pinned-runtime guard runs first so expectations can never be recorded on the
// wrong runtime.

const target = readTarget();
const problems = checkPinnedRuntime({ node: process.versions.node, v8: process.versions.v8 }, target);
if (problems.length > 0) {
  console.error(`Refusing to record conformance expectations:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
  console.error("Switch to the pinned runtime, or bump docs/TARGET.md deliberately (PROMPT.md §3.1).");
  process.exit(1);
}
console.log(`Pinned runtime OK: Node.js ${target.node} (V8 ${target.v8}).`);

// SEAM (Task 4): bytecode capture is wired here. Until then expectations hold
// `outcomes` only; `buildExpectation` calls this for a `kind: "program"` fixture
// that exits 0 or declares `expect: "run"`.
const captureBytecode: CaptureBytecode | undefined = undefined;

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "tests", "conformance");

let fixtures;
try {
  fixtures = discoverFixtures(root);
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
}

// Run everything before writing anything: a RealRunError on any fixture aborts
// the whole record and leaves the existing expectations untouched.
const results: { file: string; text: string }[] = [];
for (const fixture of fixtures) {
  try {
    const expectation = buildExpectation(fixture, target, runReal, captureBytecode);
    results.push({ file: expectationFile(fixture), text: serializeExpectation(expectation) });
    console.log(`  recorded ${fixture.file} (${expectation.outcomes.length} outcome(s))`);
  } catch (e) {
    const reason = e instanceof RealRunError ? e.message : e instanceof Error ? (e.stack ?? e.message) : String(e);
    console.error(`Recording aborted at fixture "${fixture.name}" (${fixture.file}): ${reason}`);
    process.exit(1);
  }
}

for (const { file, text } of results) {
  const full = join(root, file);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, text);
}

const orphans = checkIntegrity(root, target);
if (orphans.length > 0) {
  console.error(`Recorded ${results.length} expectation(s), but the tree is inconsistent:`);
  for (const p of orphans) console.error(`  - ${p}`);
  process.exit(1);
}
console.log(`Recorded ${results.length} expectation(s).`);
