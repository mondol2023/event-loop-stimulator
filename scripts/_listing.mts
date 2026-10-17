import { readFileSync } from "node:fs";
import { CompilationManager } from "@/core/compile/CompilationManager";
import { toPrintable } from "@/core/bytecode/BytecodeProgram";
import { formatListing } from "@/core/bytecode/printer";
const arg = process.argv[2] ?? "";
const src = arg.endsWith(".cjs") ? readFileSync(arg, "utf8") : arg;
const r = new CompilationManager().compile(src, "js");
if (!r.program) { console.log(r.diagnostics); process.exit(1); }
for (const f of r.program.functions) { console.log(`--- fn ${f.id} '${f.name}' params=${f.parameterCount} regs=${f.registerCount}`); console.log(formatListing(toPrintable(f)).join("\n")); }
