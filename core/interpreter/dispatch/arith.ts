import type { Opcode } from "@/core/bytecode/bytecodes";
import {
  type SpecRealm,
  ToBoolean,
  ToNumber,
  ToNumeric,
  ToString,
  typeofOperator,
} from "@/core/runtime/spec/conversions";
import * as ops from "@/core/runtime/spec/operators";
import type { JSValue } from "@/core/runtime/values/JSValue";
import { type Completion, isThrow, normal } from "../Completion";
import { readRegister } from "../Frame";
import { type Handler, accumulatorValue, operand } from "./context";

// Binary, unary and conversion opcodes. The abstract operations are in core/runtime/spec; here
// only the operand conventions of Ignition live: `Add r1` is `r1 + acc`, `AddSmi [n]` is `acc + n`.

type Binary = (realm: SpecRealm, left: JSValue, right: JSValue) => Completion;

const BINARY: Readonly<Record<string, Binary>> = {
  Add: ops.Add,
  Sub: ops.Sub,
  Mul: ops.Mul,
  Div: ops.Div,
  Mod: ops.Mod,
  Exp: ops.Exp,
  BitwiseOr: ops.BitwiseOr,
  BitwiseXor: ops.BitwiseXor,
  BitwiseAnd: ops.BitwiseAnd,
  ShiftLeft: ops.ShiftLeft,
  ShiftRight: ops.ShiftRight,
  ShiftRightLogical: ops.ShiftRightLogical,
};

const SMI_SUFFIX = "Smi";

/** The operator of a binary opcode (`AddSmi` and `Add` are both `Add`). */
function binaryOperator(opcode: Opcode): Binary | undefined {
  return BINARY[opcode.endsWith(SMI_SUFFIX) ? opcode.slice(0, -SMI_SUFFIX.length) : opcode];
}

export const arithHandler: Handler = (ctx, frame, instr) => {
  const realm = ctx.realm;
  const apply = (result: Completion): Completion | undefined => {
    if (isThrow(result)) return result;
    frame.accumulator = result.value;
    return undefined;
  };
  switch (instr.opcode) {
    case "Inc":
    case "Dec": {
      const n = ToNumeric(realm, accumulatorValue(frame));
      if (isThrow(n)) return n;
      return apply(normal(instr.opcode === "Inc" ? n.value + 1 : n.value - 1));
    }
    case "Negate":
      return apply(ops.Negate(realm, accumulatorValue(frame)));
    case "BitwiseNot":
      return apply(ops.BitwiseNot(realm, accumulatorValue(frame)));
    case "ToNumber":
      return apply(ToNumber(realm, accumulatorValue(frame)));
    case "ToNumeric":
      return apply(ToNumeric(realm, accumulatorValue(frame)));
    case "ToString":
      return apply(ToString(realm, accumulatorValue(frame)));
    case "ToBoolean":
      frame.accumulator = ToBoolean(accumulatorValue(frame));
      return undefined;
    case "ToBooleanLogicalNot":
      frame.accumulator = !ToBoolean(accumulatorValue(frame));
      return undefined;
    case "LogicalNot":
      frame.accumulator = !accumulatorValue(frame);
      return undefined;
    case "TypeOf":
      frame.accumulator = typeofOperator(accumulatorValue(frame));
      return undefined;
    default: {
      const operator = binaryOperator(instr.opcode);
      if (!operator) throw new Error(`${instr.opcode} is not an arithmetic opcode`);
      const right = accumulatorValue(frame);
      // The register forms read the left operand from a register, the Smi forms take it from the accumulator.
      const isSmi = instr.opcode.endsWith(SMI_SUFFIX);
      const left = isSmi ? right : (readRegister(frame, operand(instr, 0)) as JSValue);
      return apply(operator(realm, left, isSmi ? operand(instr, 0) : right));
    }
  }
};
