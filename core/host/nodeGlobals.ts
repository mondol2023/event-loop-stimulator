import type { Realm } from "@/core/runtime/Realm";
import { JSHostObject } from "@/core/runtime/objects/JSHostObject";
import { OrdinaryDefineOwnProperty } from "@/core/runtime/spec/objectOps";
import type { JSValue } from "@/core/runtime/values/JSValue";
import { type NextTickQueue, nextTickFunction } from "./nextTick";
import { queueMicrotaskFunction } from "./queueMicrotask";
import type { NodeTimers } from "./timers";

// Node's globals. V8 provides the language (core/runtime); everything here is the embedder's:
// `process.nextTick`, the timers, `setImmediate` and `queueMicrotask` (lib/internal/bootstrap/node.js
// and lib/internal/bootstrap/web/exposed-window-or-worker.js). The streams `console` writes to are
// the loop's HostHooks.write.

/** defineOperation: a writable, enumerable, configurable global function. */
const OPERATION = { writable: true, enumerable: true, configurable: true } as const;

export function installNodeGlobals(realm: Realm, timers: NodeTimers, ticks: NextTickQueue): void {
  const global = realm.globalObject;
  const define = (name: string, value: JSValue): void => {
    OrdinaryDefineOwnProperty(realm, global, name, { value, ...OPERATION });
  };

  // `process` is reachable only as `process.nextTick` in the subset (it cannot be aliased or printed).
  const process = realm.heap.allocateIntrinsic(
    (id) => new JSHostObject(id, realm.maps.rootFor("object-literal", 0), realm.intrinsics.objectPrototype, "process"),
  );
  OrdinaryDefineOwnProperty(realm, process, "nextTick", { value: nextTickFunction(realm, ticks), ...OPERATION });
  define("process", process);

  define("setTimeout", realm.nativeFunction("setTimeout", 2, (_r, _receiver, [callback, after, ...args]) => timers.schedule(callback, after, args, false)));
  define("clearTimeout", realm.nativeFunction("clearTimeout", 1, (_r, _receiver, [timer]) => timers.clear(timer)));
  define("setInterval", realm.nativeFunction("setInterval", 2, (_r, _receiver, [callback, repeat, ...args]) => timers.schedule(callback, repeat, args, true)));
  // clearInterval(timer) is clearTimeout(timer): the two share the lists.
  define("clearInterval", realm.nativeFunction("clearInterval", 1, (_r, _receiver, [timer]) => timers.clear(timer)));
  define("setImmediate", realm.nativeFunction("setImmediate", 1, (_r, _receiver, [callback, ...args]) => timers.scheduleImmediate(callback, args)));
  define("clearImmediate", realm.nativeFunction("clearImmediate", 1, (_r, _receiver, [immediate]) => timers.clearImmediate(immediate)));
  define("queueMicrotask", queueMicrotaskFunction(realm));
}
