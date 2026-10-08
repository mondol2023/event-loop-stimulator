import type { Statement } from "estree";
import type { ParsedProgram } from "@/core/frontend/parse";
import type { ScopeTree } from "@/core/frontend/scope/Scope";
import type { Diagnostic } from "@/core/shared/diagnostics";
import { asFunctionId } from "@/core/shared/ids";
import { err, ok, type Result } from "@/core/shared/result";
import { type BytecodeProgram, finishFunction } from "./BytecodeProgram";
import { FunctionGenerator, NotYetSupported } from "./FunctionGenerator";

// Compiles a parsed script to Ignition bytecode, one BytecodeFunction per function, the CommonJS
// wrapper first. Constructs grow in families (PROMPT.md phase 2): anything not compiled yet comes
// back as an E_NOT_YET_SUPPORTED diagnostic naming the node, never as an exception.

const SUBSET_DOC = "docs/SUPPORTED_SUBSET.md";

/** The receiver plus the wrapper's declared parameters. */
function wrapperParameterCount(scopes: ScopeTree): number {
  return scopes.root.parameterNames.length + 1;
}

function notYetSupported(error: NotYetSupported, source: string): Diagnostic {
  const [start, end] = error.node.range ?? [0, source.length];
  return {
    code: "E_NOT_YET_SUPPORTED",
    message: error.message,
    range: { start, end },
    hint: "The bytecode generator covers the constructs listed as compiled in the supported subset; this one has no bytecode yet.",
    docs: SUBSET_DOC,
  };
}

export function generateBytecode(program: ParsedProgram, scopes: ScopeTree): Result<BytecodeProgram, Diagnostic[]> {
  try {
    const wrapper = new FunctionGenerator({
      source: program.source,
      scopes,
      parameterCount: wrapperParameterCount(scopes),
      localCount: scopes.root.stackSlots,
    });
    // V8 puts the implicit final `return undefined` on the last character of the file.
    wrapper.generateBody(program.ast.body as Statement[], Math.max(program.source.length - 1, 0));
    return ok({ functions: [finishFunction(wrapper.builder, { id: asFunctionId(0), name: "" })] });
  } catch (error) {
    if (error instanceof NotYetSupported) return err([notYetSupported(error, program.source)]);
    throw error;
  }
}
