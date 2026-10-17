import type { BytecodeProgram } from "@/core/bytecode/BytecodeProgram";
import { CompilationManager } from "@/core/compile/CompilationManager";
import { Realm } from "@/core/runtime/Realm";
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

/** `setup` installs test-only globals on the realm before the script runs. */
export function runSource(source: string, setup?: (realm: Realm) => void): Run {
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
  });
  setup?.(realm);
  const completion = new IgnitionInterpreter(program, realm, observer).runScript();
  return { program, completion, stdout, stderr, commands };
}
