import { type Completion, isThrow, normal } from "@/core/interpreter/Completion";
import { SimulationHalt } from "@/core/shared/simulationHalt";
import { formatMessage } from "../messages";
import { JSFunction } from "../objects/JSFunction";
import { JSObject } from "../objects/JSObject";
import type { Realm } from "../Realm";
import { ToNumber } from "../spec/conversions";
import { OrdinaryGet } from "../spec/objectOps";
import type { JSValue } from "../values/JSValue";

// Function.prototype.{call, apply, bind, toString} (ECMA-262 Function.prototype.*). `call` and
// `apply` tail-call their target in V8, so they leave no frame in a stack trace.

const MAX_SAFE_LENGTH = 2 ** 53 - 1;
/** Past this V8 may throw a stack-overflow RangeError (its limit depends on the stack): not modeled. */
const MAX_APPLY_ARGUMENTS = 65_535;

function unsupported(reason: string): never {
  throw new SimulationHalt({ kind: "unsupported", reason });
}

/** The function a `call`/`apply`/`bind` receiver must be. V8 names the call site in the TypeError, which a builtin cannot see. */
function targetFunction(receiver: JSValue, method: string): JSFunction {
  if (receiver instanceof JSFunction) return receiver;
  return unsupported(`Function.prototype.${method} on a value that is not a function (the TypeError names the call site)`);
}

/** CreateListFromArrayLike: the elements `0 .. length - 1` of an array-like object. */
function createListFromArrayLike(realm: Realm, value: JSValue): Completion<JSValue[]> {
  if (!(value instanceof JSObject)) return realm.throwTypeError(formatMessage("kCalledOnNonObject", "CreateListFromArrayLike"));
  const raw = ToNumber(realm, OrdinaryGet(value, "length"));
  if (isThrow(raw)) return raw;
  // LengthOfArrayLike: ToLength.
  const length = Number.isNaN(raw.value) ? 0 : Math.min(Math.max(Math.trunc(raw.value), 0), MAX_SAFE_LENGTH);
  if (length > MAX_APPLY_ARGUMENTS) return unsupported(`an argument list of more than ${MAX_APPLY_ARGUMENTS} values`);
  const list: JSValue[] = [];
  for (let i = 0; i < length; i++) {
    realm.work.charge();
    list.push(OrdinaryGet(value, String(i)));
  }
  return normal(list);
}

export function installFunction(realm: Realm): void {
  const prototype = realm.intrinsics.functionPrototype;

  realm.defineMethod(prototype, "call", 1, (r, receiver, args) => r.call(targetFunction(receiver, "call"), args[0], args.slice(1)), true);

  realm.defineMethod(
    prototype,
    "apply",
    2,
    (r, receiver, args) => {
      const target = targetFunction(receiver, "apply");
      const argArray = args[1];
      if (argArray === undefined || argArray === null) return r.call(target, args[0], []);
      const list = createListFromArrayLike(r, argArray);
      return isThrow(list) ? list : r.call(target, args[0], list.value);
    },
    true,
  );

  realm.defineMethod(prototype, "bind", 1, (r, receiver, args) => {
    if (!(receiver instanceof JSFunction)) return r.throwTypeError(formatMessage("kFunctionBind"));
    return normal(r.boundFunction(receiver, args[0], args.slice(1)));
  });

  realm.defineMethod(prototype, "toString", 0, (r, receiver) => {
    if (!(receiver instanceof JSFunction)) return r.throwTypeError(formatMessage("kNotGeneric", "Function.prototype.toString", "Function"));
    return normal(r.functionSource(receiver));
  });
}
