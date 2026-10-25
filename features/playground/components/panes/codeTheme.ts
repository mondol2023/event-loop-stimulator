import { syntaxHighlighting } from "@codemirror/language";
import { classHighlighter } from "@lezer/highlight";
import { EditorView } from "@codemirror/view";

// Colors are the app's semantic tokens (CSS variables), so the editors follow the light/dark theme with no per-theme code.
const highlightTheme = EditorView.theme({
  "&": { height: "100%", backgroundColor: "var(--panel)", color: "var(--foreground)", fontSize: "0.875rem" },
  "&.cm-focused": { outline: "2px solid var(--ring)", outlineOffset: "-2px" },
  ".cm-scroller": { fontFamily: "var(--font-jetbrains-mono), ui-monospace, monospace", lineHeight: "1.6", overflow: "auto" },
  // CodeMirror sets tab-size through a style attribute, which the CSP blocks, so the stylesheet carries it.
  ".cm-content": { caretColor: "var(--foreground)", tabSize: "2" },
  // CSP: CodeMirror hides each gutter's width spacer with `style.cssText`, which style-src 'nonce-…' blocks, so hide it here.
  ".cm-gutter > .cm-gutterElement:first-child": { visibility: "hidden", pointerEvents: "none" },
  ".cm-gutters": { backgroundColor: "var(--panel)", color: "var(--muted-foreground)", border: "none" },
  ".cm-activeLine, .cm-activeLineGutter": { backgroundColor: "transparent" },
  ".cm-selectionBackground, &.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground": {
    backgroundColor: "color-mix(in oklab, var(--primary) 28%, transparent)",
  },
  // Where execution is: a filled line with an edge bar. What the pointer is over: an outline, so the two read apart.
  ".cm-sl-current": { backgroundColor: "color-mix(in oklab, var(--primary) 16%, transparent)", boxShadow: "inset 3px 0 0 var(--primary)" },
  ".cm-sl-hovered": { outline: "1px solid var(--webapi)", outlineOffset: "-1px" },
  ".cm-sl-fn-header": {
    // No margin: CodeMirror measures a block widget without it, so the gutter would drift out of line with the text.
    padding: "0.5rem 0.5rem 0.25rem",
    color: "var(--muted-foreground)",
    borderBottom: "1px solid var(--border)",
    fontWeight: "600",
  },
  ".tok-keyword, .tok-operatorKeyword, .tok-modifier": { color: "var(--microtask)" },
  ".tok-string, .tok-string2": { color: "var(--webapi)" },
  ".tok-number, .tok-bool, .tok-null": { color: "var(--macrotask)" },
  ".tok-comment": { color: "var(--muted-foreground)", fontStyle: "italic" },
  ".tok-variableName.tok-definition, .tok-propertyName.tok-definition": { color: "var(--primary)" },
});

export const codeTheme = [highlightTheme, syntaxHighlighting(classHighlighter)];
