import type { BytecodeFunction } from "@/core/bytecode/BytecodeProgram";
import type { Completion } from "@/core/interpreter/Completion";
import type { EntryPoint } from "@/core/host/nodeFrames";
import { nodeFrameTail } from "@/core/host/nodeFrames";
import { createError, type JSError } from "./builtins/errors";
import { type ConsoleMethod, type ConsoleRealm, type ConsoleStream, consoleMethod } from "./builtins/console";
import type { FunctionKind, InspectRealm, PromiseDetails } from "./builtins/inspect";
import { Heap } from "./heap/Heap";
import { Context } from "./objects/Context";
import type { FeedbackCell } from "./objects/FeedbackCell";
import { type JSFunction as JSFunctionType, JSFunction, type NativeConstruct, type NativeFunction } from "./objects/JSFunction";
import { JSArray } from "./objects/JSArray";
import { JSObject } from "./objects/JSObject";
import { TransitionTree } from "./objects/TransitionTree";
import type { SpecRealm } from "./spec/conversions";
import { OrdinaryDefineOwnProperty } from "./spec/objectOps";
import { captureStack, type CallSite } from "./stack";
import type { JSValue } from "./values/JSValue";

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
}

/** The interpreter, as the realm sees it: it runs user functions and describes its stack. */
export interface CallTarget {
  call(fn: JSFunctionType, receiver: JSValue, args: readonly JSValue[]): Completion;
  /** The JS frames, innermost first. */
  callSites(): readonly CallSite[];
}

export interface Intrinsics {
  readonly objectPrototype: JSObject;
  readonly functionPrototype: JSObject;
  readonly arrayPrototype: JSObject;
  readonly errorPrototypes: Readonly<Record<ErrorKind, JSObject>>;
}

const HIDDEN = { writable: true, enumerable: false, configurable: true } as const;
const FUNCTION_INFO = { writable: false, enumerable: false, configurable: true } as const;
const CONSTANT = { writable: false, enumerable: false, configurable: false } as const;

export class Realm implements SpecRealm, InspectRealm, ConsoleRealm {
  readonly heap = new Heap();
  readonly maps = new TransitionTree();
  readonly host: HostHooks;
  readonly intrinsics: Intrinsics;
  readonly globalObject: JSObject;
  /** The context builtins close over: it holds nothing. */
  readonly emptyContext = new Context(null, 0);
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
    this.intrinsics = { objectPrototype, functionPrototype, arrayPrototype, errorPrototypes };

    this.globalObject = this.#intrinsicObject(objectPrototype);
    this.#define(this.globalObject, "undefined", undefined, CONSTANT);
    this.#define(this.globalObject, "NaN", NaN, CONSTANT);
    this.#define(this.globalObject, "Infinity", Infinity, CONSTANT);
    this.#define(this.globalObject, "console", this.#console(), HIDDEN);
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

  /** A builtin that is also a constructor: `call` runs for `F()`, `construct` for `new F()`. */
  nativeConstructor(name: string, length: number, call: NativeFunction, construct: NativeConstruct): JSFunctionType {
    return this.#nativeFunction(name, length, { native: call, construct });
  }

  #nativeFunction(name: string, length: number, init: { native: NativeFunction; construct?: NativeConstruct; kind?: FunctionKind }): JSFunctionType {
    const fn = this.heap.allocateIntrinsic(
      (id) =>
        new JSFunction(id, this.maps.rootFor("function", 0), this.intrinsics.functionPrototype, {
          ...init,
          context: this.emptyContext,
        }),
    );
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
    this.#define(fn, "length", code.length, FUNCTION_INFO);
    this.#define(fn, "name", code.name, FUNCTION_INFO);
    return fn;
  }

  /** An ordinary object the program can see (`{}`): it counts toward the heap-object limit. */
  newObject(prototype: JSObject | null = this.intrinsics.objectPrototype): JSObject {
    return this.heap.allocate((id) => new JSObject(id, this.maps.rootFor("empty-object-literal", 4), prototype));
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

  // ---- SpecRealm ----

  call(fn: JSObject, receiver: JSValue, args: readonly JSValue[]): Completion {
    if (!(fn instanceof JSFunction)) throw new Error("Realm.call: not a function object");
    if (!this.#target) throw new Error("Realm.call: no interpreter is attached");
    return this.#target.call(fn, receiver, args);
  }

  throwTypeError(message: string): Completion<never> {
    return this.throwError("TypeError", message);
  }

  // ---- errors ----

  /** `new <kind>(message)` from inside the VM: the stack is captured here, at construction. */
  createError(kind: ErrorKind, message: string): JSError {
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

  /** Promises arrive with Task 15. */
  promiseDetails(): PromiseDetails | undefined {
    return undefined;
  }
}
