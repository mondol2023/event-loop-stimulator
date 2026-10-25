// @vitest-environment jsdom
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";
import { highlightField, setHighlights } from "./highlightField";

const lines = (n: number): string => Array.from({ length: n }, (_, i) => `line ${i}`).join("\n");

const views: EditorView[] = [];
function mount(doc: string): EditorView {
  const view = new EditorView({ parent: document.body, state: EditorState.create({ doc, extensions: [highlightField] }) });
  views.push(view);
  return view;
}
afterEach(() => {
  for (const v of views.splice(0)) v.destroy();
});

const decorated = (view: EditorView): number => view.dom.querySelectorAll("[data-sl-highlight]").length;

describe("highlightField", () => {
  it("marks the current line with data-sl-highlight", () => {
    const view = mount(lines(5));
    view.dispatch({ effects: setHighlights.of({ current: [2], hovered: [] }) });
    const marked = view.dom.querySelectorAll('[data-sl-highlight="current"]');
    expect(marked).toHaveLength(1);
    expect(marked[0]?.textContent).toBe("line 2");
    expect(marked[0]?.classList.contains("cm-sl-current")).toBe(true);
  });

  it("marks hovered lines, and a line that is both", () => {
    const view = mount(lines(5));
    view.dispatch({ effects: setHighlights.of({ current: [1], hovered: [1, 3] }) });
    expect(view.dom.querySelectorAll(".cm-sl-hovered")).toHaveLength(2);
    expect(view.dom.querySelectorAll(".cm-sl-current")).toHaveLength(1);
  });

  // Review Focus 2: a shorter program arrives while line 30 is highlighted.
  it("drops lines past the document instead of throwing, and clears when the document is replaced", () => {
    const view = mount(lines(40));
    view.dispatch({ effects: setHighlights.of({ current: [30], hovered: [] }) });
    expect(decorated(view)).toBe(1);

    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: lines(3) } });
    expect(decorated(view)).toBe(0);

    expect(() => view.dispatch({ effects: setHighlights.of({ current: [30], hovered: [] }) })).not.toThrow();
    expect(decorated(view)).toBe(0);
  });

  it("ignores negative and fractional lines", () => {
    const view = mount(lines(3));
    expect(() => view.dispatch({ effects: setHighlights.of({ current: [-1, 1.5], hovered: [] }) })).not.toThrow();
    expect(decorated(view)).toBe(0);
  });
});
