import { JSObject } from "@/core/runtime/objects/JSObject";
import { formatMessage } from "@/core/runtime/messages";
import { OrdinaryGet } from "@/core/runtime/spec/objectOps";
import { SimulationHalt } from "@/core/shared/simulationHalt";
import { readRegister } from "../Frame";
import { type Handler, operand } from "./context";
import { nameConstant } from "./loads";

// Property access. Task 8 has only the named load a call like `console.log(x)` needs; the stores,
// keyed access, literals and inline caches arrive with Task 10.

export const propertyHandler: Handler = (ctx, frame, instr) => {
  switch (instr.opcode) {
    case "GetNamedProperty": {
      const receiver = readRegister(frame, operand(instr, 0));
      const name = nameConstant(frame, instr, 1);
      if (receiver instanceof JSObject) {
        frame.accumulator = OrdinaryGet(receiver, name);
        return undefined;
      }
      if (receiver === undefined || receiver === null) {
        return ctx.realm.throwError("TypeError", formatMessage("kNonObjectPropertyLoadWithProperty", String(receiver), name));
      }
      throw new SimulationHalt({ kind: "unsupported", reason: `reading a property of a ${typeof receiver} (primitive wrappers arrive with Task 10)` });
    }
    default:
      throw new Error(`${instr.opcode} is not a property opcode`);
  }
};
