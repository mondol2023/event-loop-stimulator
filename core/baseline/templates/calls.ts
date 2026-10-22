// Calls and construction, after V8's src/baseline/baseline-compiler.cc (BuildCall, VisitCall*, VisitConstruct) and the descriptors
// CallTrampoline_Baseline[_Compact] and Construct_Baseline in src/codegen/interface-descriptors.h.

import { numericOperand, type Template, type TemplateInput } from "../Template";
import { accumulator, callBuiltinWith, frameRegister, frameRegisters, int, root, type Arg, type Descriptor } from "./builtinCall";

// DEFINE_PARAMETERS_NO_CONTEXT_VARARGS(kFunction, kActualArgumentsCount, kSlot) and its Compact twin (kFunction, kBitField).
const CALL: Descriptor = { registers: ["rax", "rbx", "rcx"], stackOrder: "js", context: false };
const CALL_COMPACT: Descriptor = { registers: ["rax", "rbx"], stackOrder: "js", context: false };
// DEFINE_JS_PARAMETERS_NO_CONTEXT(kSlot): kTarget rdi, kNewTarget rdx, kActualArgumentsCount rax, kSlot rbx (DefaultJSRegisterArray).
const CONSTRUCT: Descriptor = { registers: ["rdi", "rdx", "rax", "rbx"], stackOrder: "js", context: false };

type ReceiverMode = "Any" | "NullOrUndefined" | "NotNullOrUndefined";

// CallTrampoline_Baseline_CompactDescriptor::EncodeBitField: ArgumentCountField bits 0-7, SlotField bits 8-31.
function encodeBitField(argc: number, slot: number): number | undefined {
  return argc < 1 << 8 && slot < 1 << 24 ? argc | (slot << 8) : undefined;
}

// BuildCall: the compact builtin when argc and slot fit its bit field, the full one otherwise; `args` are the stack arguments.
function buildCall(mode: ReceiverMode, input: TemplateInput, slot: number, argc: number, args: readonly Arg[]) {
  const function_ = frameRegister(numericOperand(input.bytecode, 0), "function");
  const bitfield = encodeBitField(argc, slot);
  const name = `Call_ReceiverIs${mode}_Baseline`;
  return bitfield !== undefined
    ? callBuiltinWith(`${name}_Compact`, CALL_COMPACT, [function_, int(bitfield, "argc | slot << 8"), ...args])
    : callBuiltinWith(name, CALL, [function_, int(argc, "argc"), int(slot, "slot"), ...args]);
}

// JSParameterCount(n): the receiver counts (kJSArgcIncludesReceiver).
const jsParameterCount = (n: number): number => n + 1;

// VisitCallProperty: the register list includes the receiver, so its count is already the JS argc.
export const CallProperty: Template = (input) => {
  const { bytecode } = input;
  const count = numericOperand(bytecode, 2);
  return buildCall("NotNullOrUndefined", input, numericOperand(bytecode, 3), count, frameRegisters(numericOperand(bytecode, 1), count));
};

// VisitCallProperty0/1/2: the receiver and arguments are the register operands after the function.
function callPropertyN(n: number): Template {
  return (input) => {
    const { bytecode } = input;
    const args = Array.from({ length: n + 1 }, (_, i) => frameRegister(numericOperand(bytecode, 1 + i)));
    return buildCall("NotNullOrUndefined", input, numericOperand(bytecode, n + 2), jsParameterCount(n), args);
  };
}
export const CallProperty0 = callPropertyN(0);
export const CallProperty1 = callPropertyN(1);
export const CallProperty2 = callPropertyN(2);

// VisitCallUndefinedReceiver: undefined is pushed as the receiver ahead of the argument list.
export const CallUndefinedReceiver: Template = (input) => {
  const { bytecode } = input;
  const count = numericOperand(bytecode, 2);
  return buildCall("NullOrUndefined", input, numericOperand(bytecode, 3), jsParameterCount(count), [
    root("UndefinedValue"),
    ...frameRegisters(numericOperand(bytecode, 1), count),
  ]);
};

// VisitCallUndefinedReceiver0/1/2.
function callUndefinedReceiverN(n: number): Template {
  return (input) => {
    const { bytecode } = input;
    const args = Array.from({ length: n }, (_, i) => frameRegister(numericOperand(bytecode, 1 + i)));
    return buildCall("NullOrUndefined", input, numericOperand(bytecode, n + 1), jsParameterCount(n), [root("UndefinedValue"), ...args]);
  };
}
export const CallUndefinedReceiver0 = callUndefinedReceiverN(0);
export const CallUndefinedReceiver1 = callUndefinedReceiverN(1);
export const CallUndefinedReceiver2 = callUndefinedReceiverN(2);

// VisitConstruct: new.target is the accumulator, copied to rdx before rax takes the argument count.
export const Construct: Template = ({ bytecode }) => {
  const count = numericOperand(bytecode, 2);
  return callBuiltinWith("Construct_Baseline", CONSTRUCT, [
    frameRegister(numericOperand(bytecode, 0), "function"),
    accumulator,
    int(jsParameterCount(count), "argc"),
    int(numericOperand(bytecode, 3), "slot"),
    root("UndefinedValue"),
    ...frameRegisters(numericOperand(bytecode, 1), count),
  ]);
};
