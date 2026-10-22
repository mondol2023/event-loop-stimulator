// Opcode -> template, exhaustive by type (D3); BaselineCompiler::VisitSingleBytecode's dispatch in src/baseline/baseline-compiler.cc.

import { BYTECODES, type Opcode } from "../../bytecode/bytecodes";
import { callBuiltin, type Template } from "../Template";
import { Add } from "./arith";
import { JumpIfFalse } from "./jumps";
import {
  LdaContextSlot,
  LdaCurrentContextSlot,
  LdaCurrentScriptContextSlot,
  LdaScriptContextSlot,
  PopContext,
  PushContext,
  StaContextSlot,
  StaCurrentContextSlot,
  StaCurrentScriptContextSlot,
  StaScriptContextSlot,
} from "./contexts";
import {
  LdaConstant,
  LdaFalse,
  LdaGlobal,
  LdaGlobalInsideTypeof,
  LdaLookupContextSlot,
  LdaLookupContextSlotInsideTypeof,
  LdaLookupGlobalSlot,
  LdaLookupGlobalSlotInsideTypeof,
  LdaLookupScriptContextSlot,
  LdaLookupScriptContextSlotInsideTypeof,
  LdaLookupSlot,
  LdaLookupSlotInsideTypeof,
  LdaNull,
  LdaSmi,
  LdaTheHole,
  LdaTrue,
  LdaUndefined,
  LdaZero,
  Ldar,
  Mov,
  ShortStar,
  StaGlobal,
  StaLookupSlot,
  Star,
} from "./loads";

// SHORT_STAR_BYTECODE_LIST: Star0..Star15 share one template, parameterized by the register in the opcode name.
const SHORT_STARS = Object.fromEntries(Array.from({ length: 16 }, (_, k) => [`Star${k}`, ShortStar])) as Record<`Star${number}`, Template>;

// Stub for opcodes without a template yet: Sparkplug's out-of-line shape, a call to Builtin::k<Opcode>_Baseline.
function builtinStub(opcode: Opcode): Template {
  return () => [callBuiltin(`${opcode}_Baseline`)];
}

// VisitWide/VisitExtraWide are UNREACHABLE: the iterator folds the prefix into the next bytecode's operands.
const prefix: Template = ({ bytecode }) => {
  throw new Error(`${bytecode.opcode} is a prefix and never reaches a template`);
};

const STUBS = Object.fromEntries((Object.keys(BYTECODES) as Opcode[]).map((opcode) => [opcode, builtinStub(opcode)])) as Record<
  Opcode,
  Template
>;

export const TEMPLATES = {
  ...STUBS,
  Wide: prefix,
  ExtraWide: prefix,
  ...SHORT_STARS,
  Ldar,
  LdaZero,
  LdaSmi,
  LdaUndefined,
  LdaNull,
  LdaTheHole,
  LdaTrue,
  LdaFalse,
  LdaConstant,
  Star,
  Mov,
  LdaGlobal,
  LdaGlobalInsideTypeof,
  StaGlobal,
  LdaLookupSlot,
  LdaLookupSlotInsideTypeof,
  LdaLookupContextSlot,
  LdaLookupScriptContextSlot,
  LdaLookupGlobalSlot,
  LdaLookupContextSlotInsideTypeof,
  LdaLookupScriptContextSlotInsideTypeof,
  LdaLookupGlobalSlotInsideTypeof,
  StaLookupSlot,
  PushContext,
  PopContext,
  LdaContextSlot,
  LdaImmutableContextSlot: LdaContextSlot,
  LdaScriptContextSlot,
  LdaCurrentContextSlot,
  LdaImmutableCurrentContextSlot: LdaCurrentContextSlot,
  LdaCurrentScriptContextSlot,
  StaContextSlot,
  StaCurrentContextSlot,
  StaScriptContextSlot,
  StaCurrentScriptContextSlot,
  Add,
  JumpIfFalse,
} satisfies Record<Opcode, Template>;
