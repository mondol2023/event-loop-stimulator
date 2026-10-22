// The compile worker: runs the real core/ pipeline (compile, then interpret under the modeled
// event loop) on one program per message. User code is parsed and interpreted by core/, never
// executed. Protocol: the parent posts `{ id, input: { code, lang } }`, this replies
// `{ id, value: CompileSummary }`, or `{ id, value: null }` for a message it cannot read (the
// parent validates input first, so that only happens on a programming error).
//
// No `import "server-only"`: this is a worker-thread entry, outside the React server graph, so
// the react-server condition that turns that import into a no-op does not apply here.
import { parentPort } from "node:worker_threads";
import { simulate } from "@/core/timeline/simulate";
import type { CompileSummary } from "@/server/validation/compile";

if (parentPort === null) throw new Error("compile-worker must run inside a worker thread");
const port = parentPort;

function summarize(code: string, lang: "js" | "ts"): CompileSummary {
  // `record: false`: the summary carries no timeline (D8), and the run is identical either way.
  const result = simulate(code, lang, { record: false });
  return {
    diagnostics: result.diagnostics,
    ...(result.diagnostics.length > 0
      ? {}
      : { output: { stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode } }),
    warnings: result.warnings,
    ...(result.stop === undefined ? {} : { stop: result.stop }),
    tickCount: result.tickCount,
  };
}

port.on("message", (message: { id?: unknown; input?: { code?: unknown; lang?: unknown } }) => {
  const { id, input } = message;
  const code = input?.code;
  const lang = input?.lang;
  const value = typeof code === "string" && (lang === "js" || lang === "ts") ? summarize(code, lang) : null;
  port.postMessage({ id, value });
});
