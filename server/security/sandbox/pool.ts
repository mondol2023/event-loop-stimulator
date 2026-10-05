import "server-only";
import { Worker } from "node:worker_threads";

// A resource guard, not a sandbox for user code: it bounds the memory and wall-clock
// time of whatever a worker does. Nothing in this repo evaluates user code; the
// Phase 1 worker is a stub that only measures its input.

export type SandboxResult =
  | { status: "ok"; value: unknown; ms: number }
  | { status: "timeout" }
  | { status: "crashed"; reason: "out_of_memory" | "error" }
  | { status: "busy" };

export type SandboxPoolOptions = {
  workerPath: string | URL;
  size?: number;
  timeoutMs?: number;
  maxOldGenerationSizeMb?: number;
  maxQueue?: number;
};

type Job = {
  id: number;
  input: unknown;
  resolve: (result: SandboxResult) => void;
  startedAt: number;
  timer: NodeJS.Timeout | null;
};

// `worker` is null while no thread is running for this slot: before the first job,
// after a crash or timeout, or when starting one failed. A job (never a timer or an
// event handler) is what starts the next worker, so a worker that dies on startup
// costs one failed job each instead of spinning in a respawn loop.
type Slot = { worker: Worker | null; job: Job | null };

type Waiting = { input: unknown; resolve: (result: SandboxResult) => void };

const CRASHED: SandboxResult = Object.freeze({ status: "crashed", reason: "error" });

export class SandboxPool {
  readonly #workerPath: string | URL;
  readonly #timeoutMs: number;
  readonly #maxOldGenerationSizeMb: number;
  readonly #maxQueue: number;
  readonly #slots: Slot[] = [];
  readonly #waiting: Waiting[] = [];
  #nextId = 1;
  #closed = false;

  constructor(opts: SandboxPoolOptions) {
    this.#workerPath = opts.workerPath;
    this.#timeoutMs = opts.timeoutMs ?? 2000;
    this.#maxOldGenerationSizeMb = opts.maxOldGenerationSizeMb ?? 64;
    this.#maxQueue = Math.max(0, opts.maxQueue ?? 32);
    for (let i = 0; i < Math.max(1, opts.size ?? 2); i += 1) {
      const slot: Slot = { worker: null, job: null };
      this.#start(slot); // best effort: a failure here is retried when a job needs the slot
      this.#slots.push(slot);
    }
  }

  run(input: unknown): Promise<SandboxResult> {
    if (this.#closed) return Promise.resolve(CRASHED);
    return new Promise((resolve) => {
      const idle = this.#slots.find((slot) => slot.job === null);
      if (idle !== undefined) {
        this.#dispatch(idle, input, resolve);
      } else if (this.#waiting.length >= this.#maxQueue) {
        resolve({ status: "busy" });
      } else {
        this.#waiting.push({ input, resolve });
      }
    });
  }

  async close(): Promise<void> {
    this.#closed = true;
    for (const waiting of this.#waiting.splice(0)) waiting.resolve(CRASHED);
    const terminating: Promise<number>[] = [];
    for (const slot of this.#slots.splice(0)) {
      if (slot.job !== null) this.#settle(slot.job, CRASHED);
      slot.job = null;
      if (slot.worker !== null) terminating.push(slot.worker.terminate());
      slot.worker = null;
    }
    await Promise.all(terminating);
  }

  /** Starts a thread for the slot. Returns false (and leaves the slot empty) if the platform refuses. */
  #start(slot: Slot): boolean {
    let worker: Worker;
    try {
      worker = new Worker(this.#workerPath, {
        resourceLimits: {
          maxOldGenerationSizeMb: this.#maxOldGenerationSizeMb,
          maxYoungGenerationSizeMb: 16,
          stackSizeMb: 4,
        },
      });
    } catch {
      return false;
    }
    // A pool must never keep the process alive on its own.
    worker.unref();
    slot.worker = worker;

    worker.on("message", (message: { id?: unknown; value?: unknown }) => {
      const job = slot.job;
      if (slot.worker !== worker || job === null || message.id !== job.id) return;
      slot.job = null;
      this.#settle(job, { status: "ok", value: message.value, ms: Date.now() - job.startedAt });
      this.#drain(slot);
    });
    // Both `error` (incl. ERR_WORKER_OUT_OF_MEMORY) and `exit` mean this worker is gone.
    worker.on("error", (error: Error & { code?: string }) => {
      const reason = error.code === "ERR_WORKER_OUT_OF_MEMORY" ? "out_of_memory" : "error";
      this.#lost(slot, worker, { status: "crashed", reason });
    });
    worker.on("exit", () => this.#lost(slot, worker, CRASHED));
    return true;
  }

  #dispatch(slot: Slot, input: unknown, resolve: (result: SandboxResult) => void): void {
    if (slot.worker === null && !this.#start(slot)) {
      resolve(CRASHED);
      return;
    }
    const worker = slot.worker;
    if (worker === null) {
      resolve(CRASHED);
      return;
    }
    const job: Job = { id: this.#nextId, input, resolve, startedAt: Date.now(), timer: null };
    this.#nextId += 1;
    slot.job = job;
    job.timer = setTimeout(() => {
      if (slot.job !== job) return;
      slot.job = null;
      this.#settle(job, { status: "timeout" });
      this.#retire(slot, worker);
      this.#drain(slot);
    }, this.#timeoutMs);
    job.timer.unref();
    worker.postMessage({ id: job.id, input });
  }

  #settle(job: Job, result: SandboxResult): void {
    if (job.timer !== null) clearTimeout(job.timer);
    job.timer = null;
    job.resolve(result);
  }

  /** Drops `worker` from its slot and stops it. The slot starts a fresh one when a job needs it. */
  #retire(slot: Slot, worker: Worker): void {
    if (slot.worker === worker) slot.worker = null;
    void worker.terminate();
  }

  /** A worker died on its own (crash, OOM, exit): fail its job. The echo of our own terminate() is ignored. */
  #lost(slot: Slot, worker: Worker, result: SandboxResult): void {
    if (slot.worker !== worker) return;
    const job = slot.job;
    slot.job = null;
    this.#retire(slot, worker);
    if (job !== null) this.#settle(job, result);
    this.#drain(slot);
  }

  #drain(slot: Slot): void {
    if (this.#closed || slot.job !== null) return;
    const next = this.#waiting.shift();
    if (next !== undefined) this.#dispatch(slot, next.input, next.resolve);
  }
}

const GLOBAL_KEY = Symbol.for("silicon-loop.sandboxPool");
type GlobalWithPool = typeof globalThis & { [GLOBAL_KEY]?: SandboxPool };

/** The process-wide pool (survives HMR). */
export function getSandboxPool(): SandboxPool {
  const holder = globalThis as GlobalWithPool;
  holder[GLOBAL_KEY] ??= new SandboxPool({ workerPath: new URL("./compile-worker.mjs", import.meta.url) });
  return holder[GLOBAL_KEY];
}
