import { type Completion, normal } from "@/core/interpreter/Completion";
import { inspect } from "@/core/runtime/builtins/inspect";
import { HeapObject } from "@/core/runtime/objects/HeapObject";
import { JSFunction } from "@/core/runtime/objects/JSFunction";
import { JSObject } from "@/core/runtime/objects/JSObject";
import type { Realm } from "@/core/runtime/Realm";
import { ToBoolean } from "@/core/runtime/spec/conversions";
import { SameValue } from "@/core/runtime/spec/equality";
import { OrdinaryDefineOwnProperty, OrdinaryGet, OrdinaryGetOwnProperty } from "@/core/runtime/spec/objectOps";
import type { JSValue } from "@/core/runtime/values/JSValue";
import { SimulationHalt } from "@/core/shared/simulationHalt";

// The test262 host (test-only, Decision D7): test262's assert.js, sta.js and doneprintHandle.js as
// host builtins, exactly as tests/conformance/test262/harnessContract.md specifies. Messages follow
// assert.js. No schema reaches this mode.

const HIDDEN = { writable: true, enumerable: false, configurable: true } as const;
const GLOBAL = { writable: true, enumerable: true, configurable: true } as const;

/** assert._toString: objects via inspect, so no user code runs. */
const show = (realm: Realm, v: JSValue): string => (v instanceof HeapObject ? inspect(realm, v) : String(v));

function messageText(v: JSValue): string | undefined {
  if (v === undefined) return undefined;
  if (v instanceof HeapObject) throw new SimulationHalt({ kind: "unsupported", reason: "a test262 harness message that is an object" });
  return String(v);
}

/** HasProperty (`"name" in error`), read host-side. */
function hasProperty(o: JSObject, key: string): boolean {
  for (let p: JSObject | null = o; p !== null; p = p.prototype) if (OrdinaryGetOwnProperty(p, key)) return true;
  return false;
}

export function installTest262Harness(realm: Realm): void {
  const global = realm.globalObject;
  realm.scriptThisIsGlobal = true;
  // A test262 host does not end the process on an unhandled rejection (that is Node's policy).
  Object.defineProperty(realm.host, "promiseRejectionTracker", { value: undefined });
  const define = (target: JSObject, name: string, value: JSValue, attributes: { readonly writable: boolean; readonly enumerable: boolean; readonly configurable: boolean } = GLOBAL): void => {
    OrdinaryDefineOwnProperty(realm, target, name, { value, ...attributes });
  };

  // Test262Error (sta.js); an Error subclass here so Node's printer reports it like any error.
  const prototype = realm.newObject(realm.intrinsics.errorPrototypes.Error);
  define(prototype, "name", "Test262Error", HIDDEN);
  define(prototype, "message", "", HIDDEN);
  const create = (r: Realm, args: readonly JSValue[]): Completion => normal(r.createErrorWithPrototype(prototype, messageText(args[0])));
  const Test262Error = realm.nativeConstructor("Test262Error", 1, (r, _receiver, args) => create(r, args), create);
  realm.linkConstructor(Test262Error, prototype);
  define(global, "Test262Error", Test262Error);
  // sta.js: Test262Error.thrower, a function tests hand to code that expects a throwing callback.
  define(Test262Error, "thrower", realm.nativeFunction("", 1, (r, _receiver, args) => ({ type: "throw", value: r.createErrorWithPrototype(prototype, messageText(args[0])) })));

  const fail = (message: string): Completion => ({ type: "throw", value: realm.createErrorWithPrototype(prototype, message) });
  const prefixed = (message: JSValue, text: string): string => {
    const m = messageText(message);
    return m === undefined ? text : `${m} ${text}`;
  };

  const assert = realm.nativeFunction("assert", 2, (r, _receiver, [value, message]) =>
    value === true ? normal(undefined) : fail(messageText(message) ?? `Expected true but got ${show(r, value)}`),
  );
  realm.defineMethod(assert, "sameValue", 3, (r, _receiver, [actual, expected, message]) =>
    SameValue(actual, expected) ? normal(undefined) : fail(prefixed(message, `Expected SameValue(«${show(r, actual)}», «${show(r, expected)}») to be true`)),
  );
  realm.defineMethod(assert, "notSameValue", 3, (r, _receiver, [actual, unexpected, message]) =>
    !SameValue(actual, unexpected) ? normal(undefined) : fail(prefixed(message, `Expected SameValue(«${show(r, actual)}», «${show(r, unexpected)}») to be false`)),
  );
  realm.defineMethod(assert, "throws", 3, (r, _receiver, [expected, fn, message]) => {
    if (!(expected instanceof JSFunction) || !(fn instanceof JSFunction)) {
      return fail(prefixed(message, "assert.throws requires two arguments: the error constructor and a function to run"));
    }
    const expectedName = show(r, OrdinaryGet(expected, "name"));
    const result = r.call(fn, undefined, []);
    if (result.type !== "throw") return fail(prefixed(message, `Expected a ${expectedName} to be thrown but no exception was thrown at all`));
    r.exceptionCaught();
    const thrown = result.value;
    if (!(thrown instanceof JSObject)) return fail(prefixed(message, "Thrown value was not an object!"));
    // The constructor is read here, on the host side: user code still cannot reach `.constructor`.
    const actual = OrdinaryGet(thrown, "constructor");
    if (actual === expected) return normal(undefined);
    const actualName = actual instanceof JSObject ? show(r, OrdinaryGet(actual, "name")) : show(r, actual);
    return fail(prefixed(message, `Expected a ${expectedName} but got a ${actualName}`));
  });
  define(global, "assert", assert);

  define(
    global,
    "$DONOTEVALUATE",
    realm.nativeFunction("$DONOTEVALUATE", 0, () => fail("Test262: This statement should not be evaluated.")),
  );
  define(
    global,
    "$DONE",
    realm.nativeFunction("$DONE", 1, (r, _receiver, [error]) => {
      // doneprintHandle.js: any falsy value is success; a failure prints `name: message`.
      const text = !ToBoolean(error)
        ? "Test262:AsyncTestComplete"
        : error instanceof JSObject && hasProperty(error, "name")
          ? `Test262:AsyncTestFailure:${show(r, OrdinaryGet(error, "name"))}: ${show(r, OrdinaryGet(error, "message"))}`
          : `Test262:AsyncTestFailure:Test262Error: ${show(r, error)}`;
      r.host.write("stdout", `${text}\n`);
      return normal(undefined);
    }),
  );
  define(
    global,
    "print",
    realm.nativeFunction("print", 1, (r, _receiver, [message]) => {
      r.host.write("stdout", `${messageText(message) ?? "undefined"}\n`);
      return normal(undefined);
    }),
  );
}
