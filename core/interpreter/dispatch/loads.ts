import type { Instruction } from "@/core/bytecode/BytecodeArray";
import type { ConstantEntry } from "@/core/bytecode/ConstantPool";
import { local } from "@/core/bytecode/bytecodes";
import { formatMessage } from "@/core/runtime/messages";
import type { Realm } from "@/core/runtime/Realm";
import { HasProperty, OrdinaryGet, OrdinarySet } from "@/core/runtime/spec/objectOps";
import type { JSValue } from "@/core/runtime/values/JSValue";
import { TheHole } from "@/core/runtime/values/TheHole";
import { SimulationHalt } from "@/core/shared/simulationHalt";
import type { Completion } from "../Completion";
import { type Frame, readRegister, writeRegister } from "../Frame";
import { type Handler, accumulatorValue, operand } from "./context";

// Lda*/Star*/Ldar/Mov and the global accessors (src/interpreter/interpreter-generator.cc).

/** The JS value of a constant-pool entry that `LdaConstant` can load. */
export function constantValue(entry: ConstantEntry | undefined): JSValue {
  switch (entry?.kind) {
    case "string":
    case "number":
    case "smi":
      return entry.value;
    default:
      throw new SimulationHalt({ kind: "unsupported", reason: `constant-pool entry ${entry?.kind ?? "(none)"}` });
  }
}

/** A name operand: an index of a string constant (a global or property name). */
export function nameConstant(frame: Frame, instr: Instruction, index: number): string {
  const entry = frame.code.constantPool.get(operand(instr, index));
  if (entry?.kind !== "string") throw new Error(`${instr.opcode} operand ${index} does not name a string constant`);
  return entry.value;
}

const SHORT_STAR = /^Star(\d+)$/;

export const loadHandler: Handler = (ctx, frame, instr) => {
  switch (instr.opcode) {
    case "LdaZero":
      frame.accumulator = 0;
      return undefined;
    case "LdaSmi":
      frame.accumulator = operand(instr, 0);
      return undefined;
    case "LdaUndefined":
      frame.accumulator = undefined;
      return undefined;
    case "LdaNull":
      frame.accumulator = null;
      return undefined;
    case "LdaTheHole":
      frame.accumulator = TheHole;
      return undefined;
    case "LdaTrue":
      frame.accumulator = true;
      return undefined;
    case "LdaFalse":
      frame.accumulator = false;
      return undefined;
    case "LdaConstant":
      frame.accumulator = constantValue(frame.code.constantPool.get(operand(instr, 0)));
      return undefined;
    case "Ldar":
      frame.accumulator = readRegister(frame, operand(instr, 0));
      return undefined;
    case "Star":
      writeRegister(frame, operand(instr, 0), frame.accumulator);
      return undefined;
    case "Mov":
      writeRegister(frame, operand(instr, 1), readRegister(frame, operand(instr, 0)));
      return undefined;
    case "LdaGlobal":
    case "LdaGlobalInsideTypeof": {
      // LoadGlobalIC: the global object's property, or a ReferenceError (undefined inside typeof).
      const name = nameConstant(frame, instr, 0);
      if (HasProperty(ctx.realm.globalObject, name)) {
        frame.accumulator = OrdinaryGet(ctx.realm.globalObject, name);
        return undefined;
      }
      if (instr.opcode === "LdaGlobalInsideTypeof") {
        frame.accumulator = undefined;
        return undefined;
      }
      return ctx.realm.throwError("ReferenceError", formatMessage("kNotDefined", name));
    }
    case "StaGlobal":
      return storeGlobal(ctx.realm, frame, nameConstant(frame, instr, 0));
    default: {
      const short = SHORT_STAR.exec(instr.opcode);
      if (!short) throw new Error(`${instr.opcode} is not a load opcode`);
      writeRegister(frame, local(Number(short[1])), frame.accumulator);
      return undefined;
    }
  }
};

/**
 * StoreGlobalIC: sloppy code creates or overwrites the property; strict code throws a
 * ReferenceError when there is no such global (`kNotDefined`) before assigning.
 */
function storeGlobal(realm: Realm, frame: Frame, name: string): Completion | undefined {
  const global = realm.globalObject;
  if (frame.code.strict && !HasProperty(global, name)) {
    return realm.throwError("ReferenceError", formatMessage("kNotDefined", name));
  }
  const stored = OrdinarySet(realm, global, name, accumulatorValue(frame));
  if (!stored && frame.code.strict) {
    throw new SimulationHalt({ kind: "unsupported", reason: `strict assignment to the read-only global ${name}` });
  }
  return undefined;
}
