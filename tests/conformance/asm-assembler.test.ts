import { describe, expect, it } from "vitest";
import { CLANG_ARGS, LLVM_MC_ARGS, candidates, resolveAssembler, type Probe } from "../../scripts/conformance/asm-assembler.mts";

const CLANG_OUT = "clang version 23.1.4 (https://github.com/llvm/llvm-project abc)\nTarget: x86_64-pc-windows-msvc\n";
const MC_OUT = "LLVM (http://llvm.org/):\n  LLVM version 18.1.3\n  Optimized build.\n";

const probeOf =
  (available: Record<string, string>): Probe =>
  (command) => {
    const stdout = available[command];
    return { ok: stdout !== undefined, stdout: stdout ?? "" };
  };

describe("asm assembler resolution", () => {
  it("prefers llvm-mc when it runs", () => {
    const a = resolveAssembler(candidates({}, "linux"), probeOf({ "llvm-mc": MC_OUT, clang: CLANG_OUT }));
    expect(a).toMatchObject({ tool: "llvm-mc", command: "llvm-mc", args: LLVM_MC_ARGS, llvmVersion: "18.1.3", versionLine: "LLVM version 18.1.3" });
  });

  it("falls back to clang with the integrated-assembler argv", () => {
    const a = resolveAssembler(candidates({}, "linux"), probeOf({ clang: CLANG_OUT }));
    expect(a).toMatchObject({ tool: "clang", args: CLANG_ARGS, llvmVersion: "23.1.4" });
    expect(a?.versionLine.startsWith("clang version 23.1.4")).toBe(true);
    expect(CLANG_ARGS).toEqual(["--target=x86_64-unknown-linux-gnu", "-c", "-x", "assembler", "-o", "-", "-"]);
  });

  it("tries the default Windows LLVM install last, and honours LLVM_MC overrides", () => {
    const win = "C:\\Program Files\\LLVM\\bin\\clang.exe";
    expect(resolveAssembler(candidates({}, "win32"), probeOf({ [win]: CLANG_OUT }))?.command).toBe(win);
    expect(resolveAssembler(candidates({}, "linux"), probeOf({ [win]: CLANG_OUT }))).toBeUndefined();
    expect(resolveAssembler(candidates({ LLVM_MC: "/x/mc" }, "linux"), probeOf({ "/x/mc": MC_OUT }))?.command).toBe("/x/mc");
  });

  it("returns undefined when nothing runs", () => {
    expect(resolveAssembler(candidates({}, "win32"), probeOf({}))).toBeUndefined();
  });
});
