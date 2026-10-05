// Diagnostics: what we tell the user when their source cannot be handled.

/** A half-open range of UTF-16 code-unit offsets into the source: `end` is exclusive. */
export type SourceRange = { readonly start: number; readonly end: number };

export type DiagnosticCode =
  | "E_SYNTAX"
  | "E_TS_UNSUPPORTED"
  | "E_EXCLUDED_FEATURE"
  | "E_EXCLUDED_API"
  | "E_NOT_YET_SUPPORTED"
  | "E_LIMIT_SOURCE_SIZE"
  | "E_LIMIT_LINES";

export type Diagnostic = {
  readonly code: DiagnosticCode;
  readonly message: string;
  readonly range: SourceRange;
  readonly hint: string;
  readonly docs?: string;
};

/**
 * The 1-based line and 0-based column (UTF-16 units) of `offset` in `source`.
 * `\n`, `\r\n` and a lone `\r` each end one line. An offset past the end is
 * clamped to the end of the source.
 */
export function lineColumn(source: string, offset: number): { line: number; column: number } {
  const end = Math.min(Math.max(offset, 0), source.length);
  let line = 1;
  let lineStart = 0;
  for (let i = 0; i < end; i++) {
    const c = source.charCodeAt(i);
    if (c === 10) {
      line++;
      lineStart = i + 1;
    } else if (c === 13) {
      if (source.charCodeAt(i + 1) === 10) {
        // `\r\n`: the line break completes at the `\n`. If the offset points
        // between the two, it still sits on the old line.
        if (i + 1 >= end) continue;
        i++;
      }
      line++;
      lineStart = i + 1;
    }
  }
  return { line, column: end - lineStart };
}
