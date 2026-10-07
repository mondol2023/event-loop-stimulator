// The Ignition bytecode set of the pinned V8 (13.6.233.17, Node 24.19.0; see docs/TARGET.md).
//
// `BYTECODES` is transcribed from V8's `src/interpreter/bytecodes.h` at that tag: one entry per
// opcode with its operand types and its use of the accumulator. The count and a hash of the
// header it was transcribed from are recorded in tests/conformance/support/bytecodes.h.sha256
// and checked by tests/conformance/bytecodes-table.test.ts. Everything below the table is
// hand-written.

export type OperandType =
  | "Reg"
  | "RegList"
  | "RegPair"
  | "RegOut"
  | "RegOutList"
  | "RegOutPair"
  | "RegOutTriple"
  | "RegInOut"
  | "Imm"
  | "UImm"
  | "Idx"
  | "RegCount"
  | "Flag8"
  | "Flag16"
  | "IntrinsicId"
  | "RuntimeId"
  | "NativeContextIndex";

export type AccumulatorUse = "none" | "read" | "write" | "readwrite" | "clobber" | "read-clobber";

export type BytecodeInfo = {
  readonly operands: readonly OperandType[];
  readonly accumulator: AccumulatorUse;
  /** The sixteen `Star0`..`Star15` forms of `Star`: one byte, the register is in the opcode. */
  readonly shortStar?: true;
};

export const BYTECODE_TABLE_SOURCE = {
  file: "src/interpreter/bytecodes.h",
  tag: "13.6.233.17",
  sha256: "501c46f5c36ca65ae0d225bb661dcec343db637745d6110b523bb2be8c08668a",
  count: 208,
} as const;

export const BYTECODE_COUNT = BYTECODE_TABLE_SOURCE.count;

export const BYTECODES = {
  Wide: { operands: [], accumulator: "none" },
  ExtraWide: { operands: [], accumulator: "none" },
  DebugBreakWide: { operands: [], accumulator: "readwrite" },
  DebugBreakExtraWide: { operands: [], accumulator: "readwrite" },
  DebugBreak0: { operands: [], accumulator: "readwrite" },
  DebugBreak1: { operands: ["Reg"], accumulator: "readwrite" },
  DebugBreak2: { operands: ["Reg", "Reg"], accumulator: "readwrite" },
  DebugBreak3: { operands: ["Reg", "Reg", "Reg"], accumulator: "readwrite" },
  DebugBreak4: { operands: ["Reg", "Reg", "Reg", "Reg"], accumulator: "readwrite" },
  DebugBreak5: { operands: ["RuntimeId", "Reg", "Reg"], accumulator: "readwrite" },
  DebugBreak6: { operands: ["RuntimeId", "Reg", "Reg", "Reg"], accumulator: "readwrite" },
  Ldar: { operands: ["Reg"], accumulator: "write" },
  LdaZero: { operands: [], accumulator: "write" },
  LdaSmi: { operands: ["Imm"], accumulator: "write" },
  LdaUndefined: { operands: [], accumulator: "write" },
  LdaNull: { operands: [], accumulator: "write" },
  LdaTheHole: { operands: [], accumulator: "write" },
  LdaTrue: { operands: [], accumulator: "write" },
  LdaFalse: { operands: [], accumulator: "write" },
  LdaConstant: { operands: ["Idx"], accumulator: "write" },
  LdaContextSlot: { operands: ["Reg", "Idx", "UImm"], accumulator: "write" },
  LdaScriptContextSlot: { operands: ["Reg", "Idx", "UImm"], accumulator: "write" },
  LdaImmutableContextSlot: { operands: ["Reg", "Idx", "UImm"], accumulator: "write" },
  LdaCurrentContextSlot: { operands: ["Idx"], accumulator: "write" },
  LdaCurrentScriptContextSlot: { operands: ["Idx"], accumulator: "write" },
  LdaImmutableCurrentContextSlot: { operands: ["Idx"], accumulator: "write" },
  Star: { operands: ["RegOut"], accumulator: "read" },
  Mov: { operands: ["Reg", "RegOut"], accumulator: "none" },
  PushContext: { operands: ["RegOut"], accumulator: "read" },
  PopContext: { operands: ["Reg"], accumulator: "none" },
  TestReferenceEqual: { operands: ["Reg"], accumulator: "readwrite" },
  TestUndetectable: { operands: [], accumulator: "readwrite" },
  TestNull: { operands: [], accumulator: "readwrite" },
  TestUndefined: { operands: [], accumulator: "readwrite" },
  TestTypeOf: { operands: ["Flag8"], accumulator: "readwrite" },
  LdaGlobal: { operands: ["Idx", "Idx"], accumulator: "write" },
  LdaGlobalInsideTypeof: { operands: ["Idx", "Idx"], accumulator: "write" },
  StaGlobal: { operands: ["Idx", "Idx"], accumulator: "read-clobber" },
  StaContextSlot: { operands: ["Reg", "Idx", "UImm"], accumulator: "read" },
  StaCurrentContextSlot: { operands: ["Idx"], accumulator: "read" },
  StaScriptContextSlot: { operands: ["Reg", "Idx", "UImm"], accumulator: "read" },
  StaCurrentScriptContextSlot: { operands: ["Idx"], accumulator: "read" },
  LdaLookupSlot: { operands: ["Idx"], accumulator: "write" },
  LdaLookupContextSlot: { operands: ["Idx", "Idx", "UImm"], accumulator: "write" },
  LdaLookupScriptContextSlot: { operands: ["Idx", "Idx", "UImm"], accumulator: "write" },
  LdaLookupGlobalSlot: { operands: ["Idx", "Idx", "UImm"], accumulator: "write" },
  LdaLookupSlotInsideTypeof: { operands: ["Idx"], accumulator: "write" },
  LdaLookupContextSlotInsideTypeof: { operands: ["Idx", "Idx", "UImm"], accumulator: "write" },
  LdaLookupScriptContextSlotInsideTypeof: { operands: ["Idx", "Idx", "UImm"], accumulator: "write" },
  LdaLookupGlobalSlotInsideTypeof: { operands: ["Idx", "Idx", "UImm"], accumulator: "write" },
  StaLookupSlot: { operands: ["Idx", "Flag8"], accumulator: "readwrite" },
  GetNamedProperty: { operands: ["Reg", "Idx", "Idx"], accumulator: "write" },
  GetNamedPropertyFromSuper: { operands: ["Reg", "Idx", "Idx"], accumulator: "readwrite" },
  GetKeyedProperty: { operands: ["Reg", "Idx"], accumulator: "readwrite" },
  GetEnumeratedKeyedProperty: { operands: ["Reg", "Reg", "Reg", "Idx"], accumulator: "readwrite" },
  LdaModuleVariable: { operands: ["Imm", "UImm"], accumulator: "write" },
  StaModuleVariable: { operands: ["Imm", "UImm"], accumulator: "read" },
  SetNamedProperty: { operands: ["Reg", "Idx", "Idx"], accumulator: "read-clobber" },
  DefineNamedOwnProperty: { operands: ["Reg", "Idx", "Idx"], accumulator: "read-clobber" },
  SetKeyedProperty: { operands: ["Reg", "Reg", "Idx"], accumulator: "read-clobber" },
  DefineKeyedOwnProperty: { operands: ["Reg", "Reg", "Flag8", "Idx"], accumulator: "read-clobber" },
  StaInArrayLiteral: { operands: ["Reg", "Reg", "Idx"], accumulator: "read-clobber" },
  DefineKeyedOwnPropertyInLiteral: { operands: ["Reg", "Reg", "Flag8", "Idx"], accumulator: "read" },
  Add: { operands: ["Reg", "Idx"], accumulator: "readwrite" },
  Sub: { operands: ["Reg", "Idx"], accumulator: "readwrite" },
  Mul: { operands: ["Reg", "Idx"], accumulator: "readwrite" },
  Div: { operands: ["Reg", "Idx"], accumulator: "readwrite" },
  Mod: { operands: ["Reg", "Idx"], accumulator: "readwrite" },
  Exp: { operands: ["Reg", "Idx"], accumulator: "readwrite" },
  BitwiseOr: { operands: ["Reg", "Idx"], accumulator: "readwrite" },
  BitwiseXor: { operands: ["Reg", "Idx"], accumulator: "readwrite" },
  BitwiseAnd: { operands: ["Reg", "Idx"], accumulator: "readwrite" },
  ShiftLeft: { operands: ["Reg", "Idx"], accumulator: "readwrite" },
  ShiftRight: { operands: ["Reg", "Idx"], accumulator: "readwrite" },
  ShiftRightLogical: { operands: ["Reg", "Idx"], accumulator: "readwrite" },
  AddSmi: { operands: ["Imm", "Idx"], accumulator: "readwrite" },
  SubSmi: { operands: ["Imm", "Idx"], accumulator: "readwrite" },
  MulSmi: { operands: ["Imm", "Idx"], accumulator: "readwrite" },
  DivSmi: { operands: ["Imm", "Idx"], accumulator: "readwrite" },
  ModSmi: { operands: ["Imm", "Idx"], accumulator: "readwrite" },
  ExpSmi: { operands: ["Imm", "Idx"], accumulator: "readwrite" },
  BitwiseOrSmi: { operands: ["Imm", "Idx"], accumulator: "readwrite" },
  BitwiseXorSmi: { operands: ["Imm", "Idx"], accumulator: "readwrite" },
  BitwiseAndSmi: { operands: ["Imm", "Idx"], accumulator: "readwrite" },
  ShiftLeftSmi: { operands: ["Imm", "Idx"], accumulator: "readwrite" },
  ShiftRightSmi: { operands: ["Imm", "Idx"], accumulator: "readwrite" },
  ShiftRightLogicalSmi: { operands: ["Imm", "Idx"], accumulator: "readwrite" },
  Inc: { operands: ["Idx"], accumulator: "readwrite" },
  Dec: { operands: ["Idx"], accumulator: "readwrite" },
  Negate: { operands: ["Idx"], accumulator: "readwrite" },
  BitwiseNot: { operands: ["Idx"], accumulator: "readwrite" },
  ToBooleanLogicalNot: { operands: [], accumulator: "readwrite" },
  LogicalNot: { operands: [], accumulator: "readwrite" },
  TypeOf: { operands: ["Idx"], accumulator: "readwrite" },
  DeletePropertyStrict: { operands: ["Reg"], accumulator: "readwrite" },
  DeletePropertySloppy: { operands: ["Reg"], accumulator: "readwrite" },
  GetSuperConstructor: { operands: ["RegOut"], accumulator: "read" },
  FindNonDefaultConstructorOrConstruct: { operands: ["Reg", "Reg", "RegOutPair"], accumulator: "none" },
  CallAnyReceiver: { operands: ["Reg", "RegList", "RegCount", "Idx"], accumulator: "write" },
  CallProperty: { operands: ["Reg", "RegList", "RegCount", "Idx"], accumulator: "write" },
  CallProperty0: { operands: ["Reg", "Reg", "Idx"], accumulator: "write" },
  CallProperty1: { operands: ["Reg", "Reg", "Reg", "Idx"], accumulator: "write" },
  CallProperty2: { operands: ["Reg", "Reg", "Reg", "Reg", "Idx"], accumulator: "write" },
  CallUndefinedReceiver: { operands: ["Reg", "RegList", "RegCount", "Idx"], accumulator: "write" },
  CallUndefinedReceiver0: { operands: ["Reg", "Idx"], accumulator: "write" },
  CallUndefinedReceiver1: { operands: ["Reg", "Reg", "Idx"], accumulator: "write" },
  CallUndefinedReceiver2: { operands: ["Reg", "Reg", "Reg", "Idx"], accumulator: "write" },
  CallWithSpread: { operands: ["Reg", "RegList", "RegCount", "Idx"], accumulator: "write" },
  CallRuntime: { operands: ["RuntimeId", "RegList", "RegCount"], accumulator: "write" },
  CallRuntimeForPair: { operands: ["RuntimeId", "RegList", "RegCount", "RegOutPair"], accumulator: "clobber" },
  CallJSRuntime: { operands: ["NativeContextIndex", "RegList", "RegCount"], accumulator: "write" },
  InvokeIntrinsic: { operands: ["IntrinsicId", "RegList", "RegCount"], accumulator: "write" },
  Construct: { operands: ["Reg", "RegList", "RegCount", "Idx"], accumulator: "readwrite" },
  ConstructWithSpread: { operands: ["Reg", "RegList", "RegCount", "Idx"], accumulator: "readwrite" },
  ConstructForwardAllArgs: { operands: ["Reg", "Idx"], accumulator: "readwrite" },
  TestEqual: { operands: ["Reg", "Idx"], accumulator: "readwrite" },
  TestEqualStrict: { operands: ["Reg", "Idx"], accumulator: "readwrite" },
  TestLessThan: { operands: ["Reg", "Idx"], accumulator: "readwrite" },
  TestGreaterThan: { operands: ["Reg", "Idx"], accumulator: "readwrite" },
  TestLessThanOrEqual: { operands: ["Reg", "Idx"], accumulator: "readwrite" },
  TestGreaterThanOrEqual: { operands: ["Reg", "Idx"], accumulator: "readwrite" },
  TestInstanceOf: { operands: ["Reg", "Idx"], accumulator: "readwrite" },
  TestIn: { operands: ["Reg", "Idx"], accumulator: "readwrite" },
  ToName: { operands: [], accumulator: "readwrite" },
  ToNumber: { operands: ["Idx"], accumulator: "readwrite" },
  ToNumeric: { operands: ["Idx"], accumulator: "readwrite" },
  ToObject: { operands: ["RegOut"], accumulator: "read" },
  ToString: { operands: [], accumulator: "readwrite" },
  ToBoolean: { operands: [], accumulator: "readwrite" },
  CreateRegExpLiteral: { operands: ["Idx", "Idx", "Flag16"], accumulator: "write" },
  CreateArrayLiteral: { operands: ["Idx", "Idx", "Flag8"], accumulator: "write" },
  CreateArrayFromIterable: { operands: [], accumulator: "readwrite" },
  CreateEmptyArrayLiteral: { operands: ["Idx"], accumulator: "write" },
  CreateObjectLiteral: { operands: ["Idx", "Idx", "Flag8"], accumulator: "write" },
  CreateEmptyObjectLiteral: { operands: [], accumulator: "write" },
  CloneObject: { operands: ["Reg", "Flag8", "Idx"], accumulator: "write" },
  GetTemplateObject: { operands: ["Idx", "Idx"], accumulator: "write" },
  CreateClosure: { operands: ["Idx", "Idx", "Flag8"], accumulator: "write" },
  CreateBlockContext: { operands: ["Idx"], accumulator: "write" },
  CreateCatchContext: { operands: ["Reg", "Idx"], accumulator: "write" },
  CreateFunctionContext: { operands: ["Idx", "UImm"], accumulator: "write" },
  CreateEvalContext: { operands: ["Idx", "UImm"], accumulator: "write" },
  CreateWithContext: { operands: ["Reg", "Idx"], accumulator: "write" },
  CreateMappedArguments: { operands: [], accumulator: "write" },
  CreateUnmappedArguments: { operands: [], accumulator: "write" },
  CreateRestParameter: { operands: [], accumulator: "write" },
  JumpLoop: { operands: ["UImm", "Imm", "Idx"], accumulator: "clobber" },
  Jump: { operands: ["UImm"], accumulator: "none" },
  JumpConstant: { operands: ["Idx"], accumulator: "none" },
  JumpIfNullConstant: { operands: ["Idx"], accumulator: "read" },
  JumpIfNotNullConstant: { operands: ["Idx"], accumulator: "read" },
  JumpIfUndefinedConstant: { operands: ["Idx"], accumulator: "read" },
  JumpIfNotUndefinedConstant: { operands: ["Idx"], accumulator: "read" },
  JumpIfUndefinedOrNullConstant: { operands: ["Idx"], accumulator: "read" },
  JumpIfTrueConstant: { operands: ["Idx"], accumulator: "read" },
  JumpIfFalseConstant: { operands: ["Idx"], accumulator: "read" },
  JumpIfJSReceiverConstant: { operands: ["Idx"], accumulator: "read" },
  JumpIfForInDoneConstant: { operands: ["Idx", "Reg", "Reg"], accumulator: "none" },
  JumpIfToBooleanTrueConstant: { operands: ["Idx"], accumulator: "read" },
  JumpIfToBooleanFalseConstant: { operands: ["Idx"], accumulator: "read" },
  JumpIfToBooleanTrue: { operands: ["UImm"], accumulator: "read" },
  JumpIfToBooleanFalse: { operands: ["UImm"], accumulator: "read" },
  JumpIfTrue: { operands: ["UImm"], accumulator: "read" },
  JumpIfFalse: { operands: ["UImm"], accumulator: "read" },
  JumpIfNull: { operands: ["UImm"], accumulator: "read" },
  JumpIfNotNull: { operands: ["UImm"], accumulator: "read" },
  JumpIfUndefined: { operands: ["UImm"], accumulator: "read" },
  JumpIfNotUndefined: { operands: ["UImm"], accumulator: "read" },
  JumpIfUndefinedOrNull: { operands: ["UImm"], accumulator: "read" },
  JumpIfJSReceiver: { operands: ["UImm"], accumulator: "read" },
  JumpIfForInDone: { operands: ["UImm", "Reg", "Reg"], accumulator: "none" },
  SwitchOnSmiNoFeedback: { operands: ["Idx", "UImm", "Imm"], accumulator: "read" },
  ForInEnumerate: { operands: ["Reg"], accumulator: "write" },
  ForInPrepare: { operands: ["RegOutTriple", "Idx"], accumulator: "read-clobber" },
  ForInNext: { operands: ["Reg", "Reg", "RegPair", "Idx"], accumulator: "write" },
  ForInStep: { operands: ["RegInOut"], accumulator: "none" },
  SetPendingMessage: { operands: [], accumulator: "readwrite" },
  Throw: { operands: [], accumulator: "read" },
  ReThrow: { operands: [], accumulator: "read" },
  Return: { operands: [], accumulator: "read" },
  ThrowReferenceErrorIfHole: { operands: ["Idx"], accumulator: "read" },
  ThrowSuperNotCalledIfHole: { operands: [], accumulator: "read" },
  ThrowSuperAlreadyCalledIfNotHole: { operands: [], accumulator: "read" },
  ThrowIfNotSuperConstructor: { operands: ["Reg"], accumulator: "none" },
  SwitchOnGeneratorState: { operands: ["Reg", "Idx", "UImm"], accumulator: "none" },
  SuspendGenerator: { operands: ["Reg", "RegList", "RegCount", "UImm"], accumulator: "read" },
  ResumeGenerator: { operands: ["Reg", "RegOutList", "RegCount"], accumulator: "write" },
  GetIterator: { operands: ["Reg", "Idx", "Idx"], accumulator: "write" },
  Debugger: { operands: [], accumulator: "clobber" },
  IncBlockCounter: { operands: ["Idx"], accumulator: "none" },
  Abort: { operands: ["Idx"], accumulator: "none" },
  Star15: { operands: [], accumulator: "read", shortStar: true },
  Star14: { operands: [], accumulator: "read", shortStar: true },
  Star13: { operands: [], accumulator: "read", shortStar: true },
  Star12: { operands: [], accumulator: "read", shortStar: true },
  Star11: { operands: [], accumulator: "read", shortStar: true },
  Star10: { operands: [], accumulator: "read", shortStar: true },
  Star9: { operands: [], accumulator: "read", shortStar: true },
  Star8: { operands: [], accumulator: "read", shortStar: true },
  Star7: { operands: [], accumulator: "read", shortStar: true },
  Star6: { operands: [], accumulator: "read", shortStar: true },
  Star5: { operands: [], accumulator: "read", shortStar: true },
  Star4: { operands: [], accumulator: "read", shortStar: true },
  Star3: { operands: [], accumulator: "read", shortStar: true },
  Star2: { operands: [], accumulator: "read", shortStar: true },
  Star1: { operands: [], accumulator: "read", shortStar: true },
  Star0: { operands: [], accumulator: "read", shortStar: true },
  Illegal: { operands: [], accumulator: "none" },
} as const satisfies Record<string, BytecodeInfo>;

export type Opcode = keyof typeof BYTECODES;

/** What a bytecode takes, as a plain (non-literal) record. */
export function bytecodeInfo(opcode: Opcode): BytecodeInfo {
  return BYTECODES[opcode];
}

/** The width of an operand scale: 1 = no prefix, 2 = `Wide` (16 bit), 4 = `ExtraWide` (32 bit). */
export type OperandScale = 1 | 2 | 4;

/** An operand value: a number, or the name of a runtime function / intrinsic (never encoded here). */
export type Operand = number | string;

const SIGNED: ReadonlySet<OperandType> = new Set([
  "Reg",
  "RegList",
  "RegPair",
  "RegOut",
  "RegOutList",
  "RegOutPair",
  "RegOutTriple",
  "RegInOut",
  "Imm",
]);
const UNSIGNED: ReadonlySet<OperandType> = new Set(["Idx", "UImm", "RegCount"]);
const REGISTER: ReadonlySet<OperandType> = new Set([
  "Reg",
  "RegList",
  "RegPair",
  "RegOut",
  "RegOutList",
  "RegOutPair",
  "RegOutTriple",
  "RegInOut",
]);
const FIXED_SIZE: Partial<Record<OperandType, number>> = {
  Flag8: 1,
  IntrinsicId: 1,
  NativeContextIndex: 1,
  Flag16: 2,
  RuntimeId: 2,
};
const NAMED: ReadonlySet<OperandType> = new Set(["IntrinsicId", "RuntimeId"]);

export const OPERAND_SCALES: readonly OperandScale[] = [1, 2, 4];

/** Byte widths of each operand of `opcode` under `scale`. Fixed-width operands ignore the scale. */
export function operandSizes(opcode: Opcode, scale: OperandScale): number[] {
  return bytecodeInfo(opcode).operands.map((type) => FIXED_SIZE[type] ?? scale);
}

// Registers. An operand is the register's position relative to the frame pointer, in words:
// the locals r0, r1, … sit below the fixed frame header (so r0 is -7 and grows downwards), the
// receiver and the arguments above it, and the current context and the closure in the header.
// Verified against the bytes of `--print-bytecode`, e.g. `Ldar r0` = 0b f9, `Ldar a0` = 0b 03.
export const CURRENT_CONTEXT = -1;
export const CLOSURE = -2;
export const THIS = 2;
const FIRST_LOCAL = -7;
const FIRST_ARGUMENT = 3;

/** The operand for local register `index` (r0, r1, …). */
export const local = (index: number): number => FIRST_LOCAL - index;
/** The operand for the argument `index` (a0, a1, …); the receiver is `THIS`. */
export const argument = (index: number): number => FIRST_ARGUMENT + index;

export function isValidRegister(operand: number): boolean {
  return operand === CURRENT_CONTEXT || operand === CLOSURE || operand >= THIS || operand <= FIRST_LOCAL;
}

/** A register operand as `--print-bytecode` writes it: `r3`, `a0`, `<this>`, `<context>`, `<closure>`. */
export function formatRegister(operand: number): string {
  if (operand === CURRENT_CONTEXT) return "<context>";
  if (operand === CLOSURE) return "<closure>";
  if (operand === THIS) return "<this>";
  if (operand >= FIRST_ARGUMENT) return `a${operand - FIRST_ARGUMENT}`;
  if (operand <= FIRST_LOCAL) return `r${FIRST_LOCAL - operand}`;
  throw new Error(`${operand} is not a register operand`);
}

function fitsScale(type: OperandType, value: number, scale: OperandScale): boolean {
  const bits = 8 * scale;
  if (SIGNED.has(type)) return value >= -(2 ** (bits - 1)) && value <= 2 ** (bits - 1) - 1;
  return value >= 0 && value <= 2 ** bits - 1;
}

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * The smallest scale at which every scalable operand fits, as V8's builder chooses it.
 * Throws an `Error` for operands that do not match the opcode: that is a bug in the caller.
 */
export function requiredScale(opcode: Opcode, operands: readonly Operand[]): OperandScale {
  const types = bytecodeInfo(opcode).operands;
  if (operands.length !== types.length) {
    throw new Error(`${opcode} takes ${plural(types.length, "operand")}, got ${operands.length}`);
  }
  let scale: OperandScale = 1;
  types.forEach((type, i) => {
    const value = operands[i];
    const where = `${opcode} operand ${i} (${type})`;
    if (NAMED.has(type)) {
      if (typeof value !== "string" && typeof value !== "number") throw new Error(`${where} must be a name or a number`);
      if (typeof value === "string") return;
    }
    if (typeof value !== "number" || !Number.isInteger(value)) throw new Error(`${where} must be an integer, got ${String(value)}`);
    if (REGISTER.has(type) && !isValidRegister(value)) throw new Error(`${where}: ${value} is not a register`);

    const fixed = FIXED_SIZE[type];
    if (fixed !== undefined) {
      if (value < 0 || value > 2 ** (8 * fixed) - 1) throw new Error(`${where}: ${value} does not fit in ${plural(fixed, "byte")}`);
      return;
    }
    if (!SIGNED.has(type) && !UNSIGNED.has(type)) throw new Error(`${where} has no encoding`);
    for (const candidate of OPERAND_SCALES) {
      if (fitsScale(type, value, candidate)) {
        if (candidate > scale) scale = candidate;
        return;
      }
    }
    throw new Error(`${where}: ${value} does not fit in 32 bits`);
  });
  return scale;
}

export function isShortStar(opcode: Opcode): boolean {
  return bytecodeInfo(opcode).shortStar === true;
}

/** `Jump`, the conditional jumps (immediate and constant-pool forms) and `JumpLoop`. */
export function isJump(opcode: Opcode): boolean {
  return opcode.startsWith("Jump");
}

// Opcodes that can neither throw nor run user code. A pending expression position waits for the
// first opcode that is not one of these (V8's `Bytecodes::IsWithoutExternalSideEffects`), which is
// why `Star` and `Ldar` never carry an `E>` in the listings. `JumpLoop` is excluded: it is where
// the interrupt and stack checks happen.
const NO_EXTERNAL_SIDE_EFFECTS: ReadonlySet<Opcode> = new Set<Opcode>([
  "LdaZero",
  "LdaSmi",
  "LdaUndefined",
  "LdaNull",
  "LdaTheHole",
  "LdaTrue",
  "LdaFalse",
  "LdaConstant",
  "LdaContextSlot",
  "LdaCurrentContextSlot",
  "LdaImmutableContextSlot",
  "LdaImmutableCurrentContextSlot",
  "Ldar",
  "Mov",
  "PopContext",
  "PushContext",
  "Star",
]);

export function isWithoutExternalSideEffects(opcode: Opcode): boolean {
  return NO_EXTERNAL_SIDE_EFFECTS.has(opcode) || isShortStar(opcode) || (isJump(opcode) && opcode !== "JumpLoop");
}
