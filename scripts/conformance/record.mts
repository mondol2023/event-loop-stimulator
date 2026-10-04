import { checkPinnedRuntime, readTarget } from "./target.mts";

// `npm run conformance:record`: the ONLY entry point that will spawn real node
// (PROMPT.md §3.4), and only on repo-owned or generated fixture programs. The
// fixture recorder itself lands in Phase 2; Phase 0 ships the pin guard so
// expectations can never be recorded on the wrong runtime.

const target = readTarget();
const problems = checkPinnedRuntime({ node: process.versions.node, v8: process.versions.v8 }, target);
if (problems.length > 0) {
  console.error(`Refusing to record conformance expectations:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
  console.error("Switch to the pinned runtime, or bump docs/TARGET.md deliberately (PROMPT.md §3.1).");
  process.exit(1);
}

console.log(`Pinned runtime OK: Node.js ${target.node} (V8 ${target.v8}).`);
console.log("No fixtures to record yet: the recorder lands in Phase 2.");
