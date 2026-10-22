import { type Completion, isThrow, normal, thrown } from "@/core/interpreter/Completion";
import { typeNameOf } from "@/core/interpreter/callSites";
import { SimulationHalt } from "@/core/shared/simulationHalt";
import { formatMessage } from "../messages";
import { JSArray } from "../objects/JSArray";
import { displayName } from "../objects/functionName";
import { JSFunction } from "../objects/JSFunction";
import { JSObject } from "../objects/JSObject";
import { JSPromise, type PromiseCapability, type PromiseReaction } from "../objects/JSPromise";
import type { JobSpec } from "../MicrotaskQueue";
import type { Realm } from "../Realm";
import { OrdinaryDefineOwnProperty, OrdinaryGet } from "../spec/objectOps";
import type { JSValue } from "../values/JSValue";
import { JSError } from "./errors";

// Promise (ECMA-262 Promise Objects) as V8 runs it (src/builtins/promise-*.tq): the abstract
// operations by their spec names, the constructor, the statics and `then`/`catch`/`finally`.
// Only the intrinsic %Promise% is a constructor here: a user function cannot be `new`ed, and
// symbols (@@species) are outside the subset, so a promise whose `constructor` is anything else
// is an unsupported stop (Decision D3) rather than a guess.

/** What the realm keeps of Promise: the constructor and the intrinsic `then` (the thenable job's fast path compares to it). */
export interface PromiseIntrinsics {
  readonly constructor: JSFunction;
  readonly then: JSFunction;
}

const ELEMENT = { writable: true, enumerable: true, configurable: true } as const;
const HIDDEN = { writable: true, enumerable: false, configurable: true } as const;

function unsupported(reason: string): never {
  throw new SimulationHalt({ kind: "unsupported", reason });
}

function assertNever(value: never): never {
  throw new Error(`unhandled promise state ${String(value)}`);
}

/** `Object::NoSideEffectsToString` for the values the messages here print (a plain object is `#<Name>`). */
function describeValue(v: JSValue): string {
  if (v === undefined || v === null || typeof v === "string" || typeof v === "number" || typeof v === "boolean") return String(v);
  if (v instanceof JSObject && !(v instanceof JSFunction) && !(v instanceof JSArray) && !(v instanceof JSError)) return `#<${typeNameOf(v)}>`;
  return unsupported("a TypeError message that prints a function, array or error");
}

// ---- capabilities ----

/** `NewPromiseCapability(%Promise%)` as `then` makes it: a promise with no resolving functions. */
function newInternalCapability(realm: Realm): PromiseCapability {
  return { promise: realm.newPromise(), resolve: undefined, reject: undefined };
}

/** `NewPromiseCapability(%Promise%)` as the combinators make it: real resolving functions user code can see. */
function newCapabilityWithFunctions(realm: Realm): PromiseCapability {
  const promise = realm.newPromise();
  const { resolve, reject } = CreateResolvingFunctions(realm, promise);
  return { promise, resolve, reject };
}

function resolveCapability(realm: Realm, capability: PromiseCapability, value: JSValue): void {
  if (capability.resolve) realm.call(capability.resolve, undefined, [value]);
  else ResolvePromise(realm, capability.promise, value);
}

function rejectCapability(realm: Realm, capability: PromiseCapability, reason: JSValue): void {
  if (capability.reject) realm.call(capability.reject, undefined, [reason]);
  else RejectPromise(realm, capability.promise, reason);
}

// ---- abstract operations ----

/** CreateResolvingFunctions: the pair shares `alreadyResolved`, so only the first call counts. */
export function CreateResolvingFunctions(realm: Realm, promise: JSPromise): { resolve: JSFunction; reject: JSFunction } {
  let alreadyResolved = false;
  const resolve = realm.runtimeFunction("", 1, (r, _receiver, args) => {
    if (alreadyResolved) return normal(undefined);
    alreadyResolved = true;
    ResolvePromise(r, promise, args[0]);
    return normal(undefined);
  }, [promise]);
  const reject = realm.runtimeFunction("", 1, (r, _receiver, args) => {
    if (alreadyResolved) return normal(undefined);
    alreadyResolved = true;
    RejectPromise(r, promise, args[0]);
    return normal(undefined);
  }, [promise]);
  return { resolve, reject };
}

/** The body of a promise resolve function after the `alreadyResolved` check (V8's ResolvePromise). */
export function ResolvePromise(realm: Realm, promise: JSPromise, resolution: JSValue): void {
  if (resolution === promise) {
    RejectPromise(realm, promise, realm.createError("TypeError", formatMessage("kPromiseCyclic", "#<Promise>")));
    return;
  }
  if (!(resolution instanceof JSObject)) {
    FulfillPromise(realm, promise, resolution);
    return;
  }
  // OrdinaryGet cannot throw: accessors are outside the subset, so there is no abrupt Get to reject on.
  const then = OrdinaryGet(resolution, "then");
  if (!(then instanceof JSFunction)) {
    FulfillPromise(realm, promise, resolution);
    return;
  }
  realm.microtasks.enqueue(NewPromiseResolveThenableJob(realm, promise, resolution, then));
}

function settle(promise: JSPromise, state: "fulfilled" | "rejected", value: JSValue): PromiseReaction[] {
  if (promise.state !== "pending") throw new Error("a promise is settled twice");
  const reactions = state === "fulfilled" ? promise.fulfillReactions : promise.rejectReactions;
  promise.fulfillReactions = [];
  promise.rejectReactions = [];
  promise.result = value;
  promise.state = state;
  return reactions;
}

export function FulfillPromise(realm: Realm, promise: JSPromise, value: JSValue): void {
  TriggerPromiseReactions(realm, settle(promise, "fulfilled", value), value);
}

export function RejectPromise(realm: Realm, promise: JSPromise, reason: JSValue): void {
  const reactions = settle(promise, "rejected", reason);
  if (!promise.isHandled) realm.host.promiseRejectionTracker?.(promise, "reject");
  TriggerPromiseReactions(realm, reactions, reason);
}

export function TriggerPromiseReactions(realm: Realm, reactions: readonly PromiseReaction[], argument: JSValue): void {
  for (const reaction of reactions) realm.microtasks.enqueue(NewPromiseReactionJob(realm, reaction, argument, "TriggerPromiseReactions"));
}

/** What the timeline shows for a reaction job: the handler, or the await it resumes. */
function reactionLabel(reaction: PromiseReaction): string {
  if (!reaction.capability) return "await continuation";
  const which = reaction.type === "fulfill" ? "then" : "catch";
  return reaction.handler ? `${which}(${displayName(reaction.handler)})` : `${which} pass-through`;
}

/** NewPromiseReactionJob: run the handler, then settle the derived promise with its result or its throw. */
export function NewPromiseReactionJob(realm: Realm, reaction: PromiseReaction, argument: JSValue, origin: string): JobSpec {
  return {
    kind: "PromiseReactionJob",
    label: reactionLabel(reaction),
    origin,
    roots: [reaction.handler, reaction.capability?.promise, reaction.capability?.resolve, reaction.capability?.reject, argument],
    run() {
      const { capability, handler, type } = reaction;
      const handlerResult: Completion = handler
        ? realm.call(handler, undefined, [argument])
        : type === "fulfill"
          ? normal(argument)
          : thrown(argument);
      // An await has no derived promise; its handlers resume the function and never throw into one.
      if (!capability) return handlerResult;
      if (isThrow(handlerResult)) {
        realm.exceptionCaught();
        rejectCapability(realm, capability, handlerResult.value);
      } else {
        resolveCapability(realm, capability, handlerResult.value);
      }
      return normal(undefined);
    },
  };
}

/**
 * NewPromiseResolveThenableJob. For a native promise with the intrinsic `then` V8 skips the call
 * and the derived promise and performs the then directly; the observable order is the same.
 */
export function NewPromiseResolveThenableJob(realm: Realm, promise: JSPromise, thenable: JSObject, then: JSFunction): JobSpec {
  return {
    kind: "PromiseResolveThenableJob",
    label: "adopt thenable",
    origin: "Resolving a promise with a thenable",
    roots: [promise, thenable, then],
    run() {
      const { resolve, reject } = CreateResolvingFunctions(realm, promise);
      if (thenable instanceof JSPromise && then === realm.promise.then) {
        PerformPromiseThen(realm, thenable, resolve, reject, undefined);
        return normal(undefined);
      }
      const result = realm.call(then, thenable, [resolve, reject]);
      if (isThrow(result)) {
        realm.exceptionCaught();
        realm.call(reject, undefined, [result.value]);
      }
      return normal(undefined);
    },
  };
}

/** PerformPromiseThen. Handlers that are not functions are `undefined` (identity or thrower in the job). */
export function PerformPromiseThen(
  realm: Realm,
  promise: JSPromise,
  onFulfilled: JSValue,
  onRejected: JSValue,
  resultCapability: PromiseCapability | undefined,
): void {
  const fulfillReaction: PromiseReaction = {
    capability: resultCapability,
    type: "fulfill",
    handler: onFulfilled instanceof JSFunction ? onFulfilled : undefined,
  };
  const rejectReaction: PromiseReaction = {
    capability: resultCapability,
    type: "reject",
    handler: onRejected instanceof JSFunction ? onRejected : undefined,
  };
  switch (promise.state) {
    case "pending":
      promise.fulfillReactions.push(fulfillReaction);
      promise.rejectReactions.push(rejectReaction);
      break;
    case "fulfilled":
      realm.microtasks.enqueue(NewPromiseReactionJob(realm, fulfillReaction, promise.result, "PerformPromiseThen"));
      break;
    case "rejected":
      // HostPromiseRejectionTracker(promise, "handle"): a rejection nobody listened to now has a listener.
      if (!promise.isHandled) realm.host.promiseRejectionTracker?.(promise, "handle");
      realm.microtasks.enqueue(NewPromiseReactionJob(realm, rejectReaction, promise.result, "PerformPromiseThen"));
      break;
    default:
      assertNever(promise.state);
  }
  promise.isHandled = true;
}

/** PromiseResolve(%Promise%, x): a native promise with the intrinsic constructor is returned as it is. */
export function PromiseResolve(realm: Realm, x: JSValue): JSPromise {
  if (x instanceof JSPromise && OrdinaryGet(x, "constructor") === realm.promise.constructor) return x;
  const promise = realm.newPromise();
  ResolvePromise(realm, promise, x);
  return promise;
}

// ---- helpers for the builtins ----

/** SpeciesConstructor(promise, %Promise%) for the cases that need no @@species lookup. */
function requireDefaultConstructor(realm: Realm, promise: JSObject, method: string): void {
  const constructor = OrdinaryGet(promise, "constructor");
  if (constructor !== undefined && constructor !== realm.promise.constructor) {
    unsupported(`${method} on a promise whose constructor is not %Promise% (species constructors are not modeled)`);
  }
}

/** Invoke(target, "then", args). The CallPrinter text of a TypeError for a missing `then` is not modeled. */
function invokeThen(realm: Realm, target: JSValue, args: readonly JSValue[]): Completion {
  if (!(target instanceof JSObject)) return unsupported("then on a value that is not an object");
  const then = OrdinaryGet(target, "then");
  if (!(then instanceof JSFunction)) return unsupported("a `then` that is not callable (the CallPrinter text of the TypeError is not modeled)");
  return realm.call(then, target, args);
}

function createDataProperty(realm: Realm, target: JSObject, key: string, value: JSValue): void {
  OrdinaryDefineOwnProperty(realm, target, key, { value, ...ELEMENT });
}

/** The `this` check every static makes (`C` must be an object); only %Promise% itself is modeled. */
function checkConstructor(realm: Realm, receiver: JSValue, name: string): Completion<void> {
  if (!(receiver instanceof JSObject)) return realm.throwTypeError(formatMessage("kCalledOnNonObject", name));
  if (receiver !== realm.promise.constructor) return unsupported(`${name} with a this value other than %Promise%`);
  return normal(undefined);
}

/** Reads an array iterable element by element (the array iterator, live length); other iterables run user code and stop the run. */
function iterateArray(realm: Realm, iterable: JSValue, name: string, visit: (value: JSValue, index: number) => Completion<void>): Completion<void> {
  if (!(iterable instanceof JSArray)) return unsupported(`${name} over an iterable that is not an array`);
  for (let i = 0; i < iterable.length; i++) {
    realm.work.charge();
    const done = visit(OrdinaryGet(iterable, String(i)), i);
    if (isThrow(done)) return done;
  }
  return normal(undefined);
}

function discard(done: Completion): Completion<void> {
  return isThrow(done) ? done : normal(undefined);
}

/**
 * The frame shared by the four combinators: capability, `promiseResolve`, then `body`. A throw
 * from the body (IfAbruptRejectPromise) rejects the returned promise instead of propagating.
 */
function combinator(
  realm: Realm,
  receiver: JSValue,
  name: string,
  body: (capability: PromiseCapability, promiseResolve: JSFunction) => Completion<void>,
): Completion {
  const checked = checkConstructor(realm, receiver, name);
  if (isThrow(checked)) return checked;
  const capability = newCapabilityWithFunctions(realm);
  const promiseResolve = receiver instanceof JSObject ? OrdinaryGet(receiver, "resolve") : undefined;
  if (!(promiseResolve instanceof JSFunction)) return unsupported(`${name} with a Promise.resolve that is not callable`);
  const done = body(capability, promiseResolve);
  if (isThrow(done)) {
    realm.exceptionCaught();
    rejectCapability(realm, capability, done.value);
  }
  return normal(capability.promise);
}

export function installPromise(realm: Realm): PromiseIntrinsics {
  const prototype = realm.intrinsics.promisePrototype;

  const constructor = realm.nativeConstructor(
    "Promise",
    1,
    (r) => r.throwTypeError(formatMessage("kPromiseConstructorWithoutNew")),
    (r, args) => {
      const executor = args[0];
      if (!(executor instanceof JSFunction)) return r.throwTypeError(formatMessage("kResolverNotAFunction", describeValue(executor)));
      const promise = r.newPromise();
      const { resolve, reject } = CreateResolvingFunctions(r, promise);
      // `new Promise (<anonymous>)` is a frame of the stack while the executor runs.
      const result = r.nativeFrame(r.promise.constructor, undefined, true, () => r.call(executor, undefined, [resolve, reject]));
      if (isThrow(result)) {
        r.exceptionCaught();
        r.call(reject, undefined, [result.value]);
      }
      return normal(promise);
    },
  );
  realm.linkConstructor(constructor, prototype);
  realm.defineToStringTag(prototype, "Promise");

  // ---- prototype ----

  const then = realm.defineMethod(prototype, "then", 2, (r, receiver, args) => {
    if (!(receiver instanceof JSPromise)) {
      return r.throwTypeError(formatMessage("kIncompatibleMethodReceiver", "Promise.prototype.then", describeValue(receiver)));
    }
    requireDefaultConstructor(r, receiver, "Promise.prototype.then");
    const capability = newInternalCapability(r);
    PerformPromiseThen(r, receiver, args[0], args[1], capability);
    return normal(capability.promise);
  });

  realm.defineMethod(prototype, "catch", 1, (r, receiver, args) => invokeThen(r, receiver, [undefined, args[0]]));

  realm.defineMethod(prototype, "finally", 1, (r, receiver, args) => {
    if (!(receiver instanceof JSObject)) return r.throwTypeError(formatMessage("kCalledOnNonObject", "Promise.prototype.finally"));
    requireDefaultConstructor(r, receiver, "Promise.prototype.finally");
    const onFinally = args[0];
    if (!(onFinally instanceof JSFunction)) return invokeThen(r, receiver, [onFinally, onFinally]);
    // thenFinally / catchFinally (src/builtins/promise-finally.tq): wait for onFinally's result, then pass the original through.
    const thenFinally = r.runtimeFunction("", 1, (r2, _receiver, a) => {
      const value = a[0];
      const result = r2.call(onFinally, undefined, []);
      if (isThrow(result)) return result;
      const valueThunk = r2.runtimeFunction("", 0, () => normal(value));
      return invokeThen(r2, PromiseResolve(r2, result.value), [valueThunk]);
    });
    const catchFinally = r.runtimeFunction("", 1, (r2, _receiver, a) => {
      const reason = a[0];
      const result = r2.call(onFinally, undefined, []);
      if (isThrow(result)) return result;
      const thrower = r2.runtimeFunction("", 0, () => thrown(reason));
      return invokeThen(r2, PromiseResolve(r2, result.value), [thrower]);
    });
    return invokeThen(r, receiver, [thenFinally, catchFinally]);
  });

  // ---- statics ----

  realm.defineMethod(constructor, "resolve", 1, (r, receiver, args) => {
    const checked = checkConstructor(r, receiver, "PromiseResolve");
    return isThrow(checked) ? checked : normal(PromiseResolve(r, args[0]));
  });

  realm.defineMethod(constructor, "reject", 1, (r, receiver, args) => {
    const checked = checkConstructor(r, receiver, "PromiseReject");
    if (isThrow(checked)) return checked;
    const promise = r.newPromise();
    RejectPromise(r, promise, args[0]);
    return normal(promise);
  });

  realm.defineMethod(constructor, "all", 1, (r, receiver, args) =>
    combinator(r, receiver, "Promise.all", (capability, promiseResolve) => {
      const values: JSValue[] = [];
      let remaining = 1;
      const finish = (): void => resolveCapability(r, capability, r.newArray([...values]));
      const visited = iterateArray(r, args[0], "Promise.all", (next, index) => {
        values.push(undefined);
        const nextPromise = r.call(promiseResolve, receiver, [next]);
        if (isThrow(nextPromise)) return nextPromise;
        let called = false;
        const resolveElement = r.runtimeFunction("", 1, (_r, _t, a) => {
          if (called) return normal(undefined);
          called = true;
          values[index] = a[0];
          remaining -= 1;
          if (remaining === 0) finish();
          return normal(undefined);
        });
        remaining += 1;
        return discard(invokeThen(r, nextPromise.value, [resolveElement, capability.reject]));
      });
      if (isThrow(visited)) return visited;
      remaining -= 1;
      if (remaining === 0) finish();
      return normal(undefined);
    }),
  );

  realm.defineMethod(constructor, "allSettled", 1, (r, receiver, args) =>
    combinator(r, receiver, "Promise.allSettled", (capability, promiseResolve) => {
      const values: JSValue[] = [];
      let remaining = 1;
      const finish = (): void => resolveCapability(r, capability, r.newArray([...values]));
      const visited = iterateArray(r, args[0], "Promise.allSettled", (next, index) => {
        values.push(undefined);
        const nextPromise = r.call(promiseResolve, receiver, [next]);
        if (isThrow(nextPromise)) return nextPromise;
        let called = false;
        const element = (status: "fulfilled" | "rejected", key: "value" | "reason") =>
          r.runtimeFunction("", 1, (_r, _t, a) => {
            if (called) return normal(undefined);
            called = true;
            const entry = r.newObject();
            createDataProperty(r, entry, "status", status);
            createDataProperty(r, entry, key, a[0]);
            values[index] = entry;
            remaining -= 1;
            if (remaining === 0) finish();
            return normal(undefined);
          });
        const onFulfilled = element("fulfilled", "value");
        const onRejected = element("rejected", "reason");
        remaining += 1;
        return discard(invokeThen(r, nextPromise.value, [onFulfilled, onRejected]));
      });
      if (isThrow(visited)) return visited;
      remaining -= 1;
      if (remaining === 0) finish();
      return normal(undefined);
    }),
  );

  realm.defineMethod(constructor, "any", 1, (r, receiver, args) =>
    combinator(r, receiver, "Promise.any", (capability, promiseResolve) => {
      const errors: JSValue[] = [];
      let remaining = 1;
      const finish = (): void => {
        const error = r.createError("AggregateError", formatMessage("kAllPromisesRejected"));
        OrdinaryDefineOwnProperty(r, error, "errors", { value: r.newArray([...errors]), ...HIDDEN });
        rejectCapability(r, capability, error);
      };
      const visited = iterateArray(r, args[0], "Promise.any", (next, index) => {
        errors.push(undefined);
        const nextPromise = r.call(promiseResolve, receiver, [next]);
        if (isThrow(nextPromise)) return nextPromise;
        let called = false;
        const rejectElement = r.runtimeFunction("", 1, (_r, _t, a) => {
          if (called) return normal(undefined);
          called = true;
          errors[index] = a[0];
          remaining -= 1;
          if (remaining === 0) finish();
          return normal(undefined);
        });
        remaining += 1;
        return discard(invokeThen(r, nextPromise.value, [capability.resolve, rejectElement]));
      });
      if (isThrow(visited)) return visited;
      remaining -= 1;
      if (remaining === 0) finish();
      return normal(undefined);
    }),
  );

  realm.defineMethod(constructor, "race", 1, (r, receiver, args) =>
    combinator(r, receiver, "Promise.race", (capability, promiseResolve) =>
      iterateArray(r, args[0], "Promise.race", (next) => {
        const nextPromise = r.call(promiseResolve, receiver, [next]);
        if (isThrow(nextPromise)) return nextPromise;
        return discard(invokeThen(r, nextPromise.value, [capability.resolve, capability.reject]));
      }),
    ),
  );

  return { constructor, then };
}
