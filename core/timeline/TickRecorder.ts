import type { BytecodeProgram } from "@/core/bytecode/BytecodeProgram";
import type { HostView } from "@/core/host/NodeEventLoop";
import type { IgnitionInterpreter, StepObserver } from "@/core/interpreter/IgnitionInterpreter";
import type { V8Map } from "@/core/runtime/objects/V8Map";
import { mapMutationEpoch } from "@/core/runtime/objects/V8Map";
import type { Realm } from "@/core/runtime/Realm";
import { taskRefOf } from "@/core/runtime/MicrotaskQueue";
import type { MapId } from "@/core/shared/ids";
import { LIMITS } from "@/core/shared/limits";
import { SimulationHalt } from "@/core/shared/simulationHalt";
import { sourceRangeForPos, type BytecodePos } from "@/core/views/types";
import type { Command, LoopPhase } from "./Command";
import { narrate, type NarrationContext } from "./narration";
import { ContextIds, snapshotElementsKinds, snapshotFeedback, snapshotFrame, snapshotMap } from "./snapshots";
import type { ConsoleLine, DeepReadonly, FidelityWarning, MapSnapshot, Tick, TickDraft, TickPhase, V8Snapshot } from "./Tick";
import { TickBoundary } from "./tickBoundary";

// Turns the interpreter's and the host's commands into Ticks. The recorder is the exactness
// firewall's other side: it only reads. It never allocates on the heap, calls a function, reads
// an Error's `stack` or changes a queue, so a recorded run prints what an unrecorded run prints.

/** What the recorder reads, wired after the interpreter and the loop exist (they take the recorder as their observer). */
export interface TimelineWorld {
  readonly interpreter: IgnitionInterpreter;
  readonly realm: Realm;
  /** The queues, timers and console. */
  host(): HostView;
  /** The fidelity warnings raised so far. */
  warnings(): readonly string[];
}

type PhaseOfQueue = Record<"nextTick" | "microtask" | "timers" | "check", TickPhase>;
const PHASE_OF_QUEUE: PhaseOfQueue = { nextTick: "nextTick", microtask: "microtask", timers: "timers", check: "check" };

export class TickRecorder implements StepObserver {
  readonly #program: BytecodeProgram;
  readonly #boundary: TickBoundary;
  readonly #contexts = new ContextIds();
  readonly #ticks: Tick[] = [];
  readonly #lineStarts: readonly number[];
  readonly #lineCache = new Map<string, number | null>();
  /** The phases of the tasks that are running, innermost last; the script when empty. */
  readonly #phases: TickPhase[] = [];
  #loopPhase: LoopPhase | null = null;
  #world: TimelineWorld | undefined;
  #mapsSeen = { count: -1, epoch: -1 };
  /** How many entries of the realm's task log earlier ticks have already narrated. */
  #logged = 0;
  /** The state before the first tick, so the first tick's narration can say what the realm's setup left behind. */
  #previous: Tick | undefined;

  constructor(program: BytecodeProgram) {
    this.#program = program;
    this.#boundary = new TickBoundary(program);
    this.#lineStarts = lineStartsOf(program.source);
  }

  /** Wires the recorder to the run. Called once, before the first command. */
  attach(world: TimelineWorld): void {
    this.#world = world;
    this.#logged = world.realm.taskIds.log.length;
    this.#previous = { ...this.#draft(-1, "script", null), narration: "" };
  }

  get ticks(): readonly Tick[] {
    return this.#ticks;
  }

  get tickCount(): number {
    return this.#ticks.length;
  }

  onCommand(c: Command): void {
    this.#track(c);
    if (!this.#boundary.isTick(c)) return;
    if (this.#ticks.length >= LIMITS.ticks) throw new SimulationHalt({ kind: "limit", limit: "ticks" });
    this.#record(c);
  }

  /** The bookkeeping that is not a tick: which task is running and which loop phase the loop is in. */
  #track(c: Command): void {
    switch (c.kind) {
      case "job-start":
        this.#phases.push(PHASE_OF_QUEUE[c.queue]);
        return;
      case "job-end":
        this.#phases.pop();
        return;
      case "loop-phase":
        this.#loopPhase = c.phase;
        return;
      case "exit":
        this.#loopPhase = null;
        return;
      case "dispatch":
      case "gc":
        return;
      default:
        c satisfies never;
    }
  }

  #phaseFor(c: Command): TickPhase {
    switch (c.kind) {
      case "loop-phase":
        return "loop-transition";
      case "gc":
        return "gc";
      case "exit":
        return "exit";
      case "dispatch":
      case "job-start":
      case "job-end":
        return this.#phases.at(-1) ?? "script";
      default:
        return c satisfies never;
    }
  }

  #record(c: Command): void {
    const previous = this.#previous;
    const world = this.#world;
    if (!previous || !world) throw new Error("the TickRecorder was not attached to a run");
    const log = world.realm.taskIds.log;
    const context: NarrationContext = { program: this.#program, realm: world.realm, queued: log.slice(this.#logged) };
    this.#logged = log.length;
    const pos = c.kind === "dispatch" ? c.pos : null;
    const draft = this.#draft(this.#ticks.length, this.#phaseFor(c), pos);
    const narration = narrate(c, previous, draft, context);
    const tick = reuse(previous, { ...draft, narration });
    this.#ticks.push(tick);
    this.#previous = tick;
  }

  /** The state right now, with the sub-objects of the previous tick shared where nothing changed. */
  #draft(index: number, phase: TickPhase, pos: BytecodePos | null): TickDraft {
    const world = this.#world;
    if (!world) throw new Error("the TickRecorder was not attached to a run");
    const { realm, interpreter } = world;
    const host = world.host();
    const objects = realm.heap.objects();
    const previousMaps = this.#previous?.v8.maps;
    const maps = this.#mapSnapshots(realm.maps.all(), previousMaps);
    const v8: V8Snapshot = {
      maps,
      feedback: snapshotFeedback(objects),
      elementsKinds: snapshotElementsKinds(objects),
      heap: { young: { objectCount: realm.heap.allocatedCount }, old: { objectCount: 0 } },
    };
    const changed = previousMaps ? changedMap(previousMaps, maps) : undefined;
    if (changed !== undefined) v8.changedMapId = changed;
    const warnings: FidelityWarning[] = world.warnings().map((message) => ({ kind: "nondeterminism", message }));
    return {
      index,
      phase,
      pos,
      currentLine: pos ? this.#lineOf(pos) : null,
      callStack: interpreter.activeFrames.map((f) => snapshotFrame(f, this.#contexts)),
      hostApis: [...host.hostApis],
      nextTickQueue: [...host.nextTickQueue],
      microtaskQueue: realm.microtasks.pending().map(taskRefOf),
      timerQueue: [...host.timerQueue],
      immediateQueue: [...host.immediateQueue],
      loopPhase: this.#loopPhase,
      console: this.#consoleLines(host.console),
      virtualTimeMs: host.virtualTimeMs,
      v8,
      warnings,
    };
  }

  /** Console lines never change once written, so only the new ones are copied. */
  #consoleLines(lines: readonly ConsoleLine[]): ConsoleLine[] {
    const known = this.#previous?.console ?? [];
    const fresh = lines.slice(known.length).map((l) => ({ stream: l.stream, text: l.text, origin: l.origin }));
    return [...known, ...fresh];
  }

  /** The Map snapshots, rebuilt only when a Map was made or changed in place since the last tick. */
  #mapSnapshots(all: readonly V8Map[], previous: readonly DeepReadonly<MapSnapshot>[] | undefined): MapSnapshot[] {
    const epoch = mapMutationEpoch();
    if (previous && this.#mapsSeen.count === all.length && this.#mapsSeen.epoch === epoch) return previous as MapSnapshot[];
    this.#mapsSeen = { count: all.length, epoch };
    return all.map(snapshotMap);
  }

  #lineOf(pos: BytecodePos): number | null {
    const key = `${pos.functionId}:${pos.bytecodeOffset}`;
    const cached = this.#lineCache.get(key);
    if (cached !== undefined) return cached;
    const range = sourceRangeForPos(this.#program, pos);
    const line = range ? lineAt(this.#lineStarts, range.start) : null;
    this.#lineCache.set(key, line);
    return line;
  }
}

/** The newest Map that is new or different from the previous tick's. */
function changedMap(previous: readonly { id: MapId }[], current: readonly { id: MapId }[]): MapId | undefined {
  let changed: MapId | undefined;
  current.forEach((map, i) => {
    if (previous[i] === undefined || !sameValue(previous[i], map)) changed = map.id;
  });
  return changed;
}

/** Offsets at which each line starts (the same terminators as the stack-trace code frames). */
function lineStartsOf(source: string): number[] {
  const starts = [0];
  for (const m of source.matchAll(/\r\n|[\n\r\u2028\u2029]/g)) starts.push(m.index + m[0].length);
  return starts;
}

/** The 1-based line of an offset. */
function lineAt(starts: readonly number[], offset: number): number {
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if ((starts[mid] ?? 0) <= offset) low = mid;
    else high = mid - 1;
  }
  return low + 1;
}

/** Structural equality of plain snapshot values (`Object.is` for primitives, so -0 and NaN stay what they are). */
function sameValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  return keysA.every((k) => sameValue((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

/**
 * Returns `next` with every part that equals the same part of `previous` replaced by `previous`'s
 * own object (structural sharing, Decision D6): neighbouring ticks then share what did not change.
 */
function reuse<T>(previous: unknown, next: T): T {
  if (typeof next !== "object" || next === null) return next;
  if (previous === next) return next;
  if (typeof previous !== "object" || previous === null || Array.isArray(previous) !== Array.isArray(next)) return next;
  if (Array.isArray(next)) {
    const before = previous as readonly unknown[];
    let identical = before.length === next.length;
    const merged = next.map((item: unknown, i) => {
      const shared = reuse(before[i], item);
      if (!Object.is(shared, before[i])) identical = false;
      return shared;
    });
    return (identical ? previous : merged) as T;
  }
  const before = previous as Record<string, unknown>;
  const after = next as Record<string, unknown>;
  const keys = Object.keys(after);
  let identical = Object.keys(before).length === keys.length;
  const merged: Record<string, unknown> = {};
  for (const key of keys) {
    const shared = reuse(before[key], after[key]);
    if (!(key in before) || !Object.is(shared, before[key])) identical = false;
    merged[key] = shared;
  }
  return (identical ? previous : merged) as T;
}
