// x64 register roles from V8's src/codegen/x64/register-x64.h (GENERAL_REGISTERS and the k*Register aliases).

export const REGISTER_HEADER_SOURCE = {
  file: "src/codegen/x64/register-x64.h",
  tag: "13.6.233.17",
  sha256: "92cb27be24f5bd3a50b1e2fcb48ecfe6d2afe1012074de74450596dd3c4afb7f",
} as const;

// Hardware encoding numbers, in GENERAL_REGISTERS order.
export const Registers = {
  rax: 0,
  rcx: 1,
  rdx: 2,
  rbx: 3,
  rsp: 4,
  rbp: 5,
  rsi: 6,
  rdi: 7,
  r8: 8,
  r9: 9,
  r10: 10,
  r11: 11,
  r12: 12,
  r13: 13,
  r14: 14,
  r15: 15,
} as const;

export type RegisterName = keyof typeof Registers;

// Each value cites its alias in register-x64.h; rbp is the hardware frame pointer, which the header does not alias.
export const RegisterRoles = {
  accumulator: "rax", // kInterpreterAccumulatorRegister
  context: "rsi", // kContextRegister
  jsFunction: "rdi", // kJSFunctionRegister
  stackPointer: "rsp", // kStackPointerRegister
  framePointer: "rbp",
  bytecodeOffset: "r9", // kInterpreterBytecodeOffsetRegister
  bytecodeArray: "r12", // kInterpreterBytecodeArrayRegister
  dispatchTable: "r15", // kInterpreterDispatchTableRegister
  root: "r13", // kRootRegister, callee save
  cageBase: "r14", // kPtrComprCageBaseRegister, callee save
  scratch: "r10", // kScratchRegister
  argCount: "rax", // kJavaScriptCallArgCountRegister
  newTarget: "rdx", // kJavaScriptCallNewTargetRegister
  return0: "rax", // kReturnRegister0
  return1: "rdx", // kReturnRegister1
  return2: "r8", // kReturnRegister2
} as const satisfies Record<string, RegisterName>;

export type RegisterRole = keyof typeof RegisterRoles;
