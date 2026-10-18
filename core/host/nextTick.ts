import { normal } from "@/core/interpreter/Completion";
import type { Realm } from "@/core/runtime/Realm";
import { JSFunction } from "@/core/runtime/objects/JSFunction";
import type { JSValue } from "@/core/runtime/values/JSValue";
import { SimulationHalt } from "@/core/shared/simulationHalt";

// process.nextTick's queue (lib/internal/process/task_queues.js): a FIFO of tick objects that
// processTicksAndRejections drains before each run of the microtask queue.

export type TickObject =
  /** A user callback from `process.nextTick(callback, ...args)`. */
  | { readonly kind: "callback"; readonly callback: JSFunction; readonly args: readonly JSValue[] }
  /** A tick Node schedules for itself (a stream's afterWrite, process.emitWarning); it runs no user code. */
  | { readonly kind: "internal"; readonly label: string; run(): void };

export class NextTickQueue {
  readonly #ticks: TickObject[] = [];
  #head = 0;
  /**
   * tickInfo[kHasTickScheduled]: set when a tick is pushed onto an empty queue, cleared only when
   * processTicksAndRejections finishes. It decides whether a drain goes through processTicksAndRejections.
   */
  hasTickScheduled = false;

  isEmpty(): boolean {
    return this.#head === this.#ticks.length;
  }

  push(tick: TickObject): void {
    if (this.isEmpty()) this.hasTickScheduled = true;
    this.#ticks.push(tick);
  }

  shift(): TickObject | undefined {
    const tick = this.#ticks[this.#head];
    if (!tick) return undefined;
    this.#head += 1;
    if (this.isEmpty()) {
      this.#ticks.length = 0;
      this.#head = 0;
    }
    return tick;
  }
}

/** `process.nextTick(callback, ...args)`. */
export function nextTickFunction(realm: Realm, queue: NextTickQueue): JSFunction {
  return realm.nativeFunction("nextTick", 1, (_r, _receiver, args) => {
    const [callback, ...rest] = args;
    // validateFunction throws ERR_INVALID_ARG_TYPE (an Error with an own enumerable `code`), which no fixture records.
    if (!(callback instanceof JSFunction)) {
      throw new SimulationHalt({ kind: "unsupported", reason: "process.nextTick with a callback that is not a function (ERR_INVALID_ARG_TYPE is not modeled)" });
    }
    queue.push({ kind: "callback", callback, args: rest });
    return normal(undefined);
  });
}
