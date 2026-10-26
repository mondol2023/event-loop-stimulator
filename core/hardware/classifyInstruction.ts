import type { Instruction, Operand } from "../baseline/x64/Encoder";
import { CONDITION_CODES, type JccMnemonic, type Mnemonic } from "../baseline/x64/encodings";

// Illustrative (D2, ADR-033/039): what the bus and ALU would do for one baseline instruction. The model is ours; x64 does not report it.

export type AluOp = "add" | "sub" | "and" | "or" | "xor" | "shl" | "sar" | "cmp" | "test" | "inc" | "dec" | "neg" | "imul";
export type BusKind = "fetch" | "read" | "write";
export type MemRegion = "code" | "stack" | "young" | "old";
export type MemAccess = { kind: BusKind; region: MemRegion; address: bigint };

/** Where the address comes from: the frame (`stack`), a tagged heap pointer or the isolate's root table (`heap`), or a builtin's code (`code`). */
export type AccessClass = Omit<MemAccess, "address"> & { operand: "stack" | "heap" | "code" };
export type Classification = { alu: AluOp | null; access: AccessClass | null };

type Mem = Extract<Operand, { kind: "mem" }>;

const isJcc = (m: Mnemonic): m is JccMnemonic => m.startsWith("j") && (CONDITION_CODES as readonly string[]).includes(m.slice(1));
const memOperand = (ins: Instruction): Mem | undefined => ins.operands.find((o): o is Mem => o.kind === "mem");

/** The region a memory operand lands in, by its base register: frame slots, the r13 root table (read-only and old space), or a young-space object. */
export function memClass(mem: Mem): Pick<AccessClass, "region" | "operand"> {
  switch (mem.base) {
    case "rbp":
    case "rsp":
      return { region: "stack", operand: "stack" };
    case "r13":
      return { region: "old", operand: "heap" };
    default:
      return { region: "young", operand: "heap" };
  }
}

const STACK: Pick<AccessClass, "region" | "operand"> = { region: "stack", operand: "stack" };
const CODE: AccessClass = { kind: "fetch", region: "code", operand: "code" };
const none = (alu: AluOp | null = null): Classification => ({ alu, access: null });
const through = (kind: BusKind, mem: Mem | undefined, alu: AluOp | null = null): Classification => (mem ? { alu, access: { kind, ...memClass(mem) } } : none(alu));

/** Exhaustive over `Mnemonic` (the encoder's form table), so a form added there fails typecheck until it is classified here (ADR-035). */
export function classifyInstruction(ins: Instruction): Classification {
  const { mnemonic } = ins;
  // A conditional jump moves no data; the early return narrows the switch to the closed list below.
  if (isJcc(mnemonic)) return none();
  const mem = memOperand(ins);
  switch (mnemonic) {
    // push and pop move through rsp; push [mem] reads its source first, and that read is the bus cycle shown.
    case "push":
      return mem ? through("read", mem) : { alu: null, access: { kind: "write", ...STACK } };
    case "pop":
    case "ret":
      return { alu: null, access: { kind: "read", ...STACK } };
    // The destination is operand 0: a store when it is memory, a load when the source is.
    case "mov":
      return ins.operands[0]?.kind === "mem" ? through("write", mem) : through("read", mem);
    case "movb":
      return through("read", mem);
    case "lea":
    case "int3":
      return none();
    case "cmp":
    case "cmpw":
      return through("read", mem, "cmp");
    case "test":
    case "testb":
      return through("read", mem, "test");
    // A read-modify-write: the store is the last bus cycle.
    case "addl":
      return through("write", mem, "add");
    case "call":
      return { alu: null, access: CODE };
    case "jmp":
      return mem ? { alu: null, access: CODE } : none();
    default:
      return assertNever(mnemonic);
  }
}

function assertNever(value: never): never {
  throw new Error(`unclassified instruction: ${String(value)}`);
}
