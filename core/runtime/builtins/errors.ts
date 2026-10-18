import { SimulationHalt } from "@/core/shared/simulationHalt";
import type { Heap } from "../heap/Heap";
import { HeapObject } from "../objects/HeapObject";
import { JSObject } from "../objects/JSObject";
import type { TransitionTree } from "../objects/TransitionTree";
import { OrdinaryDefineOwnProperty, OrdinaryGet } from "../spec/objectOps";
import type { JSValue } from "../values/JSValue";
import { type CallSite, formatCallSite } from "../stack";

// Error objects (ECMA-262 Error constructor and Error.prototype.toString) and V8's stack
// property (src/execution/messages.cc ErrorUtils). The constructors themselves are installed on
// the realm with the other builtins.

/** An object with an [[ErrorData]] slot: V8's JSError, carrying the stack captured at construction. */
export class JSError extends JSObject {
  readonly callSites: readonly CallSite[];
  /** The formatted `stack`, fixed at first access (V8 formats it lazily, then caches it). */
  formattedStack: string | undefined;

  constructor(id: JSObject["id"], map: JSObject["map"], prototype: JSObject | null, callSites: readonly CallSite[]) {
    super(id, map, prototype);
    this.callSites = callSites;
  }
}

export interface ErrorWorld {
  readonly heap: Heap;
  readonly maps: TransitionTree;
}

/**
 * The Error constructor's own steps after OrdinaryCreateFromConstructor: if the message is not
 * undefined, CreateNonEnumerableDataPropertyOrThrow(O, "message", ToString(message)). The caller
 * has already converted the message and captured the stack.
 */
export function createError(
  world: ErrorWorld,
  prototype: JSObject,
  message: string | undefined,
  callSites: readonly CallSite[],
): JSError {
  const error = world.heap.allocate(
    (id) => new JSError(id, world.maps.rootFor("error", 0), prototype, callSites),
  );
  if (message !== undefined) {
    OrdinaryDefineOwnProperty(world, error, "message", {
      value: message,
      writable: true,
      enumerable: false,
      configurable: true,
    });
  }
  // V8 formats the header when the Error is constructed (a later `e.message = …` does not change
  // it) and keeps `stack` as an own, non-enumerable data property.
  OrdinaryDefineOwnProperty(world, error, "stack", {
    value: errorStack(error),
    writable: true,
    enumerable: false,
    configurable: true,
  });
  return error;
}

/** ToString on a primitive (bit-exact on the host); an object would run user code, which is not modeled here. */
function primitiveToString(v: JSValue, what: string): string {
  if (v instanceof HeapObject) {
    throw new SimulationHalt({ kind: "unsupported", reason: `an Error ${what} that is an object` });
  }
  return String(v);
}

/** `ErrorUtils::ToString` (Error.prototype.toString) for a name and message that are primitives. */
export function errorToString(error: JSObject): string {
  const rawName = OrdinaryGet(error, "name");
  const rawMessage = OrdinaryGet(error, "message");
  const name = rawName === undefined ? "Error" : primitiveToString(rawName, "name");
  const message = rawMessage === undefined ? "" : primitiveToString(rawMessage, "message");
  if (name === "") return message;
  if (message === "") return name;
  return `${name}: ${message}`;
}

/** `ErrorUtils::FormatStackTrace` with no `Error.prepareStackTrace`: the header, then one line per frame. */
export function errorStack(error: JSError): string {
  error.formattedStack ??= [errorToString(error), ...error.callSites.map((cs) => `    at ${formatCallSite(cs)}`)].join(
    "\n",
  );
  return error.formattedStack;
}
