import type { BytecodeProgram } from "@/core/bytecode/BytecodeProgram";
import { CompilationManager } from "@/core/compile/CompilationManager";
import { type HostHooks, Realm } from "@/core/runtime/Realm";
import type { Command } from "@/core/timeline/Command";
import type { Completion } from "./Completion";
import { IgnitionInterpreter, type StepObserver } from "./IgnitionInterpreter";

// Test-only scaffolding: compile a program with the real CompilationManager and run it on a realm
// whose host just captures the console streams.

export type Run = {
  readonly program: BytecodeProgram;
  readonly completion: Completion;
  readonly stdout: string;
  readonly stderr: string;
  readonly commands: readonly Command[];
};

export function compileOrThrow(source: string): BytecodeProgram {
  const result = new CompilationManager().compile(source, "js");
  if (!result.program) throw new Error(`not compiled: ${JSON.stringify(result.diagnostics)}`);
  return result.program;
}

/**
 * `setup` installs test-only globals on the realm before the script runs; `hooks` adds embedder
 * callbacks. The host is minimal: the microtask queue is drained once after the script (no Node loop).
 */
export function runSource(source: string, setup?: (realm: Realm) => void, hooks: Partial<HostHooks> = {}): Run {
  const program = compileOrThrow(source);
  let stdout = "";
  let stderr = "";
  const commands: Command[] = [];
  const observer: StepObserver = { onCommand: (c) => commands.push(c) };
  const realm = new Realm({
    write(stream, text) {
      if (stream === "stdout") stdout += text;
      else stderr += text;
    },
    entryPoint: () => "main",
    ...hooks,
  });
  setup?.(realm);
  const completion = new IgnitionInterpreter(program, realm, observer).runScript();
  if (completion.type === "normal") realm.microtasks.drain(observer);
  return { program, completion, stdout, stderr, commands };
}
