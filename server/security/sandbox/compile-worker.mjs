// STUB worker for Phase 1. It never evaluates `input`: it only measures it.
// The real interpreter (Phases 2-3) replaces this file. Protocol: the parent posts
// `{ id, input }`, this replies `{ id, value }`.
import { parentPort } from "node:worker_threads";

if (parentPort === null) throw new Error("compile-worker must run inside a worker thread");

parentPort.on("message", (message) => {
  const { id, input } = message;
  const code = typeof input?.code === "string" ? input.code : "";
  parentPort.postMessage({ id, value: { stub: true, bytes: Buffer.byteLength(code, "utf8"), lang: input?.lang ?? null } });
});
