import { CompilationManager } from "@/core/compile/CompilationManager";

// Spike body (Task 1): proves a module worker can bundle core/. Task 3 rewrites this.
const result = new CompilationManager().compile("let x = 1 + 2; console.log(x);", "js");
self.postMessage({ diagnostics: result.diagnostics.length });
