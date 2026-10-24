import { compileBaseline } from "@/core/baseline/BaselineCompiler";
import type { BaselineCode } from "@/core/baseline/Template";
import type { BytecodeProgram } from "@/core/bytecode/BytecodeProgram";
import { CompilationManager } from "@/core/compile/CompilationManager";
import { TieringModel } from "@/core/interpreter/tiering/TieringModel";
import { jobBoundaries } from "@/core/timeline/boundaries";
import { SimulationEngine } from "@/core/timeline/SimulationEngine";
import { TimelineStore } from "@/core/timeline/TimelineStore";
import { buildLineIndex } from "@/core/views/lineIndex";
import { type ClientViews, type PipelineRequest, type PipelineResponse, TIMELINE_MAX_CHARS } from "./protocol";

// The pure half of the pipeline worker: one request in, one or two responses out through `post`.
// Nothing here touches `self`, so it runs under Vitest in Node. The user's source is only parsed
// and interpreted by core/; it is never executed.

const FAILED_MAX = 500;

function baselinesOf(program: BytecodeProgram): BaselineCode[] {
  // Indexed by FunctionId. A function the baseline compiler refused has no code to show.
  return program.functions.map((fn) => {
    const compiled = compileBaseline(fn);
    return compiled.ok ? compiled.value : { instructions: [] };
  });
}

function failureMessage(error: unknown): string {
  // Only the error's own message: never the source, and nothing from a non-Error throw.
  const message = error instanceof Error && error.message !== "" ? error.message : "The simulation failed.";
  return message.slice(0, FAILED_MAX);
}

export function handleRequest(request: PipelineRequest, post: (response: PipelineResponse) => void): void {
  const { jobId, source, lang } = request;
  try {
    const compiled = new CompilationManager().compile(source, lang);
    const { program, views, strippedJs } = compiled;
    if (compiled.diagnostics.length > 0 || !program || !views || strippedJs === undefined) {
      post({
        type: "compiled",
        jobId,
        diagnostics: compiled.diagnostics,
        strippedJs: strippedJs ?? null,
        views: null,
        lineIndex: null,
        baselines: null,
      });
      return;
    }

    // Reading `asm` and `binary` forces the lazy views, so the posted object holds plain data only.
    const plainViews: ClientViews = { ast: views.ast, bytecode: views.bytecode, asm: views.asm, binary: views.binary };
    post({
      type: "compiled",
      jobId,
      diagnostics: [],
      strippedJs,
      views: plainViews,
      lineIndex: buildLineIndex(program, plainViews, strippedJs),
      baselines: baselinesOf(program),
    });

    const result = new SimulationEngine().run(program, { tiering: new TieringModel() });
    const timeline = TimelineStore.fromTicks(result.ticks).serialize();
    if (timeline.length > TIMELINE_MAX_CHARS) {
      post({ type: "failed", jobId, message: "The recorded timeline is too large to display." });
      return;
    }
    post({
      type: "simulated",
      jobId,
      timeline,
      boundaries: jobBoundaries(result.ticks),
      tickCount: result.tickCount,
      exitCode: result.exitCode,
      warnings: [...result.warnings],
      stop: result.stop ?? null,
    });
  } catch (error) {
    post({ type: "failed", jobId, message: failureMessage(error) });
  }
}
