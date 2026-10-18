import type { BytecodeFunction } from "@/core/bytecode/BytecodeProgram";
import type { Completion } from "@/core/interpreter/Completion";
import type { EntryPoint } from "@/core/host/nodeFrames";
import { nodeFrameTail } from "@/core/host/nodeFrames";
import { installArray } from "./builtins/Array";
import { createError, type JSError } from "./builtins/errors";
import { queueMicrotaskFunction } from "./builtins/microtask";
import { installMath } from "./builtins/Math";
import { installObject } from "./builtins/Object";
import { installPromise, type PromiseIntrinsics } from "./builtins/Promise";
import { type Job, MicrotaskQueue } from "./MicrotaskQueue";
import { WorkBudget } from "./WorkBudget";
import { type ConsoleMethod, type ConsoleRealm, type ConsoleStream, consoleMethod } from "./builtins/console";
import type { FunctionKind, InspectRealm, PromiseDetails } from "./builtins/inspect";
import { Heap } from "./heap/Heap";
import { Context } from "./objects/Context";
import type { FeedbackCell } from "./objects/FeedbackCell";
import { type JSFunction as JSFunctionType, JSFunction, type NativeConstruct, type NativeFunction } from "./objects/JSFunction";
import { JSArray } from "./objects/JSArray";
import { HeapObject } from "./objects/HeapObject";
import { JSObject } from "./objects/JSObject";
import { JSPromise } from "./objects/JSPromise";
import { TransitionTree } from "./objects/TransitionTree";
import { SimulationHalt } from "@/core/shared/simulationHalt";
import type { SpecRealm } from "./spec/conversions";
import { HasProperty, OrdinaryDefineOwnProperty, OrdinaryGet } from "./spec/objectOps";
import { captureStack, type CallSite } from "./stack";
import type { JSValue } from "./values/JSValue";
import type { TheHoleValue } from "./values/TheHole";

// A realm: the intrinsics, the global object and the hooks the embedder (Node) plugs in. In
// V8 terms this is the native context plus the Isolate's embedder callbacks.

export type ErrorKind = "Error" | "TypeError" | "RangeError" | "ReferenceError" | "SyntaxError" | "AggregateError";
const ERROR_KINDS: readonly ErrorKind[] = ["Error", "TypeError", "RangeError", "ReferenceError", "SyntaxError", "AggregateError"];

/** What V8 asks of its embedder (the part of `v8::Isolate` callbacks the model needs so far). */
export interface HostHooks {
  /** `process.stdout.write` / `process.stderr.write`. */
  write(stream: ConsoleStream, text: string): void;
  /** Where the running JS was entered from: the Node-internal frames below it in a stack trace. */
  entryPoint(): EntryPoint;
  /** HostPromiseRejectionTracker: a promise was rejected with no handler ("reject"), or got one afterwards ("handle"). */
  promiseRejectionTracker?(promise: JSPromise, operation: "reject" | "handle"): void;
  /** Called for every job the microtask queue accepts (the timeline's enqueue event). */
  enqueueMicrotaskObserved?(job: Job): void;
}

/** The interpreter, as the realm sees it: it runs user functions and describes its stack. */
export interface CallTarget {
  call(fn: JSFunctionType, receiver: JSValue, args: readonly JSValue[]): Completion;
  /** The JS frames, innermost first. */
  callSites(): readonly CallSite[];
  /** Runs `body` with a builtin's frame (`Type.name (<anonymous>)`, or `new Name (<anonymous>)`) on the stack. */
  nativeFrame<T>(fn: JSFunctionType, receiver: JSValue, construct: boolean, body: () => T): T;
  /** A builtin caught an exception (a promise job turned it into a rejection): forget the isolate's pending message. */
  clearPendingMessage(): void;
}

export interface Intrinsics {
  readonly objectPrototype: JSObject;
  readonly functionPrototype: JSObject;
  readonly arrayPrototype: JSObject;
  readonly promisePrototype: JSObject;
  readonly errorPrototypes: Readonly<Record<ErrorKind, JSObject>>;
}

const HIDDEN = { writable: true, enumerable: false, configurable: true } as const;
const FUNCTION_INFO = { writable: false, enumerable: false, configurable: true } as const;
const CONSTANT = { writable: false, enumerable: false, configurable: false } as const;

export class Realm implements SpecRealm, InspectRealm, ConsoleRealm {
  readonly heap = new Heap();
  readonly maps = new TransitionTree();
  readonly host: HostHooks;
  /** Element visits inside builtins (Decision D3's `work` limit). */
  readonly work = new WorkBudget();
  readonly intrinsics: Intrinsics;
  readonly globalObject: JSObject;
  /** The context builtins close over: it holds nothing. */
  readonly emptyContext = new Context(null, 0);
  /** V8's MicrotaskQueue: promise reactions, thenable adoption and queueMicrotask callbacks. */
  readonly microtasks = new MicrotaskQueue((job) => this.host.enqueueMicrotaskObserved?.(job));
  /** The Promise constructor and the intrinsic `then`. */
  readonly promise: PromiseIntrinsics;
  readonly #wellKnown = new Map<JSObject, string>();
  readonly #tags = new Map<JSObject, string>();
  #target: CallTarget | undefined;

  constructor(host: HostHooks) {
    this.host = host;
    const objectPrototype = this.#intrinsicObject(null);
    const functionPrototype = this.heap.allocateIntrinsic(
      (id) =>
        new JSFunction(id, this.maps.rootFor("function", 0), objectPrototype, {
          native: () => ({ type: "normal", value: undefined }),
          context: this.emptyContext,
        }),
    );
    const arrayPrototype = this.heap.allocateIntrinsic((id) => JSArray.fromElements(id, this.maps, objectPrototype, []));
    const promisePrototype = this.#intrinsicObject(objectPrototype);
    const errorPrototype = this.#intrinsicObject(objectPrototype);
    const errorPrototypes = Object.fromEntries(
      ERROR_KINDS.map((kind) => [kind, kind === "Error" ? errorPrototype : this.#intrinsicObject(errorPrototype)]),
    ) as Record<ErrorKind, JSObject>;
    for (const kind of ERROR_KINDS) {
      const prototype = errorPrototypes[kind];
      this.#define(prototype, "name", kind, HIDDEN);
      this.#define(prototype, "message", "", HIDDEN);
      this.#wellKnown.set(prototype, kind);
    }
    this.#wellKnown.set(objectPrototype, "Object");
    this.#wellKnown.set(functionPrototype, "Function");
    this.#wellKnown.set(arrayPrototype, "Array");
    this.#wellKnown.set(promisePrototype, "Promise");
    this.intrinsics = { objectPrototype, functionPrototype, arrayPrototype, promisePrototype, errorPrototypes };

    this.globalObject = this.#intrinsicObject(objectPrototype);
    this.#define(this.globalObject, "undefined", undefined, CONSTANT);
    this.#define(this.globalObject, "NaN", NaN, CONSTANT);
    this.#define(this.globalObject, "Infinity", Infinity, CONSTANT);
    this.#define(this.globalObject, "console", this.#console(), HIDDEN);
    for (const kind of ERROR_KINDS) this.#define(this.globalObject, kind, this.#errorConstructor(kind), HIDDEN);

    const objectConstructor = this.#builtinConstructor("Object", objectPrototype);
    const arrayConstructor = this.#builtinConstructor("Array", arrayPrototype);
    const math = this.#intrinsicObject(objectPrototype);
    this.#tags.set(math, "Math");
    this.#define(this.globalObject, "Object", objectConstructor, HIDDEN);
    this.#define(this.globalObject, "Array", arrayConstructor, HIDDEN);
    this.#define(this.globalObject, "Math", math, HIDDEN);
    installObject(this, objectConstructor);
    installArray(this);
    installMath(this, math);
    this.promise = installPromise(this);
    this.#define(this.globalObject, "Promise", this.promise.constructor, HIDDEN);
    this.#define(this.globalObject, "queueMicrotask", queueMicrotaskFunction(this), { writable: true, enumerable: true, configurable: true });
  }

  /** Called by the interpreter that runs this realm's functions. */
  attach(target: CallTarget): void {
    this.#target = target;
  }

  // ---- objects and functions ----

  /** A builtin function object, with `length` and `name` as V8's builtins have them. */
  nativeFunction(name: string, length: number, behavior: NativeFunction, kind: FunctionKind = "normal"): JSFunctionType {
    return this.#nativeFunction(name, length, { native: behavior, kind });
  }

  /** A builtin method: writable, non-enumerable and configurable, as V8 installs builtins. */
  defineMethod(target: JSObject, name: string, length: number, behavior: NativeFunction): JSFunctionType {
    const fn = this.nativeFunction(name, length, behavior);
    this.#define(target, name, fn, HIDDEN);
    return fn;
  }

  /** A function a builtin creates while the program runs (a promise's resolving functions): a closure, so it counts toward the heap limit. */
  runtimeFunction(name: string, length: number, behavior: NativeFunction): JSFunctionType {
    return this.#nativeFunction(name, length, { native: behavior }, true);
  }

  /** `F.prototype` (constant) and `prototype.constructor` (hidden), as V8 links a builtin constructor to its prototype. */
  linkConstructor(constructor: JSFunctionType, prototype: JSObject): void {
    this.#define(constructor, "prototype", prototype, CONSTANT);
    this.#define(prototype, "constructor", constructor, HIDDEN);
  }

  /** Records `Symbol.toStringTag` for `prototype` (symbols are outside the subset, so it is a table, not a property). */
  defineToStringTag(prototype: JSObject, tag: string): void {
    this.#tags.set(prototype, tag);
  }

  /** A builtin that is also a constructor: `call` runs for `F()`, `construct` for `new F()`. */
  nativeConstructor(name: string, length: number, call: NativeFunction, construct: NativeConstruct): JSFunctionType {
    return this.#nativeFunction(name, length, { native: call, construct });
  }

  #nativeFunction(
    name: string,
    length: number,
    init: { native: NativeFunction; construct?: NativeConstruct; kind?: FunctionKind },
    counted = false,
  ): JSFunctionType {
    const make = (id: JSFunctionType["id"]): JSFunctionType =>
      new JSFunction(id, this.maps.rootFor("function", 0), this.intrinsics.functionPrototype, {
        ...init,
        context: this.emptyContext,
      });
    const fn = counted ? this.heap.allocate(make) : this.heap.allocateIntrinsic(make);
    this.#define(fn, "length", length, FUNCTION_INFO);
    this.#define(fn, "name", name, FUNCTION_INFO);
    return fn;
  }

  /** A closure over `context` (CreateClosure): a JS-visible allocation, so it counts toward the heap limit. */
  userFunction(code: BytecodeFunction, context: Context, feedbackCell: FeedbackCell): JSFunctionType {
    const fn = this.heap.allocate(
      (id) =>
        new JSFunction(id, this.maps.rootFor("function", 0), this.intrinsics.functionPrototype, {
          code,
          context,
          feedbackCell,
        }),
    );
    feedbackCell.allocateVector(code);
    this.#define(fn, "length", code.length, FUNCTION_INFO);
    this.#define(fn, "name", code.name, FUNCTION_INFO);
    return fn;
  }

  /** An ordinary object the program can see (`{}`): it counts toward the heap-object limit. */
  newObject(prototype: JSObject | null = this.intrinsics.objectPrototype): JSObject {
    return this.heap.allocate((id) => new JSObject(id, this.maps.rootFor("empty-object-literal", 4), prototype));
  }

  /** `CreateObjectLiteral`: an object whose Map is rooted at the literal's own property count (the boilerplate Map). */
  newLiteralObject(propertyCount: number): JSObject {
    return this.heap.allocate((id) => new JSObject(id, this.maps.rootFor("object-literal", propertyCount), this.intrinsics.objectPrototype));
  }

  /** `CreateArrayLiteral` / `CreateEmptyArrayLiteral`: an array whose elements kind is what `values` need. */
  newArray(values: readonly (JSValue | TheHoleValue)[] = []): JSArray {
    return this.heap.allocate((id) => JSArray.fromElements(id, this.maps, this.intrinsics.arrayPrototype, values));
  }

  /** A new pending promise (a JS-visible allocation). */
  newPromise(): JSPromise {
    return this.heap.allocate((id) => new JSPromise(id, this.maps.rootFor("promise", 0), this.intrinsics.promisePrototype));
  }

  #intrinsicObject(prototype: JSObject | null): JSObject {
    return this.heap.allocateIntrinsic((id) => new JSObject(id, this.maps.rootFor("object-literal", 0), prototype));
  }

  #define(obj: JSObject, key: string, value: JSValue, attributes: { writable: boolean; enumerable: boolean; configurable: boolean }): void {
    OrdinaryDefineOwnProperty(this, obj, key, { value, ...attributes });
  }

  /** Node's `console`: `log` to stdout, `error` and `warn` to stderr (lib/internal/console/constructor.js). */
  #console(): JSObject {
    const console = this.#intrinsicObject(this.intrinsics.objectPrototype);
    for (const method of ["log", "error", "warn"] as const satisfies readonly ConsoleMethod[]) {
      const fn = this.nativeFunction(method, 0, (realm, _receiver, args) => {
        consoleMethod(realm, method, args);
        return { type: "normal", value: undefined };
      });
      this.#define(console, method, fn, { writable: true, enumerable: true, configurable: true });
    }
    return console;
  }

  /**
   * `Object` and `Array`: reachable as `prototype.constructor` and named for stack frames and inspect.
   * Calling or constructing them is not modeled (no fixture), so it halts rather than guessing.
   */
  #builtinConstructor(name: string, prototype: JSObject): JSFunctionType {
    const unsupported = (): never => {
      throw new SimulationHalt({ kind: "unsupported", reason: `calling or constructing ${name} is not modeled` });
    };
    const constructor = this.nativeConstructor(name, 1, unsupported, unsupported);
    this.#define(constructor, "prototype", prototype, CONSTANT);
    this.#define(prototype, "constructor", constructor, HIDDEN);
    return constructor;
  }

  /**
   * The Error and NativeError constructors (ECMA-262 Error ( message [ , options ] ), NativeError,
   * AggregateError ( errors, message [ , options ] )): `F()` and `new F()` both create the error,
   * capturing the stack where it is constructed.
   */
  #errorConstructor(kind: ErrorKind): JSFunctionType {
    const aggregate = kind === "AggregateError";
    const create = (realm: Realm, args: readonly JSValue[]): Completion => {
      const message = args[aggregate ? 1 : 0];
      const options = args[aggregate ? 2 : 1];
      // ToString of an object would run user code (toString / valueOf), which is not modeled here.
      if (message instanceof HeapObject) throw new SimulationHalt({ kind: "unsupported", reason: `new ${kind} with an object message` });
      const error = realm.createError(kind, message === undefined ? undefined : String(message));
      // InstallErrorCause: an own, non-enumerable `cause` when the options object has one.
      if (options instanceof JSObject && HasProperty(options, "cause")) {
        this.#define(error, "cause", OrdinaryGet(options, "cause"), HIDDEN);
      }
      if (aggregate) {
        const errors = args[0];
        // IterableToList would run user iterators; only arrays are modeled.
        if (!(errors instanceof JSArray)) throw new SimulationHalt({ kind: "unsupported", reason: "AggregateError from a value that is not an array" });
        const list = realm.newArray(Array.from({ length: errors.length }, (_, i) => OrdinaryGet(errors, String(i))));
        this.#define(error, "errors", list, HIDDEN);
      }
      return { type: "normal", value: error };
    };
    const constructor = this.nativeConstructor(kind, aggregate ? 2 : 1, (realm, _receiver, args) => create(realm, args), create);
    const prototype = this.intrinsics.errorPrototypes[kind];
    this.#define(constructor, "prototype", prototype, CONSTANT);
    this.#define(prototype, "constructor", constructor, HIDDEN);
    return constructor;
  }

  // ---- SpecRealm ----

  call(fn: JSObject, receiver: JSValue, args: readonly JSValue[]): Completion {
    if (!(fn instanceof JSFunction)) throw new Error("Realm.call: not a function object");
    if (!this.#target) throw new Error("Realm.call: no interpreter is attached");
    return this.#target.call(fn, receiver, args);
  }

  /** See CallTarget.nativeFrame. */
  nativeFrame<T>(fn: JSFunctionType, receiver: JSValue, construct: boolean, body: () => T): T {
    return this.#target ? this.#target.nativeFrame(fn, receiver, construct, body) : body();
  }

  /** A builtin swallowed an exception: the isolate's pending message goes with it. */
  exceptionCaught(): void {
    this.#target?.clearPendingMessage();
  }

  throwTypeError(message: string): Completion<never> {
    return this.throwError("TypeError", message);
  }

  // ---- errors ----

  /** `new <kind>(message)` from inside the VM: the stack is captured here, at construction. */
  createError(kind: ErrorKind, message: string | undefined): JSError {
    return createError(this, this.intrinsics.errorPrototypes[kind], message, captureStack(this.#stackSource()));
  }

  throwError(kind: ErrorKind, message: string): Completion<never> {
    return { type: "throw", value: this.createError(kind, message) };
  }

  #stackSource() {
    return {
      userCallSites: () => this.#target?.callSites() ?? [],
      hostTail: () => nodeFrameTail(this.host.entryPoint()),
    };
  }

  // ---- InspectRealm ----

  wellKnownPrototypeName(o: JSObject): string | undefined {
    return this.#wellKnown.get(o);
  }

  toStringTag(o: JSObject): string {
    for (let p: JSObject | null = o; p !== null; p = p.prototype) {
      const tag = this.#tags.get(p);
      if (tag !== undefined) return tag;
    }
    return "";
  }

  functionKind(fn: JSObject): FunctionKind {
    return fn instanceof JSFunction ? fn.kind : "normal";
  }

  promiseDetails(o: JSObject): PromiseDetails | undefined {
    if (!(o instanceof JSPromise)) return undefined;
    return o.state === "pending" ? { state: "pending" } : { state: o.state, result: o.result };
  }
}
