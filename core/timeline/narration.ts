import type { BytecodeProgram } from "@/core/bytecode/BytecodeProgram";
import type { Opcode } from "@/core/bytecode/bytecodes";
import { DEOPTIMIZE_REASON_MESSAGES, type Tier, type TierEvent } from "@/core/interpreter/tiering/TieringModel";
import type { ElementsKind } from "@/core/runtime/objects/ElementsKind";
import { JSArray } from "@/core/runtime/objects/JSArray";
import { JSObject } from "@/core/runtime/objects/JSObject";
import type { Realm } from "@/core/runtime/Realm";
import { isSmi } from "@/core/runtime/values/Smi";
import { isTheHole } from "@/core/runtime/values/TheHole";
import type { JSValue } from "@/core/runtime/values/JSValue";
import type { Command, GcEvent, LoopPhase, TaskRef } from "./Command";
import { previewOf } from "./snapshots";
import type { DeepReadonly, FeedbackSnapshot, MapSnapshot, Tick, TickDraft } from "./Tick";

// The friendly-coach narration of every tick (PRODUCT.md): WHY the step happened, naming the spec
// operation or the V8 or Node mechanism responsible. A tick's narration says what the command is
// (the headline) and then what changed since the previous tick (a new hidden class, an elements
// kind transition, an inline-cache state change, a queued task, console output). It only reads.

export type NarrationContext = {
  readonly program: BytecodeProgram;
  readonly realm: Realm;
  /** Tasks queued since the previous tick, in order. */
  readonly queued: readonly TaskRef[];
};

type State = DeepReadonly<TickDraft>;

/** At most this many hidden-class sentences per tick; a migration replays a whole transition chain. */
const MAX_MAP_SENTENCES = 3;

/** Stands in for a console sentence in the withheld narration; it never quotes the program's output. */
export const WITHHELD_CONSOLE_SENTENCE = "The program wrote output.";

/** `withhold` replaces every console sentence with {@link WITHHELD_CONSOLE_SENTENCE}; otherwise the text is the same. */
export function narrate(command: Command, before: Tick | null, after: TickDraft, ctx: NarrationContext, withhold = false): string {
  return [headline(command, after, ctx), ...changes(before, after, ctx, withhold)].join(" ");
}

// ---- the headline: what this step is ----

function headline(command: Command, after: State, ctx: NarrationContext): string {
  switch (command.kind) {
    case "dispatch":
      return dispatchSentence(command.opcode, command.pos.functionId, command.pos.bytecodeOffset, after, ctx);
    case "job-start":
      return jobStartSentence(command.queue, command.task);
    case "job-end":
      return `${command.task.label} finished.`;
    case "loop-phase":
      return loopPhaseSentence(command.phase);
    case "gc":
      return gcSentence(command.event);
    case "exit":
      return command.code === 0
        ? "Node exits with code 0: no ref'd timers or immediates are left, so the event loop ends."
        : `Node exits with code ${command.code}: the process ended on an uncaught error or an unhandled rejection.`;
    default:
      return command satisfies never;
  }
}

/** Illustrative: the model decides when a collection runs and invents the addresses and timing. */
function gcSentence(e: GcEvent): string {
  const objects = (n: number): string => `${n} object${n === 1 ? "" : "s"}`;
  const what =
    e.type === "scavenge"
      ? `V8 ran a scavenge (Illustrative): the young generation was full, so ${objects(e.survivedObjects + e.promotedObjects)} that ${e.survivedObjects + e.promotedObjects === 1 ? "is" : "are"} still reachable moved from ${e.fromSpace} to ${e.toSpace} (${e.promotedObjects} promoted to the old generation) and ${objects(e.freedObjects)} (${e.freedBytes} bytes) ${e.freedObjects === 1 ? "was" : "were"} freed.`
      : `V8 ran a mark-compact (Illustrative): the old generation outgrew its limit, so ${objects(e.freedObjects)} (${e.freedBytes} bytes) ${e.freedObjects === 1 ? "was" : "were"} freed and ${objects(e.survivedObjects)} compacted in place.`;
  return `${what} It took about ${e.durationMs} ms. A garbage collection never changes what your program prints.`;
}

function functionLabel(ctx: NarrationContext, functionId: number): string {
  const name = ctx.program.functions[functionId]?.name ?? "";
  return name === "" ? "(anonymous)" : name;
}

function dispatchSentence(opcode: Opcode, functionId: number, offset: number, after: State, ctx: NarrationContext): string {
  const where = after.currentLine === null ? "" : ` (line ${after.currentLine})`;
  if (offset === 0) {
    return functionId === 0
      ? "Node's CommonJS loader calls the module wrapper; your top-level code starts running in Ignition, V8's bytecode interpreter."
      : `Entering \`${functionLabel(ctx, functionId)}\`: Ignition starts a new frame for it at bytecode offset 0${where}.`;
  }
  return `${opcodeSentence(opcode)}${where}`;
}

function opcodeSentence(opcode: Opcode): string {
  switch (opcode) {
    case "JumpLoop":
      return "JumpLoop jumps back to the loop header; V8 counts these back edges to decide when a hot loop is worth optimizing.";
    case "Return":
      return "Return hands the accumulator to the caller and pops this frame.";
    case "Throw":
    case "ReThrow":
      return "Throw raises an exception: Ignition looks for a handler in this function's handler table, then unwinds to its caller.";
    case "Construct":
      return "Construct runs `new`: V8 allocates the object, then runs the constructor on it.";
    case "CreateClosure":
      return "CreateClosure makes a function object that captures the current context.";
    case "CreateObjectLiteral":
    case "CreateEmptyObjectLiteral":
      return "The object literal allocates an object whose hidden class (Map) describes its properties.";
    case "CreateArrayLiteral":
    case "CreateEmptyArrayLiteral":
      return "The array literal allocates an array with the elements kind its values need.";
    case "GetNamedProperty":
      return "GetNamedProperty reads a property through an inline cache: V8 remembers the receiver's Map to make the next read fast.";
    case "SetNamedProperty":
    case "DefineNamedOwnProperty":
      return "A named property store goes through an inline cache and may add the property, moving the object to a new hidden class.";
    case "GetKeyedProperty":
    case "SetKeyedProperty":
    case "StaInArrayLiteral":
      return "A keyed access reads or writes by index or computed name, through an inline cache.";
    case "SuspendGenerator":
      return "SuspendGenerator saves the registers: an async function pauses here at `await` and the caller continues.";
    case "ResumeGenerator":
      return "ResumeGenerator restores the saved registers: the async function continues after its `await`.";
    case "CallRuntime":
      return "CallRuntime calls into V8's runtime for an operation the interpreter does not inline.";
    default:
      if (opcode.startsWith("Call")) return `${opcode} calls a function: Ignition pushes a frame for the callee.`;
      if (opcode.startsWith("Jump")) return `${opcode} branches within this function.`;
      if (opcode.startsWith("Test")) return `${opcode} compares two values and leaves the boolean in the accumulator.`;
      return `Ignition runs ${opcode}.`;
  }
}

function jobStartSentence(queue: "nextTick" | "microtask" | "timers" | "check", task: TaskRef): string {
  switch (queue) {
    case "nextTick":
      return task.origin === "Node"
        ? `Node runs an internal process.nextTick callback (${task.label.replace("Node internal: ", "")}); processTicksAndRejections drains the whole nextTick queue before V8's microtask queue.`
        : `Node runs the process.nextTick callback \`${calleeOf(task)}\`; processTicksAndRejections drains the whole nextTick queue before V8's microtask queue.`;
    case "microtask":
      return `V8 runs a ${task.kind} (\`${task.label}\`) from its microtask queue, which drains completely before Node moves on.`;
    case "timers":
      return `Node runs the callback of \`${task.label}\` in the timers phase; its due time on the virtual clock has been reached.`;
    case "check":
      return `Node runs the callback of \`${task.label}\` in the check phase, right after the poll phase.`;
    default:
      return queue satisfies never;
  }
}

function loopPhaseSentence(phase: LoopPhase): string {
  switch (phase) {
    case "timers":
      return "libuv enters the timers phase: Node runs every timer whose due time has passed on the virtual clock.";
    case "pending":
      return "libuv enters the pending phase, which has no work in this simulator.";
    case "poll":
      return "libuv enters the poll phase: it would wait for I/O until the next timer is due, so the simulator jumps the virtual clock ahead instead of waiting.";
    case "check":
      return "libuv enters the check phase: setImmediate callbacks run here.";
    case "close":
      return "libuv enters the close phase: nothing is closing in this simulator.";
    default:
      return phase satisfies never;
  }
}

/** `process.nextTick(f)` -> `f`. */
function calleeOf(task: TaskRef): string {
  return /\((.*)\)$/.exec(task.label)?.[1] ?? task.label;
}

// ---- what changed since the previous tick ----

function changes(before: Tick | null, after: State, ctx: NarrationContext, withhold: boolean): string[] {
  const out: string[] = [];
  // The first tick has no "since": whatever Node's loader set up before your code is not a change.
  if (before && before.index >= 0) {
    out.push(...mapSentences(before.v8.maps, after.v8.maps));
    out.push(...elementsKindSentences(before.v8.elementsKinds, after.v8.elementsKinds, ctx));
    out.push(...feedbackSentences(before.v8.feedback, after.v8.feedback));
  }
  out.push(...tierEventSentences(after.v8.tierEvents ?? [], ctx));
  out.push(...queuedSentences(ctx.queued, after));
  if (before) {
    for (const line of after.console.slice(before.console.length)) out.push(withhold ? WITHHELD_CONSOLE_SENTENCE : consoleSentence(line));
    for (const warning of after.warnings.slice(before.warnings.length)) out.push(`Fidelity warning: ${warning.message}`);
  }
  return out;
}

/** Modeled: V8's tiering heuristics, so the wording is "would typically", never "did". */
export function tierEventSentences(events: readonly DeepReadonly<TierEvent>[], ctx: NarrationContext): string[] {
  return events.map((e) => {
    const name = `\`${functionLabel(ctx, e.functionId)}\``;
    if (e.kind === "deopt") {
      return `${name} would typically deoptimize from ${TIER_NAMES[e.from]} back to ${TIER_NAMES[e.to]} (${DEOPTIMIZE_REASON_MESSAGES[e.reason]}) (Modeled).`;
    }
    if (e.osr) return `${name} would typically tier up from ${TIER_NAMES[e.from]} to ${TIER_NAMES[e.to]} by on-stack replacement in a hot loop (Modeled).`;
    return `${name} would typically tier up to ${TIER_NAMES[e.to]} after ${e.invocations} calls (Modeled).`;
  });
}

const TIER_NAMES: Readonly<Record<Tier, string>> = { ignition: "Ignition", sparkplug: "Sparkplug", maglev: "Maglev", turbofan: "Turbofan" };

function mapSentences(before: readonly DeepReadonly<MapSnapshot>[], after: readonly DeepReadonly<MapSnapshot>[]): string[] {
  const known = new Map(before.map((m) => [m.id, m]));
  const byId = new Map(after.map((m) => [m.id, m]));
  const sentences: string[] = [];
  for (const map of after) {
    const old = known.get(map.id);
    if (!old) {
      // A root Map is shared by every object of its kind, so only a Map reached by a transition tells a story.
      // A non-enumerable field is the realm's own bookkeeping (builtin methods, `constructor`), not the program's.
      if (map.isDictionary) sentences.push(`The object's properties moved to dictionary mode (slow properties) → Map#${map.id}.`);
      else if (map.backPointer !== null && map.fields.at(-1)?.enumerable !== false) sentences.push(transitionSentence(map, byId.get(map.backPointer)));
      continue;
    }
    if (!old.deprecated && map.deprecated) {
      sentences.push(`Map#${map.id} was deprecated: objects using it migrate to an up-to-date Map the next time they are written.`);
    }
    map.fields.forEach((field, i) => {
      const was = old.fields[i];
      if (was && was.representation !== field.representation) {
        sentences.push(`Field \`${field.key}\` of Map#${map.id} generalized from ${was.representation} to ${field.representation} in place; V8 keeps the same Map.`);
      }
    });
  }
  if (sentences.length > MAX_MAP_SENTENCES) {
    return [...sentences.slice(0, MAX_MAP_SENTENCES), `…and ${sentences.length - MAX_MAP_SENTENCES} more hidden-class changes.`];
  }
  return sentences;
}

function transitionSentence(map: DeepReadonly<MapSnapshot>, back: DeepReadonly<MapSnapshot> | undefined): string {
  const field = map.fields.at(-1);
  const from = back ? ` (transition from Map#${back.id})` : "";
  if (back && field && map.fields.length === back.fields.length) {
    return `Field \`${field.key}\` changed representation → new hidden class Map#${map.id}${from}.`;
  }
  return field ? `Property \`${field.key}\` added → new hidden class Map#${map.id}${from}.` : `New hidden class Map#${map.id}${from}.`;
}

function elementsKindSentences(
  before: Readonly<Record<number, ElementsKind>>,
  after: Readonly<Record<number, ElementsKind>>,
  ctx: NarrationContext,
): string[] {
  const out: string[] = [];
  for (const key of Object.keys(after)) {
    const id = Number(key);
    const was = before[id];
    const now = after[id];
    if (was === undefined || now === undefined || was === now) continue;
    const object = ctx.realm.heap.objects()[id - 1];
    const what = object instanceof JSArray ? "Array" : "Object";
    out.push(`${what} #${id} went from ${was} to ${now} because ${elementsKindReason(was, now, object)}.`);
  }
  return out;
}

/** The class of values an elements kind holds: Smis, doubles, or anything. */
function family(kind: ElementsKind): "smi" | "double" | "tagged" | "dictionary" {
  switch (kind) {
    case "PACKED_SMI_ELEMENTS":
    case "HOLEY_SMI_ELEMENTS":
      return "smi";
    case "PACKED_DOUBLE_ELEMENTS":
    case "HOLEY_DOUBLE_ELEMENTS":
      return "double";
    case "PACKED_ELEMENTS":
    case "HOLEY_ELEMENTS":
      return "tagged";
    case "DICTIONARY_ELEMENTS":
      return "dictionary";
    default:
      return kind satisfies never;
  }
}

function elementsKindReason(was: ElementsKind, now: ElementsKind, object: unknown): string {
  const dense = object instanceof JSObject ? object.elements.dense : [];
  const from = family(was);
  const to = family(now);
  if (to === "dictionary") return "the elements became sparse (a write far beyond the end), so V8 stores them in a dictionary";
  if (from !== to) {
    const culprit = dense.find((v) => !isTheHole(v) && (to === "double" ? typeof v === "number" && !isSmi(v) : typeof v !== "number"));
    if (culprit !== undefined && !isTheHole(culprit)) {
      return to === "double" ? `\`${valueText(culprit)}\` isn't a Smi` : `\`${valueText(culprit)}\` isn't a number`;
    }
    return "a value arrived that the old kind cannot hold";
  }
  return "a hole appeared, so the array is now HOLEY";
}

function valueText(value: JSValue): string {
  if (typeof value === "string") return JSON.stringify(value);
  if (value !== null && typeof value === "object") return previewOf(value);
  return Object.is(value, -0) ? "-0" : String(value);
}

function feedbackSentences(before: readonly DeepReadonly<FeedbackSnapshot>[], after: readonly DeepReadonly<FeedbackSnapshot>[]): string[] {
  const old = new Map<string, string>();
  for (const vector of before) for (const slot of vector.slots) old.set(`${vector.functionId}:${slot.index}`, slot.state);
  const out: string[] = [];
  for (const vector of after) {
    for (const slot of vector.slots) {
      const was = old.get(`${vector.functionId}:${slot.index}`) ?? "UNINITIALIZED";
      if (was === slot.state) continue;
      const name = vector.functionName === "" ? "(anonymous)" : vector.functionName;
      out.push(`Inline cache: ${slot.kind} slot #${slot.index} in \`${name}\` went ${was} → ${slot.state}${seenMaps(slot.state, slot.mapIds)}.`);
    }
  }
  return out;
}

function seenMaps(state: string, mapIds: readonly number[]): string {
  if (state === "MEGAMORPHIC") return " (too many shapes seen; V8 falls back to the global stub cache)";
  if (mapIds.length === 0) return "";
  return state === "MONOMORPHIC" ? ` (receiver Map#${mapIds[0]})` : ` (saw ${mapIds.map((id) => `Map#${id}`).join(", ")})`;
}

function queuedSentences(queued: readonly TaskRef[], after: State): string[] {
  const out: string[] = [];
  for (const task of queued) {
    switch (task.kind) {
      case "PromiseReactionJob":
      case "PromiseResolveThenableJob":
      case "CallbackJob":
        out.push(
          task.label === "await continuation"
            ? `\`await\` called PerformPromiseThen, which queued the function's continuation as a PromiseReactionJob; V8 runs microtasks before Node's timers phase.`
            : `${task.origin} queued a ${task.kind}; V8 runs microtasks before Node's timers phase.`,
        );
        break;
      case "nextTick":
        // Node's own ticks (a stream's afterWrite) are bookkeeping, not a lesson.
        if (task.origin !== "Node") out.push(`process.nextTick queued \`${calleeOf(task)}\`; Node drains its nextTick queue before V8's microtask queue.`);
        break;
      case "timeout":
      case "interval": {
        const due = after.hostApis.find((h) => h.id === task.id)?.dueMs;
        const when = due === null || due === undefined ? "" : ` for ${due} ms on the virtual clock`;
        out.push(`${task.origin} scheduled \`${calleeOf(task).replace(/, \d+$/, "")}\`${when}. Timers belong to Node's timers phase, not to V8.`);
        break;
      }
      case "immediate":
        out.push(`setImmediate queued \`${calleeOf(task)}\`; Node's check phase runs it right after the poll phase.`);
        break;
      default:
        task.kind satisfies never;
    }
  }
  return out;
}

function consoleSentence(line: { readonly stream: string; readonly text: string; readonly origin: string }): string {
  const text = JSON.stringify(line.text).slice(1, -1);
  const shown = text.length > 60 ? `${text.slice(0, 60)}…` : text;
  return line.origin === "console"
    ? `${line.stream === "stdout" ? "console.log" : "console.error"} wrote \`${shown}\` to ${line.stream}.`
    : `Node printed \`${shown}\` to ${line.stream}.`;
}
