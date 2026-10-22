// Shared emit helpers for the boolean-producing and branching templates, after V8's src/codegen/x64/macro-assembler-x64.cc
// (CheckSmi, LoadMap, CmpObjectType) and src/baseline/x64/baseline-assembler-x64-inl.h (TestAndBranch, LoadWord8Field).

import { type ConditionCode, type JccMnemonic } from "../x64/encodings";
import { imm, labelRef, mem, reg, type Label } from "../x64/Encoder";
import { RegisterRoles, type RegisterName } from "../x64/registers";
import { rootSlot } from "../isolateData";
import { asm, bind, callBuiltin, type Emit, type TemplateLabels } from "../Template";

export const ACC = RegisterRoles.accumulator;

// ScratchRegisterScope::AcquireScratch hands out r8 first (baseline-assembler-x64-inl.h, kScratchRegisters).
export const SCRATCH = "r8";

const HEAP_OBJECT_TAG = 1;
// Illustrative non-compressed layout (Node builds without pointer compression): Map::instance_type (u16) and Map::bit_field (u8).
const MAP_INSTANCE_TYPE_OFFSET = 12;
const MAP_BIT_FIELD_OFFSET = 14;

// MapBitFields1 (src/objects/map.tq): is_callable is bit 1, is_undetectable bit 4.
export const MapBits1 = { isCallable: 1 << 1, isUndetectable: 1 << 4 } as const;

// Illustrative InstanceType numbers (instance-type.h is generated); only FIRST_NONSTRING_TYPE = SYMBOL_TYPE >= 0x80 is pinned by V8.
export const InstanceTypes = { SYMBOL: 0x80, BIGINT: 0x82, HEAP_NUMBER: 0x83, FIRST_JS_RECEIVER: 0x410 } as const;

/** `j<cc> target`, the V8 `j(cc, target)`. */
export function jcc(cc: ConditionCode, target: Label): Emit {
  const mnemonic: JccMnemonic = `j${cc}`;
  return asm(mnemonic, [labelRef(target)]);
}

/** MacroAssembler::JumpIfSmi: CheckSmi is `testb value, kSmiTagMask`, taken on zero. */
export function jumpIfSmi(value: RegisterName, target: Label): Emit[] {
  return [asm("testb", [reg(value), imm(1)], "JumpIfSmi"), jcc("e", target)];
}

/** MacroAssembler::LoadMap: HeapObject::map is the first field. */
export function loadMap(into: RegisterName, object: RegisterName): Emit {
  return asm("mov", [reg(into), mem(object, -HEAP_OBJECT_TAG)], "LoadMap");
}

/** BaselineAssembler::LoadWord8Field of Map::bit_field. */
export function loadMapBitField(into: RegisterName, map: RegisterName): Emit {
  return asm("movb", [reg(into), mem(map, MAP_BIT_FIELD_OFFSET - HEAP_OBJECT_TAG)], "Map::bit_field");
}

/** BaselineAssembler::TestAndBranch with a mask that fits a byte: testb, then the condition. */
export function testAndBranch(value: RegisterName, mask: number, cc: ConditionCode, target: Label): Emit[] {
  return [asm("testb", [reg(value), imm(mask)]), jcc(cc, target)];
}

/** BaselineAssembler::JumpIfObjectType(Fast) without static roots: CmpObjectType (LoadMap, cmpw instance_type), then the branch. */
export function jumpIfObjectType(cc: ConditionCode, object: RegisterName, type: number, map: RegisterName, target: Label): Emit[] {
  return [
    loadMap(map, object),
    asm("cmpw", [mem(map, MAP_INSTANCE_TYPE_OFFSET - HEAP_OBJECT_TAG), imm(type)], "Map::instance_type"),
    jcc(cc, target),
  ];
}

/** LoadRoot(accumulator, RootIndex::k<root>). */
export function loadRootInto(root: string): Emit {
  return asm("mov", [reg(ACC), rootSlot(root)], `RootIndex::k${root}`);
}

/** BaselineCompiler::SelectBooleanConstant: false unless `jumpToTrue` branches to the label it is given. */
export function selectBooleanConstant(labels: TemplateLabels, jumpToTrue: (setTrue: Label) => readonly Emit[]): Emit[] {
  const done = labels.local("done");
  const setTrue = labels.local("set_true");
  return [...jumpToTrue(setTrue), loadRootInto("FalseValue"), asm("jmp", [labelRef(done)]), bind(setTrue), loadRootInto("TrueValue"), bind(done)];
}

/** BaselineCompiler::JumpIfToBoolean: ToBooleanForBaselineJump returns the flag Smi in rdx, the value stays in rax. */
export function jumpIfToBoolean(doJumpIfTrue: boolean, target: Label): Emit[] {
  const flag = RegisterRoles.return1;
  return [
    callBuiltin("ToBooleanForBaselineJump"),
    asm("test", [reg(flag), reg(flag)], "SmiCompare(Smi 0)"),
    jcc(doJumpIfTrue ? "ne" : "e", target),
  ];
}
