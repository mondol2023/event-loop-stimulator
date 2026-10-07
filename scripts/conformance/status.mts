import { writeFileSync } from "node:fs";
import {
  STATUS_FILE,
  type StatusFile,
  describeOutcome,
  measure,
  ratchetFixtures,
  readStatusFile,
} from "../../tests/conformance/support/bytecodeStatus.ts";

// `npm run conformance:status`: rewrites tests/conformance/bytecode-status.json from what the
// bytecode generator produces now, keeping the reasons already written for exceptions that still
// apply. It never touches an `*.expected.json`. New "operands" exceptions get a TODO reason, which
// the ratchet test refuses until it is replaced by a real explanation.

const before = readStatusFile();
const after: StatusFile = {};
const lines: string[] = [];

for (const { fixture, real } of ratchetFixtures()) {
  const outcome = measure(fixture, real);
  const entry = describeOutcome(outcome, before[fixture.name]);
  after[fixture.name] = entry;
  const changed = JSON.stringify(before[fixture.name]) === JSON.stringify(entry) ? " " : "*";
  const why = outcome.refusal === undefined ? "" : `  (${outcome.refusal})`;
  lines.push(`${changed} ${entry.status.padEnd(8)} ${fixture.name}${why}`);
  for (const e of entry.exceptions ?? []) lines.push(`             ${e.level}: ${e.function}`);
}

writeFileSync(STATUS_FILE, `${JSON.stringify(after, null, 2)}\n`);
const count = (status: string): number => Object.values(after).filter((e) => e.status === status).length;
console.log(lines.join("\n"));
console.log(`\n${count("exact")} exact, ${count("opcodes")} opcodes, ${count("pending")} pending of ${Object.keys(after).length} fixtures (* = changed)`);
