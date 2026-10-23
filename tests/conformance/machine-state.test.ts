import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { discoverFixtures } from "../../scripts/conformance/fixtures.mts";
import { compileBaseline } from "@/core/baseline/BaselineCompiler";
import { machineStateAt } from "@/core/baseline/machineState";
import { CompilationManager } from "@/core/compile/CompilationManager";
import { simulate } from "@/core/timeline/simulate";

// D1: the machine state is derived from a tick and the function's baseline code, never stored on the Tick.

const ROOT = dirname(fileURLToPath(import.meta.url));

// The fixture has no numbers, so a small Smi program rides along to make the rax check bite.
const SMI_PROGRAM = "let a = 21; let b = a + a; console.log(b, -a);";

it("nexttick-vs-promise: every JS tick has an asm line in range, and rax is the Smi accumulator << 1", () => {
  const fixture = discoverFixtures(ROOT).find((f) => f.kind === "program" && f.name === "nexttick-vs-promise");
  if (!fixture) throw new Error("fixture missing");

  let smiTicks = 0;
  for (const source of [fixture.source, SMI_PROGRAM]) {
    const program = new CompilationManager().compile(source, fixture.lang, { natives: false }).program;
    if (!program) throw new Error("program does not compile");
    for (const tick of simulate(source, fixture.lang).ticks) {
      if (!tick.pos) continue;
      const fn = program.functions.find((f) => f.id === tick.pos?.functionId);
      const baseline = fn && compileBaseline(fn);
      if (!baseline?.ok) throw new Error(`no baseline code for function ${String(tick.pos.functionId)}`);

      const state = machineStateAt(tick, baseline.value);
      expect(state, `tick ${tick.index}`).not.toBeNull();
      if (!state) continue;
      expect(state.asmLine).toBeGreaterThanOrEqual(0);
      expect(state.asmLine).toBeLessThan(baseline.value.instructions.length);

      const accumulator = tick.callStack.at(-1)?.accumulator;
      if (accumulator?.kind === "smi") {
        smiTicks += 1;
        expect(state.registers.rax).toBe(BigInt.asUintN(32, BigInt(accumulator.value) << 1n));
      }
    }
  }
  expect(smiTicks).toBeGreaterThan(0);
});
