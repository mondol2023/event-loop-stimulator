import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { ASM_EXPECTED_FILE, collectAsmForms } from "./asm-forms.mts";

// `npm run asm:record`: llvm-mc encodes every distinct form the baseline compiler emits (repo-generated asm text only, never user source); asm.test.ts checks the result offline.

const LLVM_MC = process.env.LLVM_MC ?? "llvm-mc";
// An explicit ELF triple keeps the output independent of the host OS.
const ARGS = ["--show-encoding", "-triple=x86_64-unknown-linux-gnu"];

const version = spawnSync(LLVM_MC, ["--version"], { encoding: "utf8" });
if (version.error || version.status !== 0) {
  console.error(`Refusing to record: ${LLVM_MC} is not available, and the x64 encodings must come from a real assembler.`);
  console.error("Install LLVM, then open a new shell so it is on PATH (or set LLVM_MC to the llvm-mc binary):");
  console.error("  Windows:  winget install LLVM.LLVM     (or: choco install llvm)");
  console.error("  macOS:    brew install llvm");
  console.error("  Linux:    sudo apt install llvm");
  process.exit(1);
}
const llvmVersion = /LLVM version ([\d.]+\S*)/.exec(version.stdout)?.[1] ?? "unknown";

const { forms, skipped } = collectAsmForms();
if (forms.length === 0) {
  console.error("Refusing to record: the baseline compiler produced no forms.");
  process.exit(1);
}

const run = spawnSync(LLVM_MC, ARGS, { input: forms.map((f) => f.source).join("\n") + "\n", encoding: "utf8" });
if (run.error || run.status !== 0) {
  console.error(`llvm-mc failed (exit ${run.status ?? "none"}):\n${run.error?.message ?? run.stderr}`);
  process.exit(1);
}

// Each form assembles to exactly one instruction line, in input order; .fill and label lines carry no encoding.
const encodings = [...run.stdout.matchAll(/# encoding: \[([^\]]*)\]/g)].map((m) =>
  (m[1] ?? "")
    .split(",")
    .map((b) => b.trim().replace(/^0x/, "").padStart(2, "0"))
    .join(""),
);
if (encodings.length !== forms.length) {
  console.error(`llvm-mc returned ${encodings.length} encodings for ${forms.length} forms; refusing to record.`);
  process.exit(1);
}

const mismatches: string[] = [];
const recorded: Record<string, string> = {};
forms.forEach((form, i) => {
  const bytes = encodings[i] as string;
  recorded[form.key] = bytes;
  if (bytes !== form.bytes) mismatches.push(`${form.key}: llvm-mc ${bytes}, encoder ${form.bytes}`);
});

mkdirSync(dirname(ASM_EXPECTED_FILE), { recursive: true });
writeFileSync(ASM_EXPECTED_FILE, `${JSON.stringify({ llvm: llvmVersion, forms: recorded }, null, 2)}\n`);
console.log(`Recorded ${forms.length} encoded forms from LLVM ${llvmVersion} (${skipped.length} refused fixtures skipped).`);
// The file is written first so the diff is reviewable; a mismatch is a bug in the encoder, never a reason to edit it.
if (mismatches.length > 0) {
  console.error(`The encoder disagrees with llvm-mc on ${mismatches.length} form(s):\n${mismatches.map((m) => `  - ${m}`).join("\n")}`);
  process.exit(1);
}
