import type { ParsedProgram } from "@/core/frontend/parse";
import type { ScopeTree } from "@/core/frontend/scope/Scope";
import type { Diagnostic } from "@/core/shared/diagnostics";
import { asFunctionId } from "@/core/shared/ids";
import { err, ok, type Result } from "@/core/shared/result";
import { BytecodeArrayBuilder } from "./BytecodeArrayBuilder";
import { type BytecodeProgram, finishFunction } from "./BytecodeProgram";

// Compiles a parsed script to Ignition bytecode, one BytecodeFunction per function, the CommonJS
// wrapper first. Constructs grow in families (PROMPT.md phase 2): anything not compiled yet comes
// back as an E_NOT_YET_SUPPORTED diagnostic naming the node, never as an exception.

const SUBSET_DOC = "docs/SUPPORTED_SUBSET.md";

/** The receiver plus the wrapper's declared parameters. */
function wrapperParameterCount(scopes: ScopeTree): number {
  return scopes.root.parameterNames.length + 1;
}

function notYetSupported(node: { readonly type: string; readonly range?: [number, number] | undefined }, source: string): Diagnostic {
  const [start, end] = node.range ?? [0, source.length];
  return {
    code: "E_NOT_YET_SUPPORTED",
    message: `${node.type} is not compiled to bytecode yet`,
    range: { start, end },
    hint: "The bytecode generator covers the constructs listed as compiled in the supported subset; this one has no bytecode yet.",
    docs: SUBSET_DOC,
  };
}

export function generateBytecode(program: ParsedProgram, scopes: ScopeTree): Result<BytecodeProgram, Diagnostic[]> {
  const unsupported = program.ast.body.map((statement) => notYetSupported(statement, program.source));
  if (unsupported.length > 0) return err(unsupported);

  const wrapper = new BytecodeArrayBuilder({ parameterCount: wrapperParameterCount(scopes) });
  wrapper.emit("LdaUndefined");
  // V8 puts the implicit final `return undefined` on the last character of the file.
  wrapper.setStatementPosition(Math.max(program.source.length - 1, 0));
  wrapper.emit("Return");
  return ok({ functions: [finishFunction(wrapper, { id: asFunctionId(0), name: "" })] });
}
