import { CompilationManager, type Language } from "@/core/compile/CompilationManager";
import type { GcOptions } from "@/core/runtime/heap/GcModel";
import type { Diagnostic } from "@/core/shared/diagnostics";
import type { SimulationStop } from "@/core/shared/simulationHalt";
import { SimulationEngine } from "./SimulationEngine";
import type { Tick } from "./Tick";

// The whole pipeline for one program: compile, then run it on a fresh realm under Node's event
// loop (core/host/NodeEventLoop), which also prints uncaught exceptions and unhandled rejections,
// and record the timeline (SimulationEngine).

/**
 * `host` is a test-only mode (D7): only Node is modeled so far. `record: false` runs without
 * building ticks and narration (the conformance suites compare output only); the run, its output
 * and where it stops are identical either way, which the exactness firewall tests prove.
 */
export type SimulationOptions = {
  readonly host?: "node";
  /** Test-only natives mode (D2): `%Name(args)` compiles to the V8 runtime probes in RUNTIME_NATIVES. */
  readonly natives?: boolean;
  readonly record?: boolean;
  /** The sizes of the modeled generations (Illustrative; they never change what a program prints). */
  readonly gc?: Partial<GcOptions>;
};

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
  /** The timeline: one Tick per step (empty when the program was refused or `record` is false). */
  readonly ticks: readonly Tick[];
  /** How many ticks the run made, recorded or not. */
  readonly tickCount: number;
};

/** A refused program: `<code>: <message>` lines and exit code 1 (D1, the test262 contract's format). */
function refused(diagnostics: Diagnostic[]): SimulationResult {
  const stderr = diagnostics.map((d) => `${d.code}: ${d.message}
`).join("");
  return { diagnostics, stdout: "", stderr, exitCode: 1, warnings: [], ticks: [], tickCount: 0 };
}

export function simulate(source: string, lang: Language, opts: SimulationOptions = {}): SimulationResult {
  if ((opts.host ?? "node") !== "node") throw new Error(`host mode ${String(opts.host)} is not modeled yet`);
  const compiled = new CompilationManager().compile(source, lang, { natives: opts.natives ?? false });
  if (!compiled.program) return refused(compiled.diagnostics);
  return new SimulationEngine().run(compiled.program, opts);
}
