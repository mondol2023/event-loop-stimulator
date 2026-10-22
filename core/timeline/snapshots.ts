import type { BytecodeFunction } from "@/core/bytecode/BytecodeProgram";
import type { Frame } from "@/core/interpreter/Frame";
import { slotKindName } from "@/core/runtime/ic/FeedbackVector";
import { Context } from "@/core/runtime/objects/Context";
import { displayName } from "@/core/runtime/objects/functionName";
import type { HeapObject } from "@/core/runtime/objects/HeapObject";
import { JSArray } from "@/core/runtime/objects/JSArray";
import { JSFunction } from "@/core/runtime/objects/JSFunction";
import { JSHostObject } from "@/core/runtime/objects/JSHostObject";
import { JSMessageObject } from "@/core/runtime/objects/JSMessageObject";
import { JSObject } from "@/core/runtime/objects/JSObject";
import { JSPromise } from "@/core/runtime/objects/JSPromise";
import type { V8Map } from "@/core/runtime/objects/V8Map";
import { primitiveToString } from "@/core/runtime/spec/conversions";
import { isSmi } from "@/core/runtime/values/Smi";
import { taggedSmi } from "@/core/runtime/values/tagging";
import { isTheHole } from "@/core/runtime/values/TheHole";
import type { RegisterValue } from "@/core/runtime/values/JSValue";
import type { ObjectId } from "@/core/shared/ids";
import type { ElementsKind } from "@/core/runtime/objects/ElementsKind";
import type {
  FeedbackSnapshot,
  FrameSnapshot,
  MapSnapshot,
  ValueSnapshot,
} from "./Tick";

// The read-only views the TickRecorder builds its Ticks from. Nothing here may run user code or
// change state: no property getter is invoked (an Error's `stack` is formatted at its first
// read, so an Error is never asked for its properties), and no object is allocated on the heap.

/** Numbers the Contexts the timeline sees, from 1 in order of first sight (deterministic for a deterministic run). */
export class ContextIds {
  readonly #ids = new WeakMap<Context, number>();
  #next = 1;

  of(context: Context): number {
    let id = this.#ids.get(context);
    if (id === undefined) {
      id = this.#next;
      this.#next += 1;
      this.#ids.set(context, id);
    }
    return id;
  }
}

/** A short description of an object for the panes: not `util.inspect` (that reads properties). */
export function previewOf(object: HeapObject): string {
  if (object instanceof JSFunction) return `ƒ ${displayName(object)}`;
  if (object instanceof JSArray) return `Array(${object.length})`;
  if (object instanceof JSPromise) return `Promise { <${object.state}> }`;
  if (object instanceof JSHostObject) return object.hostClass;
  if (object instanceof JSObject) return object.map.family === "error" ? "Error" : "Object";
  return "HeapObject";
}

export function snapshotValue(value: RegisterValue): ValueSnapshot {
  if (value === undefined) return { kind: "oddball", name: "undefined" };
  if (value === null) return { kind: "oddball", name: "null" };
  if (typeof value === "boolean") return { kind: "oddball", name: value ? "true" : "false" };
  if (typeof value === "number") {
    return isSmi(value) ? { kind: "smi", value, tagged: taggedSmi(value) } : { kind: "heap-number", value, text: numberText(value) };
  }
  if (typeof value === "string") return { kind: "string", value };
  if (isTheHole(value)) return { kind: "oddball", name: "the_hole" };
  if (value instanceof Context) return { kind: "internal", name: "context" };
  if (value instanceof JSMessageObject) return { kind: "internal", name: "message" };
  if (value instanceof JSObject) return { kind: "object", id: value.id, mapId: value.map.id, preview: previewOf(value) };
  throw new Error("a register holds a value the timeline cannot show");
}

/** Number::toString, except that -0 shows its sign. */
function numberText(value: number): string {
  return Object.is(value, -0) ? "-0" : primitiveToString(value);
}

export function snapshotFrame(frame: Frame, contexts: ContextIds): FrameSnapshot {
  return {
    functionName: frame.code.name,
    functionId: frame.code.id,
    bytecodeOffset: frame.offset,
    registers: frame.registers.map((r) => snapshotValue(r)),
    accumulator: snapshotValue(frame.accumulator),
    contextId: contexts.of(frame.context),
  };
}

export function snapshotMap(map: V8Map): MapSnapshot {
  return {
    id: map.id,
    family: map.family,
    instanceType: map.instanceType,
    elementsKind: map.elementsKind,
    isDictionary: map.isDictionary,
    deprecated: map.deprecated,
    inObjectCapacity: map.inObjectCapacity,
    backPointer: map.back?.id ?? null,
    fields: map.descriptors.map((d) => ({ key: d.key, representation: d.representation, location: d.location, enumerable: d.attributes.enumerable })),
  };
}

/** One entry per feedback vector (the closures of one creation site share it), in the order the first closure was made. */
export function snapshotFeedback(objects: readonly HeapObject[]): FeedbackSnapshot[] {
  const seen = new Set<unknown>();
  const out: FeedbackSnapshot[] = [];
  for (const object of objects) {
    if (!(object instanceof JSFunction) || !object.code || seen.has(object.feedbackCell)) continue;
    seen.add(object.feedbackCell);
    const vector = object.feedbackCell.vectorOrUndefined();
    if (!vector) continue;
    const code: BytecodeFunction = object.code;
    out.push({
      functionId: code.id,
      functionName: code.name,
      slots: vector.slotIndices().map((index) => {
        const slot = vector.slot(index);
        return { index, kind: slotKindName(slot.kind), state: slot.state, mapIds: slot.maps.map((m) => m.id) };
      }),
    });
  }
  return out;
}

/** The elements kind of every array and every object that has indexed properties. */
export function snapshotElementsKinds(objects: readonly HeapObject[]): Record<ObjectId, ElementsKind> {
  const kinds: Record<ObjectId, ElementsKind> = {};
  for (const object of objects) {
    if (object instanceof JSArray || (object instanceof JSObject && !(object instanceof JSFunction) && object.elements.length > 0)) {
      kinds[object.id] = object.map.elementsKind;
    }
  }
  return kinds;
}
