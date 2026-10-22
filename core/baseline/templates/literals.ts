// Literals, closures and the context-creating bytecodes, after V8's src/baseline/baseline-compiler.cc (VisitCreate*) and the Torque
// builtins in src/builtins/constructor.tq (CreateShallowArrayLiteral, FastNewClosureBaseline, FastNewFunctionContextFunction).

import { mem, reg } from "../x64/Encoder";
import { RegisterRoles } from "../x64/registers";
import { BaselineFrame } from "../frame";
import { asm, callRuntime, numericOperand, type Emit, type Template } from "../Template";
import { callBuiltinWith, frameRegister, frameSlot, fromRegister, handle, int, pushAll, smiArg, stubDescriptor, taggedIndexArg } from "./builtinCall";
import { loadContext } from "./contexts";
import { constant, runtimeWithName } from "./loads";

const HEAP_OBJECT_TAG = 1;
// Illustrative non-compressed layouts: FeedbackVector::kClosureFeedbackCellArrayOffset and FixedArray's data start (map, length).
const CLOSURE_FEEDBACK_CELL_ARRAY_OFFSET = 24;
const FIXED_ARRAY_DATA_START = 16;

// BaselineCompiler::FeedbackVector(): the frame slot holding the FeedbackVector.
const feedbackVector = () => frameSlot(mem(RegisterRoles.framePointer, BaselineFrame.feedbackVector), "FeedbackVector");

// interpreter::CreateArrayLiteralFlags / CreateObjectLiteralFlags: FlagsBits are bits 0-4, FastCloneSupportedBit is bit 5.
const FLAGS_MASK = 0x1f;
const FAST_CLONE_SUPPORTED = 0x20;

// VisitCreateArrayLiteral and VisitCreateObjectLiteral: (feedback vector, slot, constant, flags), shallow clone or the slow boilerplate.
function createLiteral(shallow: string, slow: string): Template {
  return (input) => {
    const { bytecode } = input;
    const flags = numericOperand(bytecode, 2);
    return callBuiltinWith((flags & FAST_CLONE_SUPPORTED) !== 0 ? shallow : slow, stubDescriptor(4, true), [
      feedbackVector(),
      taggedIndexArg(numericOperand(bytecode, 1), "IndexAsTagged(1)"),
      handle(constant(input, 0), "boilerplate"),
      smiArg(flags & FLAGS_MASK, "Smi flags"),
    ]);
  };
}
export const CreateArrayLiteral = createLiteral("CreateShallowArrayLiteral", "CreateArrayFromSlowBoilerplate");
export const CreateObjectLiteral = createLiteral("CreateShallowObjectLiteral", "CreateObjectFromSlowBoilerplate");

// VisitCreateEmptyArrayLiteral.
export const CreateEmptyArrayLiteral: Template = ({ bytecode }) =>
  callBuiltinWith("CreateEmptyArrayLiteral", stubDescriptor(2, true), [
    feedbackVector(),
    taggedIndexArg(numericOperand(bytecode, 0), "IndexAsTagged(0)"),
  ]);

// VisitCreateEmptyObjectLiteral.
export const CreateEmptyObjectLiteral: Template = () => callBuiltinWith("CreateEmptyLiteralObject", stubDescriptor(0, true), []);

// interpreter::CreateClosureFlags: PretenuredBit is bit 0, FastNewClosureBit bit 1.
export const CreateClosure: Template = (input) => {
  const { bytecode } = input;
  const flags = numericOperand(bytecode, 2);
  // FastNewClosureBaseline(sharedFunctionInfo rax, feedbackCell rbx): the cell is loaded into its parameter register first.
  const cell = "rbx" as const;
  const loadCell: Emit[] = [
    asm("mov", [reg(cell), mem(RegisterRoles.framePointer, BaselineFrame.feedbackVector)], "LoadFeedbackVector"),
    asm("mov", [reg(cell), mem(cell, CLOSURE_FEEDBACK_CELL_ARRAY_OFFSET - HEAP_OBJECT_TAG)], "closure feedback cell array"),
    asm("mov", [reg(cell), mem(cell, FIXED_ARRAY_DATA_START + 8 * numericOperand(bytecode, 1) - HEAP_OBJECT_TAG)], "feedback cell"),
  ];
  const sharedFunctionInfo = handle(constant(input, 0), "SharedFunctionInfo");
  if ((flags & 2) !== 0) {
    return [
      ...loadCell,
      ...callBuiltinWith("FastNewClosureBaseline", stubDescriptor(2, false), [sharedFunctionInfo, fromRegister(cell, "feedback cell")]),
    ];
  }
  const runtime = (flags & 1) !== 0 ? "NewClosure_Tenured" : "NewClosure";
  return [
    ...loadCell,
    loadContext(RegisterRoles.context),
    ...pushAll([sharedFunctionInfo, fromRegister(cell, "feedback cell")]),
    ...callRuntime(runtime, 2),
  ];
};

// VisitCreateBlockContext: Runtime::kPushBlockContext(scope info).
export const CreateBlockContext: Template = (input) => runtimeWithName("PushBlockContext", input, false);

// VisitCreateCatchContext: Runtime::kPushCatchContext(exception, scope info).
export const CreateCatchContext: Template = (input) => [
  loadContext(RegisterRoles.context),
  ...pushAll([frameRegister(numericOperand(input.bytecode, 0), "exception"), handle(constant(input, 1), "ScopeInfo")]),
  ...callRuntime("PushCatchContext", 2),
];

// VisitCreateFunctionContext: FastNewFunctionContextFunction(scope info, slot count), a Torque builtin with an implicit context.
export const CreateFunctionContext: Template = (input) =>
  callBuiltinWith("FastNewFunctionContextFunction", stubDescriptor(2, true), [
    handle(constant(input, 0), "ScopeInfo"),
    int(numericOperand(input.bytecode, 1), "slot count"),
  ]);
