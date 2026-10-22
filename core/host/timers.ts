import { type Completion, isThrow, normal } from "@/core/interpreter/Completion";
import type { Realm } from "@/core/runtime/Realm";
import { displayName } from "@/core/runtime/objects/functionName";
import { JSFunction } from "@/core/runtime/objects/JSFunction";
import { JSHostObject } from "@/core/runtime/objects/JSHostObject";
import { JSObject } from "@/core/runtime/objects/JSObject";
import { ToBoolean, ToNumber } from "@/core/runtime/spec/conversions";
import { OrdinaryDefineOwnProperty, OrdinaryGet } from "@/core/runtime/spec/objectOps";
import type { JSValue } from "@/core/runtime/values/JSValue";
import type { TaskId } from "@/core/shared/ids";
import { SimulationHalt } from "@/core/shared/simulationHalt";
import type { TaskRef } from "@/core/timeline/Command";
import type { RunNextTicksCaller } from "./nodeFrames";
import type { VirtualClock } from "./VirtualClock";
import { type ProcessWarning, timeoutNaNWarning, timeoutNegativeWarning, timeoutOverflowWarning } from "./warnings";

// Timers and immediates, ported from lib/internal/timers.js and lib/timers.js at v24.19.0.
// Timeouts live in one list per duration (timerListMap); the lists sit in a priority queue
// ordered by expiry, then by list id (compareTimersLists). Immediates are one FIFO.

/** The largest delay that fits a 32-bit signed integer; anything outside [1, TIMEOUT_MAX] becomes 1. */
export const TIMEOUT_MAX = 2 ** 31 - 1;

/** A Timeout: its JS object (holding `_onTimeout`) and the fields the loop reads. */
export class TimeoutRecord {
  readonly id: TaskId;
  readonly object: JSHostObject;
  /** `_idleTimeout`: the delay, or -1 once unenrolled. */
  idleTimeout: number;
  /** `_idleStart`: the loop time when it was inserted. */
  idleStart = 0;
  /** `_repeat`: the interval's delay, or null for a one-shot timeout. */
  readonly repeat: number | null;
  readonly args: readonly JSValue[] | undefined;
  destroyed = false;
  /** `[kRefed]`. */
  refed: boolean;
  /** The list it is linked into (`_idleNext`/`_idlePrev` non-null), or null. */
  list: TimersList | null = null;

  constructor(id: TaskId, object: JSHostObject, after: number, args: readonly JSValue[] | undefined, isRepeat: boolean) {
    this.id = id;
    this.object = object;
    this.idleTimeout = after;
    this.repeat = isRepeat ? after : null;
    this.args = args;
    this.refed = true;
  }
}

/** `TimersList`: the timeouts of one duration, in insertion order. */
export class TimersList {
  expiry: number;
  id: number;
  readonly msecs: number;
  readonly timers: TimeoutRecord[] = [];

  constructor(expiry: number, id: number, msecs: number) {
    this.expiry = expiry;
    this.id = id;
    this.msecs = msecs;
  }
}

/** An Immediate: its JS object (holding `_onImmediate`) and its bookkeeping. */
export class ImmediateRecord {
  readonly id: TaskId;
  readonly object: JSHostObject;
  readonly args: readonly JSValue[] | undefined;
  destroyed = false;
  /** `[kRefed]`: null once it has run or been cleared. */
  refed: boolean | null = true;
  /** clearImmediate unlinked it from the queue. */
  cleared = false;

  constructor(id: TaskId, object: JSHostObject, args: readonly JSValue[] | undefined) {
    this.id = id;
    this.object = object;
    this.args = args;
  }
}

/** What the timers ask of the loop around each callback. */
export interface TimerLoop {
  /** Calls a timer or immediate callback with the entry point set for its stack frames. */
  invoke(task: TaskRef, callback: JSFunction, receiver: JSValue, args: readonly JSValue[], entry: "timer" | "immediate"): Completion;
  /** An exception escaped a callback: print it; the process exits. */
  uncaught(exception: JSValue): void;
  /** runNextTicks() between two callbacks; false when the process died in it. */
  runNextTicks(within: RunNextTicksCaller): boolean;
  /** A list was re-armed after its due timers ran (the nondeterminism rules watch this). */
  listReArmed(list: TimersList, others: readonly TimersList[]): void;
}

const DATA = { writable: true, enumerable: true, configurable: true } as const;

/** compareTimersLists. */
function compareLists(a: TimersList, b: TimersList): number {
  return a.expiry - b.expiry || a.id - b.id;
}

function notAFunction(what: string): never {
  throw new SimulationHalt({ kind: "unsupported", reason: `${what} with a callback that is not a function (ERR_INVALID_ARG_TYPE is not modeled)` });
}

export class NodeTimers {
  readonly #realm: Realm;
  readonly #clock: VirtualClock;
  readonly #emitWarning: (warning: ProcessWarning) => void;
  /** timerListMap. */
  readonly #lists = new Map<number, TimersList>();
  /** timerListQueue (a binary heap in Node; ids make the order total, so any min-structure agrees). */
  readonly #queue: TimersList[] = [];
  #nextListId = 0;
  /** timeoutInfo[0]: ref'd timeouts that are not destroyed. */
  refCount = 0;
  #warnedNegativeNumber = false;
  #warnedNotNumber = false;
  /** immediateQueue. */
  #immediates: ImmediateRecord[] = [];
  /** immediateInfo[kRefCount]. */
  immediateRefCount = 0;
  readonly #timeouts = new WeakMap<JSObject, TimeoutRecord>();
  readonly #immediateRecords = new WeakMap<JSObject, ImmediateRecord>();
  #timeoutPrototype: JSObject | undefined;
  #immediatePrototype: JSObject | undefined;

  constructor(realm: Realm, clock: VirtualClock, emitWarning: (warning: ProcessWarning) => void) {
    this.#realm = realm;
    this.#clock = clock;
    this.#emitWarning = emitWarning;
  }

  // ---- queries the loop makes ----

  /** The list that comes due first (timerListQueue.peek()). */
  peek(): TimersList | undefined {
    let best: TimersList | undefined;
    for (const list of this.#queue) if (!best || compareLists(list, best) < 0) best = list;
    return best;
  }

  /** The lists in the queue, for the nondeterminism rules. */
  lists(): readonly TimersList[] {
    return this.#queue;
  }

  /** immediateInfo[kCount] > 0. */
  get hasImmediates(): boolean {
    return this.#immediates.length > 0;
  }

  /** The pending timeouts in the order they will fire (lists by expiry then id, each list in insertion order). */
  pendingTimeouts(): readonly TimeoutRecord[] {
    return [...this.#queue].sort(compareLists).flatMap((list) => list.timers.filter((t) => !t.destroyed));
  }

  /** The immediates the next check phase will run, in order. */
  pendingImmediates(): readonly ImmediateRecord[] {
    return this.#immediates.filter((i) => !i.destroyed);
  }

  /** `setTimeout(callback, delay)` as the timeline names it (an interval says `setInterval`). */
  timeoutRef(timer: TimeoutRecord): TaskRef {
    const callback = OrdinaryGet(timer.object, "_onTimeout");
    const name = callback instanceof JSFunction ? displayName(callback) : "(cleared)";
    const kind = timer.repeat !== null ? "interval" : "timeout";
    const api = kind === "interval" ? "setInterval" : "setTimeout";
    return { id: timer.id, kind, label: `${api}(${name}, ${timer.repeat ?? timer.idleTimeout})`, origin: api };
  }

  immediateRef(immediate: ImmediateRecord): TaskRef {
    const callback = OrdinaryGet(immediate.object, "_onImmediate");
    return { id: immediate.id, kind: "immediate", label: `setImmediate(${callback instanceof JSFunction ? displayName(callback) : "(cleared)"})`, origin: "setImmediate" };
  }

  // ---- the JS-visible API ----

  /** `setTimeout` / `setInterval`: new Timeout(...) then insert(). */
  schedule(callback: JSValue, after: JSValue, args: readonly JSValue[], isRepeat: boolean): Completion {
    if (!(callback instanceof JSFunction)) notAFunction(isRepeat ? "setInterval" : "setTimeout");
    const delay = this.#timeoutDuration(after);
    if (isThrow(delay)) return delay;
    const object = this.#hostObject("Timeout", this.#timeoutProto());
    OrdinaryDefineOwnProperty(this.#realm, object, "_onTimeout", { value: callback, ...DATA });
    const timer = new TimeoutRecord(this.#realm.taskIds.next(), object, delay.value, args.length > 0 ? args : undefined, isRepeat);
    this.#timeouts.set(object, timer);
    this.refCount += 1;
    this.#insert(timer, timer.idleTimeout);
    this.#realm.taskIds.record(this.timeoutRef(timer));
    return normal(object);
  }

  /** `clearTimeout` / `clearInterval` (lib/timers.js). */
  clear(value: JSValue): Completion {
    if (!(value instanceof JSObject)) return normal(undefined); // knownTimersById is empty: Symbol.toPrimitive is outside the model
    if (!ToBoolean(OrdinaryGet(value, "_onTimeout"))) return normal(undefined);
    const timer = this.#timeouts.get(value);
    if (!timer) throw new SimulationHalt({ kind: "unsupported", reason: "clearTimeout on an object that is not a Timeout" });
    OrdinaryDefineOwnProperty(this.#realm, value, "_onTimeout", { value: null, ...DATA });
    this.#unenroll(timer);
    return normal(undefined);
  }

  /** `setImmediate`: new Immediate(...), ref'd and appended to the queue. */
  scheduleImmediate(callback: JSValue, args: readonly JSValue[]): Completion {
    if (!(callback instanceof JSFunction)) notAFunction("setImmediate");
    const object = this.#hostObject("Immediate", this.#immediateProto());
    OrdinaryDefineOwnProperty(this.#realm, object, "_onImmediate", { value: callback, ...DATA });
    const immediate = new ImmediateRecord(this.#realm.taskIds.next(), object, args.length > 0 ? args : undefined);
    this.#immediateRecords.set(object, immediate);
    this.immediateRefCount += 1;
    this.#immediates.push(immediate);
    this.#realm.taskIds.record(this.immediateRef(immediate));
    return normal(object);
  }

  /** `clearImmediate` (lib/timers.js). */
  clearImmediate(value: JSValue): Completion {
    if (!(value instanceof JSObject) || !ToBoolean(OrdinaryGet(value, "_onImmediate"))) return normal(undefined);
    const immediate = this.#immediateRecords.get(value);
    if (!immediate) throw new SimulationHalt({ kind: "unsupported", reason: "clearImmediate on an object that is not an Immediate" });
    if (immediate.destroyed) return normal(undefined);
    immediate.destroyed = true;
    if (immediate.refed) this.immediateRefCount -= 1;
    immediate.refed = null;
    OrdinaryDefineOwnProperty(this.#realm, value, "_onImmediate", { value: null, ...DATA });
    immediate.cleared = true;
    this.#immediates = this.#immediates.filter((i) => i !== immediate);
    return normal(undefined);
  }

  /** The Timeout constructor's delay coercion: `after *= 1`, then anything outside [1, TIMEOUT_MAX] is 1. */
  #timeoutDuration(after: JSValue): Completion<number> {
    if (after === undefined) return normal(1);
    const converted = ToNumber(this.#realm, after);
    if (isThrow(converted)) return converted;
    const n = converted.value;
    if (n >= 1 && n <= TIMEOUT_MAX) return normal(n);
    if (n > TIMEOUT_MAX) {
      this.#emitWarning(timeoutOverflowWarning(n));
    } else if (n < 0 && !this.#warnedNegativeNumber) {
      this.#warnedNegativeNumber = true;
      this.#emitWarning(timeoutNegativeWarning(n));
    } else if (Number.isNaN(n) && !this.#warnedNotNumber) {
      this.#warnedNotNumber = true;
      this.#emitWarning(timeoutNaNWarning(n));
    }
    return normal(1);
  }

  /** insert(item, msecs, start = getLibuvNow()). */
  #insert(timer: TimeoutRecord, msecs: number, start = this.#clock.now()): void {
    const key = Math.trunc(msecs);
    timer.idleStart = start;
    let list = this.#lists.get(key);
    if (!list) {
      list = new TimersList(start + key, this.#nextListId++, key);
      this.#lists.set(key, list);
      this.#queue.push(list);
    }
    // L.append unlinks the item from any list first.
    this.#unlink(timer);
    list.timers.push(timer);
    timer.list = list;
  }

  #unlink(timer: TimeoutRecord): void {
    const list = timer.list;
    if (!list) return;
    const at = list.timers.indexOf(timer);
    if (at >= 0) list.timers.splice(at, 1);
    timer.list = null;
  }

  #removeList(list: TimersList): void {
    const at = this.#queue.indexOf(list);
    if (at >= 0) this.#queue.splice(at, 1);
    if (this.#lists.get(list.msecs) === list) this.#lists.delete(list.msecs);
  }

  /** unenroll (lib/timers.js). */
  #unenroll(timer: TimeoutRecord): void {
    if (timer.destroyed) return;
    timer.destroyed = true;
    this.#unlink(timer);
    if (timer.refed) {
      const list = this.#lists.get(Math.trunc(timer.idleTimeout));
      if (list && list.timers.length === 0) this.#removeList(list);
      this.refCount -= 1;
    }
    timer.idleTimeout = -1;
  }

  // ---- the loop's side ----

  /** processTimers(now): runs every list that is due, oldest expiry first. False when the process died. */
  processTimers(now: number, loop: TimerLoop): boolean {
    let ranAtLeastOneList = false;
    for (let list = this.peek(); list && list.expiry <= now; list = this.peek()) {
      if (ranAtLeastOneList) {
        if (!loop.runNextTicks("processTimers")) return false;
      } else {
        ranAtLeastOneList = true;
      }
      if (!this.#listOnTimeout(list, now, loop)) return false;
    }
    return true;
  }

  /** listOnTimeout(list, now). */
  #listOnTimeout(list: TimersList, now: number, loop: TimerLoop): boolean {
    const msecs = list.msecs;
    let ranAtLeastOneTimer = false;
    for (let timer = list.timers[0]; timer; timer = list.timers[0]) {
      const diff = now - timer.idleStart;
      // Too early for this timer: the rest of the list is later still. Re-arm the list.
      if (diff < msecs) {
        list.expiry = Math.max(timer.idleStart + msecs, now + 1);
        list.id = this.#nextListId++;
        loop.listReArmed(list, this.#queue);
        return true;
      }
      if (ranAtLeastOneTimer) {
        if (!loop.runNextTicks("listOnTimeout")) return false;
      } else {
        ranAtLeastOneTimer = true;
      }
      this.#unlink(timer);
      const onTimeout = OrdinaryGet(timer.object, "_onTimeout");
      if (!ToBoolean(onTimeout)) {
        if (!timer.destroyed) {
          timer.destroyed = true;
          if (timer.refed) this.refCount -= 1;
        }
        continue;
      }
      const start = timer.repeat !== null ? this.#clock.now() : undefined;
      if (!(onTimeout instanceof JSFunction)) throw new SimulationHalt({ kind: "unsupported", reason: "a Timeout whose _onTimeout is not a function" });
      const done = loop.invoke(this.timeoutRef(timer), onTimeout, timer.object, timer.args ?? [], "timer");
      // The `finally`: an interval re-arms from its callback's start time; a one-shot timeout is destroyed.
      if (timer.repeat !== null && timer.idleTimeout !== -1) {
        timer.idleTimeout = timer.repeat;
        this.#insert(timer, timer.idleTimeout, start);
      } else if (timer.list === null && !timer.destroyed) {
        timer.destroyed = true;
        if (timer.refed) this.refCount -= 1;
      }
      if (isThrow(done)) {
        loop.uncaught(done.value);
        return false;
      }
    }
    // Every timer ran: drop the list, unless it was removed (and maybe recreated) meanwhile.
    if (this.#lists.get(msecs) === list) this.#removeList(list);
    return true;
  }

  /** processImmediate(): runs the immediates queued before it started; new ones wait for the next check phase. */
  processImmediate(loop: TimerLoop): boolean {
    const queue = this.#immediates;
    this.#immediates = [];
    /** `_idleNext`: the next immediate still linked (clearImmediate unlinks). */
    const next = (i: number): number => {
      let j = i + 1;
      while (j < queue.length && queue[j]?.cleared) j += 1;
      return j;
    };
    let ranAtLeastOneImmediate = false;
    for (let i = queue[0]?.cleared ? next(0) : 0; i < queue.length; ) {
      if (ranAtLeastOneImmediate) {
        if (!loop.runNextTicks("processImmediate")) return false;
      } else {
        ranAtLeastOneImmediate = true;
      }
      const immediate = queue[i];
      if (!immediate) break;
      // Cleared while the tick queue drained just above.
      if (immediate.destroyed) {
        i = next(i);
        continue;
      }
      immediate.destroyed = true;
      if (immediate.refed) this.immediateRefCount -= 1;
      immediate.refed = null;
      const callback = OrdinaryGet(immediate.object, "_onImmediate");
      if (!(callback instanceof JSFunction)) throw new SimulationHalt({ kind: "unsupported", reason: "an Immediate whose _onImmediate is not a function" });
      const done = loop.invoke(this.immediateRef(immediate), callback, immediate.object, immediate.args ?? [], "immediate");
      // The `finally` clears `_onImmediate` before an uncaught exception is reported.
      OrdinaryDefineOwnProperty(this.#realm, immediate.object, "_onImmediate", { value: null, ...DATA });
      i = next(i);
      if (isThrow(done)) {
        loop.uncaught(done.value);
        return false;
      }
    }
    return true;
  }

  // ---- Timeout.prototype and Immediate.prototype ----

  #hostObject(hostClass: string, prototype: JSObject): JSHostObject {
    const realm = this.#realm;
    return realm.heap.allocate((id) => new JSHostObject(id, realm.maps.rootFor("object-literal", 0), prototype, hostClass));
  }

  #intrinsicPrototype(name: string): JSObject {
    const realm = this.#realm;
    const prototype = realm.heap.allocateIntrinsic((id) => new JSObject(id, realm.maps.rootFor("object-literal", 0), realm.intrinsics.objectPrototype));
    const unsupported = (): never => {
      throw new SimulationHalt({ kind: "unsupported", reason: `calling or constructing Node's ${name} class is not modeled` });
    };
    realm.linkConstructor(realm.nativeConstructor(name, 0, unsupported, unsupported), prototype);
    return prototype;
  }

  #timeoutProto(): JSObject {
    if (this.#timeoutPrototype) return this.#timeoutPrototype;
    const prototype = this.#intrinsicPrototype("Timeout");
    const timer = (receiver: JSValue, method: string): TimeoutRecord => {
      const record = receiver instanceof JSObject ? this.#timeouts.get(receiver) : undefined;
      if (!record) throw new SimulationHalt({ kind: "unsupported", reason: `Timeout.prototype.${method} on a value that is not a Timeout` });
      return record;
    };
    const realm = this.#realm;
    realm.defineMethod(prototype, "refresh", 0, (_r, receiver) => {
      const t = timer(receiver, "refresh");
      // insertGuarded(this, this[kRefed]).
      if (t.idleTimeout >= 0) {
        this.#insert(t, t.idleTimeout);
        if (t.destroyed) {
          t.destroyed = false;
          if (t.refed) this.refCount += 1;
        }
      }
      return normal(receiver);
    });
    realm.defineMethod(prototype, "unref", 0, (_r, receiver) => {
      const t = timer(receiver, "unref");
      if (t.refed) {
        t.refed = false;
        if (!t.destroyed) this.refCount -= 1;
      }
      return normal(receiver);
    });
    realm.defineMethod(prototype, "ref", 0, (_r, receiver) => {
      const t = timer(receiver, "ref");
      if (!t.refed) {
        t.refed = true;
        if (!t.destroyed) this.refCount += 1;
      }
      return normal(receiver);
    });
    realm.defineMethod(prototype, "hasRef", 0, (_r, receiver) => normal(timer(receiver, "hasRef").refed));
    realm.defineMethod(prototype, "close", 0, (_r, receiver) => {
      timer(receiver, "close");
      const cleared = this.clear(receiver);
      return isThrow(cleared) ? cleared : normal(receiver);
    });
    this.#timeoutPrototype = prototype;
    return prototype;
  }

  #immediateProto(): JSObject {
    if (this.#immediatePrototype) return this.#immediatePrototype;
    const prototype = this.#intrinsicPrototype("Immediate");
    const immediate = (receiver: JSValue, method: string): ImmediateRecord => {
      const record = receiver instanceof JSObject ? this.#immediateRecords.get(receiver) : undefined;
      if (!record) throw new SimulationHalt({ kind: "unsupported", reason: `Immediate.prototype.${method} on a value that is not an Immediate` });
      return record;
    };
    const realm = this.#realm;
    realm.defineMethod(prototype, "ref", 0, (_r, receiver) => {
      const i = immediate(receiver, "ref");
      if (i.refed === false) {
        i.refed = true;
        this.immediateRefCount += 1;
      }
      return normal(receiver);
    });
    realm.defineMethod(prototype, "unref", 0, (_r, receiver) => {
      const i = immediate(receiver, "unref");
      if (i.refed === true) {
        i.refed = false;
        this.immediateRefCount -= 1;
      }
      return normal(receiver);
    });
    realm.defineMethod(prototype, "hasRef", 0, (_r, receiver) => normal(immediate(receiver, "hasRef").refed === true));
    this.#immediatePrototype = prototype;
    return prototype;
  }
}
