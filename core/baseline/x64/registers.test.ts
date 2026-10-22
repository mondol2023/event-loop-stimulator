import { describe, expect, it } from "vitest";
import { RegisterRoles, Registers } from "./registers";

describe("register-x64.h roles", () => {
  it("assigns V8's roles to the registers the header names", () => {
    expect(RegisterRoles).toEqual({
      accumulator: "rax",
      context: "rsi",
      jsFunction: "rdi",
      stackPointer: "rsp",
      framePointer: "rbp",
      bytecodeOffset: "r9",
      bytecodeArray: "r12",
      dispatchTable: "r15",
      root: "r13",
      cageBase: "r14",
      scratch: "r10",
      argCount: "rax",
      newTarget: "rdx",
      return0: "rax",
      return1: "rdx",
      return2: "r8",
    });
  });

  it("numbers all 16 registers with their hardware codes", () => {
    expect(Object.values(Registers)).toEqual([...Array(16).keys()]);
  });
});
