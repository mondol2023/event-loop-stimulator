import type { Instruction } from "@/core/bytecode/BytecodeArray";
import type { ArrayBoilerplate, BoilerplateValue, ObjectBoilerplate } from "@/core/bytecode/boilerplate";
import { InlineCache } from "@/core/runtime/ic/InlineCache";
import { formatMessage } from "@/core/runtime/messages";
import { HeapObject } from "@/core/runtime/objects/HeapObject";
import { JSArguments } from "@/core/runtime/objects/JSArguments";
import { JSArray } from "@/core/runtime/objects/JSArray";
import { JSFunction } from "@/core/runtime/objects/JSFunction";
import { JSObject } from "@/core/runtime/objects/JSObject";
import type { Realm } from "@/core/runtime/Realm";
import { ToNumber, ToPropertyKey } from "@/core/runtime/spec/conversions";
import { OrdinaryDefineOwnProperty, OrdinaryDelete, OrdinaryGetOwnProperty, OrdinarySet, toArrayIndex } from "@/core/runtime/spec/objectOps";
import type { JSValue } from "@/core/runtime/values/JSValue";
import { TheHole, type TheHoleValue } from "@/core/runtime/values/TheHole";
import { SimulationHalt } from "@/core/shared/simulationHalt";
import { type Completion, isThrow } from "../Completion";
import { type Frame, readRegister } from "../Frame";
import { type Handler, accumulatorValue, operand } from "./context";
import { nameConstant } from "./loads";

// Property access, literals and inline-cache feedback (src/ic/ic.cc, src/runtime/runtime-literals.cc,
// src/interpreter/interpreter-generator.cc). Every access that has a feedback slot records the
// receiver's Map there before it runs, which is what V8's IC does on a miss.

const DATA_PROPERTY = { writable: true, enumerable: true, configurable: true } as const;
const MAX_UINT32 = 4294967295;

function unsupported(reason: string): never {
  throw new SimulationHalt({ kind: "unsupported", reason });
}

/** Records the Map of `receiver` at the feedback slot named by operand `slotOperand` (builtin values have no Map here). */
function recordMap(frame: Frame, instr: Instruction, slotOperand: number, receiver: JSValue): void {
  if (!(receiver instanceof JSObject)) return;
  new InlineCache(frame.fn.feedbackCell.requireVector()).update(operand(instr, slotOperand), receiver.map);
}

/** `NoSideEffectsToString` of a key in a "Cannot read properties" message: nothing here may run user code. */
function keyForMessage(key: JSValue): string {
  if (key instanceof HeapObject) unsupported("the text of a TypeError that names an object key (it would need the object's string form)");
  return String(key);
}

/**
 * The `caller` and `arguments` of a function: %Function.prototype% holds throwing accessors
 * (AddRestrictedFunctionProperties) and a sloppy function has own null data properties
 * (V8's sloppy_function_map). Accessors are not in the object model, so they are answered here.
 * `undefined` means the property is ordinary; "read-only" is a write that is refused.
 */
function restrictedFunctionAccess(realm: Realm, receiver: JSObject, key: string, access: "get" | "set"): Completion | "read-only" | undefined {
  // An unmapped arguments object has a throwing `callee` accessor of its own.
  if (key === "callee" && receiver instanceof JSArguments && receiver.unmapped) return realm.throwTypeError(formatMessage("kRestrictedFunctionProperties"));
  if (key !== "caller" && key !== "arguments") return undefined;
  const functionPrototype = realm.intrinsics.functionPrototype;
  let reaches = false;
  for (let o: JSObject | null = receiver; o !== null; o = o.prototype) {
    if (OrdinaryGetOwnProperty(o, key)) return undefined;
    if (o === functionPrototype) reaches = true;
  }
  if (!reaches) return undefined;
  const code = receiver instanceof JSFunction ? receiver.code : undefined;
  if (code && !code.strict && code.constructable && code.kind === "normal") {
    if (access === "set") return "read-only";
    // While the function runs, V8 answers its caller or a fresh arguments object: not modeled.
    if (realm.isActive(receiver as JSFunction)) throw new SimulationHalt({ kind: "unsupported", reason: `${key} of a running sloppy function` });
    return { type: "normal", value: null };
  }
  return realm.throwTypeError(formatMessage("kRestrictedFunctionProperties"));
}

/** Get on `holder`'s chain; a member real Node has but the model lacks halts the run instead of reading as `undefined`. */
function getMember(realm: Realm, holder: JSObject, key: string): JSValue {
  for (let o: JSObject | null = holder; o !== null; o = o.prototype) {
    const desc = OrdinaryGetOwnProperty(o, key);
    if (desc) return desc.value;
    realm.requireModeled(o, key);
  }
  return undefined;
}

/** The loaded value of `key` on a primitive receiver: a string's own index and `length`, else its wrapper prototype's property. */
function loadFromPrimitive(realm: Realm, receiver: string | number | boolean, key: string): JSValue {
  if (typeof receiver === "string") {
    if (key === "length") return receiver.length;
    const index = toArrayIndex(key);
    if (index !== undefined && index < receiver.length) return receiver.charAt(index);
  }
  const { stringPrototype, numberPrototype, booleanPrototype } = realm.intrinsics;
  return getMember(realm, typeof receiver === "string" ? stringPrototype : typeof receiver === "number" ? numberPrototype : booleanPrototype, key);
}

/** `LoadIC`: the property `key` of `receiver`, or the V8 TypeError for undefined and null. */
function loadProperty(realm: Realm, receiver: JSValue, key: JSValue): Completion {
  if (receiver === undefined || receiver === null) {
    return realm.throwError("TypeError", formatMessage("kNonObjectPropertyLoadWithProperty", String(receiver), keyForMessage(key)));
  }
  const name = ToPropertyKey(realm, key);
  if (isThrow(name)) return name;
  if (receiver instanceof JSObject) {
    const restricted = restrictedFunctionAccess(realm, receiver, name.value, "get");
    if (restricted && restricted !== "read-only") return restricted;
    return { type: "normal", value: getMember(realm, receiver, name.value) };
  }
  return { type: "normal", value: loadFromPrimitive(realm, receiver as string | number | boolean, name.value) };
}

/**
 * `ArraySetLength` for a store to `length`: a value that is not a valid uint32 is a RangeError.
 * Only primitives are converted here; an object would run its `valueOf` twice, as the spec does.
 */
function validatedArrayLength(realm: Realm, value: JSValue): Completion<number> {
  if (value instanceof HeapObject) unsupported("assigning an object to an array's length (its valueOf runs twice)");
  const number = ToNumber(realm, value);
  if (isThrow(number)) return number;
  const n = number.value;
  if (!Number.isInteger(n) || n < 0 || n > MAX_UINT32) return realm.throwError("RangeError", formatMessage("kInvalidArrayLength"));
  return { type: "normal", value: n };
}

/** `StoreIC`: `receiver[key] = value`. A refused write is silent in sloppy code, and stops the run in strict code. */
function storeProperty(realm: Realm, frame: Frame, receiver: JSValue, key: JSValue, value: JSValue): Completion | undefined {
  if (receiver === undefined || receiver === null) {
    return realm.throwError("TypeError", formatMessage("kNonObjectPropertyStoreWithProperty", String(receiver), keyForMessage(key)));
  }
  const name = ToPropertyKey(realm, key);
  if (isThrow(name)) return name;
  if (!(receiver instanceof JSObject)) {
    // OrdinarySet on the wrapper with the primitive as Receiver always fails: sloppy code ignores it, strict code throws.
    if (!frame.code.strict) return undefined;
    const index = toArrayIndex(name.value);
    const readOnly = typeof receiver === "string" && (name.value === "length" || (index !== undefined && index < receiver.length));
    return realm.throwTypeError(formatMessage(readOnly ? "kStrictReadOnlyProperty" : "kStrictCannotCreateProperty", name.value, typeof receiver, String(receiver)));
  }
  let stored: JSValue = value;
  if (receiver instanceof JSArray && name.value === "length") {
    const length = validatedArrayLength(realm, value);
    if (isThrow(length)) return length;
    stored = length.value;
  }
  const restricted = restrictedFunctionAccess(realm, receiver, name.value, "set");
  if (restricted && restricted !== "read-only") return restricted;
  if (!(restricted ? false : OrdinarySet(realm, receiver, name.value, stored)) && frame.code.strict) {
    unsupported(`strict assignment to the read-only property ${name.value} (the TypeError text is not modeled)`);
  }
  return undefined;
}

/** `BuildBoilerplate`'s copy: a fresh object or array from the data, nested literals included. */
function instantiate(realm: Realm, value: BoilerplateValue | "hole"): JSValue | TheHoleValue {
  if (value === "hole") return TheHole;
  switch (value.kind) {
    case "value":
      return value.value;
    case "placeholder":
      return 0; // a Smi the bytecode after the Create* overwrites
    case "object":
      return instantiateObject(realm, value);
    case "array":
      return instantiateArray(realm, value);
    default:
      return value satisfies never;
  }
}

function instantiateObject(realm: Realm, boilerplate: ObjectBoilerplate): JSObject {
  const object = realm.newLiteralObject(boilerplate.properties.length);
  for (const { key, value } of boilerplate.properties) {
    OrdinaryDefineOwnProperty(realm, object, key, { value: instantiate(realm, value) as JSValue, ...DATA_PROPERTY });
  }
  return object;
}

function instantiateArray(realm: Realm, boilerplate: ArrayBoilerplate): JSArray {
  return realm.newArray(boilerplate.elements.map((element) => instantiate(realm, element)));
}

function boilerplateOf(frame: Frame, instr: Instruction): ObjectBoilerplate | ArrayBoilerplate {
  const entry = frame.code.constantPool.get(operand(instr, 0));
  if (entry?.kind !== "boilerplate" || !entry.literal) throw new Error(`${instr.opcode} does not name a boilerplate with data`);
  return entry.literal;
}

export const propertyHandler: Handler = (ctx, frame, instr) => {
  const realm = ctx.realm;
  switch (instr.opcode) {
    case "GetNamedProperty": {
      const receiver = readRegister(frame, operand(instr, 0)) as JSValue;
      recordMap(frame, instr, 2, receiver);
      const loaded = loadProperty(realm, receiver, nameConstant(frame, instr, 1));
      if (isThrow(loaded)) return loaded;
      frame.accumulator = loaded.value;
      return undefined;
    }
    case "GetKeyedProperty": {
      const receiver = readRegister(frame, operand(instr, 0)) as JSValue;
      recordMap(frame, instr, 1, receiver);
      const loaded = loadProperty(realm, receiver, accumulatorValue(frame));
      if (isThrow(loaded)) return loaded;
      frame.accumulator = loaded.value;
      return undefined;
    }
    case "SetNamedProperty": {
      const receiver = readRegister(frame, operand(instr, 0)) as JSValue;
      recordMap(frame, instr, 2, receiver);
      return storeProperty(realm, frame, receiver, nameConstant(frame, instr, 1), accumulatorValue(frame));
    }
    case "SetKeyedProperty": {
      const receiver = readRegister(frame, operand(instr, 0)) as JSValue;
      recordMap(frame, instr, 2, receiver);
      return storeProperty(realm, frame, receiver, readRegister(frame, operand(instr, 1)) as JSValue, accumulatorValue(frame));
    }
    case "DefineNamedOwnProperty": {
      // CreateDataProperty on a literal under construction: always an ordinary object.
      const literal = readRegister(frame, operand(instr, 0));
      if (!(literal instanceof JSObject)) throw new Error("DefineNamedOwnProperty on a value that is not an object");
      recordMap(frame, instr, 2, literal);
      OrdinaryDefineOwnProperty(realm, literal, nameConstant(frame, instr, 1), { value: accumulatorValue(frame), ...DATA_PROPERTY });
      return undefined;
    }
    case "CreateObjectLiteral":
    case "CreateArrayLiteral": {
      const boilerplate = boilerplateOf(frame, instr);
      frame.accumulator = (boilerplate.kind === "object" ? instantiateObject : instantiateArray)(realm, boilerplate as never);
      return undefined;
    }
    case "CreateEmptyObjectLiteral":
      frame.accumulator = realm.newObject();
      return undefined;
    case "CreateEmptyArrayLiteral":
      frame.accumulator = realm.newArray();
      return undefined;
    case "StaInArrayLiteral": {
      // DefineKeyedOwnPropertyInLiteral on the array under construction; the index is a Smi.
      const array = readRegister(frame, operand(instr, 0));
      const index = readRegister(frame, operand(instr, 1));
      if (!(array instanceof JSArray) || typeof index !== "number") throw new Error("StaInArrayLiteral without an array and a numeric index");
      recordMap(frame, instr, 2, array);
      array.putElement(realm.maps, index, accumulatorValue(frame));
      return undefined;
    }
    case "DeletePropertySloppy":
    case "DeletePropertyStrict": {
      const receiver = readRegister(frame, operand(instr, 0)) as JSValue;
      if (!(receiver instanceof JSObject)) unsupported(`delete on a ${receiver === null || receiver === undefined ? String(receiver) : typeof receiver} (the TypeError text is not modeled)`);
      const key = ToPropertyKey(realm, accumulatorValue(frame));
      if (isThrow(key)) return key;
      const deleted = OrdinaryDelete(realm, receiver, key.value);
      if (!deleted && instr.opcode === "DeletePropertyStrict") unsupported(`strict delete of the non-configurable property ${key.value} (the TypeError text is not modeled)`);
      frame.accumulator = deleted;
      return undefined;
    }
    default:
      throw new Error(`${instr.opcode} is not a property opcode`);
  }
};
