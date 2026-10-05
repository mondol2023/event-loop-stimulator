// Repo-owned fixture: a worker that allocates until its heap limit is hit.
import { parentPort } from "node:worker_threads";

const keep = [];
parentPort.on("message", () => {
  while (true) keep.push(new Array(100_000).fill(1));
});
