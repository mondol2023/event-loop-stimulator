import type { ElementsKind } from "@/core/runtime/objects/ElementsKind";
import type { FieldLocation, InstanceType, MapFamily, Representation } from "@/core/runtime/objects/V8Map";
import type { FunctionId, MapId, ObjectId, TaskId } from "@/core/shared/ids";
import type { BytecodePos } from "@/core/views/types";
import type { GcEvent, LoopPhase, TaskRef } from "./Command";

// One step of a run, as the learner scrubs through it (PROMPT.md §7.5). A Tick is a plain,
// deeply readonly value with no class instances, so it serializes and compares structurally.
// Phase 3's Tick leaves out `machine`, `cache`, `bus` and `alu` (Phases 4 and 7, Illustrative) and
// `v8.tiers` (Phase 4's TieringModel); each later phase adds its field.

export type { GcEvent, LoopPhase, TaskRef };

export type DeepReadonly<T> = T extends string | number | boolean | null | undefined
  ? T
  : T extends readonly (infer U)[]
    ? readonly DeepReadonly<U>[]
    : T extends object
      ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
      : T;

/** Which part of Node's world the step belongs to. */
export type TickPhase = "script" | "nextTick" | "microtask" | "timers" | "check" | "loop-transition" | "gc" | "exit";

/** An interpreter register, the accumulator or a stack value, as the panes show it. */
export type ValueSnapshot =
  /** `tagged` is the Smi's word as `%DebugPrint` shows it. */
  | { kind: "smi"; value: number; tagged: string }
  /** `text` is Number::toString, because JSON cannot carry NaN, Infinity or -0. */
  | { kind: "heap-number"; value: number; text: string }
  | { kind: "string"; value: string }
  | { kind: "oddball"; name: "undefined" | "null" | "true" | "false" | "the_hole" }
  | { kind: "object"; id: ObjectId; mapId: MapId; preview: string }
  /** A Context pushed into a register, or the isolate's pending message a `finally` saved. */
  | { kind: "internal"; name: "context" | "message" };

export type FrameSnapshot = {
  functionName: string;
  functionId: FunctionId;
  bytecodeOffset: number;
  /** r0..rn, in register order. */
  registers: ValueSnapshot[];
  accumulator: ValueSnapshot;
  /** Sequential from 1 in the order the timeline first sees a Context. */
  contextId: number;
};

/** `origin` tells the program's own `console` calls from what Node itself prints (an uncaught-error report, a warning). */
export type ConsoleLine = { stream: "stdout" | "stderr"; text: string; origin: "console" | "node" };

/** A pending timer or immediate in the host (libuv/Node), with its virtual due time. */
export type HostEntry = {
  id: TaskId;
  kind: "timeout" | "interval" | "immediate";
  label: string;
  /** Virtual ms the timer is due; `null` for an immediate. */
  dueMs: number | null;
  refed: boolean;
};

export type MapSnapshot = {
  id: MapId;
  family: MapFamily;
  instanceType: InstanceType;
  elementsKind: ElementsKind;
  isDictionary: boolean;
  deprecated: boolean;
  inObjectCapacity: number;
  backPointer: MapId | null;
  fields: { key: string; representation: Representation; location: FieldLocation; enumerable: boolean }[];
};

export type FeedbackSlotSnapshot = {
  index: number;
  /** `%DebugPrint`'s slot kind: `LoadProperty`, `SetNamedSloppy`, … */
  kind: string;
  state: "UNINITIALIZED" | "MONOMORPHIC" | "POLYMORPHIC" | "MEGAMORPHIC";
  /** The receiver Maps the slot has seen (empty once megamorphic). */
  mapIds: MapId[];
};

export type FeedbackSnapshot = { functionId: FunctionId; functionName: string; slots: FeedbackSlotSnapshot[] };

/** Illustrative: one generation of the modeled heap (sizes come from estimated instance sizes). */
export type HeapRegion = { objectCount: number; usedBytes: number; capacityBytes: number };

export type FidelityWarning = { kind: "nondeterminism"; message: string } | { kind: "stopped"; message: string };

export type V8Snapshot = {
  maps: MapSnapshot[];
  /** The newest Map that was created or changed since the previous tick. */
  changedMapId?: MapId;
  feedback: FeedbackSnapshot[];
  elementsKinds: Record<ObjectId, ElementsKind>;
  heap: { young: HeapRegion; old: HeapRegion; lastGc?: GcEvent };
};

export type TickDraft = {
  index: number;
  phase: TickPhase;
  pos: BytecodePos | null;
  currentLine: number | null;
  callStack: FrameSnapshot[];
  hostApis: HostEntry[];
  nextTickQueue: TaskRef[];
  microtaskQueue: TaskRef[];
  timerQueue: TaskRef[];
  immediateQueue: TaskRef[];
  loopPhase: LoopPhase | null;
  console: ConsoleLine[];
  virtualTimeMs: number;
  v8: V8Snapshot;
  warnings: FidelityWarning[];
};

export type Tick = DeepReadonly<TickDraft & { narration: string }>;
