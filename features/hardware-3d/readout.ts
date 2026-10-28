import type { BaselineCode } from "@/core/baseline/Template";
import { formatInstruction } from "@/core/baseline/x64/syntax";
import type { HardwareFrame } from "../playground/hooks/useHardwareFrame";
import type { AsmSyntax, PlaygroundState } from "../playground/store/playgroundStore";

/** The current instruction in the Machine Code pane's syntax. */
export function instructionText(baseline: BaselineCode, asmLine: number, syntax: AsmSyntax): string {
  const ins = baseline.instructions[asmLine];
  if (!ins) return "";
  return syntax === "intel" ? formatInstruction(ins.instruction, "intel") : ins.asm;
}

export const BEFORE_RUN = "Nothing to execute yet. Press Play and the board follows the Machine Code pane, one instruction at a time.";

export const IDLE_READOUT ="No baseline code on this tick: Node is between tasks, so the CPU waits.";

const hex = (v: bigint): string => `0x${v.toString(16)}`;

/** The board's one-line reading, "<asm>; rax=0x…, rsi=0x…": the canvas aria-label, and the text for the toolbar readout and the SVG board. */
export function readout(frame: HardwareFrame | null, baseline: BaselineCode | undefined, syntax: AsmSyntax): string {
  const machine = frame?.machine;
  if (!machine || !baseline) return IDLE_READOUT;
  return `${instructionText(baseline, machine.asmLine, syntax)}; rax=${hex(machine.registers.rax)}, rsi=${hex(machine.registers.rsi)}`;
}

type ReadingState = Pick<PlaygroundState, "compile" | "asmSyntax" | "playback">;

/** The one text both the visible readout and the canvas label show: BEFORE_RUN until a run exists, then `readout`. */
export function boardReading(frame: HardwareFrame | null, state: ReadingState): string {
  if (state.playback.length === 0) return BEFORE_RUN;
  const baseline = frame?.tick.pos ? state.compile.baselines?.[frame.tick.pos.functionId] : undefined;
  return readout(frame, baseline, state.asmSyntax);
}
