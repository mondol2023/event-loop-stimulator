import { machineStateAt, type MachineState } from "../baseline/machineState";
import { fnv1a32, hashedPointer } from "../baseline/illustrativePointers";
import type { BaselineCode, BaselineInstruction } from "../baseline/Template";
import type { RegisterName } from "../baseline/x64/registers";
import type { Tick } from "../timeline/Tick";
import { CacheModel, type CacheLevel } from "./cacheModel";
import { classifyInstruction, type AccessClass, type AluOp, type BusKind, type MemRegion } from "./classifyInstruction";

// Illustrative (D2, ADR-033/039): the hardware view of a tick is derived here from the tick and the function's baseline code, never stored on the Tick.
// A tick is one bytecode, whose machine code is a handful of instructions: the step shows the one that touches the bus, else the one that uses the ALU, else the first.
// Its addresses use the registers on entry to the bytecode (machineStateAt), so a later instruction's rax-based address is an approximation, like the rest of the model.

export type HardwareStep = {
  alu: AluOp | null;
  bus: { kind: BusKind; region: MemRegion } | null;
  /** The cache level that answered the bus access; `null` with no access. */
  servedBy: CacheLevel | null;
  /** Line tags (address / 64) resident after this tick, oldest first; L2 includes L1's lines. */
  l1: readonly number[];
  l2: readonly number[];
};

// Disjoint illustrative address spaces: the pointer-compression cage (r14), the isolate's root table (r13), and builtin code.
const CAGE_BASE = 0x0000_1000_0000_0000n;
const ISOLATE_DATA_BASE = CAGE_BASE + 2n ** 32n;
const BUILTIN_CODE_BASE = 0x0000_5000_0000_0000n;
const BUILTIN_CODE_STRIDE = 0x100n;

/** A builtin's entry is named by the instruction's `Builtin::k...` comment; the name picks a stable slot. */
function builtinCodeAddress(ins: BaselineInstruction): bigint {
  return BUILTIN_CODE_BASE + BigInt(fnv1a32(ins.comment ?? ins.asm) & 0xffff) * BUILTIN_CODE_STRIDE;
}

function registerValue(base: RegisterName, machine: MachineState): bigint {
  switch (base) {
    case "rbp":
      return machine.registers.rbp;
    case "rsp":
      return machine.registers.rsp;
    case "r13":
      return ISOLATE_DATA_BASE;
    case "rax":
      return CAGE_BASE + machine.registers.rax;
    case "rsi":
      return CAGE_BASE + machine.registers.rsi;
    // The model keeps only rax, rsi, rbp and rsp, so any other base is a stable stand-in object.
    default:
      return CAGE_BASE + hashedPointer("Register", base);
  }
}

function addressOf(ins: BaselineInstruction, access: AccessClass, machine: MachineState): bigint {
  if (access.operand === "code") return builtinCodeAddress(ins);
  const mem = ins.instruction.operands.find((o) => o.kind === "mem");
  if (mem?.kind === "mem") return BigInt.asUintN(64, registerValue(mem.base, machine) + BigInt(mem.disp));
  // push and pop/ret name no memory operand: they move through the stack top.
  return access.kind === "write" ? machine.registers.rsp - 8n : machine.registers.rsp;
}

type Classified = { ins: BaselineInstruction; alu: AluOp | null; access: AccessClass | null };

/** The instruction that stands for the bytecode starting at `asmLine`: its machine code runs while `bytecodeOffset` is unchanged. */
function representative(baseline: BaselineCode, asmLine: number): Classified | null {
  const first = baseline.instructions[asmLine];
  if (!first) return null;
  let withAlu: Classified | null = null;
  let head: Classified | null = null;
  for (let i = asmLine; i < baseline.instructions.length; i++) {
    const ins = baseline.instructions[i];
    if (!ins || ins.bytecodeOffset !== first.bytecodeOffset) break;
    const classified: Classified = { ins, ...classifyInstruction(ins.instruction) };
    if (classified.access) return classified;
    withAlu ??= classified.alu ? classified : null;
    head ??= classified;
  }
  return withAlu ?? head;
}

/** One step per tick. The caches carry over ticks outside baseline code, so `l1` and `l2` always describe the state after the tick. */
export function traceHardware(ticks: readonly Tick[], baselines: readonly BaselineCode[]): HardwareStep[] {
  const cache = new CacheModel();
  return ticks.map((tick): HardwareStep => {
    const baseline = tick.pos ? baselines[tick.pos.functionId] : undefined;
    const machine = baseline ? machineStateAt(tick, baseline) : null;
    const chosen = baseline && machine ? representative(baseline, machine.asmLine) : null;
    const access = chosen?.access ?? null;
    const servedBy = chosen && machine && access ? cache.access(addressOf(chosen.ins, access, machine)) : null;
    return { alu: chosen?.alu ?? null, bus: access ? { kind: access.kind, region: access.region } : null, servedBy, l1: cache.l1(), l2: cache.l2() };
  });
}
