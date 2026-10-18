import type { BytecodeProgram } from "@/core/bytecode/BytecodeProgram";
import type { Realm } from "@/core/runtime/Realm";
import { JSFunction } from "@/core/runtime/objects/JSFunction";
import type { JSValue } from "@/core/runtime/values/JSValue";
import { JSObject } from "@/core/runtime/objects/JSObject";
import { OrdinaryGet, OrdinaryGetOwnProperty } from "@/core/runtime/spec/objectOps";
import { type CallSite, positionOf } from "@/core/runtime/stack";
import { sourceRangeForPos } from "@/core/views/types";
import type { Frame } from "./Frame";

// The CallSite of one interpreter frame (src/objects/call-site-info.cc): what `captureStack`
// keeps of it at Error construction. The frame shapes are checked against the recorded fixtures
// when they are replayed (Tasks 14 and 17).

/** `JSReceiver::GetConstructorName` for the common case: the `constructor.name` found up the chain, else `Object`. */
export function typeNameOf(receiver: JSObject): string {
  for (let o: JSObject | null = receiver; o !== null; o = o.prototype) {
    const ctor = OrdinaryGetOwnProperty(o, "constructor")?.value;
    if (ctor instanceof JSFunction) {
      const name = OrdinaryGet(ctor, "name");
      if (typeof name === "string" && name !== "") return name;
    }
  }
  return "Object";
}

/** `CallSiteInfo::GetMethodName`: the property of the receiver that holds the function, own or inherited. */
function methodNameOf(receiver: JSObject, fn: JSFunction, functionName: string): string | null {
  const holdsFn = (o: JSObject, key: string): boolean => OrdinaryGetOwnProperty(o, key)?.value === fn;
  if (functionName !== "") {
    for (let o: JSObject | null = receiver; o !== null; o = o.prototype) if (holdsFn(o, functionName)) return functionName;
  }
  for (let o: JSObject | null = receiver; o !== null; o = o.prototype) {
    for (const key of o.namedKeys()) if (holdsFn(o, key)) return key;
  }
  return null;
}

export function callSiteOf(realm: Realm, program: BytecodeProgram, frame: Frame): CallSite {
  const range = sourceRangeForPos(program, { functionId: frame.code.id, bytecodeOffset: frame.offset });
  const receiver = frame.receiver;
  const functionName = frame.code.name === "" ? null : frame.code.name;
  const isTopLevel = receiver === undefined || receiver === null || receiver === realm.globalObject;
  const object = receiver instanceof JSObject ? receiver : undefined;
  return {
    functionName,
    typeName: isTopLevel || !object ? null : typeNameOf(object),
    methodName: isTopLevel || !object ? null : methodNameOf(object, frame.fn, functionName ?? ""),
    isTopLevel,
    isAsync: false,
    pos: positionOf(program.source, range?.start ?? 0),
  };
}

/**
 * A builtin's frame, `Type.name (<anonymous>)` (CallSiteInfo for a builtin: no script, so the
 * location is `<anonymous>`). The type is the receiver's constructor name, as for a method call.
 */
export function nativeCallSite(fn: JSFunction, receiver: JSValue, construct = false): CallSite {
  const name = OrdinaryGet(fn, "name");
  const functionName = typeof name === "string" ? name : "";
  if (construct) return { native: `new ${functionName} (<anonymous>)` };
  const type = receiver instanceof JSObject ? typeNameOf(receiver) : undefined;
  // An anonymous builtin with no receiver (a promise's thenFinally) is just `<anonymous>`.
  if (functionName === "" && type === undefined) return { native: "<anonymous>" };
  return { native: `${type ? `${type}.` : ""}${functionName} (<anonymous>)` };
}
