// Repo-owned fixture: a worker that never answers (busy loop). Never given user code.
import { parentPort } from "node:worker_threads";

parentPort.on("message", () => {
  while (true) {
    // spin until the pool terminates this worker
  }
});
