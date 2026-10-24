import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { ASM_EXPECTED_FILE, collectAsmForms } from "./asm-forms.mts";

// `npm run asm:record`: llvm-mc encodes every distinct form the baseline compiler emits (repo-generated asm text only, never user source); asm.test.ts checks the result offline.
//
// Why `-filetype=obj` and not `--show-encoding`: for a branch to a label, --show-encoding prints a fixup placeholder
// ("[0xeb,A]") and only the rel8 shape, never the final bytes or the rel32 form. An object file holds the resolved,
// relaxed bytes, so each form is assembled alone into an ELF object and its .text section is read back. A branch form is
// assembled with `.fill` padding that places the target `disp` bytes away; the padding is cut off to leave the branch.
// NOTE: written without llvm-mc installed; it has never run against a real llvm-mc. The first `npm run asm:record` on a
// machine with LLVM is its test (if the ELF parse or a form's text is wrong it fails loudly rather than record).

const LLVM_MC = process.env.LLVM_MC ?? "llvm-mc";
// An explicit ELF triple keeps the output independent of the host OS.
const ARGS = ["-filetype=obj", "-triple=x86_64-unknown-linux-gnu", "-o", "-"];

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

/** The bytes of the `.text` section of a little-endian ELF64 object (e_shoff, e_shentsize, e_shnum, e_shstrndx, then the section headers). */
function textSection(elf: Buffer): Buffer {
  if (elf.length < 64 || elf.readUInt32BE(0) !== 0x7f454c46 || elf[4] !== 2 || elf[5] !== 1) throw new Error("llvm-mc did not produce a little-endian ELF64 object");
  const shoff = Number(elf.readBigUInt64LE(0x28));
  const shentsize = elf.readUInt16LE(0x3a);
  const shnum = elf.readUInt16LE(0x3c);
  const shstrndx = elf.readUInt16LE(0x3e);
  const header = (i: number) => {
    const at = shoff + i * shentsize;
    return { name: elf.readUInt32LE(at), offset: Number(elf.readBigUInt64LE(at + 0x18)), size: Number(elf.readBigUInt64LE(at + 0x20)) };
  };
  const strtab = header(shstrndx);
  for (let i = 0; i < shnum; i++) {
    const h = header(i);
    const start = strtab.offset + h.name;
    if (elf.toString("latin1", start, elf.indexOf(0, start)) === ".text") return elf.subarray(h.offset, h.offset + h.size);
  }
  throw new Error("the object has no .text section");
}

function encode(source: string): string {
  const run = spawnSync(LLVM_MC, ARGS, { input: `${source}\n`, encoding: "buffer" });
  if (run.error || run.status !== 0) throw new Error(`llvm-mc failed on "${source.replaceAll("\n", " ; ")}" (exit ${run.status ?? "none"}): ${run.error?.message ?? run.stderr.toString("utf8")}`);
  return textSection(run.stdout).toString("hex");
}

const encodings: string[] = [];
try {
  for (const form of forms) {
    const text = encode(form.source);
    const take = text.length - form.fill * 2;
    if (take <= 0) throw new Error(`"${form.key}" assembled to ${text.length / 2} bytes, no more than its ${form.fill} filler bytes`);
    encodings.push(form.instructionFirst ? text.slice(0, take) : text.slice(text.length - take));
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
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
