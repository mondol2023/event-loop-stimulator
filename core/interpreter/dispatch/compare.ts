import { typeofOperator } from "@/core/runtime/spec/conversions";
import {
  GreaterThan,
  GreaterThanOrEqual,
  IsLooselyEqual,
  IsStrictlyEqual,
  LessThan,
  LessThanOrEqual,
} from "@/core/runtime/spec/equality";
import type { JSValue } from "@/core/runtime/values/JSValue";
import { type Completion, isThrow } from "../Completion";
import { readRegister } from "../Frame";
import { type Handler, accumulatorValue, operand } from "./context";

// Test* opcodes: `TestLessThan r1` is `r1 < acc`, and the result replaces the accumulator.

/** `TestTypeOf`'s literal operand (V8 TestTypeOfFlags::LiteralFlag): the string `typeof` is compared with. */
const TYPEOF_LITERALS = ["number", "string", "symbol", "boolean", "bigint", "undefined", "function", "object"] as const;

export const compareHandler: Handler = (ctx, frame, instr) => {
  const acc = accumulatorValue(frame);
  const lhs = (): JSValue => readRegister(frame, operand(instr, 0)) as JSValue;
  const settle = (result: Completion<boolean>): Completion | undefined => {
    if (isThrow(result)) return result;
    frame.accumulator = result.value;
    return undefined;
  };
  switch (instr.opcode) {
    case "TestEqual":
      return settle(IsLooselyEqual(ctx.realm, lhs(), acc));
    case "TestEqualStrict":
      frame.accumulator = IsStrictlyEqual(lhs(), acc);
      return undefined;
    case "TestLessThan":
      return settle(LessThan(ctx.realm, lhs(), acc));
    case "TestGreaterThan":
      return settle(GreaterThan(ctx.realm, lhs(), acc));
    case "TestLessThanOrEqual":
      return settle(LessThanOrEqual(ctx.realm, lhs(), acc));
    case "TestGreaterThanOrEqual":
      return settle(GreaterThanOrEqual(ctx.realm, lhs(), acc));
    case "TestReferenceEqual":
      frame.accumulator = lhs() === acc;
      return undefined;
    case "TestUndetectable":
      // Only undefined and null are undetectable (document.all does not exist here).
      frame.accumulator = acc === undefined || acc === null;
      return undefined;
    case "TestNull":
      frame.accumulator = acc === null;
      return undefined;
    case "TestUndefined":
      frame.accumulator = acc === undefined;
      return undefined;
    case "TestTypeOf":
      frame.accumulator = typeofOperator(acc) === TYPEOF_LITERALS[operand(instr, 0)];
      return undefined;
    default:
      throw new Error(`${instr.opcode} is not a comparison opcode`);
  }
};
