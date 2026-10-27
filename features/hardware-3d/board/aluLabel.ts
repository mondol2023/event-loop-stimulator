import type { AluOp } from "@/core/hardware/classifyInstruction";

/** The op as the ALU shows it. */
export function aluLabel(op: AluOp): string {
  switch (op) {
    case "add":
      return "add +";
    case "sub":
      return "sub -";
    case "and":
      return "and &";
    case "or":
      return "or |";
    case "xor":
      return "xor ^";
    case "shl":
      return "shl <<";
    case "sar":
      return "sar >>";
    case "cmp":
      return "cmp";
    case "test":
      return "test";
    case "inc":
      return "inc +1";
    case "dec":
      return "dec -1";
    case "neg":
      return "neg";
    case "imul":
      return "imul *";
    default: {
      const never: never = op;
      return never;
    }
  }
}
