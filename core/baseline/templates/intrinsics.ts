// InvokeIntrinsic, after V8's src/baseline/baseline-compiler.cc (VisitInvokeIntrinsic and VisitIntrinsic*). Intrinsics the generator
// never emits keep the stub builtin call.

import { imm, mem, reg } from "../x64/Encoder";
import { RegisterRoles } from "../x64/registers";
import { rootSlot } from "../isolateData";
import { asm, callBuiltin, numericOperand, type Template } from "../Template";
import { callBuiltinWith, frameRegisters, stubDescriptor } from "./builtinCall";
import { registerOperand } from "../frame";
import { GeneratorField, GeneratorState } from "./generators";
import { smi } from "./loads";

const ACC = RegisterRoles.accumulator;
const HEAP_OBJECT_TAG = 1;

// The intrinsics that are CallBuiltin<k...>(args): TFS builtins with context, one parameter per register in the list.
const BUILTIN_INTRINSICS: Readonly<Record<string, string>> = {
  _AsyncFunctionAwait: "AsyncFunctionAwait",
  _AsyncFunctionEnter: "AsyncFunctionEnter",
  _AsyncFunctionReject: "AsyncFunctionReject",
  _AsyncFunctionResolve: "AsyncFunctionResolve",
  _AsyncGeneratorAwait: "AsyncGeneratorAwait",
  _AsyncGeneratorReject: "AsyncGeneratorReject",
  _AsyncGeneratorResolve: "AsyncGeneratorResolve",
  _AsyncGeneratorYieldWithAwait: "AsyncGeneratorYieldWithAwait",
  _CopyDataProperties: "CopyDataProperties",
  _CreateIterResultObject: "CreateIterResultObject",
  _CreateJSGeneratorObject: "CreateGeneratorObject",
};

export const InvokeIntrinsic: Template = ({ bytecode }) => {
  const id = String(bytecode.operands[0]);
  const first = numericOperand(bytecode, 1);
  const count = numericOperand(bytecode, 2);
  const builtin = BUILTIN_INTRINSICS[id];
  if (builtin !== undefined) return callBuiltinWith(builtin, stubDescriptor(count, true), frameRegisters(first, count));
  switch (id) {
    // VisitIntrinsicGeneratorGetResumeMode: LoadTaggedField(JSGeneratorObject::kResumeModeOffset).
    case "_GeneratorGetResumeMode":
      return [
        asm("mov", [reg(ACC), registerOperand(first)], "generator"),
        asm("mov", [reg(ACC), mem(ACC, GeneratorField.resumeMode - HEAP_OBJECT_TAG)], "resume mode"),
      ];
    // VisitIntrinsicGeneratorClose: continuation = kGeneratorClosed, result undefined.
    case "_GeneratorClose":
      return [
        asm("mov", [reg(ACC), registerOperand(first)], "generator"),
        asm("mov", [mem(ACC, GeneratorField.continuation - HEAP_OBJECT_TAG), imm(smi(GeneratorState.closed))], "kGeneratorClosed"),
        asm("mov", [reg(ACC), rootSlot("UndefinedValue")], "RootIndex::kUndefinedValue"),
      ];
    default:
      return [callBuiltin("InvokeIntrinsic_Baseline")];
  }
};
