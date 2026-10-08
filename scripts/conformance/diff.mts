import { existsSync, readFileSync } from "node:fs";
import { generateBytecode } from "@/core/bytecode/BytecodeGenerator";
import { toPrintable } from "@/core/bytecode/BytecodeProgram";
import { type PrintedFunction, printBytecodeArray } from "@/core/bytecode/printer";
import { parseScript } from "@/core/frontend/parse";
import { analyzeScopes } from "@/core/frontend/scope/ScopeAnalyzer";
import { captureBytecode } from "./bytecode-capture.mts";
import type { RealFunctionBytecode } from "./expectation.mts";
import { compareProgram } from "../../tests/conformance/support/compareBytecode.ts";

// `npm run conformance:diff -- <file.cjs>` or `-- -e "<source>"`: compiles the source with our
// generator and with real Node, then prints both listings side by side with every difference marked.
// A development aid for the bytecode families; it never writes an expectation.

const args = process.argv.slice(2);
const source = args[0] === "-e" ? (args[1] ?? "") : existsSync(args[0] ?? "") ? readFileSync(args[0] as string, "utf8") : (args[0] ?? "");

const real = captureBytecode(source, "js");
const parsed = parseScript(source);
if (!parsed.ok) {
  console.log(`parse failed: ${parsed.error.map((d) => d.message).join("; ")}`);
  process.exit(1);
}
const generated = generateBytecode(parsed.value, analyzeScopes(parsed.value));
if (!generated.ok) {
  console.log(`not compiled: ${generated.error.map((d) => `${d.message} @${d.range.start}`).join("; ")}`);
  console.log("--- V8");
  show(real, "", (line) => console.log(line));
  process.exit(0);
}

type Line = { readonly offset: number; readonly text: string; readonly position?: { readonly at: number; readonly kind: "S" | "E" } | undefined };
const line = (i: Line | undefined): string => {
  if (!i) return "";
  const pos = i.position ? `${String(i.position.at).padStart(5)} ${i.position.kind}>` : " ".repeat(8);
  return `${pos} @${String(i.offset).padStart(4)} ${i.text}`;
};

function show(fn: RealFunctionBytecode | PrintedFunction, indent: string, out: (s: string) => void): void {
  out(`${indent}[${fn.name || "<anon>"}] ${JSON.stringify(fn.header)}`);
  for (const i of fn.instructions) out(`${indent}  ${line(i)}`);
  fn.constantPool.forEach((c, k) => out(`${indent}    pool ${k}: ${c}`));
  for (const h of fn.handlerTable) out(`${indent}    handler ${h}`);
  for (const [k, c] of Object.entries(fn.children)) {
    out(`${indent}  child #${k}`);
    show(c, `${indent}    `, out);
  }
}

const pad = (s: string, n: number): string => (s.length >= n ? s : s + " ".repeat(n - s.length));

function side(ours: PrintedFunction, theirs: RealFunctionBytecode, path: string): void {
  console.log(`=== ${path}   ours ${JSON.stringify(ours.header)}\n    ${" ".repeat(path.length)}    V8   ${JSON.stringify(theirs.header)}`);
  const n = Math.max(ours.instructions.length, theirs.instructions.length);
  for (let i = 0; i < n; i++) {
    const a = line(ours.instructions[i]);
    const b = line(theirs.instructions[i]);
    console.log(`${a === b ? "  " : "!!"} ${pad(a, 46)} | ${b}`);
  }
  const m = Math.max(ours.constantPool.length, theirs.constantPool.length);
  for (let i = 0; i < m; i++) {
    const a = ours.constantPool[i] ?? "";
    const b = theirs.constantPool[i] ?? "";
    console.log(`${a === b ? "  " : "!!"} ${pad(`pool ${i}: ${a}`, 46)} | pool ${i}: ${b}`);
  }
  const h = Math.max(ours.handlerTable.length, theirs.handlerTable.length);
  for (let i = 0; i < h; i++) {
    const a = ours.handlerTable[i] ?? "";
    const b = theirs.handlerTable[i] ?? "";
    console.log(`${a === b ? "  " : "!!"} ${pad(`handler ${a}`, 46)} | handler ${b}`);
  }
}

const program = generated.value;
const compared = compareProgram(program, real);
const root = program.functions[0];
if (root) {
  const visit = (mine: (typeof program.functions)[number], theirs: RealFunctionBytecode, path: string): void => {
    side(printBytecodeArray(toPrintable(mine)), theirs, path);
    for (const [key, child] of Object.entries(theirs.children)) {
      const entry = mine.constantPool.get(Number(key));
      const next = entry?.kind === "sfi" ? program.functions[entry.functionId] : undefined;
      if (next) visit(next, child, `${path}/#${key}:${child.name}`);
      else console.log(`=== ${path}/#${key}:${child.name}: ours has no function`);
    }
  };
  visit(root, real, "<root>");
}
const exact = compared.filter((c) => c.comparison.exact).length;
console.log(`\n${exact}/${compared.length} functions exact`);
