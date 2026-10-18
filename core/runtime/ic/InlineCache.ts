import type { V8Map } from "../objects/V8Map";
import type { FeedbackVector, IcState } from "./FeedbackVector";

// The state machine of an inline cache (src/ic/ic.cc, src/ic/stub-cache.h):
// UNINITIALIZED -> MONOMORPHIC -> POLYMORPHIC -> MEGAMORPHIC. It only moves forward.

/** `v8_flags.max_valid_polymorphic_map_count` (src/flags/flag-definitions.h): a fifth Map makes the site megamorphic. */
export const MAX_POLYMORPHIC_MAPS = 4;

export class InlineCache {
  readonly #vector: FeedbackVector;

  constructor(vector: FeedbackVector) {
    this.#vector = vector;
  }

  state(slot: number): IcState {
    return this.#vector.slot(slot).state;
  }

  /** The Maps a monomorphic or polymorphic slot has seen, in the order it saw them. */
  maps(slot: number): readonly V8Map[] {
    return this.#vector.slot(slot).maps;
  }

  /** Records that the site at `slot` handled a receiver with `map`; returns the state afterwards. */
  update(slot: number, map: V8Map): IcState {
    const entry = this.#vector.slot(slot);
    if (entry.state === "MEGAMORPHIC" || entry.maps.includes(map)) return entry.state;
    const seen = [...entry.maps, map];
    if (seen.length > MAX_POLYMORPHIC_MAPS) {
      entry.state = "MEGAMORPHIC";
      entry.maps = [];
    } else {
      entry.state = seen.length === 1 ? "MONOMORPHIC" : "POLYMORPHIC";
      entry.maps = seen;
    }
    return entry.state;
  }
}
