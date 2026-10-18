import type { Completion } from "@/core/interpreter/Completion";
import { isThrow, normal } from "@/core/interpreter/Completion";
import type { StepObserver } from "@/core/interpreter/IgnitionInterpreter";
import type { TaskId } from "@/core/shared/ids";

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
}

export type JobSpec = Omit<Job, "id">;

export class MicrotaskQueue {
  readonly #jobs: Job[] = [];
  #head = 0;
  #nextId = 1;
  readonly #onEnqueue: ((job: Job) => void) | undefined;

  constructor(onEnqueue?: (job: Job) => void) {
    this.#onEnqueue = onEnqueue;
  }

  get length(): number {
    return this.#jobs.length - this.#head;
  }

  enqueue(spec: JobSpec): Job {
    const job: Job = { id: this.#nextId as TaskId, ...spec };
    this.#nextId += 1;
    this.#jobs.push(job);
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
      observer.onCommand({ kind: "job-start", jobId: job.id, jobKind: job.kind, label: job.label });
      const done = job.run();
      observer.onCommand({ kind: "job-end", jobId: job.id });
      if (isThrow(done)) return done;
    }
    // The consumed prefix is dropped once the queue is empty, so a long run does not keep it alive.
    this.#jobs.length = 0;
    this.#head = 0;
    return normal(undefined);
  }
}
