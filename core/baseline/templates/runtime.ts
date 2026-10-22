// Runtime calls and throws, after V8's src/baseline/baseline-compiler.cc (CallRuntime, VisitCallRuntime, VisitThrow, VisitReThrow,
// VisitThrowReferenceErrorIfHole, VisitSetPendingMessage).

import { imm, mem, reg } from "../x64/Encoder";
import { RegisterRoles } from "../x64/registers";
import { externalReferenceAddress, rootSlot } from "../isolateData";
import { asm, bind, callRuntime, numericOperand, type Emit, type Template } from "../Template";
import { ACC, jcc, SCRATCH } from "./checks";
import { frameRegisters, pushAll } from "./builtinCall";
import { loadContext } from "./contexts";
import { runtimeWithName } from "./loads";

// MacroAssembler::Trap after a call that never returns.
const trap = (): Emit => asm("int3", [], "Trap");

// VisitCallRuntime: the context, the register list pushed in order, then CallRuntime.
export const CallRuntime: Template = ({ bytecode }) => {
  const count = numericOperand(bytecode, 2);
  return [
    loadContext(RegisterRoles.context),
    ...pushAll(frameRegisters(numericOperand(bytecode, 1), count)),
    ...callRuntime(String(bytecode.operands[0]), count),
  ];
};

// VisitThrow and VisitReThrow: Runtime::k<Throw|ReThrow>(accumulator), then Trap.
function throwRuntime(runtime: string): Template {
  return () => [
    loadContext(RegisterRoles.context),
    asm("push", [reg(ACC)], "value"),
    ...callRuntime(runtime, 1),
    trap(),
  ];
}
export const Throw = throwRuntime("Throw");
export const ReThrow = throwRuntime("ReThrow");

// VisitThrowReferenceErrorIfHole: JumpIfNotRoot(the hole), else Runtime::kThrowAccessedUninitializedVariable(name).
export const ThrowReferenceErrorIfHole: Template = (input) => {
  const done = input.labels.local("done");
  return [
    asm("cmp", [reg(ACC), rootSlot("TheHoleValue")], "RootIndex::kTheHoleValue"),
    jcc("ne", done),
    ...runtimeWithName("ThrowAccessedUninitializedVariable", input, false),
    trap(),
    bind(done),
  ];
};

// VisitSetPendingMessage: swap the accumulator with the isolate's pending message through two scratch registers.
export const SetPendingMessage: Template = () => [
  asm("mov", [reg(SCRATCH), imm(externalReferenceAddress("address_of_pending_message"))], "address_of_pending_message"),
  asm("mov", [reg("r9"), reg(ACC)], "tmp"),
  asm("mov", [reg(ACC), mem(SCRATCH, 0)]),
  asm("mov", [mem(SCRATCH, 0), reg("r9")]),
];

