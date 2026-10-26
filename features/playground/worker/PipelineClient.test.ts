import { describe, expect, it } from "vitest";
import { createFakeWorker, type FakeWorker } from "../test/fakeWorker";
import { handleRequest } from "./handleRequest";
import { createPipelineClient, type PipelineEvent } from "./PipelineClient";
import type { PipelineResponse } from "./protocol";

function fakeTimers() {
  let now = 0;
  let nextId = 1;
  const pending = new Map<number, { at: number; fn: () => void }>();
  return {
    setTimer: (fn: () => void, ms: number): unknown => {
      const id = nextId++;
      pending.set(id, { at: now + ms, fn });
      return id;
    },
    clearTimer: (h: unknown): void => {
      pending.delete(h as number);
    },
    advance(ms: number): void {
      now += ms;
      for (const [id, t] of [...pending]) {
        if (t.at <= now) {
          pending.delete(id);
          t.fn();
        }
      }
    },
  };
}

function setup(onCreate?: (w: FakeWorker) => void) {
  const timers = fakeTimers();
  const fake = createFakeWorker();
  const events: PipelineEvent[] = [];
  const client = createPipelineClient({
    createWorker: () => {
      const w = fake.factory();
      const instance = fake.instances[fake.instances.length - 1];
      if (instance) onCreate?.(instance);
      return w;
    },
    onEvent: (e) => events.push(e),
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  });
  const inst = (i: number): FakeWorker => {
    const w = fake.instances[i];
    if (!w) throw new Error(`no worker instance ${i}`);
    return w;
  };
  return { timers, fake, events, client, inst };
}

const simulated = (jobId: number): PipelineResponse => ({ type: "simulated", jobId, timeline: "{}", boundaries: [0], markers: [], tierTracks: [], hardware: [], tickCount: 1, exitCode: 0, warnings: [], stop: null });

const compiledOk = (jobId: number) => ({
  type: "compiled",
  jobId,
  diagnostics: [],
  strippedJs: "",
  views: { ast: { lines: [] }, bytecode: { functions: [] }, asm: { functions: [] }, binary: { functions: [] } },
  lineIndex: { source: [], panes: { ast: [], bytecode: [], asm: [], binary: [] } },
  baselines: [],
});

const compiledWithDiagnostic = (jobId: number) => ({
  type: "compiled",
  jobId,
  diagnostics: [{ code: "E_EXCLUDED_API", message: "m", range: { start: 0, end: 1 }, hint: "h" }],
  strippedJs: null,
  views: null,
  lineIndex: null,
  baselines: null,
});

const responsesOf = (events: PipelineEvent[]) => events.filter((e) => e.kind === "response");

describe("PipelineClient debounce", () => {
  it("posts one message with the last source after the quiet period", () => {
    const { timers, fake, client } = setup();
    client.request("a", "js");
    timers.advance(100);
    client.request("b", "js");
    timers.advance(100);
    client.request("c", "ts");
    timers.advance(399);
    expect(fake.instances).toHaveLength(0);
    timers.advance(1);
    expect(fake.instances).toHaveLength(1);
    expect(fake.instances[0]?.posted).toEqual([{ type: "run", jobId: 1, source: "c", lang: "ts" }]);
  });

  it("flush dispatches the pending request immediately and only once", () => {
    const { timers, fake, events, client } = setup();
    client.request("a", "js");
    client.flush();
    expect(fake.instances[0]?.posted).toHaveLength(1);
    expect(events).toEqual([{ kind: "started", jobId: 1 }]);
    client.flush();
    timers.advance(1000);
    expect(fake.instances[0]?.posted).toHaveLength(1);
  });
});

describe("PipelineClient job numbering", () => {
  it("continues from initialJobId, so a recreated client never reuses a number the store has seen", () => {
    const fake = createFakeWorker();
    const events: PipelineEvent[] = [];
    const client = createPipelineClient({
      createWorker: fake.factory,
      onEvent: (e) => events.push(e),
      setTimer: () => 0,
      clearTimer: () => undefined,
      initialJobId: 12,
    });
    client.request("a", "js");
    client.flush();
    expect(events).toEqual([{ kind: "started", jobId: 13 }]);
    expect(fake.instances[0]?.posted[0]?.jobId).toBe(13);
  });
});

describe("PipelineClient stale drop", () => {
  it("never forwards a response for a superseded job from either worker", () => {
    const { fake, events, client, inst } = setup();
    client.request("a", "js");
    client.flush();
    client.request("b", "js");
    client.flush();
    expect(fake.instances).toHaveLength(2);
    inst(0).emit(simulated(1));
    inst(1).emit(simulated(1));
    expect(responsesOf(events)).toEqual([]);
    inst(1).emit(simulated(2));
    expect(responsesOf(events)).toEqual([{ kind: "response", response: simulated(2) }]);
  });

  it("drops a response for a job that was never dispatched", () => {
    const { events, client, inst } = setup();
    client.request("a", "js");
    client.flush();
    inst(0).emit(simulated(5));
    expect(responsesOf(events)).toEqual([]);
  });
});

describe("PipelineClient supersede", () => {
  it("terminates the busy worker and posts the new job to a fresh instance", () => {
    const { fake, client, inst } = setup();
    client.request("a", "js");
    client.flush();
    client.request("b", "js");
    client.flush();
    expect(inst(0).terminated).toBe(true);
    expect(fake.instances).toHaveLength(2);
    expect(inst(1).terminated).toBe(false);
    expect(inst(1).posted).toEqual([{ type: "run", jobId: 2, source: "b", lang: "js" }]);
  });

  it("supersedes after compiled when simulated has not arrived", () => {
    const { fake, client, inst } = setup();
    client.request("a", "js");
    client.flush();
    inst(0).emit(compiledOk(1));
    client.request("b", "js");
    client.flush();
    expect(inst(0).terminated).toBe(true);
    expect(fake.instances).toHaveLength(2);
  });

  it("reuses the worker once the job finished", () => {
    const { fake, events, client, inst } = setup();
    client.request("a", "js");
    client.flush();
    inst(0).emit(simulated(1));
    client.request("b", "js");
    client.flush();
    expect(fake.instances).toHaveLength(1);
    expect(inst(0).terminated).toBe(false);
    expect(inst(0).posted.map((m) => m.jobId)).toEqual([1, 2]);
    expect(events.filter((e) => e.kind === "started")).toHaveLength(2);
  });

  it("treats a compiled response with diagnostics as the end of the job", () => {
    const { fake, events, client, inst } = setup();
    client.request("a", "js");
    client.flush();
    inst(0).emit(compiledWithDiagnostic(1));
    expect(responsesOf(events)).toHaveLength(1);
    client.request("b", "js");
    client.flush();
    expect(fake.instances).toHaveLength(1);
    expect(inst(0).terminated).toBe(false);
  });

  it("treats a worker-reported failure as the end of the job", () => {
    const { fake, client, inst } = setup();
    client.request("a", "js");
    client.flush();
    inst(0).emit({ type: "failed", jobId: 1, message: "boom" });
    client.request("b", "js");
    client.flush();
    expect(fake.instances).toHaveLength(1);
  });
});

describe("PipelineClient crash handling", () => {
  it("emits failed for the latest job on a worker error and starts a fresh worker next time", () => {
    const { fake, events, client, inst } = setup();
    client.request("a", "js");
    client.flush();
    inst(0).crash();
    expect(events.at(-1)).toEqual({ kind: "failed", jobId: 1, message: expect.any(String) });
    expect(inst(0).terminated).toBe(true);
    client.request("b", "js");
    client.flush();
    expect(fake.instances).toHaveLength(2);
    expect(inst(1).posted[0]?.jobId).toBe(2);
  });

  it("emits failed on onmessageerror", () => {
    const { events, client, inst } = setup();
    client.request("a", "js");
    client.flush();
    inst(0).onmessageerror?.(new Error("clone"));
    expect(events.at(-1)).toMatchObject({ kind: "failed", jobId: 1 });
  });

  it("emits failed, not response, for an unparsable message", () => {
    const { fake, events, client, inst } = setup();
    client.request("a", "js");
    client.flush();
    inst(0).emit({ type: "simulated", jobId: 1 });
    expect(responsesOf(events)).toEqual([]);
    expect(events.at(-1)).toMatchObject({ kind: "failed", jobId: 1 });
    client.request("b", "js");
    client.flush();
    expect(fake.instances).toHaveLength(2);
  });

  it("ignores events from a dropped worker", () => {
    const { events, client, inst } = setup();
    client.request("a", "js");
    client.flush();
    inst(0).crash();
    const before = events.length;
    inst(0).crash();
    inst(0).emit(simulated(1));
    expect(events).toHaveLength(before);
  });
});

describe("PipelineClient failure edges", () => {
  it("emits failed when the worker factory throws", () => {
    const events: PipelineEvent[] = [];
    const client = createPipelineClient({
      createWorker: () => {
        throw new Error("no workers here");
      },
      onEvent: (e) => events.push(e),
      setTimer: () => 0,
      clearTimer: () => undefined,
    });
    client.request("a", "js");
    client.flush();
    expect(events).toEqual([
      { kind: "started", jobId: 1 },
      { kind: "failed", jobId: 1, message: "no workers here" },
    ]);
  });

  it("emits failed when postMessage throws", () => {
    const { events, client, inst } = setup((w) => {
      w.postMessage = () => {
        throw new Error("clone failed");
      };
    });
    client.request("a", "js");
    client.flush();
    expect(events.at(-1)).toEqual({ kind: "failed", jobId: 1, message: "clone failed" });
    expect(inst(0).terminated).toBe(true);
  });

  it("does not fail a finished job when an idle worker errors", () => {
    const { events, client, inst } = setup();
    client.request("a", "js");
    client.flush();
    inst(0).emit(simulated(1));
    const before = events.length;
    inst(0).crash();
    expect(events).toHaveLength(before);
    expect(inst(0).terminated).toBe(true);
  });
});

describe("PipelineClient dispose", () => {
  it("terminates the worker and cancels a pending debounce", () => {
    const { timers, fake, client, inst } = setup();
    client.request("a", "js");
    client.flush();
    client.request("b", "js");
    client.dispose();
    expect(inst(0).terminated).toBe(true);
    timers.advance(1000);
    expect(fake.instances).toHaveLength(1);
    expect(inst(0).posted).toHaveLength(1);
  });

  it("ignores requests after dispose", () => {
    const { fake, client } = setup();
    client.dispose();
    client.request("a", "js");
    client.flush();
    expect(fake.instances).toHaveLength(0);
  });
});

describe("PipelineClient request validation", () => {
  it("fails an over-long source instead of leaving the job compiling, and keeps the worker usable", () => {
    const { events, fake, client } = setup();
    client.request("x".repeat(65_537), "js");
    client.flush();
    expect(events).toEqual([
      { kind: "started", jobId: 1 },
      { kind: "failed", jobId: 1, message: "The program is too long." },
    ]);
    expect(fake.instances).toHaveLength(0);
    client.request("ok", "js");
    client.flush();
    expect(fake.instances[0]?.posted).toHaveLength(1);
  });
});

describe("PipelineClient with the real handler", () => {
  it("forwards compiled then simulated for the latest job", async () => {
    const { events, client } = setup((w) => w.respondWith(handleRequest));
    client.request("console.log(1);", "js");
    client.flush();
    await Promise.resolve();
    expect(responsesOf(events).map((e) => e.response.type)).toEqual(["compiled", "simulated"]);
  });
});
