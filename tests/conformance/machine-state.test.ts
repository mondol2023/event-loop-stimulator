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
const SMI_PROGRAM = "let a = 21; let b = a + a; let n = -a; console.log(b, n); console.log(n);";

it("nexttick-vs-promise: every JS tick has an asm line in range, and rax is the Smi accumulator << 1", () => {
  const fixture = discoverFixtures(ROOT).find((f) => f.kind === "program" && f.name === "nexttick-vs-promise");
  if (!fixture) throw new Error("fixture missing");

  let smiTicks = 0;
  const raxBySmi = new Map<number, bigint>();
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
        raxBySmi.set(accumulator.value, state.registers.rax);
        expect(state.registers.rax).toBe(BigInt.asUintN(32, BigInt(accumulator.value) << 1n));
      }
    }
  }
  expect(smiTicks).toBeGreaterThan(0);
  // Hard-coded words, so a wrong formula cannot agree with itself: 21 << 1, and -21 as a 32-bit two's complement.
  expect(raxBySmi.get(21)).toBe(42n);
  expect(raxBySmi.get(-21)).toBe(0xffff_ffd6n);
});

// The condition codes are the ones the `cmp` shown at asmLine sets; a comparison that calls a builtin has no cmp in its code.
// Ticks fall on statement starts, so no real tick sits on a Test* bytecode: the tick is moved onto one, with a chosen accumulator.
it("flags are projected only where the shown instruction is a cmp, and equal that cmp's flags", () => {
  const source = "let u; let n = null; const a = u === undefined; const b = n === null; const d = 1 < 2; console.log(a, b, d);";
  const program = new CompilationManager().compile(source, "js", { natives: false }).program;
  if (!program) throw new Error("program does not compile");
  const fn = program.functions[0];
  const baseline = fn && compileBaseline(fn);
  if (!fn || !baseline?.ok) throw new Error("no baseline code");
  const base = simulate(source, "js").ticks.find((t) => t.callStack.at(-1)?.functionId === fn.id && t.pos);
  const frame = base?.callStack.at(-1);
  if (!base || !frame) throw new Error("no tick in the top-level function");

  const stateOn = (opcode: string, accumulator: typeof frame.accumulator) => {
    const line = baseline.value.instructions.find((i) => i.bytecode?.opcode === opcode);
    if (!line?.bytecode) throw new Error(`no ${opcode} in the program`);
    const tick = { ...base, pos: { functionId: fn.id, bytecodeOffset: line.bytecode.offset }, callStack: [{ ...frame, accumulator }] };
    const state = machineStateAt(tick, baseline.value);
    if (!state) throw new Error("no state");
    return { state, shown: baseline.value.instructions[state.asmLine] };
  };

  const undef = stateOn("TestUndefined", { kind: "oddball", name: "undefined" });
  expect(undef.shown?.instruction.mnemonic).toBe("cmp");
  expect(undef.state.flags).toEqual({ zf: true, sf: false, cf: false, of: false });
  const notNull = stateOn("TestNull", { kind: "smi", value: 1, tagged: "1" });
  expect(notNull.shown?.instruction.mnemonic).toBe("cmp");
  expect(notNull.state.flags?.zf).toBe(false);

  // TestLessThan loads rdx and calls a builtin: the shown code has no cmp, so there are no flags to show.
  const less = stateOn("TestLessThan", { kind: "smi", value: 2, tagged: "2" });
  expect(less.shown?.instruction.mnemonic).not.toBe("cmp");
  expect(less.state.flags).toBeNull();
});
