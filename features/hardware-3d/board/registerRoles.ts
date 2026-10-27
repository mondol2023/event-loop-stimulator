import { RegisterRoles, Registers, type RegisterName, type RegisterRole } from "@/core/baseline/x64/registers";

// Roles come from V8's register-x64.h as pinned by REGISTER_HEADER_SOURCE; typing this as a Record makes a new role in core a compile error here.
const ROLE_WORDS: Readonly<Record<RegisterRole, string>> = {
  accumulator: "accumulator",
  context: "context",
  jsFunction: "JS function",
  stackPointer: "stack pointer",
  framePointer: "frame pointer",
  bytecodeOffset: "bytecode offset",
  bytecodeArray: "bytecode array",
  dispatchTable: "dispatch table",
  root: "root",
  cageBase: "cage base",
  scratch: "scratch",
  argCount: "arg count",
  newTarget: "new target",
  return0: "return 0",
  return1: "return 1",
  return2: "return 2",
};

/** The 16 general registers in hardware encoding order. */
export const REGISTER_NAMES = Object.keys(Registers) as readonly RegisterName[];

const ROLES = new Map<RegisterName, string>();
for (const role of Object.keys(RegisterRoles) as RegisterRole[]) {
  const reg = RegisterRoles[role];
  // A register with several roles (rax is the accumulator, arg count and return 0) shows the first listed.
  if (!ROLES.has(reg)) ROLES.set(reg, ROLE_WORDS[role]);
}

/** The V8 role of a register, or "" when V8's header gives it none. */
export function roleOf(reg: RegisterName): string {
  return ROLES.get(reg) ?? "";
}
