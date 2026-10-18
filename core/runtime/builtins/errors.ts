import { SimulationHalt } from "@/core/shared/simulationHalt";
import type { Heap } from "../heap/Heap";
import { HeapObject } from "../objects/HeapObject";
import { JSObject, type NamedEntry } from "../objects/JSObject";
import type { TransitionTree } from "../objects/TransitionTree";
import type { PropertyAttributes } from "../objects/V8Map";
import { OrdinaryDefineOwnProperty, OrdinaryGet } from "../spec/objectOps";
import type { JSValue } from "../values/JSValue";
import { type CallSite, formatCallSite } from "../stack";

// Error objects (ECMA-262 Error constructor and Error.prototype.toString) and V8's stack
// property (src/execution/messages.cc ErrorUtils). The constructors themselves are installed on
// the realm with the other builtins.

/**
 * An object with an [[ErrorData]] slot: V8's JSError, carrying the stack captured at construction.
 *
 * V8 keeps the captured call sites and formats `stack` the first time it is read
 * (ErrorUtils::GetFormattedStack), so the header shows the name and message as they are then, and
 * a method name is looked up on the receiver then (an immediate's `_onImmediate` is gone once its
 * callback has returned). The `stack` own property exists from construction; its text is written
 * on first access, and an assignment before that replaces it for good.
 */
export class JSError extends JSObject {
  readonly callSites: readonly CallSite[];
  #stackPending = false;

  constructor(id: JSObject["id"], map: JSObject["map"], prototype: JSObject | null, callSites: readonly CallSite[]) {
    super(id, map, prototype);
    this.callSites = callSites;
  }

  /** Called once the `stack` slot exists: its text is formatted at the first read. */
  deferStack(): void {
    this.#stackPending = true;
  }

  override getOwnNamed(key: string): NamedEntry | undefined {
    if (key === "stack" && this.#stackPending) this.#formatStack();
    return super.getOwnNamed(key);
  }

  override putNamed(maps: TransitionTree, key: string, value: JSValue, attributes: PropertyAttributes): void {
    if (key === "stack") this.#stackPending = false;
    super.putNamed(maps, key, value, attributes);
  }

  override removeNamed(maps: TransitionTree, key: string): void {
    if (key === "stack") this.#stackPending = false;
    super.removeNamed(maps, key);
  }

  /** Writes the formatted text into the slot in place: it replaces a string, so the field representation stays. */
  #formatStack(): void {
    this.#stackPending = false;
    const text = formatStackTrace(this);
    if (this.map.isDictionary) {
      const entry = this.properties.dictionary?.get("stack");
      if (entry) this.properties.dictionary?.set("stack", { ...entry, value: text });
      return;
    }
    const index = this.map.indexOf("stack");
    if (index >= 0) this.properties.fast[index] = text;
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
  // `stack` is an own, non-enumerable data property from the start; JSError formats its text at
  // first access (the empty string holds the slot until then).
  OrdinaryDefineOwnProperty(world, error, "stack", {
    value: "",
    writable: true,
    enumerable: false,
    configurable: true,
  });
  error.deferStack();
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
function formatStackTrace(error: JSError): string {
  return [errorToString(error), ...error.callSites.map((cs) => `    at ${formatCallSite(cs)}`)].join("\n");
}

/** The error's `stack` as Node's printers read it: the own property (formatted on first access), else the formatted trace. */
export function errorStack(error: JSError): string {
  const own = error.getOwnNamed("stack")?.value;
  return typeof own === "string" ? own : formatStackTrace(error);
}
