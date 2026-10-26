import type { BytecodeFunction, BytecodeProgram } from "@/core/bytecode/BytecodeProgram";
import { CompilationManager } from "@/core/compile/CompilationManager";
import { SimulationEngine } from "@/core/timeline/SimulationEngine";
import type { Tick, ValueSnapshot } from "@/core/timeline/Tick";

// Reads the arguments of a `console.log(...)` call back out of a recorded run, so a test can compare what the
// timeline shows (an object's Map, an array's elements kind) with what a natives twin printed on real node.

/** A recorded run: the compiled program (for the call's operands) and its ticks. */
export type RecordedRun = { readonly program: BytecodeProgram; readonly ticks: readonly Tick[] };

/** Compiles and runs `source` with recording on (no natives: this is the example as the learner sees it). */
export function recordRun(source: string): RecordedRun {
  const compiled = new CompilationManager().compile(source, "js");
  if (!compiled.program) throw new Error(`the source did not compile: ${compiled.diagnostics.map((d) => d.message).join("; ")}`);
  return { program: compiled.program, ticks: new SimulationEngine().run(compiled.program).ticks };
}

/** A register operand maps to the frame's register `FIRST_LOCAL - operand` (core/interpreter/Frame.ts). */
const FIRST_LOCAL = -7;

const PROBE_LINE = /^console\.log\("probe \d+"/;
const KIND_DEFINITION = /\n\/\/ Probe helper[\s\S]*$/;

/** The example's source back from its natives twin: the probe lines and the trailing `kind` helper go. */
export function stripProbes(source: string): string {
  return source
    .replace(KIND_DEFINITION, "")
    .split("\n")
    .filter((line) => !PROBE_LINE.test(line))
    .join("\n");
}

function lineOf(source: string, position: number): number {
  let line = 1;
  for (let i = 0; i < position; i++) if (source.charCodeAt(i) === 10) line++;
  return line;
}

type CallSite = { readonly fn: BytecodeFunction; readonly statement: number; readonly argumentRegisters: readonly number[] };

/** The last entry at or before `offset`, optionally only of one kind. */
function entryAt(fn: BytecodeFunction, offset: number, kind?: "statement"): { readonly position: number; readonly offset: number } | undefined {
  return [...fn.positions.entries].reverse().find((e) => e.offset <= offset && (kind === undefined || e.kind === kind));
}

/** The `console.log` call on `sourceLine`: its function, the statement it belongs to and the registers of its arguments. */
function findCall(program: BytecodeProgram, sourceLine: number): CallSite {
  for (const fn of program.functions) {
    for (const instr of fn.array.instructions) {
      if (!instr.opcode.startsWith("CallProperty")) continue;
      const expression = entryAt(fn, instr.offset);
      if (!expression || program.callPrinter[expression.position] !== "console.log") continue;
      if (lineOf(program.source, expression.position) !== sourceLine) continue;
      const statement = entryAt(fn, instr.offset, "statement");
      if (!statement) continue;
      const operands = instr.operands.filter((o): o is number => typeof o === "number");
      // CallProperty0..2: callee, then the receiver and arguments as single registers, then the feedback slot.
      // CallProperty: callee, the first register of a list, its count, then the feedback slot.
      const registers =
        instr.opcode === "CallProperty"
          ? Array.from({ length: operands[2] ?? 0 }, (_, i) => (operands[1] ?? 0) - i)
          : operands.slice(1, operands.length - 1);
      // The first register is the receiver (`console`); the rest are the arguments.
      return { fn, statement: statement.offset, argumentRegisters: registers.slice(1) };
    }
  }
  throw new Error(`no console.log call on source line ${sourceLine}`);
}

/**
 * The state right after the occurrence-th run of the `console.log` call on `sourceLine`, and the call's argument values.
 * Ticks are statement-level: the call's own tick is taken before its arguments are loaded, so the values are read from the
 * next tick in the same frame, whose snapshot is taken before that tick's first instruction and still holds the call's registers.
 */
export function consoleCallTick(run: RecordedRun, sourceLine: number, occurrence = 0): { readonly tick: Tick; readonly args: ValueSnapshot[] } {
  const call = findCall(run.program, sourceLine);
  const starts = run.ticks.filter((t) => t.pos?.functionId === call.fn.id && t.pos.bytecodeOffset === call.statement);
  const start = starts[occurrence];
  if (!start) throw new Error(`the console.log on source line ${sourceLine} ran ${starts.length} time(s); occurrence ${occurrence} does not exist`);
  const depth = start.callStack.length;
  const after = run.ticks.find((t) => t.index > start.index && t.callStack.length === depth && t.callStack[depth - 1]?.functionId === call.fn.id);
  if (!after) throw new Error(`no tick follows the console.log on source line ${sourceLine} in the same frame`);
  const frame = after.callStack[depth - 1];
  const args = call.argumentRegisters.map((operand) => {
    const value = operand <= FIRST_LOCAL ? frame?.registers[FIRST_LOCAL - operand] : undefined;
    if (!value) throw new Error(`argument register operand ${operand} of the console.log on source line ${sourceLine} is not a local`);
    return value as ValueSnapshot;
  });
  return { tick: after, args };
}

/** The argument registers of the occurrence-th run of the `console.log` call on `sourceLine`, read from the frame. */
export function consoleCallArgs(run: RecordedRun, sourceLine: number, occurrence = 0): ValueSnapshot[] {
  return consoleCallTick(run, sourceLine, occurrence).args;
}
