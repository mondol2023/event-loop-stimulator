// Which assembler `npm run asm:record` runs, and with what argv. Pure (the probe is injected), so asm-assembler.test.ts needs no assembler.
//
// llvm-mc and clang's integrated assembler are the same LLVM MC layer: `clang -c -x assembler` runs the MC assembler on the text with the
// same target triple, so the bytes are expected to be identical. The one thing that could differ is the object wrapper (clang may add
// .note.GNU-stack / .llvm_addrsig / .comment sections); the recorder reads only the `.text` section, which is unaffected. The record
// stores which tool and version produced the golden, so any difference found later is attributable.

export type AssemblerTool = "llvm-mc" | "clang";

export type Assembler = {
  readonly tool: AssemblerTool;
  readonly command: string;
  /** The argv (after the command) that assembles asm text on stdin into an ELF64 object on stdout. */
  readonly args: readonly string[];
  /** The first line of `--version` that names the version (llvm-mc's first line is only a URL banner). */
  readonly versionLine: string;
  /** The LLVM version number. */
  readonly llvmVersion: string;
};

// An explicit ELF triple keeps the output independent of the host OS.
const TRIPLE = "x86_64-unknown-linux-gnu";
export const LLVM_MC_ARGS: readonly string[] = ["-filetype=obj", `-triple=${TRIPLE}`, "-o", "-"];
export const CLANG_ARGS: readonly string[] = [`--target=${TRIPLE}`, "-c", "-x", "assembler", "-o", "-", "-"];

export type Probe = (command: string) => { readonly ok: boolean; readonly stdout: string };

export type Candidate = { readonly tool: AssemblerTool; readonly command: string };

export function candidates(env: { readonly LLVM_MC?: string | undefined; readonly CLANG?: string | undefined }, platform: string): Candidate[] {
  const list: Candidate[] = [
    { tool: "llvm-mc", command: env.LLVM_MC ?? "llvm-mc" },
    { tool: "clang", command: env.CLANG ?? "clang" },
  ];
  if (platform === "win32" && env.CLANG === undefined) list.push({ tool: "clang", command: "C:\\Program Files\\LLVM\\bin\\clang.exe" });
  return list;
}

/** The first candidate whose `--version` runs, preferring llvm-mc; undefined when none does. */
export function resolveAssembler(list: readonly Candidate[], probe: Probe): Assembler | undefined {
  for (const c of list) {
    const result = probe(c.command);
    if (!result.ok) continue;
    const lines = result.stdout.split(/\r?\n/).filter((l) => l.trim() !== "");
    const versionLine = (lines.find((l) => /version/i.test(l)) ?? lines[0] ?? "unknown").trim();
    const llvmVersion = /(?:LLVM|clang) version ([\d.]+\S*)/.exec(result.stdout)?.[1] ?? "unknown";
    return { tool: c.tool, command: c.command, args: c.tool === "llvm-mc" ? LLVM_MC_ARGS : CLANG_ARGS, versionLine, llvmVersion };
  }
  return undefined;
}
