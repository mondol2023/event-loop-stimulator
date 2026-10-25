import { type Diagnostic as LintDiagnostic, lintGutter, setDiagnostics } from "@codemirror/lint";
import type { EditorState, TransactionSpec } from "@codemirror/state";
import type { Diagnostic } from "@/core/shared/diagnostics";

/** The squiggle gutter and tooltip styling; fixed for the editor's lifetime so the diagnostics survive a language switch. */
export const diagnosticsExtension = lintGutter();

/** Maps our diagnostics to CodeMirror's, clamping each range into a document of `docLength`. */
export function toLintDiagnostics(diagnostics: readonly Diagnostic[], docLength: number): LintDiagnostic[] {
  return diagnostics.map((d) => {
    const from = Math.min(Math.max(d.range.start, 0), docLength);
    // An empty range would draw nothing; widen it by a character when there is one.
    const to = Math.min(Math.max(d.range.end, from + 1), docLength);
    return {
      from,
      to,
      severity: "error",
      source: d.code,
      message: `${d.message}\n${d.hint}`,
      renderMessage: () => {
        const el = document.createElement("div");
        const message = document.createElement("div");
        message.textContent = d.message;
        const hint = document.createElement("div");
        hint.textContent = d.hint;
        el.append(message, hint);
        return el;
      },
    };
  });
}

/** The transaction that replaces the editor's diagnostics (an empty list clears them). */
export function diagnosticsSpec(state: EditorState, diagnostics: readonly Diagnostic[]): TransactionSpec {
  return setDiagnostics(state, toLintDiagnostics(diagnostics, state.doc.length));
}
