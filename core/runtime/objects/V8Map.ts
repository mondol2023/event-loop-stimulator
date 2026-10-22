import type { MapId } from "@/core/shared/ids";
import type { ElementsKind } from "./ElementsKind";

// V8's hidden class (`Map`, src/objects/map.h). Named V8Map so it never shadows the ES `Map`; the
// UI and narration still call it a Map. A Map is immutable shape data except for the three things
// V8 mutates too: a field's representation, its transition table and the deprecated bit. Those
// are changed only by `TransitionTree`.

/**
 * Counts the in-place changes a Map can undergo (a field's representation, the deprecated bit).
 * The timeline compares it, with the number of Maps, to know when its snapshots of them are stale.
 * It is a cache key and nothing else: it never influences a run.
 */
let mutationEpoch = 0;

export function mapMutationEpoch(): number {
  return mutationEpoch;
}

/** Field representations (src/objects/property-details.h Representation). */
export type Representation = "Smi" | "Double" | "HeapObject" | "Tagged";

export type FieldLocation = "in-object" | "backing-store";

export interface PropertyAttributes {
  readonly writable: boolean;
  readonly enumerable: boolean;
  readonly configurable: boolean;
}

export const DEFAULT_ATTRIBUTES: PropertyAttributes = { writable: true, enumerable: true, configurable: true };

export type MapFamily =
  | "empty-object-literal"
  | "object-literal"
  | "array"
  | "function"
  | "promise"
  | "error"
  | "generator"
  | "primitive-wrapper";

export type InstanceType =
  | "JS_OBJECT_TYPE"
  | "JS_ARRAY_TYPE"
  | "JS_FUNCTION_TYPE"
  | "JS_PROMISE_TYPE"
  | "JS_ERROR_TYPE"
  | "JS_GENERATOR_OBJECT_TYPE"
  | "JS_PRIMITIVE_WRAPPER_TYPE";

/**
 * One named field of a fast-mode Map (a DescriptorArray entry). The entry object is shared by a
 * Map and every descendant that inherits it, which is how an in-place representation
 * generalization reaches the whole subtree at once.
 */
export class FieldDescriptor {
  readonly key: string;
  readonly attributes: PropertyAttributes;
  readonly location: FieldLocation;
  #representation: Representation;

  constructor(key: string, attributes: PropertyAttributes, location: FieldLocation, representation: Representation) {
    this.key = key;
    this.attributes = attributes;
    this.location = location;
    this.#representation = representation;
  }

  get representation(): Representation {
    return this.#representation;
  }

  /** In-place generalization (`Map::GeneralizeField` when the change needs no migration). */
  generalizeInPlace(representation: Representation): void {
    this.#representation = representation;
    mutationEpoch += 1;
  }
}

export interface V8MapInit {
  readonly id: MapId;
  readonly family: MapFamily;
  readonly instanceType: InstanceType;
  readonly descriptors: readonly FieldDescriptor[];
  readonly inObjectCapacity: number;
  readonly isDictionary: boolean;
  readonly elementsKind: ElementsKind;
  readonly back?: V8Map;
  readonly root?: V8Map;
}

export class V8Map {
  readonly id: MapId;
  readonly family: MapFamily;
  readonly instanceType: InstanceType;
  readonly descriptors: readonly FieldDescriptor[];
  readonly inObjectCapacity: number;
  /** Dictionary ("slow") mode: the object owns its properties and the Map is not shared by shape. */
  readonly isDictionary: boolean;
  readonly elementsKind: ElementsKind;
  /** The Map this one transitioned from (`Map::GetBackPointer`). */
  readonly back: V8Map | undefined;
  /** The root of the transition tree this Map belongs to; itself for a root. */
  readonly root: V8Map;
  /** Outgoing transitions by attributes + key. Owned by `TransitionTree`. */
  readonly transitions = new Map<string, V8Map>();
  #deprecated = false;
  readonly #indexByKey = new Map<string, number>();

  constructor(init: V8MapInit) {
    this.id = init.id;
    this.family = init.family;
    this.instanceType = init.instanceType;
    this.descriptors = init.descriptors;
    this.inObjectCapacity = init.inObjectCapacity;
    this.isDictionary = init.isDictionary;
    this.elementsKind = init.elementsKind;
    this.back = init.back;
    this.root = init.root ?? this;
    init.descriptors.forEach((d, i) => this.#indexByKey.set(d.key, i));
  }

  get deprecated(): boolean {
    return this.#deprecated;
  }

  /** Tree-internal: `Map::DeprecateTransitionTree`. */
  markDeprecated(): void {
    this.#deprecated = true;
    mutationEpoch += 1;
  }

  /** Index of a named field in the descriptor array, or -1. */
  indexOf(key: string): number {
    return this.#indexByKey.get(key) ?? -1;
  }
}
