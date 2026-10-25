// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePlaygroundStore } from "./PlaygroundContext";
import { PlaygroundProvider } from "./PlaygroundProvider";
import type { PlaygroundStore } from "./playgroundStore";

const created: FakeWorker[] = [];

class FakeWorker {
  onmessage = null;
  onerror = null;
  onmessageerror = null;
  terminated = false;
  posts = 0;
  constructor() {
    created.push(this);
  }
  postMessage(): void {
    this.posts += 1;
  }
  terminate(): void {
    this.terminated = true;
  }
}

function mount(loadClient?: () => Promise<typeof import("../worker/PipelineClient")>) {
  const captured: { store?: PlaygroundStore } = {};
  function Probe() {
    captured.store = usePlaygroundStore();
    return null;
  }
  const view = render(
    <PlaygroundProvider initialSource="console.log(1)" {...(loadClient ? { loadClient } : {})}>
      <Probe />
    </PlaygroundProvider>,
  );
  return { view, captured };
}

// The client module is imported dynamically; let that promise and its continuation settle.
const settle = () => act(async () => void (await new Promise((resolve) => setTimeout(resolve, 50))));

describe("PlaygroundProvider pipeline client", () => {
  beforeEach(() => {
    created.length = 0;
    vi.stubGlobal("Worker", FakeWorker);
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("starts a worker once the client module has loaded", async () => {
    mount();
    await vi.waitFor(() => expect(created).toHaveLength(1), { timeout: 5000 });
  });

  it("creates nothing when it unmounts before the client module resolves", async () => {
    const { view, captured } = mount();
    view.unmount();
    await settle();
    expect(created).toHaveLength(0);
    // No subscription survived: an edit after unmount starts no work.
    captured.store?.getState().setSource("console.log(2)");
    await settle();
    expect(created).toHaveLength(0);
  });

  it("disposes its subscriptions and worker on unmount after loading", async () => {
    const { view, captured } = mount();
    await vi.waitFor(() => expect(created).toHaveLength(1), { timeout: 5000 });
    view.unmount();
    const posts = created.reduce((n, w) => n + w.posts, 0);
    captured.store?.getState().setSource("console.log(3)");
    await settle();
    expect(created.reduce((n, w) => n + w.posts, 0)).toBe(posts);
    expect(created.every((w) => w.terminated || w.posts === 0)).toBe(true);
  });

  it("reports a failed load, then retries on the next edit", async () => {
    let attempts = 0;
    const loadClient = (): Promise<typeof import("../worker/PipelineClient")> => {
      attempts += 1;
      return attempts === 1 ? Promise.reject(new Error("chunk failed")) : import("../worker/PipelineClient");
    };
    const { captured } = mount(loadClient);
    await settle();
    expect(captured.store?.getState().compile.status).toBe("failed");
    expect(created).toHaveLength(0);

    act(() => captured.store?.getState().setSource("console.log(2)"));
    await vi.waitFor(() => expect(created).toHaveLength(1), { timeout: 5000 });
    expect(attempts).toBe(2);
    expect(captured.store?.getState().compile.status).toBe("compiling");
  });
});
