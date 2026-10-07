import { parse } from "@babel/parser";
import type { Program } from "estree";
import type { Diagnostic } from "@/core/shared/diagnostics";
import { err, ok, type Result } from "@/core/shared/result";
import { hasUseStrictDirective } from "./ast";

// Parse a script to ESTree (@babel/parser with the `estree` plugin). The user's
// source is only parsed here, never executed.
//
// The script is the body of the CommonJS wrapper function, so a top-level
// `return` and `new.target` are legal. Babel recovers from many errors and still
// returns a tree (`let x; let x;`, `1 = 2`, `await 1`, ...); every recovered
// error becomes a diagnostic so a recovered tree can never reach later stages.

export type ParsedProgram = {
  /** ESTree; every node carries `range: [start, end]` in UTF-16 code units. */
  readonly ast: Program;
  /** True when the script starts with a `"use strict"` directive. */
  readonly strict: boolean;
  /** The text that was parsed; offsets in `ast` index into it. */
  readonly source: string;
};

const SUBSET_DOC = "docs/SUPPORTED_SUBSET.md";
const MODULE_ONLY = /'import' and 'export'|'await' is only allowed|\bimport\b.*\bsourceType\b/;

type BabelError = { message: string; pos?: number; loc?: { index?: number } };

function errorPosition(error: BabelError, source: string): number {
  const pos = error.pos ?? error.loc?.index ?? 0;
  return Math.min(Math.max(pos, 0), source.length);
}

/** Babel reports only a start position: extend over an identifier there, else one code unit. */
function errorRange(source: string, start: number): { start: number; end: number } {
  const identifier = /[\p{ID_Continue}$‌‍]+/uy;
  identifier.lastIndex = start;
  const m = identifier.exec(source);
  const end = m ? start + m[0].length : Math.min(start + 1, source.length);
  return { start, end: Math.max(end, Math.min(start + 1, source.length)) };
}

function toDiagnostic(error: BabelError, source: string): Diagnostic {
  const start = errorPosition(error, source);
  const message = error.message.replace(/\s*\(\d+:\d+\)$/, "");
  const hint = MODULE_ONLY.test(message)
    ? `Modules and top-level await are outside the supported subset; the script runs as one CommonJS file. See ${SUBSET_DOC}.`
    : "Fix the syntax error. The playground reports syntax errors with its own message, not V8's.";
  return { code: "E_SYNTAX", message, range: errorRange(source, start), hint };
}

export function parseScript(js: string): Result<ParsedProgram, Diagnostic[]> {
  if (js.charCodeAt(0) === 0xfeff) {
    return err([
      {
        code: "E_SYNTAX",
        message: "Unexpected byte order mark at the start of the source",
        range: { start: 0, end: 1 },
        hint: "Strip the BOM before parsing: V8 never sees it, and source offsets are relative to the BOM-less text.",
      },
    ]);
  }

  let file: ReturnType<typeof parse>;
  try {
    file = parse(js, {
      sourceType: "script",
      plugins: ["estree"],
      ranges: true,
      errorRecovery: true,
      allowReturnOutsideFunction: true,
      allowNewTargetOutsideFunction: true,
    });
  } catch (error) {
    return err([toDiagnostic(error as BabelError, js)]);
  }

  const recovered = (file.errors ?? []) as BabelError[];
  if (recovered.length > 0) {
    return err(recovered.map((e) => toDiagnostic(e, js)).sort((a, b) => a.range.start - b.range.start));
  }

  const ast = file.program as unknown as Program;
  return ok({ ast, strict: hasUseStrictDirective(ast.body), source: js });
}
