import { CompilationManager, type Language } from "@/core/compile/CompilationManager";
import { DETACHED_HOST, NodeEventLoop } from "@/core/host/NodeEventLoop";
import { IgnitionInterpreter } from "@/core/interpreter/IgnitionInterpreter";
import { Realm } from "@/core/runtime/Realm";
import type { Diagnostic } from "@/core/shared/diagnostics";
import { SimulationHalt, type SimulationStop } from "@/core/shared/simulationHalt";
import { stopNotice, TickLimiter } from "./limits";

// The whole pipeline for one program: compile, then run it on a fresh realm under Node's event
// loop (core/host/NodeEventLoop), which also prints uncaught exceptions and unhandled rejections.
// No ticks or timeline yet (Tasks 19 and 20).

/** Test-only host modes (D7) arrive with the test262 harness; only Node is modeled so far. */
export type SimulationOptions = { readonly host?: "node" };

export type SimulationResult = {
  readonly diagnostics: Diagnostic[];
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
  /** Fidelity warnings (e.g. a nondeterministic ordering); never part of stdout or stderr. */
  readonly warnings: string[];
  /**
   * Why the run ended early (D3). Output up to that point is kept, and `exitCode` is 0 because
   * the process never exited: `stop` is what says the run is incomplete.
   */
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

  const realm = new Realm(DETACHED_HOST);
  const observer = new TickLimiter(program);
  const interpreter = new IgnitionInterpreter(program, realm, observer);
  const loop = new NodeEventLoop(realm, interpreter, observer);
  try {
    const { exitCode } = loop.run();
    return { diagnostics: [], stdout: loop.stdout, stderr: loop.stderr, exitCode, warnings: [...loop.warnings] };
  } catch (e) {
    if (!(e instanceof SimulationHalt)) throw e;
    return { diagnostics: [], stdout: loop.stdout, stderr: loop.stderr, exitCode: 0, warnings: [...loop.warnings, stopNotice(e.stop)], stop: e.stop };
  }
}
