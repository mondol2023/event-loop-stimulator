import { readFileSync } from "node:fs";
import { join } from "node:path";
import { handleRequest } from "../worker/handleRequest";
import type { PipelineResponse } from "../worker/protocol";

// Runs a conformance fixture through the real worker handler in-process, so store tests apply the
// exact responses the browser would receive.

type Compiled = PipelineResponse & { type: "compiled" };
type Simulated = PipelineResponse & { type: "simulated" };

const FIXTURES = join(process.cwd(), "tests", "conformance", "fixtures");

export function runSource(source: string, jobId: number): PipelineResponse[] {
  const responses: PipelineResponse[] = [];
  handleRequest({ type: "run", jobId, source, lang: "js" }, (r) => responses.push(r));
  return responses;
}

export function fixtureRun(name: string, jobId = 1): { source: string; compiled: Compiled; simulated: Simulated } {
  const source = readFileSync(join(FIXTURES, `${name}.cjs`), "utf8");
  const responses = runSource(source, jobId);
  const compiled = responses.find((r): r is Compiled => r.type === "compiled");
  const simulated = responses.find((r): r is Simulated => r.type === "simulated");
  if (!compiled || !simulated) throw new Error(`fixture ${name} did not compile and simulate: ${responses.map((r) => r.type).join(", ")}`);
  return { source, compiled, simulated };
}
