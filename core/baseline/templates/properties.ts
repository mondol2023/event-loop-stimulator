// Named and keyed property access and delete, after V8's src/baseline/baseline-compiler.cc (VisitGetNamedProperty ..
// VisitStaInArrayLiteral, VisitDeleteProperty*) and the Load/KeyedLoad/Store Baseline descriptors in interface-descriptors-x64-inl.h.

import { reg } from "../x64/Encoder";
import { asm, numericOperand, type Template } from "../Template";
import { accumulator, callBuiltinWith, fromRegister, frameRegister, handle, smiArg, taggedIndexArg, type Descriptor } from "./builtinCall";
import { constant } from "./loads";
import { SCRATCH } from "./checks";

// LoadDescriptor::registers: receiver rdx, name rcx, slot rax.
const LOAD: Descriptor = { registers: ["rdx", "rcx", "rax"], stackOrder: "default", context: false };
// KeyedLoadBaselineDescriptor::registers: receiver rdx, name (the accumulator) rax, slot rcx.
const KEYED_LOAD: Descriptor = { registers: ["rdx", "rax", "rcx"], stackOrder: "default", context: false };
// StoreDescriptor::registers: receiver rdx, name rcx, value rax, slot rdi.
const STORE: Descriptor = { registers: ["rdx", "rcx", "rax", "rdi"], stackOrder: "default", context: false };

// VisitGetNamedProperty: LoadICBaseline(object, name, slot).
export const GetNamedProperty: Template = (input) => {
  const { bytecode } = input;
  return callBuiltinWith("LoadICBaseline", LOAD, [
    frameRegister(numericOperand(bytecode, 0), "object"),
    handle(constant(input, 1), "name"),
    taggedIndexArg(numericOperand(bytecode, 2), "IndexAsTagged(2)"),
  ]);
};

// VisitGetKeyedProperty: KeyedLoadICBaseline(object, key, slot).
export const GetKeyedProperty: Template = ({ bytecode }) =>
  callBuiltinWith("KeyedLoadICBaseline", KEYED_LOAD, [
    frameRegister(numericOperand(bytecode, 0), "object"),
    accumulator,
    taggedIndexArg(numericOperand(bytecode, 1), "IndexAsTagged(1)"),
  ]);

// VisitSetNamedProperty and VisitDefineNamedOwnProperty differ only in the IC builtin.
function namedStore(builtin: string): Template {
  return (input) => {
    const { bytecode } = input;
    return callBuiltinWith(builtin, STORE, [
      frameRegister(numericOperand(bytecode, 0), "object"),
      handle(constant(input, 1), "name"),
      accumulator,
      taggedIndexArg(numericOperand(bytecode, 2), "IndexAsTagged(2)"),
    ]);
  };
}
export const SetNamedProperty = namedStore("StoreICBaseline");
export const DefineNamedOwnProperty = namedStore("DefineNamedOwnICBaseline");

// VisitSetKeyedProperty and VisitStaInArrayLiteral: (object, key, value, slot), differing only in the IC builtin.
function keyedStore(builtin: string): Template {
  return ({ bytecode }) =>
    callBuiltinWith(builtin, STORE, [
      frameRegister(numericOperand(bytecode, 0), "object"),
      frameRegister(numericOperand(bytecode, 1), "key"),
      accumulator,
      taggedIndexArg(numericOperand(bytecode, 2), "IndexAsTagged(2)"),
    ]);
}
export const SetKeyedProperty = keyedStore("KeyedStoreICBaseline");
export const StaInArrayLiteral = keyedStore("StoreInArrayLiteralICBaseline");

// VisitDeletePropertyStrict/Sloppy: DeleteProperty(object, key = accumulator copied to a scratch, language mode); a TFS builtin with context.
function deleteProperty(languageMode: number): Template {
  return ({ bytecode }) => [
    asm("mov", [reg(SCRATCH), reg("rax")], "ScratchRegisterScope: key"),
    ...callBuiltinWith("DeleteProperty", { registers: ["rax", "rbx", "rcx"], stackOrder: "default", context: true }, [
      frameRegister(numericOperand(bytecode, 0), "object"),
      fromRegister(SCRATCH, "key"),
      smiArg(languageMode, "Smi::FromEnum(LanguageMode)"),
    ]),
  ];
}
export const DeletePropertySloppy = deleteProperty(0);
export const DeletePropertyStrict = deleteProperty(1);
