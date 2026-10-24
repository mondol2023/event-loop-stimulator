import type { Program } from "estree";
import { generateBytecode } from "@/core/bytecode/BytecodeGenerator";
import type { BytecodeProgram } from "@/core/bytecode/BytecodeProgram";
import { parseScript } from "@/core/frontend/parse";
import type { ScopeTree } from "@/core/frontend/scope/Scope";
import { analyzeScopes } from "@/core/frontend/scope/ScopeAnalyzer";
import { stripTypes } from "@/core/frontend/strip-types";
import { checkSourceLimits, validateSubset } from "@/core/frontend/subset/validator";
import type { Diagnostic } from "@/core/shared/diagnostics";
import type { FunctionId } from "@/core/shared/ids";
import { type AstViewOutput, astView } from "@/core/views/AstView";
import { type AsmViewOutput, asmView } from "@/core/views/AsmView";
import { type BinaryViewOutput, binaryView } from "@/core/views/BinaryView";
import { type BytecodeViewOutput, bytecodeView } from "@/core/views/BytecodeView";

// The compile pipeline in one place (PROMPT.md §7.2): BOM -> limits -> type strip -> parse ->
// scopes -> subset validation -> bytecode -> views. The first stage to report anything stops the
// pipeline, so a program only exists when every earlier stage was clean. Source is never executed.

export type Language = "js" | "ts";

/**
 * Test-only compile options. `natives` compiles `%Name(args)` to `CallRuntime [Name]` (Decision
 * D2). It is in no input schema, so nothing a user sends can turn it on.
 */
export type CompileOptions = { readonly natives?: boolean };

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
  readonly views?: {
    readonly ast: AstViewOutput;
    readonly bytecode: BytecodeViewOutput;
    readonly asm: AsmViewOutput;
    readonly binary: BinaryViewOutput;
  };
};

const BOM = 0xfeff;

function tooDeep(source: string): Diagnostic {
  return {
    code: "E_NOT_YET_SUPPORTED",
    message: "The program is nested too deeply to compile.",
    range: { start: 0, end: Math.min(1, source.length) },
    hint: "Split the long expression or the deep nesting into several statements.",
  };
}

/**
 * Runs a lazily computed code view without ever throwing (compile() promises "never throws", and a getter runs after
 * its try/catch has gone). A failure, such as a stack overflow in deep code, is reported the way the views already
 * report a baseline failure: every function listed, with no lines and the reason in `unavailable`.
 */
function safeView<T extends { readonly functions: readonly unknown[] }>(
  view: { emit(program: BytecodeProgram, context: { source: string; ast: Program }): T },
  program: BytecodeProgram,
  context: { source: string; ast: Program },
  unavailable: (functions: readonly UnavailableFunction[]) => T,
): T {
  try {
    return view.emit(program, context);
  } catch (error) {
    // A RangeError is the known template/nesting failure; anything else is a bug, so it is not labelled as one.
    const reason = error instanceof RangeError ? `E_TEMPLATE: ${error.message}` : `E_INTERNAL: ${error instanceof Error ? error.message : String(error)}`;
    return unavailable(program.functions.map((fn) => ({ functionId: fn.id, name: fn.name, lines: [], unavailable: reason })));
  }
}

type UnavailableFunction = { readonly functionId: FunctionId; readonly name: string; readonly lines: readonly never[]; readonly unavailable: string };

export class CompilationManager {
  /** Never throws, whatever the string. */
  compile(source: string, lang: Language, opts: CompileOptions = {}): CompilationResult {
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

    const parsed = parseScript(js, { natives: opts.natives ?? false });
    if (!parsed.ok) return { diagnostics: parsed.error, hasBom, strippedJs: js };
    const { ast } = parsed.value;

    // A program the front end cannot walk without overflowing the stack (a chain of thousands of
    // member accesses fits in the size limit) is a diagnostic, not an exception.
    try {
      const scopes = analyzeScopes(parsed.value);
      const refused = validateSubset(parsed.value, scopes);
      if (refused.length > 0) return { diagnostics: refused, hasBom, strippedJs: js, ast, scopes };

      const generated = generateBytecode(parsed.value, scopes);
      if (!generated.ok) return { diagnostics: generated.error, hasBom, strippedJs: js, ast, scopes };

      const program = generated.value;
      const context = { source: js, ast };
      const memo: { asm?: AsmViewOutput; binary?: BinaryViewOutput } = {};
      return {
        diagnostics: [],
        hasBom,
        strippedJs: js,
        ast,
        scopes,
        program,
        // The asm and binary views run the baseline code generator (about half of compile() time on a large
        // program) and simulate() never reads them, so they are computed on first access and then kept.
        views: {
          ast: astView.emit(program, context),
          bytecode: bytecodeView.emit(program, context),
          get asm() {
            return memo.asm ?? (memo.asm = safeView(asmView, program, context, (functions) => ({ functions })));
          },
          get binary() {
            return memo.binary ?? (memo.binary = safeView(binaryView, program, context, (functions) => ({ functions })));
          },
        },
      };
    } catch (error) {
      if (error instanceof RangeError) return { diagnostics: [tooDeep(js)], hasBom, strippedJs: js };
      throw error;
    }
  }
}
