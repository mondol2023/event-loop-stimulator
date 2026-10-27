import type { BusKind } from "@/core/hardware/classifyInstruction";

export type BusToken = "mutedForeground" | "busRead" | "busWrite";

/** The token colour of a pulse: fetch is neutral, read blue, write pink. */
export function busToken(kind: BusKind): BusToken {
  switch (kind) {
    case "fetch":
      return "mutedForeground";
    case "read":
      return "busRead";
    case "write":
      return "busWrite";
    default: {
      const never: never = kind;
      return never;
    }
  }
}

/** A write travels from the die toward RAM; a fetch or read travels back toward the die. */
export function travelsTowardRam(kind: BusKind): boolean {
  switch (kind) {
    case "write":
      return true;
    case "fetch":
    case "read":
      return false;
    default: {
      const never: never = kind;
      return never;
    }
  }
}
