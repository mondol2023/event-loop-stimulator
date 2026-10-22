import type { BytecodeFunction } from "@/core/bytecode/BytecodeProgram";
import type { Completion } from "@/core/interpreter/Completion";
import type { ObjectId } from "@/core/shared/ids";
import type { FunctionKind } from "../builtins/inspect";
import type { Realm } from "../Realm";
import type { JSValue } from "../values/JSValue";
import type { Context } from "./Context";
import { FeedbackCell } from "./FeedbackCell";
import { JSObject, type NamedEntry } from "./JSObject";
import type { V8Map } from "./V8Map";

/** A builtin: runs on the host, called with the receiver and the arguments of the call. */
export type NativeFunction = (realm: Realm, receiver: JSValue, args: readonly JSValue[]) => Completion;

/** A builtin's [[Construct]]: `new F(...args)`. */
export type NativeConstruct = (realm: Realm, args: readonly JSValue[]) => Completion;

export interface JSFunctionInit {
  /** The bytecode of a user function; absent for a builtin. */
  readonly code?: BytecodeFunction | undefined;
  readonly native?: NativeFunction | undefined;
  readonly construct?: NativeConstruct | undefined;
  readonly context: Context;
  readonly kind?: FunctionKind;
  /** Shared by the closures of one creation site; a fresh cell when absent. */
  readonly feedbackCell?: FeedbackCell;
  /** A builtin V8 leaves out of stack traces (an await's resume closures); visible when absent. */
  readonly hiddenFromStackTrace?: boolean;
  /** What a builtin closure keeps alive (its captured variables); the modeled GC follows them. */
  readonly captures?: readonly unknown[];
  /** [[BoundTargetFunction]] of a bound function. */
  readonly boundTarget?: JSFunction | undefined;
}

/** V8's JSFunction: a closure over a Context (user code) or a builtin. `name` and `length` are ordinary properties. */
export class JSFunction extends JSObject {
  readonly code: BytecodeFunction | undefined;
  readonly native: NativeFunction | undefined;
  /** A builtin constructor's [[Construct]]; a user function is constructed by the interpreter (see `isConstructor`). */
  readonly construct: NativeConstruct | undefined;
  readonly context: Context;
  readonly kind: FunctionKind;
  readonly feedbackCell: FeedbackCell;
  readonly hiddenFromStackTrace: boolean;
  readonly captures: readonly unknown[];
  readonly boundTarget: JSFunction | undefined;
  /**
   * V8 allocates a function's `prototype` object on first use. The property exists from the start,
   * holding `undefined`; the first read of it runs this, which stores the real object.
   */
  materializePrototype: ((fn: JSFunction) => void) | undefined;
  /** The Map of the objects `new F` makes (`JSFunction::initial_map`), made on the first construct. */
  initialMap: V8Map | undefined;

  constructor(id: ObjectId, map: V8Map, prototype: JSObject | null, init: JSFunctionInit) {
    super(id, map, prototype);
    this.code = init.code;
    this.native = init.native;
    this.construct = init.construct;
    this.context = init.context;
    this.kind = init.kind ?? "normal";
    this.feedbackCell = init.feedbackCell ?? new FeedbackCell();
    this.hiddenFromStackTrace = init.hiddenFromStackTrace ?? false;
    this.captures = init.captures ?? [];
    this.boundTarget = init.boundTarget;
  }

  override get isCallable(): boolean {
    return true;
  }

  /** IsConstructor: a builtin constructor, or a user function that is neither an arrow, a method nor async. */
  get isConstructor(): boolean {
    return this.construct !== undefined || (this.code?.constructable ?? false);
  }

  override getOwnNamed(key: string): NamedEntry | undefined {
    if (key === "prototype" && this.materializePrototype) {
      const materialize = this.materializePrototype;
      this.materializePrototype = undefined;
      materialize(this);
    }
    return super.getOwnNamed(key);
  }
}
