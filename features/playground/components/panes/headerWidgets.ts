import { StateEffect, StateField, type Text } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, WidgetType } from "@codemirror/view";
import type { PaneHeader } from "./paneDocs";

// Function headings are block widgets, not document lines, so line i of the document stays line i of the LineIndex.

class HeaderWidget extends WidgetType {
  constructor(private readonly text: string) {
    super();
  }
  override eq(other: HeaderWidget): boolean {
    return other.text === this.text;
  }
  override toDOM(): HTMLElement {
    const el = document.createElement("div");
    el.className = "cm-sl-fn-header";
    el.textContent = this.text;
    return el;
  }
}

export const setHeaders = StateEffect.define<readonly PaneHeader[]>();

function build(doc: Text, headers: readonly PaneHeader[]): DecorationSet {
  const ranges = headers.map(({ line, text }) => {
    const widget = new HeaderWidget(text);
    // A function with no lines at the end of the pane has no line to precede; it follows the last one.
    return line < doc.lines
      ? Decoration.widget({ widget, block: true, side: -1 }).range(doc.line(line + 1).from)
      : Decoration.widget({ widget, block: true, side: 1 }).range(doc.length);
  });
  return Decoration.set(ranges, true);
}

export const headerField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    for (const effect of tr.effects) if (effect.is(setHeaders)) return build(tr.state.doc, effect.value);
    return tr.docChanged ? value.map(tr.changes) : value;
  },
  provide: (field) => EditorView.decorations.from(field),
});
