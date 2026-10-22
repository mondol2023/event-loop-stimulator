import type { Completion } from "@/core/interpreter/Completion";
import { isThrow, normal } from "@/core/interpreter/Completion";
import type { StepObserver } from "@/core/interpreter/IgnitionInterpreter";
import type { TaskId } from "@/core/shared/ids";
import type { TaskRef } from "@/core/timeline/Command";
import type { TaskIds } from "./TaskIds";

// V8's MicrotaskQueue (src/execution/microtask-queue.h): one FIFO of jobs shared by promise
// reactions, thenable adoption and queueMicrotask. A job queued while draining goes to the back
// and still runs before the drain ends (RunMicrotasks).

export type JobKind = "PromiseReactionJob" | "PromiseResolveThenableJob" | "CallbackJob";

export interface Job {
  readonly id: TaskId;
  readonly kind: JobKind;
  /** Runs the job. Only a CallbackJob can complete abruptly; the promise jobs route a throw into a promise. */
  run(): Completion;
  /** What the narration says about this job. */
  readonly label: string;
  /** The abstract operation or API that queued it (`PerformPromiseThen`, `queueMicrotask`). */
  readonly origin: string;
  /** The values the job keeps alive until it runs (the modeled GC's roots). */
  readonly roots?: readonly unknown[];
}

export type JobSpec = Omit<Job, "id">;

/** The timeline's name for a job. */
export function taskRefOf(job: Job): TaskRef {
  return { id: job.id, kind: job.kind, label: job.label, origin: job.origin };
}

export class MicrotaskQueue {
  readonly #jobs: Job[] = [];
  #head = 0;
  readonly #ids: TaskIds;
  readonly #onEnqueue: ((job: Job) => void) | undefined;

  constructor(ids: TaskIds, onEnqueue?: (job: Job) => void) {
    this.#ids = ids;
    this.#onEnqueue = onEnqueue;
  }

  get length(): number {
    return this.#jobs.length - this.#head;
  }

  /** The jobs that have not started, in the order they will run. */
  pending(): readonly Job[] {
    return this.#jobs.slice(this.#head);
  }

  enqueue(spec: JobSpec): Job {
    const job: Job = { id: this.#ids.next(), ...spec };
    this.#jobs.push(job);
    this.#ids.record(taskRefOf(job));
    this.#onEnqueue?.(job);
    return job;
  }

  /**
   * Runs jobs until the queue is empty, reporting `job-start` and `job-end` around each. A job
   * that throws ends the drain at once and its exception is returned: Node treats it as an
   * uncaught exception, so the jobs behind it never run.
   */
  drain(observer: StepObserver): Completion<void> {
    while (this.#head < this.#jobs.length) {
      const job = this.#jobs[this.#head++];
      if (!job) break;
      const task = taskRefOf(job);
      observer.onCommand({ kind: "job-start", queue: "microtask", task });
      const done = job.run();
      observer.onCommand({ kind: "job-end", task });
      if (isThrow(done)) return done;
    }
    // The consumed prefix is dropped once the queue is empty, so a long run does not keep it alive.
    this.#jobs.length = 0;
    this.#head = 0;
    return normal(undefined);
  }
}
