import type { JSPromise } from "@/core/runtime/objects/JSPromise";
import type { JSValue } from "@/core/runtime/values/JSValue";

// Unhandled-rejection tracking (lib/internal/process/promises.js) in the default
// `--unhandled-rejections=throw` mode. V8's HostPromiseRejectionTracker reports each promise
// rejected with no handler and each handler attached afterwards; processPromiseRejections, run
// after the tick and microtask queues drain, makes the first one still unhandled fatal.

export interface UnhandledRejection {
  readonly promise: JSPromise;
  readonly reason: JSValue;
}

export class PromiseRejections {
  /** pendingUnhandledRejections: insertion-ordered, so the check sees rejections in the order they happened. */
  #pending = new Map<JSPromise, JSValue>();
  /** hasRejectionToWarn(): set by a new unhandled rejection, cleared when processTicksAndRejections finishes. */
  hasRejectionToWarn = false;

  /** promiseRejectHandler: kPromiseRejectWithNoHandler and kPromiseHandlerAddedAfterReject. */
  track(promise: JSPromise, operation: "reject" | "handle"): void {
    if (operation === "reject") {
      this.#pending.set(promise, promise.result);
      this.hasRejectionToWarn = true;
      return;
    }
    // A promise already reported ("warned") would queue a PromiseRejectionHandledWarning, but in
    // `throw` mode the first report ends the process, so a handled promise is always still pending here.
    this.#pending.delete(promise);
  }

  /**
   * processPromiseRejections: takes every pending rejection; in `throw` mode the first one is
   * thrown as an uncaught exception, so it is the only one that matters.
   */
  /** The promises and reasons that wait for the next check (the modeled GC's roots). */
  roots(): unknown[] {
    return [...this.#pending].flat();
  }

  takeFirstUnhandled(): UnhandledRejection | undefined {
    const first = this.#pending.entries().next();
    this.#pending = new Map();
    return first.done ? undefined : { promise: first.value[0], reason: first.value[1] };
  }
}
