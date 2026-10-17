import { readFileSync, readdirSync } from "node:fs";
import { BYTECODES, type Opcode } from "@/core/bytecode/bytecodes";
import { CompilationManager } from "@/core/compile/CompilationManager";
const all = Object.keys(BYTECODES) as Opcode[];
// names as string literals in generator sources
const srcs = readdirSync("core/bytecode").filter(f => f.endsWith(".ts") && !f.endsWith(".test.ts") && f !== "bytecodes.ts").map(f => readFileSync(`core/bytecode/${f}`, "utf8")).join("\n");
const literal = new Set(all.filter(op => new RegExp(`["'\`]${op}["'\`]`).test(srcs)));
const seen = new Set<string>();
for (const dir of ["tests/conformance/fixtures"]) for (const f of readdirSync(dir).filter(f => f.endsWith(".cjs"))) {
  const r = new CompilationManager().compile(readFileSync(`${dir}/${f}`, "utf8"), "js");
  for (const fn of r.program?.functions ?? []) for (const i of fn.array.instructions) seen.add(i.opcode);
}
console.log("literal-not-seen:", [...literal].filter(o => !seen.has(o)).join(" "));
console.log("seen-not-literal:", [...seen].filter(o => !literal.has(o as Opcode)).join(" "));
console.log("never:", all.filter(o => !literal.has(o) && !seen.has(o)).join(" "));
console.log("seen:", [...seen].sort().join(" "));
