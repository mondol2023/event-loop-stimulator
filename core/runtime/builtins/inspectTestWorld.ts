import { normal } from "@/core/interpreter/Completion";
import { JSArray } from "../objects/JSArray";
import { JSObject } from "../objects/JSObject";
import { OrdinaryDefineOwnProperty, OrdinarySet } from "../spec/objectOps";
import { TestFunction, specTestWorld } from "../spec/specTestWorld";
import type { CallSite } from "../stack";
import type { JSValue } from "../values/JSValue";
import { TheHole, type TheHoleValue } from "../values/TheHole";
import { createError, type JSError } from "./errors";
import type { FunctionKind, InspectRealm, PromiseDetails } from "./inspect";

// Test-only scaffolding for util.inspect: the intrinsic prototypes and constructors inspect reads
// (`constructor`, `name`, the well-known prototypes), callable objects with a FunctionKind, and
// promises with a fixed state. The real Realm (Task 8) satisfies InspectRealm the same way.

export class InspectTestFunction extends TestFunction {
  readonly kind: FunctionKind;

  constructor(id: JSObject["id"], map: JSObject["map"], kind: FunctionKind) {
    super(id, map, () => normal(undefined));
    this.kind = kind;
  }
}

export class TestPromise extends JSObject {
  details: PromiseDetails = { state: "pending" };
}

/** An array element or a hole. */
export const hole: TheHoleValue = TheHole;

const HIDDEN = { writable: true, enumerable: false, configurable: true } as const;
const FROZEN = { writable: false, enumerable: false, configurable: false } as const;

export function inspectTestWorld() {
  const w = specTestWorld();
  const { heap, maps, ctx } = w;
  const wellKnown = new Map<JSObject, string>();
  const tags = new Map<JSObject, string>();

  const plain = (prototype: JSObject | null): JSObject =>
    heap.allocate((id) => new JSObject(id, maps.rootFor("object-literal", 0), prototype));

  const objectPrototype = plain(null);
  const functionPrototype = heap.allocate(
    (id) => new InspectTestFunction(id, maps.rootFor("function", 0), "normal"),
  );
  functionPrototype.prototype = objectPrototype;
  OrdinaryDefineOwnProperty(ctx, functionPrototype, "name", { value: "", ...FROZEN, configurable: true });

  /** A function object with `name` (and, for a constructor, `prototype`), like V8's JSFunction. */
  const makeFunction = (name: string, kind: FunctionKind, prototype: JSObject = functionPrototype): JSObject => {
    const fn = heap.allocate((id) => new InspectTestFunction(id, maps.rootFor("function", 0), kind));
    fn.prototype = prototype;
    OrdinaryDefineOwnProperty(ctx, fn, "name", { value: name, writable: false, enumerable: false, configurable: true });
    return fn;
  };

  /** A constructor and its prototype object, linked both ways, as the realm's intrinsics are. */
  const intrinsic = (name: string, proto: JSObject, parent: JSObject | null, fnProto?: JSObject): JSObject => {
    proto.prototype = parent;
    const ctor = makeFunction(name, "normal", fnProto);
    OrdinaryDefineOwnProperty(ctx, ctor, "prototype", { value: proto, ...FROZEN });
    OrdinaryDefineOwnProperty(ctx, proto, "constructor", { value: ctor, ...HIDDEN });
    wellKnown.set(proto, name);
    return ctor;
  };

  intrinsic("Object", objectPrototype, null);
  intrinsic("Function", functionPrototype, objectPrototype);
  const arrayPrototype = heap.allocate((id) => JSArray.fromElements(id, maps, null, []));
  intrinsic("Array", arrayPrototype, objectPrototype);

  const errorPrototype = plain(null);
  intrinsic("Error", errorPrototype, objectPrototype);
  const errorProto = (name: string): JSObject => {
    const p = plain(null);
    intrinsic(name, p, errorPrototype);
    return p;
  };
  const errorPrototypes = {
    Error: errorPrototype,
    TypeError: errorProto("TypeError"),
    RangeError: errorProto("RangeError"),
    AggregateError: errorProto("AggregateError"),
  };
  for (const [name, p] of Object.entries(errorPrototypes)) {
    OrdinaryDefineOwnProperty(ctx, p, "name", { value: name, ...HIDDEN });
    OrdinaryDefineOwnProperty(ctx, p, "message", { value: "", ...HIDDEN });
  }

  const promisePrototype = plain(null);
  intrinsic("Promise", promisePrototype, objectPrototype);
  tags.set(promisePrototype, "Promise");

  // %AsyncFunction.prototype% and friends: not globals, so not in wellKnownPrototypes.
  const functionFamily = (name: string): JSObject => {
    const p = plain(null);
    intrinsic(name, p, functionPrototype);
    wellKnown.delete(p);
    tags.set(p, name);
    return p;
  };
  const kindPrototypes: Record<FunctionKind, JSObject> = {
    normal: functionPrototype,
    class: functionPrototype,
    async: functionFamily("AsyncFunction"),
    generator: functionFamily("GeneratorFunction"),
    asyncGenerator: functionFamily("AsyncGeneratorFunction"),
  };

  const math = plain(objectPrototype);
  tags.set(math, "Math");

  const realm: InspectRealm = {
    wellKnownPrototypeName: (o) => wellKnown.get(o),
    toStringTag(o) {
      for (let p: JSObject | null = o; p !== null; p = p.prototype) {
        const tag = tags.get(p);
        if (tag !== undefined) return tag;
      }
      return "";
    },
    functionKind: (fn) => (fn instanceof InspectTestFunction ? fn.kind : "normal"),
    promiseDetails: (o) => (o instanceof TestPromise ? o.details : undefined),
  };

  // ---- value builders ----

  const object = (props: Record<string, JSValue> = {}, prototype: JSObject | null = objectPrototype): JSObject => {
    const o = plain(prototype);
    for (const [k, v] of Object.entries(props)) OrdinarySet(ctx, o, k, v);
    return o;
  };
  const array = (values: readonly (JSValue | TheHoleValue)[]): JSArray =>
    heap.allocate((id) => JSArray.fromElements(id, maps, arrayPrototype, values));
  const fn = (name: string, kind: FunctionKind = "normal"): JSObject => makeFunction(name, kind, kindPrototypes[kind]);
  const promise = (details: PromiseDetails): TestPromise => {
    const p = heap.allocate((id) => new TestPromise(id, maps.rootFor("promise", 0), promisePrototype));
    p.details = details;
    return p;
  };
  const error = (
    type: keyof typeof errorPrototypes,
    message: string | undefined,
    callSites: readonly CallSite[] = [],
  ): JSError => createError({ heap, maps }, errorPrototypes[type], message, callSites);
  /** A user constructor `name` and an instance of it. */
  const instanceOf = (name: string, props: Record<string, JSValue> = {}): JSObject => {
    const proto = object();
    const ctor = makeFunction(name, "normal");
    OrdinaryDefineOwnProperty(ctx, ctor, "prototype", { value: proto, writable: true, enumerable: false, configurable: false });
    OrdinaryDefineOwnProperty(ctx, proto, "constructor", { value: ctor, ...HIDDEN });
    return object(props, proto);
  };
  const set = (o: JSObject, key: string, value: JSValue): void => {
    OrdinarySet(ctx, o, key, value);
  };
  const defineHidden = (o: JSObject, key: string, value: JSValue): void => {
    OrdinaryDefineOwnProperty(ctx, o, key, { value, ...HIDDEN });
  };

  return {
    ...w,
    realm,
    intrinsics: { objectPrototype, functionPrototype, arrayPrototype, promisePrototype, errorPrototypes, math },
    object,
    array,
    fn,
    promise,
    error,
    instanceOf,
    set,
    defineHidden,
  };
}

export type InspectTestWorld = ReturnType<typeof inspectTestWorld>;
