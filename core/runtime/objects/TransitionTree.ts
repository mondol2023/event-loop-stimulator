import type { MapId } from "@/core/shared/ids";
import { isSmi } from "../values/Smi";
import type { JSValue } from "../values/JSValue";
import type { ElementsKind } from "./ElementsKind";
import {
  DEFAULT_ATTRIBUTES,
  FieldDescriptor,
  type InstanceType,
  type MapFamily,
  type PropertyAttributes,
  type Representation,
  V8Map,
} from "./V8Map";

const INSTANCE_TYPES: Record<MapFamily, InstanceType> = {
  "empty-object-literal": "JS_OBJECT_TYPE",
  "object-literal": "JS_OBJECT_TYPE",
  array: "JS_ARRAY_TYPE",
  function: "JS_FUNCTION_TYPE",
  promise: "JS_PROMISE_TYPE",
  error: "JS_ERROR_TYPE",
  generator: "JS_GENERATOR_OBJECT_TYPE",
};

function defaultElementsKind(family: MapFamily): ElementsKind {
  return family === "array" ? "PACKED_SMI_ELEMENTS" : "HOLEY_ELEMENTS";
}

/** `Object::OptimalRepresentation`: numbers are Smi or Double, every other value is a heap object. */
export function representationOf(value: JSValue): Representation {
  if (typeof value === "number") return isSmi(value) ? "Smi" : "Double";
  return "HeapObject";
}

/** Whether a field of representation `field` can hold a value of representation `value` as is. */
function covers(field: Representation, value: Representation): boolean {
  if (field === value || field === "Tagged") return true;
  return field === "Double" && value === "Smi";
}

/** `Representation::generalize`: Smi and Double make Double, anything with a heap object makes Tagged. */
function join(a: Representation, b: Representation): Representation {
  if (a === b) return a;
  if ((a === "Smi" && b === "Double") || (a === "Double" && b === "Smi")) return "Double";
  return "Tagged";
}

/** `Representation::CanBeInPlaceChangedTo` (src/objects/property-details.h): Double needs a box. */
function isInPlaceChange(from: Representation, to: Representation): boolean {
  return to === "Tagged" && (from === "Smi" || from === "HeapObject");
}

function transitionKey(key: string, attributes: PropertyAttributes): string {
  const bits = (attributes.writable ? 1 : 0) | (attributes.enumerable ? 2 : 0) | (attributes.configurable ? 4 : 0);
  return `${bits}:${key}`;
}

/**
 * The Map transition tree of one realm (src/objects/transitions.h). Roots are shared per
 * (family, in-object capacity, elements kind); each added field is a transition to a child Map.
 * Which operations make a new Map follows the recorded fixtures `maps-same-shape-vs-order` and
 * `maps-field-generalization`: Smi/HeapObject -> Tagged generalizes in place (the Map is kept),
 * while a change that needs a HeapNumber box deprecates the old Map and the transition now leads
 * to a new one. Objects still holding a deprecated Map migrate lazily, on their next write.
 * The prototype is not part of a modeled Map (a divergence from V8, noted in FIDELITY.md).
 */
export class TransitionTree {
  #nextId = 0;
  readonly #roots = new Map<string, V8Map>();
  readonly #all: V8Map[] = [];

  /** Every Map made so far, in id order. Read-only: the timeline's view of the hidden classes. */
  all(): readonly V8Map[] {
    return this.#all;
  }

  #register(map: V8Map): V8Map {
    this.#all.push(map);
    return map;
  }

  #newId(): MapId {
    this.#nextId += 1;
    return this.#nextId as MapId;
  }

  rootFor(family: MapFamily, inObjectCapacity: number, elementsKind: ElementsKind = defaultElementsKind(family)): V8Map {
    const key = `${family}:${inObjectCapacity}:${elementsKind}`;
    let root = this.#roots.get(key);
    if (!root) {
      root = this.#register(
        new V8Map({
          id: this.#newId(),
          family,
          instanceType: INSTANCE_TYPES[family],
          descriptors: [],
          inObjectCapacity,
          isDictionary: false,
          elementsKind,
        }),
      );
      this.#roots.set(key, root);
    }
    return root;
  }

  /** The Map after adding own property `key` holding `value`; reuses the existing transition. */
  addProperty(map: V8Map, key: string, value: JSValue, attributes: PropertyAttributes = DEFAULT_ATTRIBUTES): V8Map {
    if (map.isDictionary) throw new Error("addProperty on a dictionary-mode Map: the object owns its dictionary");
    return this.#ensureField(this.updateMap(map), key, attributes, representationOf(value));
  }

  /**
   * The Map an object of `map` needs after storing `value` into field `index` (`Map::GeneralizeField`).
   * Returns the up-to-date `map` itself for an in-place change or when the value already fits.
   */
  generalizeField(map: V8Map, index: number, value: JSValue): V8Map {
    const current = this.updateMap(map);
    const descriptor = current.descriptors[index];
    if (!descriptor) throw new Error(`no field ${index} in Map ${current.id}`);
    const wanted = representationOf(value);
    if (covers(descriptor.representation, wanted)) return current;
    let owner = current;
    while (owner.descriptors.length > index) {
      if (!owner.back) throw new Error("Map chain ended before the field owner");
      owner = owner.back;
    }
    this.#ensureField(owner, descriptor.key, descriptor.attributes, wanted);
    return this.updateMap(current);
  }

  /** `Map::Update`: the up-to-date Map for a possibly deprecated one, replayed from its root. */
  updateMap(map: V8Map): V8Map {
    if (!map.deprecated) return map;
    let current = map.root;
    for (const d of map.descriptors) current = this.#ensureField(current, d.key, d.attributes, d.representation);
    return current;
  }

  /** `Map::Normalize`: a dictionary-mode Map of its own (V8's normalized-map cache is not modeled). */
  normalize(map: V8Map): V8Map {
    return this.#dictionaryCopy(map, map.elementsKind);
  }

  /** The Map of the same shape with another elements kind (`Map::TransitionElementsTo`). */
  withElementsKind(map: V8Map, kind: ElementsKind): V8Map {
    if (map.elementsKind === kind) return map;
    if (map.isDictionary) return this.#dictionaryCopy(map, kind);
    let current = this.rootFor(map.family, map.inObjectCapacity, kind);
    for (const d of map.descriptors) current = this.#ensureField(current, d.key, d.attributes, d.representation);
    return current;
  }

  #dictionaryCopy(map: V8Map, elementsKind: ElementsKind): V8Map {
    return this.#register(
      new V8Map({
        id: this.#newId(),
        family: map.family,
        instanceType: map.instanceType,
        descriptors: [],
        inObjectCapacity: 0,
        isDictionary: true,
        elementsKind,
      }),
    );
  }

  #ensureField(parent: V8Map, key: string, attributes: PropertyAttributes, wanted: Representation): V8Map {
    const tk = transitionKey(key, attributes);
    const child = parent.transitions.get(tk);
    if (!child) return this.#addChild(parent, tk, key, attributes, wanted);
    const field = child.descriptors[parent.descriptors.length];
    if (!field) throw new Error("transition leads to a Map without the new field");
    if (covers(field.representation, wanted)) return child;
    const target = join(field.representation, wanted);
    if (isInPlaceChange(field.representation, target)) {
      field.generalizeInPlace(target);
      return child;
    }
    this.#deprecate(child);
    return this.#addChild(parent, tk, key, attributes, target);
  }

  #addChild(parent: V8Map, tk: string, key: string, attributes: PropertyAttributes, rep: Representation): V8Map {
    const index = parent.descriptors.length;
    const location = index < parent.inObjectCapacity ? "in-object" : "backing-store";
    const child = this.#register(
      new V8Map({
        id: this.#newId(),
        family: parent.family,
        instanceType: parent.instanceType,
        descriptors: [...parent.descriptors, new FieldDescriptor(key, attributes, location, rep)],
        inObjectCapacity: parent.inObjectCapacity,
        isDictionary: false,
        elementsKind: parent.elementsKind,
        back: parent,
        root: parent.root,
      }),
    );
    parent.transitions.set(tk, child);
    return child;
  }

  /** `Map::DeprecateTransitionTree`. */
  #deprecate(map: V8Map): void {
    map.markDeprecated();
    for (const next of map.transitions.values()) this.#deprecate(next);
  }
}
