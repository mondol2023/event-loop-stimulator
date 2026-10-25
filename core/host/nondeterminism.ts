import type { TimersList } from "./timers";

// Orderings real Node does not guarantee, one rule per probed case. Each rule names the fixture
// whose recording (several distinct outcomes over many runs) proves it. The simulator never
// picks an order at random: JavaScript costs 0 virtual ms, so it always takes the same branch,
// and the rule adds a fidelity warning (never stdout or stderr).

export interface NondeterminismRule {
  readonly fixture: string;
  readonly warning: string;
}

/**
 * Rule 1 (timeout-vs-immediate-main): a `setTimeout(≤1)` and a `setImmediate` both pending when
 * the loop starts. Whether the 1 ms timer is due at the first timers phase depends on how much
 * real time startup took; with 0 ms of startup it is not, so the immediate runs first
 * (outcomes[0]).
 */
export const FIRST_ITERATION_TIMER_VS_IMMEDIATE: NondeterminismRule = {
  fixture: "timeout-vs-immediate-main",
  warning: "Order not guaranteed in real Node: whether the 1 ms timer is due before the first loop iteration depends on how long startup took.",
};

/**
 * Rule 2 (timer-in-timer-ordering): a timer list is re-armed, after its due timers ran, to the
 * same expiry as another pending list, so the two run in list-id order. In real Node the
 * re-armed expiry, and the other list's, depend on how many real milliseconds the callbacks and
 * the script took (getLibuvNow() reads the clock each time), so either list may run first. With
 * 0 ms callbacks the other (older) list runs first, which is one of the recorded outcomes.
 */
export const RE_ARMED_LIST_TIE: NondeterminismRule = {
  fixture: "timer-in-timer-ordering",
  warning:
    "Order not guaranteed in real Node: timers scheduled from a timer callback tie with an existing timer, and which runs first depends on how long the callbacks took.",
};

/**
 * Rule 3 (timer-after-first-write): a timer inserted after a console write that followed the arming
 * of another list (into a new list or an existing one), due up to WRITE_SLACK_MS before that list.
 * getLibuvNow() reads the clock at each insert, and a write costs real time (the first ~2.2 ms,
 * later ones less but still enough to flip a 2 ms gap in 10 of 40 runs, probed), so the later list
 * may start late enough to run second. A write before the other list was armed does not matter
 * (probed: 0 flips in 40 runs). With 0 ms writes it runs first, one of the recorded outcomes.
 */
export const TIMER_ARMED_AFTER_WRITE: NondeterminismRule = {
  fixture: "timer-after-first-write",
  warning: "Order not guaranteed in real Node: a timer armed after console output races an earlier timer, and which runs first depends on how long the output took.",
};

/** Probed: an expiry gap of 4 ms flips after the first write, 5 ms did not; 5 keeps a margin. */
export const WRITE_SLACK_MS = 5;

export const NONDETERMINISM_RULES: readonly NondeterminismRule[] = [FIRST_ITERATION_TIMER_VS_IMMEDIATE, RE_ARMED_LIST_TIE, TIMER_ARMED_AFTER_WRITE];

/** Collects each rule's warning at most once per run, in the order they first apply. */
export class NondeterminismWatch {
  readonly warnings: string[] = [];
  /** Console writes so far, and the count when each list was armed (rule 3). */
  #writes = 0;
  readonly #armedAt = new WeakMap<TimersList, number>();

  #raise(rule: NondeterminismRule): void {
    if (!this.warnings.includes(rule.warning)) this.warnings.push(rule.warning);
  }

  /** Rule 1, checked when the loop starts (uv_run's first timers phase). */
  loopStarts(lists: readonly TimersList[], hasImmediates: boolean, now: number): void {
    if (hasImmediates && lists.some((l) => l.msecs <= 1 && l.timers.length > 0 && l.expiry > now)) {
      this.#raise(FIRST_ITERATION_TIMER_VS_IMMEDIATE);
    }
  }

  /** Rule 3: a console write happened. */
  wrote(): void {
    this.#writes++;
  }

  /** Rule 3, checked at every insert(): `due` is the timer's own idleStart + msecs. */
  timerInserted(list: TimersList, due: number, lists: readonly TimersList[]): void {
    if (!this.#armedAt.has(list)) this.#armedAt.set(list, this.#writes);
    const raced = lists.some((other) => {
      const gap = other.expiry - due;
      return other !== list && other.timers.length > 0 && this.#writes > (this.#armedAt.get(other) ?? 0) && gap > 0 && gap <= WRITE_SLACK_MS;
    });
    if (raced) this.#raise(TIMER_ARMED_AFTER_WRITE);
  }

  /** Rule 2, checked when listOnTimeout re-arms a list. */
  listReArmed(list: TimersList, lists: readonly TimersList[]): void {
    if (lists.some((other) => other !== list && other.timers.length > 0 && other.expiry === list.expiry)) this.#raise(RE_ARMED_LIST_TIE);
  }
}
