import type { Language } from "@/core/compile/CompilationManager";
import { parseResponse, type PipelineRequest, type PipelineResponse } from "./protocol";

// The main-thread end of the pipeline worker: debounces edits, numbers jobs, drops responses for
// superseded jobs, and replaces a worker that is busy or has crashed (D3: a run cannot be
// cancelled in place, so it is terminated).

export type WorkerLike = {
  postMessage(m: PipelineRequest): void;
  terminate(): void;
  onmessage: ((e: { data: unknown }) => void) | null;
  onerror: ((e: unknown) => void) | null;
  onmessageerror: ((e: unknown) => void) | null;
};

export type PipelineEvent =
  | { kind: "started"; jobId: number }
  | { kind: "response"; response: PipelineResponse }
  | { kind: "failed"; jobId: number; message: string };

export type PipelineClient = {
  request(source: string, lang: Language): void;
  flush(): void;
  dispose(): void;
};

type Deps = {
  createWorker: () => WorkerLike;
  onEvent: (e: PipelineEvent) => void;
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (h: unknown) => void;
  debounceMs?: number;
};

const DEFAULT_DEBOUNCE_MS = 400;

export function createPipelineClient(deps: Deps): PipelineClient {
  const debounceMs = deps.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  let worker: WorkerLike | null = null;
  let timer: unknown = null;
  let pending: { source: string; lang: Language } | null = null;
  let latestJobId = 0;
  // True from dispatch until the job's last response, so a busy worker is replaced, not queued behind.
  let inFlight = false;
  let disposed = false;

  function dropWorker(): void {
    if (!worker) return;
    // Detach first so a terminated worker's late events cannot reach us.
    worker.onmessage = null;
    worker.onerror = null;
    worker.onmessageerror = null;
    worker.terminate();
    worker = null;
    inFlight = false;
  }

  function fail(message: string): void {
    const jobId = latestJobId;
    const wasInFlight = inFlight;
    dropWorker();
    // An idle worker's late error must not flip the finished job's good result to failed.
    if (!wasInFlight) return;
    deps.onEvent({ kind: "failed", jobId, message });
  }

  function onData(data: unknown): void {
    const response = parseResponse(data);
    if (!response) {
      fail("The pipeline worker sent an unreadable message.");
      return;
    }
    if (response.jobId !== latestJobId) return;
    // `compiled` with diagnostics is final: no `simulated` follows it.
    if (response.type === "simulated" || response.type === "failed" || (response.type === "compiled" && response.diagnostics.length > 0)) {
      inFlight = false;
    }
    deps.onEvent({ kind: "response", response });
  }

  function createWorker(): WorkerLike {
    const created = deps.createWorker();
    created.onmessage = (e) => onData(e.data);
    created.onerror = () => fail("The pipeline worker crashed.");
    created.onmessageerror = () => fail("The pipeline worker sent a message that could not be read.");
    return created;
  }

  function dispatch(): void {
    if (disposed || !pending) return;
    const { source, lang } = pending;
    pending = null;
    if (timer !== null) {
      deps.clearTimer(timer);
      timer = null;
    }
    if (inFlight) dropWorker();
    latestJobId += 1;
    inFlight = true;
    deps.onEvent({ kind: "started", jobId: latestJobId });
    try {
      worker ??= createWorker();
      worker.postMessage({ type: "run", jobId: latestJobId, source, lang });
    } catch (error) {
      // A throwing factory or post must still end the job, or status would stay "simulating" forever.
      fail(error instanceof Error ? error.message : "The pipeline worker could not be started.");
    }
  }

  return {
    request(source, lang) {
      if (disposed) return;
      pending = { source, lang };
      if (timer !== null) deps.clearTimer(timer);
      timer = deps.setTimer(() => {
        timer = null;
        dispatch();
      }, debounceMs);
    },
    flush: dispatch,
    dispose() {
      disposed = true;
      pending = null;
      if (timer !== null) {
        deps.clearTimer(timer);
        timer = null;
      }
      dropWorker();
    },
  };
}
