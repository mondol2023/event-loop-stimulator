import { CompilationManager, type Language } from "@/core/compile/CompilationManager";
import { printUncaught } from "@/core/host/errorPrinter";
import { IgnitionInterpreter, NO_OBSERVER } from "@/core/interpreter/IgnitionInterpreter";
import { Realm } from "@/core/runtime/Realm";
import { inspect } from "@/core/runtime/builtins/inspect";
import { positionOf } from "@/core/runtime/stack";
import type { Diagnostic } from "@/core/shared/diagnostics";
import { SimulationHalt, type SimulationStop } from "@/core/shared/simulationHalt";
import { sourceRangeForPos } from "@/core/views/types";

// The whole pipeline for one program: compile, run the CommonJS wrapper on a fresh realm, and
// print an uncaught exception the way Node's fatal-exception handler does. This is the minimal,
// synchronous version: no event loop yet (Task 17), no ticks or timeline (Tasks 19 and 20).

/** Test-only host modes (D7) arrive with the test262 harness; only Node is modeled so far. */
export type SimulationOptions = { readonly host?: "node" };

export type SimulationResult = {
  readonly diagnostics: Diagnostic[];
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
  /** Fidelity warnings (e.g. a nondeterministic ordering); never part of stdout or stderr. */
  readonly warnings: string[];
  /** Why the run ended early (D3). Output up to that point is kept. */
  readonly stop?: SimulationStop;
};

/** A refused program: `<code>: <message>` lines and exit code 1 (D1, the test262 contract's format). */
function refused(diagnostics: Diagnostic[]): SimulationResult {
  const stderr = diagnostics.map((d) => `${d.code}: ${d.message}\n`).join("");
  return { diagnostics, stdout: "", stderr, exitCode: 1, warnings: [] };
}

export function simulate(source: string, lang: Language, opts: SimulationOptions = {}): SimulationResult {
  if ((opts.host ?? "node") !== "node") throw new Error(`host mode ${String(opts.host)} is not modeled yet`);
  const compiled = new CompilationManager().compile(source, lang);
  const program = compiled.program;
  if (!program) return refused(compiled.diagnostics);

  let stdout = "";
  let stderr = "";
  const realm = new Realm({
    write(stream, text) {
      if (stream === "stdout") stdout += text;
      else stderr += text;
    },
    entryPoint: () => "main",
  });
  const interpreter = new IgnitionInterpreter(program, realm, NO_OBSERVER);

  try {
    const completion = interpreter.runScript();
    if (completion.type === "throw") {
      // src/node_errors.cc TriggerUncaughtException: the code frame comes from the pending message.
      const message = interpreter.pendingMessage;
      const range = message ? sourceRangeForPos(program, message.pos) : undefined;
      stderr += printUncaught(completion.value, {
        source: program.source,
        throwPosition: positionOf(program.source, range?.start ?? 0),
        inspect: (value) => inspect(realm, value),
      });
      return { diagnostics: [], stdout, stderr, exitCode: 1, warnings: [] };
    }
  } catch (e) {
    if (!(e instanceof SimulationHalt)) throw e;
    return { diagnostics: [], stdout, stderr, exitCode: 0, warnings: [], stop: e.stop };
  }
  return { diagnostics: [], stdout, stderr, exitCode: 0, warnings: [] };
}
