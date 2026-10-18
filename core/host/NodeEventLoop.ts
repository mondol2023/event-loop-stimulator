import type { Completion } from "@/core/interpreter/Completion";
import type { IgnitionInterpreter, StepObserver } from "@/core/interpreter/IgnitionInterpreter";
import type { HostHooks, Realm } from "@/core/runtime/Realm";
import type { ConsoleStream } from "@/core/runtime/builtins/console";
import { inspect } from "@/core/runtime/builtins/inspect";
import type { JSFunction } from "@/core/runtime/objects/JSFunction";
import type { JSPromise } from "@/core/runtime/objects/JSPromise";
import { positionOf } from "@/core/runtime/stack";
import type { JSValue } from "@/core/runtime/values/JSValue";
import { sourceRangeForPos } from "@/core/views/types";
import { printUncaught, printUnhandledRejection } from "./errorPrinter";
import { NextTickQueue } from "./nextTick";
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

export type LoopPhase = "timers" | "pending" | "poll" | "check" | "close";

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
  readonly #ticks = new NextTickQueue();
  readonly #rejections = new PromiseRejections();
  readonly #processWarnings = new ProcessWarnings();
  readonly #nondeterminism = new NondeterminismWatch();
  readonly #timers: NodeTimers;
  /** A stream's afterWrite tick is queued and has not run yet (Writable's afterWriteTickInfo). */
  readonly #afterWritePending: Record<ConsoleStream, boolean> = { stdout: false, stderr: false };
  #entry: EntryPoint = "main";
  /** The process ended on an uncaught exception or an unhandled rejection. */
  #died = false;
  stdout = "";
  stderr = "";

  constructor(realm: Realm, interp: IgnitionInterpreter, observer: StepObserver) {
    this.#realm = realm;
    this.#interp = interp;
    this.#observer = observer;
    this.#timers = new NodeTimers(realm, this.#clock, (warning) => this.#emitWarning(warning));
    realm.host = this;
    installNodeGlobals(realm, this.#timers, this.#ticks);
  }

  /** Fidelity warnings raised so far (nondeterministic orderings); never part of stdout or stderr. */
  get warnings(): readonly string[] {
    return this.#nondeterminism.warnings;
  }

  // ---- HostHooks ----

  /**
   * process.stdout.write / process.stderr.write. The recorded runs write to pipes, which complete
   * synchronously, so Writable defers its afterWrite callback with process.nextTick (one tick per
   * stream until it runs). That tick prints nothing, but it routes the next drain through
   * processTicksAndRejections, which shows in stack traces (probed).
   */
  write(stream: ConsoleStream, text: string): void {
    if (stream === "stdout") this.stdout += text;
    else this.stderr += text;
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

  entryPoint(): EntryPoint {
    return this.#entry;
  }

  promiseRejectionTracker(promise: JSPromise, operation: "reject" | "handle"): void {
    this.#rejections.track(promise, operation);
  }

  // ---- the run ----

  /** The main script, its drain, then the loop until nothing is ref'd. */
  run(): { exitCode: number } {
    if (!this.#runMain()) return { exitCode: 1 };
    // uv_run(UV_RUN_DEFAULT): the timers run once before the first iteration.
    let alive = this.#alive();
    if (alive) {
      this.#nondeterminism.loopStarts(this.#timers.lists(), this.#timers.hasImmediates, this.#clock.now());
      if (!this.#timersPhase()) return { exitCode: 1 };
    }
    while (alive) {
      this.#poll();
      if (!this.#checkPhase()) return { exitCode: 1 };
      // The close phase has nothing to close (no handles in the subset); then the clock and the timers.
      if (!this.#timersPhase()) return { exitCode: 1 };
      alive = this.#alive();
    }
    return { exitCode: 0 };
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
    invoke: (callback: JSFunction, receiver: JSValue, args: readonly JSValue[], entry: "timer" | "immediate"): Completion =>
      this.#call(callback, receiver, args, entry),
    uncaught: (exception: JSValue) => {
      this.#uncaught(exception);
    },
    runNextTicks: (within: RunNextTicksCaller) => this.#runNextTicks(within),
    listReArmed: (list: TimersList, others: readonly TimersList[]) => this.#nondeterminism.listReArmed(list, others),
  };

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
          tick.run();
          continue;
        }
        const done = this.#call(tick.callback, undefined, tick.args, at("nextTick"));
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
    this.stderr += printUnhandledRejection(unhandled.reason, this.#printContext(), unhandledRejectionFrames(within));
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
      run: () => this.write("stderr", this.#processWarnings.emit(warning)),
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
    this.stderr += printUncaught(exception, { ...this.#printContext(), throwPosition: positionOf(program.source, range?.start ?? 0) });
    this.#died = true;
    return false;
  }
}
