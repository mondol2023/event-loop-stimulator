import { SimulationHalt } from "@/core/shared/simulationHalt";
import { normal } from "@/core/interpreter/Completion";
import { displayName } from "@/core/runtime/objects/functionName";
import { JSFunction } from "@/core/runtime/objects/JSFunction";
import type { Realm } from "@/core/runtime/Realm";

// `queueMicrotask(callback)` (lib/internal/process/task_queues.js): the callback becomes a job in
// the same FIFO queue as promise reactions. A throw is an uncaught exception (the loop reports it).

/** The global `queueMicrotask`. */
export function queueMicrotaskFunction(realm: Realm): JSFunction {
  return realm.nativeFunction("queueMicrotask", 1, (r, _receiver, args) => {
    const callback = args[0];
    // validateFunction throws a Node ERR_INVALID_ARG_TYPE error (own enumerable `code`), which no fixture records.
    if (!(callback instanceof JSFunction)) {
      throw new SimulationHalt({ kind: "unsupported", reason: "queueMicrotask with a callback that is not a function (ERR_INVALID_ARG_TYPE is not modeled)" });
    }
    r.microtasks.enqueue({ kind: "CallbackJob", label: `queueMicrotask(${displayName(callback)})`, origin: "queueMicrotask", roots: [callback], run: () => r.call(callback, undefined, []) });
    return normal(undefined);
  });
}
