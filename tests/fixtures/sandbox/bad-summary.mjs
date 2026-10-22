// Repo-owned fixture: a worker that answers with a value that is not a CompileSummary. Never given user code.
import { parentPort } from "node:worker_threads";

parentPort.on("message", ({ id }) => {
  parentPort.postMessage({ id, value: { stub: true, diagnostics: [] } });
});
