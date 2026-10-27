import type { Extension, Text } from "@codemirror/state";
import type { Opcode } from "@/core/bytecode/bytecodes";
import { Decoration, type DecorationSet, EditorView, WidgetType } from "@codemirror/view";

// The feedback slot operand of a bytecode line becomes a link to its row in the IC table (PROMPT §8.3).
// The slot is the last `[n]` operand, and only of the opcodes that own a feedback slot: `[n]` is also a
// constant-pool or context index elsewhere, and linking those would send the learner to a row that is not theirs.

// Each of these ends in the Idx operand that is its feedback slot (core/bytecode/bytecodes.ts); `satisfies` fails the build on a misspelt or removed opcode.
const FEEDBACK_SLOT_OPCODES = [
  "LdaGlobal",
  "LdaGlobalInsideTypeof",
  "StaGlobal",
  "GetNamedProperty",
  "GetNamedPropertyFromSuper",
  "GetKeyedProperty",
  "GetEnumeratedKeyedProperty",
  "SetNamedProperty",
  "DefineNamedOwnProperty",
  "SetKeyedProperty",
  "DefineKeyedOwnProperty",
  "StaInArrayLiteral",
  "DefineKeyedOwnPropertyInLiteral",
  "Add",
  "Sub",
  "Mul",
  "Div",
  "Mod",
  "Exp",
  "BitwiseOr",
  "BitwiseXor",
  "BitwiseAnd",
  "ShiftLeft",
  "ShiftRight",
  "ShiftRightLogical",
  "AddSmi",
  "SubSmi",
  "MulSmi",
  "DivSmi",
  "ModSmi",
  "ExpSmi",
  "BitwiseOrSmi",
  "BitwiseXorSmi",
  "BitwiseAndSmi",
  "ShiftLeftSmi",
  "ShiftRightSmi",
  "ShiftRightLogicalSmi",
  "Inc",
  "Dec",
  "Negate",
  "BitwiseNot",
  "TypeOf",
  "ToNumber",
  "ToNumeric",
  "CallAnyReceiver",
  "CallProperty",
  "CallProperty0",
  "CallProperty1",
  "CallProperty2",
  "CallUndefinedReceiver",
  "CallUndefinedReceiver0",
  "CallUndefinedReceiver1",
  "CallUndefinedReceiver2",
  "CallWithSpread",
  "Construct",
  "ConstructWithSpread",
  "ConstructForwardAllArgs",
  "TestEqual",
  "TestEqualStrict",
  "TestLessThan",
  "TestGreaterThan",
  "TestLessThanOrEqual",
  "TestGreaterThanOrEqual",
  "TestInstanceOf",
  "TestIn",
  "CreateRegExpLiteral",
  "CreateArrayLiteral",
  "CreateEmptyArrayLiteral",
  "CreateObjectLiteral",
  "CloneObject",
  "GetTemplateObject",
  "CreateClosure",
  "ForInPrepare",
  "ForInNext",
  "GetIterator",
] as const satisfies readonly Opcode[];

export const OWNS_FEEDBACK_SLOT: ReadonlySet<string> = new Set(FEEDBACK_SLOT_OPCODES);

export type SlotLink = {
  /** 0-based line of the pane document. */
  readonly line: number;
  /** Column range of the `[n]` text within that line. */
  readonly from: number;
  readonly to: number;
  readonly functionId: number;
  readonly slot: number;
  readonly text: string;
};

type LinkableFunction = { readonly functionId: number; readonly lines: readonly { readonly text: string; readonly offset: number }[] };

/** The slot links of the bytecode pane's lines; each line of the document is `offset` padded to 4, two spaces, then the instruction (paneDocs.ts). */
export function slotLinksOf(functions: readonly LinkableFunction[]): SlotLink[] {
  const links: SlotLink[] = [];
  let line = 0;
  for (const fn of functions) {
    for (const l of fn.lines) {
      // Greedy, so it is the last `[n]`; flags print as `#n` and may follow it (CreateArrayLiteral [0], [0], #37).
      const match = /^(\w+)\b.*(\[(\d+)\])((?:, #\d+)*)$/.exec(l.text);
      const opcode = match?.[1];
      const operand = match?.[2];
      const slot = match?.[3];
      const trailing = match?.[4] ?? "";
      if (opcode !== undefined && operand !== undefined && slot !== undefined && OWNS_FEEDBACK_SLOT.has(opcode)) {
        const from = String(l.offset).padStart(4).length + 2 + l.text.length - trailing.length - operand.length;
        links.push({ line, from, to: from + operand.length, functionId: fn.functionId, slot: Number(slot), text: operand });
      }
      line++;
    }
  }
  return links;
}

class SlotLinkWidget extends WidgetType {
  constructor(
    private readonly link: SlotLink,
    private readonly onSelect: (link: SlotLink) => void,
  ) {
    super();
  }
  override eq(other: SlotLinkWidget): boolean {
    return other.link.functionId === this.link.functionId && other.link.slot === this.link.slot && other.link.text === this.link.text;
  }
  override toDOM(): HTMLElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "cm-sl-slot-link";
    button.textContent = this.link.text;
    button.dataset["functionId"] = String(this.link.functionId);
    button.dataset["slot"] = String(this.link.slot);
    button.setAttribute("aria-label", `Show feedback slot ${this.link.slot} in the inline cache table`);
    button.addEventListener("click", () => this.onSelect(this.link));
    return button;
  }
  override ignoreEvent(): boolean {
    return true;
  }
}

function build(doc: Text, links: readonly SlotLink[], onSelect: (link: SlotLink) => void): DecorationSet {
  const ranges = links.flatMap((link) => {
    // A stale link list (the document changed first) must not throw or hide other text.
    if (link.line >= doc.lines) return [];
    const line = doc.line(link.line + 1);
    if (doc.sliceString(line.from + link.from, line.from + link.to) !== link.text) return [];
    return [Decoration.replace({ widget: new SlotLinkWidget(link, onSelect) }).range(line.from + link.from, line.from + link.to)];
  });
  return Decoration.set(ranges, true);
}

/** Replaces each linked `[n]` with a button, keeping the document text (and so line numbers and offsets) as it is. */
export function slotLinkExtension(links: readonly SlotLink[], onSelect: (link: SlotLink) => void): Extension {
  return EditorView.decorations.compute(["doc"], (state) => build(state.doc, links, onSelect));
}
