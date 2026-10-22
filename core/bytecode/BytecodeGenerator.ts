import type { Statement } from "estree";
import type { ParsedProgram } from "@/core/frontend/parse";
import type { ScopeTree } from "@/core/frontend/scope/Scope";
import type { Diagnostic } from "@/core/shared/diagnostics";
import { type FunctionId, asFunctionId } from "@/core/shared/ids";
import { err, ok, type Result } from "@/core/shared/result";
import { type BytecodeFunction, type BytecodeProgram, finishFunction } from "./BytecodeProgram";
import { type FunctionCompiler, type FunctionLiteral, FunctionGenerator, NotYetSupported } from "./FunctionGenerator";

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

/** Hands out function ids as closures are created and keeps what each one compiled to. */
class ProgramCompiler implements FunctionCompiler {
  readonly functions: (BytecodeFunction | undefined)[] = [];
  readonly callPrinter: Record<number, string> = {};
  /** The object-literal methods, with where each one's source text starts (the key, not the `(`). */
  readonly #methods = new Map<FunctionLiteral, number>();

  constructor(
    private readonly program: ParsedProgram,
    private readonly scopes: ScopeTree,
  ) {}

  compileWrapper(): void {
    const id = this.reserve();
    const wrapper = new FunctionGenerator({
      source: this.program.source,
      scopes: this.scopes,
      scope: this.scopes.root,
      functions: this,
      parameterCount: wrapperParameterCount(this.scopes),
      localCount: this.scopes.root.stackSlots,
    });
    // V8 puts the implicit final `return undefined` on the last character of the file.
    wrapper.generateBody(this.program.ast.body as Statement[], Math.max(this.program.source.length - 1, 0));
    this.functions[id] = finishFunction(wrapper.builder, { id: asFunctionId(id), name: "", strict: this.scopes.root.strict, length: WRAPPER_LENGTH, children: wrapper.children });
  }

  compile(node: FunctionLiteral, name: string, debugName: string): FunctionId {
    const id = this.reserve();
    const scope = this.scopes.scopeOf.get(node);
    if (!scope) throw new Error("function without a scope");
    const generator = new FunctionGenerator({
      source: this.program.source,
      scopes: this.scopes,
      scope,
      functions: this,
      parameterCount: node.params.length + 1,
      localCount: scope.stackSlots,
    });
    generator.generateFunction(node);
    const methodStart = this.#methods.get(node);
    const sourceRange = { start: methodStart ?? node.range?.[0] ?? 0, end: node.range?.[1] ?? 0 };
    const constructable = node.type !== "ArrowFunctionExpression" && !scope.isAsync && methodStart === undefined;
    this.functions[id] = finishFunction(generator.builder, {
      id: asFunctionId(id),
      name: debugName,
      strict: scope.strict,
      constructable,
      sourceRange,
      kind: scope.isAsync ? "async" : "normal",
      length: formalLength(node),
      children: generator.children,
    });
    return asFunctionId(id);
  }

  markMethod(node: FunctionLiteral, start: number): void {
    this.#methods.set(node, start);
  }

  recordCallPrinter(position: number, text: string): void {
    this.callPrinter[position] = text;
  }

  private reserve(): number {
    this.functions.push(undefined);
    return this.functions.length - 1;
  }
}

/** `length` of the CommonJS wrapper: (exports, require, module, __filename, __dirname). */
const WRAPPER_LENGTH = 5;

/** ExpectedArgumentCount: the parameters before the first default or rest. */
function formalLength(node: FunctionLiteral): number {
  const first = node.params.findIndex((p) => p.type === "AssignmentPattern" || p.type === "RestElement");
  return first === -1 ? node.params.length : first;
}

export function generateBytecode(program: ParsedProgram, scopes: ScopeTree): Result<BytecodeProgram, Diagnostic[]> {
  try {
    const compiler = new ProgramCompiler(program, scopes);
    compiler.compileWrapper();
    return ok({ functions: compiler.functions.map((fn) => fn as BytecodeFunction), source: program.source, callPrinter: compiler.callPrinter });
  } catch (error) {
    if (error instanceof NotYetSupported) return err([notYetSupported(error, program.source)]);
    throw error;
  }
}
