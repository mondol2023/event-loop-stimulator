import type { NodeEventLoop } from "@/core/host/NodeEventLoop";
import type { IgnitionInterpreter, StepObserver } from "@/core/interpreter/IgnitionInterpreter";
import type { GcModel } from "@/core/runtime/heap/GcModel";
import type { Realm } from "@/core/runtime/Realm";
import type { Command } from "./Command";

// Puts the modeled garbage collector in the command stream. After each command that starts
// something (a dispatch, a task, a loop phase) the model looks at what was allocated; if the
// young generation is full it collects, and each collection is reported as a `gc` command.
// A `gc` command is a tick like any other (Decision D4), whether or not the run is recorded, so
// a limit stops the run at the same place either way. The model only reads the heap.

export interface GcWorld {
  readonly realm: Realm;
  readonly interpreter: IgnitionInterpreter;
  readonly loop: NodeEventLoop;
}

export class GcObserver implements StepObserver {
  readonly #inner: StepObserver;
  readonly #model: GcModel;
  readonly #world: () => GcWorld;

  constructor(inner: StepObserver, model: GcModel, world: () => GcWorld) {
    this.#inner = inner;
    this.#model = model;
    this.#world = world;
  }

  onCommand(c: Command): void {
    this.#inner.onCommand(c);
    if (c.kind !== "dispatch" && c.kind !== "job-start" && c.kind !== "loop-phase") return;
    for (const event of this.#model.collect(() => rootValues(this.#world()))) this.#inner.onCommand({ kind: "gc", event });
  }
}

/** Everything the program can still reach: the global object, the active frames, the queues and the host's timers. */
export function rootValues({ realm, interpreter, loop }: GcWorld): unknown[] {
  const roots: unknown[] = [realm.globalObject, realm.emptyContext, realm.intrinsics.objectPrototype, realm.intrinsics.functionPrototype, realm.intrinsics.asyncFunctionPrototype];
  roots.push(realm.intrinsics.arrayPrototype, realm.intrinsics.promisePrototype, ...Object.values(realm.intrinsics.errorPrototypes));
  for (const frame of interpreter.activeFrames) roots.push(frame.fn, frame.receiver, frame.context, frame.accumulator, ...frame.args, ...frame.registers);
  for (const job of realm.microtasks.pending()) roots.push(...(job.roots ?? []));
  roots.push(...loop.gcRoots());
  return roots;
}
