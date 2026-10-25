"use client";

import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import type { Language } from "@/core/compile/CompilationManager";
import { useShortcuts } from "../keyboard/useShortcuts";
import { createPlaybackClock } from "../playback/PlaybackClock";
import type { PipelineClient, WorkerLike } from "../worker/PipelineClient";
import { PlaygroundStoreContext, RunNowContext } from "./PlaygroundContext";
import { createPlaygroundStore, type PlaybackSpeed } from "./playgroundStore";

type PipelineClientModule = typeof import("../worker/PipelineClient");

// The client module is imported on demand, not at the top: it carries the Zod message parsers, which would
// otherwise sit in the first-load JS (D6 budget).
const importPipelineClient = (): Promise<PipelineClientModule> => import("../worker/PipelineClient");

// Same-origin module worker from a repo file, never a blob; the literal URL is what the bundler rewrites.
function createPipelineWorker(): WorkerLike {
  const worker = new Worker(new URL("../worker/pipeline.worker.ts", import.meta.url), { type: "module" });
  // An adapter, because WorkerLike takes narrower event handlers than the DOM Worker's.
  const adapter: WorkerLike = {
    postMessage: (m) => worker.postMessage(m),
    terminate: () => worker.terminate(),
    onmessage: null,
    onerror: null,
    onmessageerror: null,
  };
  worker.onmessage = (e) => adapter.onmessage?.({ data: e.data });
  worker.onerror = (e) => {
    // Uncancelled, the browser re-reports a worker error on the page as an uncaught error too.
    if (typeof (e as Partial<Event>).preventDefault === "function") e.preventDefault();
    adapter.onerror?.(e);
  };
  worker.onmessageerror = (e) => adapter.onmessageerror?.(e);
  return adapter;
}

export function PlaygroundProvider({
  initialSource,
  initialLang,
  initialSpeed,
  loadClient = importPipelineClient,
  children,
}: {
  initialSource?: string;
  initialLang?: Language;
  initialSpeed?: PlaybackSpeed;
  /** Loads the pipeline client module; tests replace it to exercise a failed load. */
  loadClient?: () => Promise<PipelineClientModule>;
  children: ReactNode;
}) {
  const [store] = useState(() =>
    createPlaygroundStore({
      ...(initialSource !== undefined ? { source: initialSource } : {}),
      ...(initialLang !== undefined ? { lang: initialLang } : {}),
      ...(initialSpeed !== undefined ? { speed: initialSpeed } : {}),
    }),
  );

  useShortcuts(store);

  const flushRef = useRef<(() => void) | null>(null);
  const runNow = useCallback(() => flushRef.current?.(), []);

  // Read through a ref, so a caller passing a new function each render does not restart the pipeline.
  const loadClientRef = useRef(loadClient);
  useEffect(() => {
    loadClientRef.current = loadClient;
  });

  // Created in an effect and fully disposed on cleanup, so React StrictMode's double effect leaves one live worker.
  // The effect runs after hydration, so only the first compile waits for the client module.
  useEffect(() => {
    let disposed = false;
    let loading = false;
    // Whatever has been made so far, so cleanup and a throw part-way through setup both dispose exactly that.
    let client: PipelineClient | null = null;
    let clock: { dispose(): void } | null = null;

    const request = (): void => {
      // No client yet: the first load failed or is still under way. An edit retries a failed load.
      if (!client) return load();
      const { source, lang } = store.getState().editor;
      client.request(source, lang);
    };

    const setup = ({ createPipelineClient }: PipelineClientModule): void => {
      if (disposed) return;
      client = createPipelineClient({
        createWorker: createPipelineWorker,
        onEvent: (e) => store.getState().applyPipelineEvent(e),
        setTimer: (fn, ms) => window.setTimeout(fn, ms),
        clearTimer: (h) => window.clearTimeout(h as number),
        // The store outlives the client (Fast Refresh re-runs this effect), and it ignores any job older than its own.
        initialJobId: store.getState().compile.jobId,
      });
      clock = createPlaybackClock({
        store,
        requestFrame: (cb) => window.requestAnimationFrame(cb),
        cancelFrame: (h) => window.cancelAnimationFrame(h),
      });
      flushRef.current = client.flush;
      request();
      client.flush();
    };

    // The catch is only for the module failing to load; a bug in setup must surface, not read as a load failure.
    function load(): void {
      if (client || loading || disposed) return;
      loading = true;
      loadClientRef.current().then(
        (module) => {
          loading = false;
          setup(module);
        },
        () => {
          loading = false;
          if (!disposed) store.getState().applyPipelineEvent({ kind: "failed", jobId: store.getState().compile.jobId, message: "The compile pipeline could not be loaded." });
        },
      );
    }

    const unsubSource = store.subscribe((s) => s.editor.source, request);
    const unsubLang = store.subscribe((s) => s.editor.lang, request);
    load();
    return () => {
      disposed = true;
      flushRef.current = null;
      unsubSource();
      unsubLang();
      clock?.dispose();
      client?.dispose();
    };
  }, [store]);

  return (
    <PlaygroundStoreContext.Provider value={store}>
      <RunNowContext.Provider value={runNow}>{children}</RunNowContext.Provider>
    </PlaygroundStoreContext.Provider>
  );
}
