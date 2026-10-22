import { DifferentialMismatch, differentialProperty } from "../../tests/conformance/differential.ts";
import { SIMULATOR } from "../../tests/conformance/support/simulator.ts";
import { checkPinnedRuntime, readTarget } from "./target.mts";

// `npm run conformance:differential -- --runs N --seed S`: N generated programs on the simulator
// and on the pinned real node. Runs under tsx for the `@/` alias.

function option(name: string): number | undefined {
  const at = process.argv.indexOf(name);
  if (at === -1) return undefined;
  const value = Number.parseInt(process.argv[at + 1] ?? "", 10);
  if (!Number.isInteger(value)) throw new Error(`usage: differential [--runs N] [--seed S] (${name} needs an integer)`);
  return value;
}

const problems = checkPinnedRuntime({ node: process.versions.node, v8: process.versions.v8 }, readTarget());
if (problems.length > 0) throw new Error(`differential needs the pinned runtime: ${problems.join("; ")} (docs/TARGET.md)`);

const numRuns = option("--runs") ?? 1000;
const seed = option("--seed") ?? Math.floor(Math.random() * 0x7fffffff);
try {
  const stats = differentialProperty(SIMULATOR, { numRuns, seed });
  console.log(`runs: ${stats.runs}\ndiscarded: ${stats.discarded}\nmismatches: 0\nseed: ${seed}`);
} catch (e) {
  if (!(e instanceof DifferentialMismatch)) throw e;
  console.error(e.message);
  process.exitCode = 1;
}
