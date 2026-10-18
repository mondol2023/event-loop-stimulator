import type { BytecodeFunction } from "@/core/bytecode/BytecodeProgram";
import type { Opcode } from "@/core/bytecode/bytecodes";
import type { V8Map } from "../objects/V8Map";

// V8's FeedbackVector (src/objects/feedback-vector.h): one slot per inline-cache site of a
// function. The model allocates it eagerly, when the closure is created, which is what
// `--no-lazy-feedback-allocation` gives real V8 (docs/FIDELITY.md notes the lazy default).

export type IcState = "UNINITIALIZED" | "MONOMORPHIC" | "POLYMORPHIC" | "MEGAMORPHIC";

/** The property-access slot kinds of `FeedbackSlotKind` (src/objects/feedback-vector.h) the model keeps. */
export type IcSlotKind =
  | "kLoadProperty"
  | "kLoadKeyed"
  | "kSetNamedSloppy"
  | "kSetNamedStrict"
  | "kSetKeyedSloppy"
  | "kSetKeyedStrict"
  | "kDefineNamedOwn"
  | "kStoreInArrayLiteral";

/** `FeedbackMetadata::Kind2String`, which is what `%DebugPrint` prints after `slot #N`. */
export function slotKindName(kind: IcSlotKind): string {
  switch (kind) {
    case "kLoadProperty":
      return "LoadProperty";
    case "kLoadKeyed":
      return "LoadKeyed";
    case "kSetNamedSloppy":
      return "SetNamedSloppy";
    case "kSetNamedStrict":
      return "SetNamedStrict";
    case "kSetKeyedSloppy":
      return "SetKeyedSloppy";
    case "kSetKeyedStrict":
      return "SetKeyedStrict";
    case "kDefineNamedOwn":
      return "DefineNamedOwn";
    case "kStoreInArrayLiteral":
      return "StoreInArrayLiteral";
    default:
      return kind satisfies never;
  }
}

/** One inline-cache site: its kind, its state, and the receiver Maps it has seen (empty once megamorphic). */
export class FeedbackSlot {
  readonly kind: IcSlotKind;
  state: IcState = "UNINITIALIZED";
  maps: readonly V8Map[] = [];

  constructor(kind: IcSlotKind) {
    this.kind = kind;
  }
}

/** The slot kind an instruction's feedback-slot operand has, and which operand holds the slot. */
function slotUse(opcode: Opcode, strict: boolean): { kind: IcSlotKind; operand: number } | undefined {
  switch (opcode) {
    case "GetNamedProperty":
      return { kind: "kLoadProperty", operand: 2 };
    case "GetKeyedProperty":
      return { kind: "kLoadKeyed", operand: 1 };
    case "SetNamedProperty":
      return { kind: strict ? "kSetNamedStrict" : "kSetNamedSloppy", operand: 2 };
    case "SetKeyedProperty":
      return { kind: strict ? "kSetKeyedStrict" : "kSetKeyedSloppy", operand: 2 };
    case "DefineNamedOwnProperty":
      return { kind: "kDefineNamedOwn", operand: 2 };
    case "StaInArrayLiteral":
      return { kind: "kStoreInArrayLiteral", operand: 2 };
    default:
      return undefined;
  }
}

export class FeedbackVector {
  readonly #slots = new Map<number, FeedbackSlot>();

  /** A vector with exactly these slots; `index` is the first entry of the slot, as the bytecode names it. */
  static fromSlots(slots: readonly { readonly index: number; readonly kind: IcSlotKind }[]): FeedbackVector {
    const vector = new FeedbackVector();
    for (const { index, kind } of slots) vector.#slots.set(index, new FeedbackSlot(kind));
    return vector;
  }

  /**
   * The vector for `code`: a slot at every index a property-access instruction names, with the kind
   * that instruction implies (the generator's FeedbackVectorSpec assigns the same kinds).
   */
  static forFunction(code: BytecodeFunction): FeedbackVector {
    const found = new Map<number, IcSlotKind>();
    for (const instr of code.array.instructions) {
      const use = slotUse(instr.opcode, code.strict);
      if (!use) continue;
      const index = instr.operands[use.operand];
      if (typeof index !== "number") throw new Error(`${instr.opcode} operand ${use.operand} is not a feedback slot`);
      const earlier = found.get(index);
      if (earlier !== undefined && earlier !== use.kind) throw new Error(`feedback slot ${index} is used as both ${earlier} and ${use.kind}`);
      found.set(index, use.kind);
    }
    return FeedbackVector.fromSlots([...found].map(([index, kind]) => ({ index, kind })));
  }

  slot(index: number): FeedbackSlot {
    const slot = this.#slots.get(index);
    if (!slot) throw new Error(`the feedback vector has no inline-cache slot ${index}`);
    return slot;
  }

  /** The first index of every slot, ascending (the order `%DebugPrint` lists them). */
  slotIndices(): number[] {
    return [...this.#slots.keys()].sort((a, b) => a - b);
  }
}
