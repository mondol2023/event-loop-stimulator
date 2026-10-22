import { type Completion, normal } from "@/core/interpreter/Completion";
import { SimulationHalt } from "@/core/shared/simulationHalt";
import { slotKindName } from "../ic/FeedbackVector";
import type { ElementsKind } from "../objects/ElementsKind";
import { JSFunction } from "../objects/JSFunction";
import { JSObject } from "../objects/JSObject";
import type { Realm } from "../Realm";
import type { JSValue } from "../values/JSValue";

// The V8 runtime functions natives mode (Decision D2) reaches through `CallRuntime [Name]`
// (src/runtime/runtime-test.cc), answered from the Map, elements-kind and feedback model. They
// exist only for the `internals` fixtures; no user input can compile a call to them.

/** The property-IC slot kinds `%DebugPrint` shows (D2); the rest of V8's output carries addresses. */
const PRINTED_SLOT_KINDS = new Set(["LoadProperty", "LoadKeyed", "SetNamedSloppy", "SetNamedStrict", "SetKeyedSloppy", "SetKeyedStrict", "DefineNamedOwn"]);

function unsupported(reason: string): never {
  throw new SimulationHalt({ kind: "unsupported", reason });
}

function objectArgument(name: string, value: JSValue): JSObject {
  if (value instanceof JSObject) return value;
  return unsupported(`%${name} of a value that is not an object`);
}

/** An elements-kind predicate (src/objects/elements-kind.h IsSmiElementsKind and friends). */
function elementsKindIs(name: string, test: (kind: ElementsKind) => boolean): RuntimeNative {
  return (_realm, args) => normal(test(objectArgument(name, args[0]).map.elementsKind));
}

/**
 * `%DebugPrint(fn)` reduced to the lines D2 keeps: `function NAME`, then `slot #N KIND STATE` for
 * each property-IC slot in index order. V8 writes it straight to stdout and returns the argument.
 */
function debugPrint(realm: Realm, args: readonly JSValue[]): Completion {
  const fn = args[0];
  if (!(fn instanceof JSFunction) || !fn.code) return unsupported("%DebugPrint of a value that is not a user function (only its feedback vector is modeled)");
  const vector = fn.feedbackCell.requireVector();
  let text = `function ${fn.code.name}\n`;
  for (const index of vector.slotIndices()) {
    const slot = vector.slot(index);
    const kind = slotKindName(slot.kind);
    if (PRINTED_SLOT_KINDS.has(kind)) text += `slot #${index} ${kind} ${slot.state}\n`;
  }
  realm.host.write("stdout", text);
  return normal(fn);
}

export type RuntimeNative = (realm: Realm, args: readonly JSValue[]) => Completion;

export const RUNTIME_NATIVE_FUNCTIONS: Readonly<Record<string, RuntimeNative>> = {
  HaveSameMap: (_realm, args) => normal(objectArgument("HaveSameMap", args[0]).map === objectArgument("HaveSameMap", args[1]).map),
  HasFastProperties: (_realm, args) => normal(objectArgument("HasFastProperties", args[0]).hasFastProperties),
  HasSmiElements: elementsKindIs("HasSmiElements", (k) => k === "PACKED_SMI_ELEMENTS" || k === "HOLEY_SMI_ELEMENTS"),
  HasDoubleElements: elementsKindIs("HasDoubleElements", (k) => k === "PACKED_DOUBLE_ELEMENTS" || k === "HOLEY_DOUBLE_ELEMENTS"),
  HasObjectElements: elementsKindIs("HasObjectElements", (k) => k === "PACKED_ELEMENTS" || k === "HOLEY_ELEMENTS"),
  HasHoleyElements: elementsKindIs("HasHoleyElements", (k) => k === "HOLEY_SMI_ELEMENTS" || k === "HOLEY_DOUBLE_ELEMENTS" || k === "HOLEY_ELEMENTS"),
  HasDictionaryElements: elementsKindIs("HasDictionaryElements", (k) => k === "DICTIONARY_ELEMENTS"),
  DebugPrint: debugPrint,
};
