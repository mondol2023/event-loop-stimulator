import type { ObjectId } from "@/core/shared/ids";
import type { JSValue, RegisterValue } from "../values/JSValue";
import type { Context } from "./Context";
import type { JSFunction } from "./JSFunction";
import { JSObject } from "./JSObject";
import type { JSPromise } from "./JSPromise";
import type { V8Map } from "./V8Map";

// V8's JSGeneratorObject (src/objects/js-generator.h): what a suspended function keeps while it is
// off the stack. SuspendGenerator exports the parameters and the live registers into it, and
// ResumeGenerator imports them back; `continuation` names the suspend point to jump to.

/** JSGeneratorObject::ResumeMode. */
export const ResumeMode = { kNext: 0, kReturn: 1, kThrow: 2 } as const;
export type ResumeMode = (typeof ResumeMode)[keyof typeof ResumeMode];

/** JSGeneratorObject::kGeneratorExecuting: the function is running, so there is nothing to resume. */
export const kGeneratorExecuting = -2;
/** JSGeneratorObject::kGeneratorClosed. */
export const kGeneratorClosed = -1;

export class JSGeneratorObject extends JSObject {
  readonly function: JSFunction;
  /** The `this` the function was called with, after OrdinaryCallBindThis. */
  readonly receiver: JSValue;
  context: Context;
  /** The suspend id to resume at, or kGeneratorExecuting / kGeneratorClosed. */
  continuation: number = kGeneratorExecuting;
  /** The value the function is resumed with (ResumeGenerator puts it in the accumulator). */
  inputOrDebugPos: JSValue = undefined;
  resumeMode: ResumeMode = ResumeMode.kNext;
  /** The formal parameters, then the registers SuspendGenerator saved (parameters_and_registers). */
  parameters: JSValue[] = [];
  registers: RegisterValue[] = [];

  constructor(id: ObjectId, map: V8Map, prototype: JSObject | null, fn: JSFunction, receiver: JSValue, context: Context) {
    super(id, map, prototype);
    this.function = fn;
    this.receiver = receiver;
    this.context = context;
  }
}

/** V8's JSAsyncFunctionObject: the generator of an async function, with the promise the call returned. */
export class JSAsyncFunctionObject extends JSGeneratorObject {
  readonly promise: JSPromise;

  constructor(id: ObjectId, map: V8Map, prototype: JSObject | null, fn: JSFunction, receiver: JSValue, context: Context, promise: JSPromise) {
    super(id, map, prototype, fn, receiver, context);
    this.promise = promise;
  }
}
