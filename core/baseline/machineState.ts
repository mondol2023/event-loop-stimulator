import { local } from "../bytecode/bytecodes";
import type { TruthLevel } from "../shared/fidelity";
import type { Tick } from "../timeline/Tick";
import { BaselineFrame } from "./frame";
import { contextPointer, hashedPointer, objectPointer, oddballPointer, smiWord } from "./illustrativePointers";
import { FUNCTION_ENTRY_BYTECODE_OFFSET, type BaselineCode } from "./Template";
import type { RegisterName } from "./x64/registers";

// Illustrative compressed-pointer scheme: it does NOT match the pinned Node build (24.19.0, V8 13.6), which has pointer compression off and stores 32-bit Smis as value<<32 in a 64-bit word, so %IsSmi(2**30) is true there.
// Every register word here (rax = value << 1, r14 = cage base) is that scheme, so none of it is a reading of a real Node process.
// D1: the machine state of a tick is derived from the tick and the function's baseline code, never stored on the Tick.
// A tick is reported before its bytecode executes, so the state is the one on entry to that bytecode's first instruction.

type Frame = Tick["callStack"][number];
type Value = Frame["accumulator"];

export type MachineFlags = { readonly zf: boolean; readonly sf: boolean; readonly cf: boolean; readonly of: boolean };

export type MachineState = {
  readonly truth: Extract<TruthLevel, "illustrative">;
  /** Index into `baseline.instructions` of the next machine instruction. */
  readonly asmLine: number;
  /** rax and rsi hold 32-bit compressed words, rbp and rsp 64-bit stack addresses. */
  readonly registers: Readonly<Record<Extract<RegisterName, "rax" | "rsi" | "rbp" | "rsp">, bigint>>;
  /** The condition codes of the comparison a Test* bytecode makes; `null` anywhere else, or when an operand is not in the snapshot. */
  readonly flags: MachineFlags | null;
};

/** The tagged word a register holds for a value: a Smi is `value << 1`, anything else an illustrative compressed pointer. */
export function taggedWord(value: Value): bigint {
  switch (value.kind) {
    case "smi":
      return smiWord(value.value);
    case "object":
      return objectPointer(value.id);
    case "oddball":
      return oddballPointer(value.name);
    case "string":
      return hashedPointer("String", value.value);
    case "heap-number":
      return hashedPointer("HeapNumber", value.text);
    case "internal":
      return hashedPointer("Internal", value.name);
  }
}

// An illustrative stack top; each frame is its two saved words, BaselineFrame's fixed slots and one word per interpreter register.
const STACK_TOP = 0x0000_00ba_f2f0_0000n;
const SAVED_WORDS_BYTES = 16;
const FIXED_SLOTS_BYTES = -BaselineFrame.feedbackVector;
const frameBytes = (registerCount: number): number => SAVED_WORDS_BYTES + FIXED_SLOTS_BYTES + 8 * registerCount;

function framePointers(callStack: readonly Frame[], depth: number): { rbp: bigint; rsp: bigint } {
  let top = STACK_TOP;
  for (let i = 0; i < depth; i++) top -= BigInt(frameBytes(callStack[i]?.registers.length ?? 0));
  const frame = callStack[depth];
  const rbp = top - BigInt(SAVED_WORDS_BYTES);
  return { rbp, rsp: rbp - BigInt(FIXED_SLOTS_BYTES + 8 * (frame?.registers.length ?? 0)) };
}

/** `cmp a, b` on 32-bit tagged words: the flags of a - b. */
function compareFlags(a: bigint, b: bigint): MachineFlags {
  const result = BigInt.asUintN(32, a - b);
  const signed = (x: bigint): bigint => BigInt.asIntN(32, x);
  const diff = signed(a) - signed(b);
  return { zf: result === 0n, sf: (result >> 31n) === 1n, cf: a < b, of: diff !== signed(result) };
}

// Only these templates compare directly or hand rax and a register to a builtin: the word on the left of the comparison.
const REGISTER_TESTS: ReadonlySet<string> = new Set([
  "TestEqual",
  "TestEqualStrict",
  "TestLessThan",
  "TestGreaterThan",
  "TestLessThanOrEqual",
  "TestGreaterThanOrEqual",
  "TestReferenceEqual",
]);

function testFlags(opcode: string, operand: number | undefined, frame: Frame, rax: bigint): MachineFlags | null {
  // TestNull and TestUndefined are `cmp rax, [r13 + root slot]`.
  if (opcode === "TestNull") return compareFlags(rax, oddballPointer("null"));
  if (opcode === "TestUndefined") return compareFlags(rax, oddballPointer("undefined"));
  if (!REGISTER_TESTS.has(opcode) || operand === undefined) return null;
  // The snapshot holds the locals only: r0 is local(0), r1 is local(0) - 1, and so on.
  const lhs = frame.registers[local(0) - operand];
  return lhs ? compareFlags(taggedWord(lhs), rax) : null;
}

/** The machine state at a tick, or `null` while no JS frame is running or the tick is not at a bytecode of this baseline. */
export function machineStateAt(tick: Tick, baseline: BaselineCode): MachineState | null {
  const { pos, callStack } = tick;
  const depth = callStack.length - 1;
  const frame = callStack[depth];
  if (!pos || !frame || frame.functionId !== pos.functionId) return null;

  // The bytecode may emit no instructions (a Nop), so take the first line at or after it.
  const asmLine = baseline.instructions.findIndex((i) => i.bytecodeOffset !== FUNCTION_ENTRY_BYTECODE_OFFSET && i.bytecodeOffset >= pos.bytecodeOffset);
  if (asmLine < 0) return null;

  const site = baseline.instructions[asmLine]?.bytecode;
  const rax = taggedWord(frame.accumulator);
  const flags = site?.opcode.startsWith("Test") && site.offset === pos.bytecodeOffset
    ? testFlags(site.opcode, typeof site.operands[0] === "number" ? site.operands[0] : undefined, frame, rax)
    : null;
  const { rbp, rsp } = framePointers(callStack, depth);

  return {
    truth: "illustrative",
    asmLine,
    registers: { rax, rsi: contextPointer(frame.contextId), rbp, rsp },
    flags,
  };
}
