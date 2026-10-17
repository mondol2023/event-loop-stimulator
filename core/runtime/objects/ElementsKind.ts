import { isSmi } from "../values/Smi";
import type { JSValue } from "../values/JSValue";

// V8 src/objects/elements-kind.h. Only the kinds the subset can reach are modeled. Transitions
// move one way: SMI -> DOUBLE -> tagged, and PACKED -> HOLEY (src/objects/elements-kind.cc
// IsMoreGeneralElementsKindTransition).
export type ElementsKind =
  | "PACKED_SMI_ELEMENTS"
  | "HOLEY_SMI_ELEMENTS"
  | "PACKED_DOUBLE_ELEMENTS"
  | "HOLEY_DOUBLE_ELEMENTS"
  | "PACKED_ELEMENTS"
  | "HOLEY_ELEMENTS"
  | "DICTIONARY_ELEMENTS";

export function isHoleyKind(kind: ElementsKind): boolean {
  switch (kind) {
    case "HOLEY_SMI_ELEMENTS":
    case "HOLEY_DOUBLE_ELEMENTS":
    case "HOLEY_ELEMENTS":
      return true;
    case "PACKED_SMI_ELEMENTS":
    case "PACKED_DOUBLE_ELEMENTS":
    case "PACKED_ELEMENTS":
    case "DICTIONARY_ELEMENTS":
      return false;
    default:
      return kind satisfies never;
  }
}

function toHoley(kind: ElementsKind): ElementsKind {
  switch (kind) {
    case "PACKED_SMI_ELEMENTS":
      return "HOLEY_SMI_ELEMENTS";
    case "PACKED_DOUBLE_ELEMENTS":
      return "HOLEY_DOUBLE_ELEMENTS";
    case "PACKED_ELEMENTS":
      return "HOLEY_ELEMENTS";
    case "HOLEY_SMI_ELEMENTS":
    case "HOLEY_DOUBLE_ELEMENTS":
    case "HOLEY_ELEMENTS":
    case "DICTIONARY_ELEMENTS":
      return kind;
    default:
      return kind satisfies never;
  }
}

/** The kind an elements store needs after `value` (or a hole) is written into `from`. */
export function generalizeElementsKind(from: ElementsKind, value: JSValue | "hole"): ElementsKind {
  if (from === "DICTIONARY_ELEMENTS") return from;
  if (value === "hole") return toHoley(from);
  const holey = isHoleyKind(from);
  const wantsTagged = typeof value !== "number";
  const wantsDouble = typeof value === "number" && !isSmi(value);
  switch (from) {
    case "PACKED_SMI_ELEMENTS":
    case "HOLEY_SMI_ELEMENTS":
      if (wantsTagged) return holey ? "HOLEY_ELEMENTS" : "PACKED_ELEMENTS";
      if (wantsDouble) return holey ? "HOLEY_DOUBLE_ELEMENTS" : "PACKED_DOUBLE_ELEMENTS";
      return from;
    case "PACKED_DOUBLE_ELEMENTS":
    case "HOLEY_DOUBLE_ELEMENTS":
      return wantsTagged ? (holey ? "HOLEY_ELEMENTS" : "PACKED_ELEMENTS") : from;
    case "PACKED_ELEMENTS":
    case "HOLEY_ELEMENTS":
      return from;
    default:
      return from satisfies never;
  }
}
