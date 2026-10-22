import type { JSFunction } from "./JSFunction";
import { JSObject } from "./JSObject";
import type { JSValue } from "../values/JSValue";

// V8's JSPromise (src/objects/js-promise.h): the [[PromiseState]], [[PromiseResult]],
// [[PromiseFulfillReactions]], [[PromiseRejectReactions]] and [[PromiseIsHandled]] slots.

export type PromiseState = "pending" | "fulfilled" | "rejected";

/**
 * A PromiseCapability Record. The resolving functions are absent for the capability `then` makes
 * for its result promise (V8's fast path never creates them); the combinators and
 * `Promise.reject` hand real functions to user code.
 */
export interface PromiseCapability {
  /** A JSPromise for %Promise%; whatever the constructor returned for a user constructor. */
  readonly promise: JSObject;
  readonly resolve: JSFunction | undefined;
  readonly reject: JSFunction | undefined;
}

/**
 * A PromiseReaction Record. A reaction with no capability belongs to an `await`, whose handlers
 * never throw into a promise.
 */
export interface PromiseReaction {
  readonly capability: PromiseCapability | undefined;
  readonly type: "fulfill" | "reject";
  readonly handler: JSFunction | undefined;
}

export class JSPromise extends JSObject {
  state: PromiseState = "pending";
  result: JSValue = undefined;
  fulfillReactions: PromiseReaction[] = [];
  rejectReactions: PromiseReaction[] = [];
  isHandled = false;
}
