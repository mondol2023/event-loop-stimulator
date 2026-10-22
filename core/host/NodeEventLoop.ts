import type { Completion } from "@/core/interpreter/Completion";
import type { IgnitionInterpreter, StepObserver } from "@/core/interpreter/IgnitionInterpreter";
import type { HostHooks, Realm } from "@/core/runtime/Realm";
import type { ConsoleStream } from "@/core/runtime/builtins/console";
import { inspect } from "@/core/runtime/builtins/inspect";
import type { JSFunction } from "@/core/runtime/objects/JSFunction";
import type { JSPromise } from "@/core/runtime/objects/JSPromise";
import { positionOf } from "@/core/runtime/stack";
import type { JSValue } from "@/core/runtime/values/JSValue";
import { LIMITS } from "@/core/shared/limits";
import { SimulationHalt } from "@/core/shared/simulationHalt";
import { sourceRangeForPos } from "@/core/views/types";
import { printUncaught, printUnhandledRejection } from "./errorPrinter";
import type { ConsoleLine, HostEntry } from "@/core/timeline/Tick";
import type { LoopPhase, TaskRef } from "@/core/timeline/Command";
import { NextTickQueue, tickRef } from "./nextTick";
import { type EntryPoint, type RunNextTicksCaller, unhandledRejectionFrames } from "./nodeFrames";
import { installNodeGlobals } from "./nodeGlobals";
import { NondeterminismWatch } from "./nondeterminism";
import { PromiseRejections } from "./rejections";
import { NodeTimers, type TimerLoop, type TimersList } from "./timers";
import { VirtualClock } from "./VirtualClock";
import { type ProcessWarning, ProcessWarnings } from "./warnings";

// Node's event loop around one realm: the main script, then libuv's phases (deps/uv/src/unix/core.c
// uv_run, UV_RUN_DEFAULT) until no ref'd handle is left. Timers and immediates come from
// lib/internal/timers.js; after the script and after every timer or immediate callback the tick
// and microtask queues drain (lib/internal/process/task_queues.js processTicksAndRejections and
// runNextTicks, src/api/callback.cc InternalCallbackScope::Close), and only then are unhandled
// rejections checked (lib/internal/process/promises.js).

export type { LoopPhase };

/** What the timeline reads from the host between two commands. Read-only: nothing here changes the run. */
export type HostView = {
  readonly nextTickQueue: readonly TaskRef[];
  readonly timerQueue: readonly TaskRef[];
  readonly immediateQueue: readonly TaskRef[];
  readonly hostApis: readonly HostEntry[];
  readonly console: readonly ConsoleLine[];
  readonly virtualTimeMs: number;
};

/** The host a realm starts with before its loop exists: using it is a programmer error. */
export const DETACHED_HOST: HostHooks = {
  write() {
    throw new Error("the realm has no host yet: create its NodeEventLoop first");
  },
  entryPoint() {
    throw new Error("the realm has no host yet: create its NodeEventLoop first");
  },
};

export class NodeEventLoop implements HostHooks {
  readonly #realm: Realm;
  readonly #interp: IgnitionInterpreter;
  readonly #observer: StepObserver;
  readonly #clock = new VirtualClock();
  readonly #ticks: NextTickQueue;
  readonly #rejections = new PromiseRejections();
  readonly #processWarnings = new ProcessWarnings();
  readonly #nondeterminism = new NondeterminismWatch();
  readonly #timers: NodeTimers;
  /** A stream's afterWrite tick is queued and has not run yet (Writable's afterWriteTickInfo). */
  readonly #afterWritePending: Record<ConsoleStream, boolean> = { stdout: false, stderr: false };
  #entry: EntryPoint = "main";
  /** The process ended on an uncaught exception or an unhandled rejection. */
  #died = false;
  readonly #consoleLines: ConsoleLine[] = [];
  stdout = "";
  stderr = "";

  constructor(realm: Realm, interp: IgnitionInterpreter, observer: StepObserver) {
    this.#realm = realm;
    this.#ticks = new NextTickQueue(realm.taskIds);
    this.#interp = interp;
    this.#observer = observer;
    this.#timers = new NodeTimers(
      realm,
      this.#clock,
      (warning) => this.#emitWarning(warning),
      (list, due, lists) => this.#nondeterminism.timerInserted(list, due, lists),
    );
    realm.host = this;
    installNodeGlobals(realm, this.#timers, this.#ticks);
  }

  /** Fidelity warnings raised so far (nondeterministic orderings); never part of stdout or stderr. */
  get warnings(): readonly string[] {
    return this.#nondeterminism.warnings;
  }

  /** The queues, timers and console as the timeline shows them. */
  view(): HostView {
    const timeouts = this.#timers.pendingTimeouts();
    const immediates = this.#timers.pendingImmediates();
    const timerRefs = timeouts.map((t) => this.#timers.timeoutRef(t));
    const immediateRefs = immediates.map((i) => this.#timers.immediateRef(i));
    return {
      nextTickQueue: this.#ticks.pending().map(tickRef),
      timerQueue: timerRefs,
      immediateQueue: immediateRefs,
      hostApis: [
        ...timeouts.map(
          (t, i): HostEntry => ({
            id: t.id,
            kind: timerRefs[i]?.kind === "interval" ? "interval" : "timeout",
            label: timerRefs[i]?.label ?? "",
            dueMs: t.idleStart + t.idleTimeout,
            refed: t.refed,
          }),
        ),
        ...immediates.map(
          (im, i): HostEntry => ({ id: im.id, kind: "immediate", label: immediateRefs[i]?.label ?? "", dueMs: null, refed: im.refed === true }),
        ),
      ],
      console: this.#consoleLines,
      virtualTimeMs: this.#clock.now(),
    };
  }

  // ---- HostHooks ----

  /**
   * process.stdout.write / process.stderr.write. The recorded runs write to pipes, which complete
   * synchronously, so Writable defers its afterWrite callback with process.nextTick (one tick per
   * stream until it runs). That tick prints nothing, but it routes the next drain through
   * processTicksAndRejections, which shows in stack traces (probed).
   */
  write(stream: ConsoleStream, text: string): void {
    this.#writeFrom("console", stream, text);
  }

  #writeFrom(origin: ConsoleLine["origin"], stream: ConsoleStream, text: string): void {
    this.#nondeterminism.wrote();
    this.#print(stream, text, origin);
    if (this.#afterWritePending[stream]) return;
    this.#afterWritePending[stream] = true;
    this.#ticks.push({
      kind: "internal",
      label: `${stream} afterWrite`,
      run: () => {
        this.#afterWritePending[stream] = false;
      },
    });
  }

  /** Appends to a stream and to the timeline's console; a write past the `output` limit halts before it lands. */
  #print(stream: ConsoleStream, text: string, origin: ConsoleLine["origin"]): void {
    if (this.stdout.length + this.stderr.length + text.length > LIMITS.outputChars) {
      throw new SimulationHalt({ kind: "limit", limit: "output" });
    }
    if (stream === "stdout") this.stdout += text;
    else this.stderr += text;
    this.#consoleLines.push({ stream, text, origin });
  }

  entryPoint(): EntryPoint {
    return this.#entry;
  }

  promiseRejectionTracker(promise: JSPromise, operation: "reject" | "handle"): void {
    this.#rejections.track(promise, operation);
  }

  /** What the host keeps alive: queued ticks, pending timers and immediates, and rejections not yet reported (the modeled GC's roots). */
  gcRoots(): unknown[] {
    const ticks = this.#ticks.pending().flatMap((t) => (t.kind === "callback" ? [t.callback, ...t.args] : []));
    const timeouts = this.#timers.pendingTimeouts().flatMap((t) => [t.object, ...(t.args ?? [])]);
    const immediates = this.#timers.pendingImmediates().flatMap((i) => [i.object, ...(i.args ?? [])]);
    return [...ticks, ...timeouts, ...immediates, ...this.#rejections.roots()];
  }

  // ---- the run ----

  /** The main script, its drain, then the loop until nothing is ref'd; the `exit` command ends the run. */
  run(): { exitCode: number } {
    const exitCode = this.#loop() ? 0 : 1;
    this.#observer.onCommand({ kind: "exit", code: exitCode });
    return { exitCode };
  }

  #loop(): boolean {
    if (!this.#runMain()) return false;
    // uv_run(UV_RUN_DEFAULT): the timers run once before the first iteration.
    let alive = this.#alive();
    if (alive) {
      this.#nondeterminism.loopStarts(this.#timers.lists(), this.#timers.hasImmediates, this.#clock.now());
      this.#enterPhase("timers");
      if (!this.#timersPhase()) return false;
    }
    while (alive) {
      this.#enterPhase("poll");
      this.#poll();
      this.#enterPhase("check");
      if (!this.#checkPhase()) return false;
      // The close phase has nothing to close (no handles in the subset); then the clock and the timers.
      this.#enterPhase("close");
      this.#enterPhase("timers");
      if (!this.#timersPhase()) return false;
      alive = this.#alive();
    }
    return true;
  }

  /** The loop moves on to a phase (the `pending` phase has no work in the subset and is not reported). */
  #enterPhase(phase: LoopPhase): void {
    this.#observer.onCommand({ kind: "loop-phase", phase });
  }

  #runMain(): boolean {
    this.#entry = "main";
    const done = this.#interp.runScript();
    if (done.type === "throw") return this.#uncaught(done.value);
    return this.#callbackScopeClose();
  }

  /** uv__loop_alive: a ref'd timer (the timer handle is ref'd while timeoutInfo[0] > 0) or a ref'd immediate. */
  #alive(): boolean {
    return this.#timers.refCount > 0 || this.#timers.immediateRefCount > 0;
  }

  /** uv__run_timers: Node's one timer handle fires when the earliest list is due; RunTimers calls processTimers. */
  #timersPhase(): boolean {
    const next = this.#timers.peek();
    if (!next || next.expiry > this.#clock.now()) return true;
    if (!this.#timers.processTimers(this.#clock.now(), this.#timerLoop)) return false;
    return this.#callbackScopeClose();
  }

  /** uv__io_poll: with no ref'd immediate pending, block until the timer handle is due. */
  #poll(): void {
    if (this.#timers.immediateRefCount > 0) return;
    const next = this.#timers.peek();
    if (next) this.#clock.advanceTo(Math.max(this.#clock.now(), next.expiry));
  }

  /** uv__run_check: CheckImmediate runs processImmediate when any immediate is queued. */
  #checkPhase(): boolean {
    if (!this.#timers.hasImmediates) return true;
    if (!this.#timers.processImmediate(this.#timerLoop)) return false;
    return this.#callbackScopeClose();
  }

  readonly #timerLoop: TimerLoop = {
    invoke: (task: TaskRef, callback: JSFunction, receiver: JSValue, args: readonly JSValue[], entry: "timer" | "immediate"): Completion =>
      this.#task(entry === "timer" ? "timers" : "check", task, () => this.#call(callback, receiver, args, entry)),
    uncaught: (exception: JSValue) => {
      this.#uncaught(exception);
    },
    runNextTicks: (within: RunNextTicksCaller) => this.#runNextTicks(within),
    listReArmed: (list: TimersList, others: readonly TimersList[]) => this.#nondeterminism.listReArmed(list, others),
  };

  /** Runs one task between its job-start and job-end commands. */
  #task<T>(queue: "nextTick" | "timers" | "check", task: TaskRef, body: () => T): T {
    this.#observer.onCommand({ kind: "job-start", queue, task });
    try {
      return body();
    } finally {
      this.#observer.onCommand({ kind: "job-end", task });
    }
  }

  #call(fn: JSFunction, receiver: JSValue, args: readonly JSValue[], entry: EntryPoint): Completion {
    this.#entry = entry;
    this.#interp.clearPendingMessage();
    return this.#interp.call(fn, receiver, args);
  }

  // ---- draining ----

  /** InternalCallbackScope::Close: a checkpoint if nothing is pending, then processTicksAndRejections if anything is. */
  #callbackScopeClose(): boolean {
    if (!this.#ticks.hasTickScheduled && !this.#rejections.hasRejectionToWarn) {
      if (!this.#runMicrotasks("checkpoint")) return false;
    }
    if (!this.#ticks.hasTickScheduled && !this.#rejections.hasRejectionToWarn) return true;
    return this.#processTicksAndRejections(undefined);
  }

  /** runNextTicks(): the same, between two timer or immediate callbacks. */
  #runNextTicks(within: RunNextTicksCaller): boolean {
    if (!this.#ticks.hasTickScheduled && !this.#rejections.hasRejectionToWarn) {
      if (!this.#runMicrotasks(`checkpoint:${within}`)) return false;
    }
    if (!this.#ticks.hasTickScheduled && !this.#rejections.hasRejectionToWarn) return true;
    return this.#processTicksAndRejections(within);
  }

  /** processTicksAndRejections: every tick, then every microtask; again while ticks remain; then the rejection check. */
  #processTicksAndRejections(within: RunNextTicksCaller | undefined): boolean {
    const at = (step: "nextTick" | "microtask"): EntryPoint => (within ? `${step}:${within}` : step);
    do {
      for (let tick = this.#ticks.shift(); tick; tick = this.#ticks.shift()) {
        if (tick.kind === "internal") {
          this.#task("nextTick", tickRef(tick), () => tick.run());
          continue;
        }
        const done = this.#task("nextTick", tickRef(tick), () => this.#call(tick.callback, undefined, tick.args, at("nextTick")));
        if (done.type === "throw") return this.#uncaught(done.value);
      }
      if (!this.#runMicrotasks(at("microtask"))) return false;
    } while (!this.#ticks.isEmpty() || (this.#rejections.hasRejectionToWarn && this.#processPromiseRejections(within)));
    if (this.#died) return false;
    this.#ticks.hasTickScheduled = false;
    this.#rejections.hasRejectionToWarn = false;
    return true;
  }

  /**
   * processPromiseRejections in `throw` mode. Returns whether to drain again (never, in this mode:
   * there is no `unhandledRejection` listener) and ends the process on an unhandled rejection
   * (`#died` tells the caller apart).
   */
  #processPromiseRejections(within: RunNextTicksCaller | undefined): boolean {
    const unhandled = this.#rejections.takeFirstUnhandled();
    if (!unhandled) return false;
    this.#print("stderr", printUnhandledRejection(unhandled.reason, this.#printContext(), unhandledRejectionFrames(within)), "node");
    this.#died = true;
    return false;
  }

  /** V8's microtask checkpoint; a job that throws is an uncaught exception. */
  #runMicrotasks(entry: EntryPoint): boolean {
    this.#entry = entry;
    const done = this.#realm.microtasks.drain(this.#observer);
    if (done.type === "throw") return this.#uncaught(done.value);
    return true;
  }

  // ---- warnings and fatal errors ----

  /** process.emitWarning: the warning is written from a tick (process.nextTick(doEmitWarning, warning)). */
  #emitWarning(warning: ProcessWarning): void {
    this.#ticks.push({
      kind: "internal",
      label: `emit ${warning.name}`,
      run: () => this.#writeFrom("node", "stderr", this.#processWarnings.emit(warning)),
    });
  }

  #printContext() {
    return { source: this.#interp.program.source, inspect: (value: JSValue) => inspect(this.#realm, value) };
  }

  /** TriggerUncaughtException with no handler: print, exit code 1. Always false (the process is gone). */
  #uncaught(exception: JSValue): false {
    const program = this.#interp.program;
    const message = this.#interp.pendingMessage;
    const range = message ? sourceRangeForPos(program, message.pos) : undefined;
    this.#print("stderr", printUncaught(exception, { ...this.#printContext(), throwPosition: positionOf(program.source, range?.start ?? 0) }), "node");
    this.#died = true;
    return false;
  }
}
