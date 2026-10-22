// Comparisons and boolean-producing tests, after V8's src/baseline/baseline-compiler.cc (VisitTest*, VisitLogicalNot,
// VisitToBooleanLogicalNot); Compare_BaselineDescriptor is rdx, rax, rbx and KeyedHasICBaselineDescriptor rax, rdx, rcx.

import { imm, labelRef, reg, type Label } from "../x64/Encoder";
import { registerOperand } from "../frame";
import { rootSlot } from "../isolateData";
import { asm, bind, callBuiltin, numericOperand, type Emit, type Template } from "../Template";
import {
  ACC,
  InstanceTypes,
  jcc,
  jumpIfObjectType,
  jumpIfSmi,
  jumpIfToBoolean,
  loadMap,
  loadMapBitField,
  loadRootInto,
  MapBits1,
  SCRATCH,
  selectBooleanConstant,
  testAndBranch,
} from "./checks";
import { taggedIndex } from "./loads";

// VisitTestEqual..VisitTestGreaterThanOrEqual: CallBuiltin<k<Op>_Baseline>(RegisterOperand(0), accumulator, Index(1)).
function compareOp(builtin: string): Template {
  return ({ bytecode }) => [
    asm("mov", [reg("rdx"), registerOperand(numericOperand(bytecode, 0))], "lhs"),
    asm("mov", [reg("rbx"), imm(numericOperand(bytecode, 1))], "feedback slot"),
    callBuiltin(builtin),
  ];
}

export const TestEqual = compareOp("Equal_Baseline");
export const TestEqualStrict = compareOp("StrictEqual_Baseline");
export const TestLessThan = compareOp("LessThan_Baseline");
export const TestGreaterThan = compareOp("GreaterThan_Baseline");
export const TestLessThanOrEqual = compareOp("LessThanOrEqual_Baseline");
export const TestGreaterThanOrEqual = compareOp("GreaterThanOrEqual_Baseline");
// VisitTestInstanceOf: the callable moves from the accumulator to kRight, which is rax already.
export const TestInstanceOf = compareOp("InstanceOf_Baseline");

// VisitTestIn: KeyedHasICBaseline(object = accumulator, name = RegisterOperand(0), IndexAsTagged(1)).
export const TestIn: Template = ({ bytecode }) => [
  asm("mov", [reg("rdx"), registerOperand(numericOperand(bytecode, 0))], "name"),
  asm("mov", [reg("rcx"), imm(taggedIndex(numericOperand(bytecode, 1)))], "IndexAsTagged(1)"),
  callBuiltin("KeyedHasICBaseline"),
];

// VisitTestReferenceEqual: JumpIfTagged(kEqual, RegisterFrameOperand(0), accumulator).
export const TestReferenceEqual: Template = ({ bytecode, labels }) =>
  selectBooleanConstant(labels, (setTrue) => [asm("cmp", [registerOperand(numericOperand(bytecode, 0)), reg(ACC)]), jcc("e", setTrue)]);

function testRoot(root: string): Template {
  return ({ labels }) =>
    selectBooleanConstant(labels, (setTrue) => [asm("cmp", [reg(ACC), rootSlot(root)], `RootIndex::k${root}`), jcc("e", setTrue)]);
}
// VisitTestNull, VisitTestUndefined, VisitLogicalNot.
export const TestNull = testRoot("NullValue");
export const TestUndefined = testRoot("UndefinedValue");
export const LogicalNot = testRoot("FalseValue");

// VisitToBooleanLogicalNot: JumpIfToBoolean(false, if_true).
export const ToBooleanLogicalNot: Template = ({ labels }) => selectBooleanConstant(labels, (setTrue) => jumpIfToBoolean(false, setTrue));

// VisitTestUndetectable: Smis are not; otherwise the map's is_undetectable bit decides.
export const TestUndetectable: Template = ({ labels }) => {
  const done = labels.local("done");
  const isSmi = labels.local("is_smi");
  const notUndetectable = labels.local("not_undetectable");
  return [
    ...jumpIfSmi(ACC, isSmi),
    loadMap(ACC, ACC),
    loadMapBitField(ACC, ACC),
    ...testAndBranch(ACC, MapBits1.isUndetectable, "e", notUndetectable),
    loadRootInto("TrueValue"),
    asm("jmp", [labelRef(done)]),
    bind(isSmi),
    bind(notUndetectable),
    loadRootInto("FalseValue"),
    bind(done),
  ];
};

// The shared shape of most VisitTestTypeOf cases: true, jump to done, then the bound false-side labels, then false.
function trueThenFalse(done: Label, falseLabels: readonly Label[]): Emit[] {
  return [loadRootInto("TrueValue"), asm("jmp", [labelRef(done)]), ...falseLabels.map(bind), loadRootInto("FalseValue")];
}

// VisitTestTypeOf: the literal flag is interpreter::TestTypeOfFlags::LiteralFlag; kOther is UNREACHABLE.
export const TestTypeOf: Template = ({ bytecode, labels }) => {
  const done = labels.local("done");
  const isSmi = labels.local("is_smi");
  const bad = labels.local("bad_instance_type");
  const isNull = labels.local("is_null");
  const isHeapNumber = labels.local("is_heap_number");
  const isTrue = labels.local("is_true");
  const isFalse = labels.local("is_false");
  const notUndetectable = labels.local("not_undetectable");
  const notCallable = labels.local("not_callable");
  const undetectable = labels.local("undetectable");
  const undetectableOrCallable = labels.local("undetectable_or_callable");
  const flag = numericOperand(bytecode, 0);
  const body = ((): Emit[] => {
    switch (flag) {
      case 0: // kNumber
        return [
          ...jumpIfSmi(ACC, isSmi),
          ...jumpIfObjectType("e", ACC, InstanceTypes.HEAP_NUMBER, SCRATCH, isHeapNumber),
          loadRootInto("FalseValue"),
          asm("jmp", [labelRef(done)]),
          bind(isSmi),
          bind(isHeapNumber),
          loadRootInto("TrueValue"),
        ];
      case 1: // kString: instance types below FIRST_NONSTRING_TYPE (SYMBOL_TYPE) are strings
        return [
          ...jumpIfSmi(ACC, isSmi),
          ...jumpIfObjectType("ge", ACC, InstanceTypes.SYMBOL, SCRATCH, bad),
          ...trueThenFalse(done, [isSmi, bad]),
        ];
      case 2: // kSymbol
        return [
          ...jumpIfSmi(ACC, isSmi),
          ...jumpIfObjectType("ne", ACC, InstanceTypes.SYMBOL, SCRATCH, bad),
          ...trueThenFalse(done, [isSmi, bad]),
        ];
      case 3: // kBoolean
        return [
          asm("cmp", [reg(ACC), rootSlot("TrueValue")], "RootIndex::kTrueValue"),
          jcc("e", isTrue),
          asm("cmp", [reg(ACC), rootSlot("FalseValue")], "RootIndex::kFalseValue"),
          jcc("e", isFalse),
          loadRootInto("FalseValue"),
          asm("jmp", [labelRef(done)]),
          bind(isTrue),
          bind(isFalse),
          loadRootInto("TrueValue"),
        ];
      case 4: // kBigInt
        return [
          ...jumpIfSmi(ACC, isSmi),
          ...jumpIfObjectType("ne", ACC, InstanceTypes.BIGINT, SCRATCH, bad),
          ...trueThenFalse(done, [isSmi, bad]),
        ];
      case 5: // kUndefined: null is undetectable but typeof null is "object", so it is excluded first
        return [
          ...jumpIfSmi(ACC, isSmi),
          asm("cmp", [reg(ACC), rootSlot("NullValue")], "RootIndex::kNullValue"),
          jcc("e", isNull),
          loadMap(ACC, ACC),
          loadMapBitField(ACC, ACC),
          ...testAndBranch(ACC, MapBits1.isUndetectable, "e", notUndetectable),
          ...trueThenFalse(done, [isSmi, isNull, notUndetectable]),
        ];
      case 6: // kFunction: callable and not undetectable
        return [
          ...jumpIfSmi(ACC, isSmi),
          loadMap(ACC, ACC),
          loadMapBitField(ACC, ACC),
          ...testAndBranch(ACC, MapBits1.isCallable, "e", notCallable),
          ...testAndBranch(ACC, MapBits1.isUndetectable, "ne", undetectable),
          ...trueThenFalse(done, [isSmi, notCallable, undetectable]),
        ];
      case 7: // kObject: null, or a receiver that is neither undetectable nor callable
        return [
          ...jumpIfSmi(ACC, isSmi),
          asm("cmp", [reg(ACC), rootSlot("NullValue")], "RootIndex::kNullValue"),
          jcc("e", isNull),
          ...jumpIfObjectType("l", ACC, InstanceTypes.FIRST_JS_RECEIVER, SCRATCH, bad),
          loadMapBitField(ACC, SCRATCH),
          ...testAndBranch(ACC, MapBits1.isUndetectable | MapBits1.isCallable, "ne", undetectableOrCallable),
          bind(isNull),
          loadRootInto("TrueValue"),
          asm("jmp", [labelRef(done)]),
          bind(isSmi),
          bind(bad),
          bind(undetectableOrCallable),
          loadRootInto("FalseValue"),
        ];
      default:
        throw new Error(`TestTypeOf literal flag ${flag} is kOther, which V8 treats as UNREACHABLE`);
    }
  })();
  return [...body, bind(done)];
};
