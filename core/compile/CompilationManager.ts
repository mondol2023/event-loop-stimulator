import type { Program } from "estree";
import { generateBytecode } from "@/core/bytecode/BytecodeGenerator";
import type { BytecodeProgram } from "@/core/bytecode/BytecodeProgram";
import { parseScript } from "@/core/frontend/parse";
import type { ScopeTree } from "@/core/frontend/scope/Scope";
import { analyzeScopes } from "@/core/frontend/scope/ScopeAnalyzer";
import { stripTypes } from "@/core/frontend/strip-types";
import { checkSourceLimits, validateSubset } from "@/core/frontend/subset/validator";
import type { Diagnostic } from "@/core/shared/diagnostics";
import { type AstViewOutput, astView } from "@/core/views/AstView";
import { type BytecodeViewOutput, bytecodeView } from "@/core/views/BytecodeView";

// The compile pipeline in one place (PROMPT.md §7.2): BOM -> limits -> type strip -> parse ->
// scopes -> subset validation -> bytecode -> views. The first stage to report anything stops the
// pipeline, so a program only exists when every earlier stage was clean. Source is never executed.

export type Language = "js" | "ts";

export type CompilationResult = {
  /** Empty exactly when `program` exists. */
  readonly diagnostics: Diagnostic[];
  /** True when the input began with a byte order mark. It is removed before anything else. */
  readonly hasBom: boolean;
  /**
   * The JavaScript the later stages saw: the input without its BOM and, for TypeScript, with types
   * erased in place. Every range in `diagnostics`, `ast` and `program` indexes into this text, and
   * for TypeScript it has the same length as the BOM-less input.
   */
  readonly strippedJs?: string;
  readonly ast?: Program;
  readonly scopes?: ScopeTree;
  readonly program?: BytecodeProgram;
  readonly views?: { readonly ast: AstViewOutput; readonly bytecode: BytecodeViewOutput };
};

const BOM = 0xfeff;

export class CompilationManager {
  /** Never throws, whatever the string. */
  compile(source: string, lang: Language): CompilationResult {
    const hasBom = source.charCodeAt(0) === BOM;
    // V8 never sees the BOM, so offsets are relative to the text without it. Only one is removed.
    const text = hasBom ? source.slice(1) : source;

    const limits = checkSourceLimits(text);
    if (limits.length > 0) return { diagnostics: limits, hasBom };

    let js = text;
    if (lang === "ts") {
      const stripped = stripTypes(text);
      if (!stripped.ok) return { diagnostics: stripped.error, hasBom };
      js = stripped.value;
    }

    const parsed = parseScript(js);
    if (!parsed.ok) return { diagnostics: parsed.error, hasBom, strippedJs: js };
    const { ast } = parsed.value;

    const scopes = analyzeScopes(parsed.value);
    const refused = validateSubset(parsed.value, scopes);
    if (refused.length > 0) return { diagnostics: refused, hasBom, strippedJs: js, ast, scopes };

    const generated = generateBytecode(parsed.value, scopes);
    if (!generated.ok) return { diagnostics: generated.error, hasBom, strippedJs: js, ast, scopes };

    const program = generated.value;
    const context = { source: js, ast };
    return {
      diagnostics: [],
      hasBom,
      strippedJs: js,
      ast,
      scopes,
      program,
      views: { ast: astView.emit(program, context), bytecode: bytecodeView.emit(program, context) },
    };
  }
}
