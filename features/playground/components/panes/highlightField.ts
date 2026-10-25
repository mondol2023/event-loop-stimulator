import { StateEffect, StateField, type Text } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView } from "@codemirror/view";

export type HighlightSet = { readonly current: readonly number[]; readonly hovered: readonly number[] };

export const setHighlights = StateEffect.define<HighlightSet>();

function build(doc: Text, { current, hovered }: HighlightSet): DecorationSet {
  const marks: Record<number, { current: boolean; hovered: boolean }> = {};
  // A line number from an older program can lie past this document; CodeMirror throws a RangeError for it.
  const mark = (line: number, kind: "current" | "hovered"): void => {
    if (!Number.isInteger(line) || line < 0 || line >= doc.lines) return;
    (marks[line] ??= { current: false, hovered: false })[kind] = true;
  };
  current.forEach((l) => mark(l, "current"));
  hovered.forEach((l) => mark(l, "hovered"));
  const ranges = Object.entries(marks).map(([line, m]) => {
    const kinds = [m.current ? "current" : null, m.hovered ? "hovered" : null].filter((k) => k !== null);
    return Decoration.line({
      class: kinds.map((k) => `cm-sl-${k}`).join(" "),
      attributes: { "data-sl-highlight": kinds.join(" ") },
    }).range(doc.line(Number(line) + 1).from);
  });
  return Decoration.set(ranges, true);
}

/** Line decorations for where execution is (`current`) and what the pointer is over (`hovered`). */
export const highlightField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    for (const effect of tr.effects) if (effect.is(setHighlights)) return build(tr.state.doc, effect.value);
    // Lines belong to the previous text: the owner re-sends the highlights for the new document.
    return tr.docChanged ? Decoration.none : value;
  },
  provide: (field) => EditorView.decorations.from(field),
});

