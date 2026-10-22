import type { BytecodeProgram } from "@/core/bytecode/BytecodeProgram";
import type { Command } from "./Command";

/**
 * Which commands make a tick. Ticks are statement-level (the owner's ruling on the D4 gate:
 * per-dispatch ticks put recursion-factorial at 28,491): a dispatch at a statement position (the
 * `S>` marks of the bytecode listing), a `JumpLoop` back edge (so an empty loop body still ticks),
 * the entry of a function, a task start, a loop-phase transition, a GC event and the exit. Every
 * other dispatch belongs to the statement it sits in, and a task end only closes its start.
 * Both the limiter and the recorder count with this one rule, so recording never changes where a
 * run stops.
 */
export class TickBoundary {
  readonly #statements: readonly ReadonlySet<number>[];

  constructor(program: BytecodeProgram) {
    this.#statements = program.functions.map(
      (fn) => new Set(fn.positions.entries.filter((e) => e.kind === "statement").map((e) => e.offset)),
    );
  }

  isTick(c: Command): boolean {
    switch (c.kind) {
      case "dispatch": {
        const { functionId, bytecodeOffset } = c.pos;
        return bytecodeOffset === 0 || c.opcode === "JumpLoop" || this.#statements[functionId]?.has(bytecodeOffset) === true;
      }
      case "job-start":
      case "loop-phase":
      case "gc":
      case "exit":
        return true;
      case "job-end":
        return false;
      default:
        return c satisfies never;
    }
  }
}
