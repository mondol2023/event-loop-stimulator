import type { PipelineRequest, PipelineResponse } from "../worker/protocol";
import type { WorkerLike } from "../worker/PipelineClient";

// A scriptable stand-in for the browser Worker, so client tests never need real threads.

export class FakeWorker implements WorkerLike {
  readonly posted: PipelineRequest[] = [];
  terminated = false;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  onmessageerror: ((e: unknown) => void) | null = null;
  private handler: ((request: PipelineRequest, post: (response: PipelineResponse) => void) => void) | null = null;

  postMessage(message: PipelineRequest): void {
    this.posted.push(message);
    const handler = this.handler;
    if (!handler) return;
    // Asynchronous like a real worker, so callers cannot rely on a synchronous reply.
    queueMicrotask(() => {
      if (this.terminated) return;
      handler(message, (response) => this.emit(response));
    });
  }

  terminate(): void {
    this.terminated = true;
  }

  /** Delivers `data` as if the worker had posted it. */
  emit(data: unknown): void {
    this.onmessage?.({ data });
  }

  crash(): void {
    this.onerror?.(new Error("worker crashed"));
  }

  /** Runs the real pipeline handler for every request this worker receives. */
  respondWith(handler: (request: PipelineRequest, post: (response: PipelineResponse) => void) => void): void {
    this.handler = handler;
  }
}

export function createFakeWorker(): { factory: () => WorkerLike; instances: FakeWorker[] } {
  const instances: FakeWorker[] = [];
  return {
    factory: () => {
      const worker = new FakeWorker();
      instances.push(worker);
      return worker;
    },
    instances,
  };
}
