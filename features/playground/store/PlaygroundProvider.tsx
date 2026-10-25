"use client";

import { type ReactNode, useEffect, useState } from "react";
import type { Language } from "@/core/compile/CompilationManager";
import { useShortcuts } from "../keyboard/useShortcuts";
import { createPlaybackClock } from "../playback/PlaybackClock";
import type { WorkerLike } from "../worker/PipelineClient";
import { PlaygroundStoreContext } from "./PlaygroundContext";
import { createPlaygroundStore, type PlaybackSpeed } from "./playgroundStore";

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
  children,
}: {
  initialSource?: string;
  initialLang?: Language;
  initialSpeed?: PlaybackSpeed;
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

  // Created in an effect and fully disposed on cleanup, so React StrictMode's double effect leaves one live worker.
  // The client module is imported here, not at the top: it carries the Zod message parsers, which would
  // otherwise sit in the first-load JS (D6 budget). The effect runs after hydration, so only the first compile waits for it.
  useEffect(() => {
    let disposed = false;
    let teardown: (() => void) | null = null;
    void import("../worker/PipelineClient")
      .then(({ createPipelineClient }) => {
        if (disposed) return;
        const client = createPipelineClient({
          createWorker: createPipelineWorker,
          onEvent: (e) => store.getState().applyPipelineEvent(e),
          setTimer: (fn, ms) => window.setTimeout(fn, ms),
          clearTimer: (h) => window.clearTimeout(h as number),
          // The store outlives the client (Fast Refresh re-runs this effect), and it ignores any job older than its own.
          initialJobId: store.getState().compile.jobId,
        });
        const clock = createPlaybackClock({
          store,
          requestFrame: (cb) => window.requestAnimationFrame(cb),
          cancelFrame: (h) => window.cancelAnimationFrame(h),
        });
        const request = (): void => {
          const { source, lang } = store.getState().editor;
          client.request(source, lang);
        };
        const unsubSource = store.subscribe((s) => s.editor.source, request);
        const unsubLang = store.subscribe((s) => s.editor.lang, request);
        request();
        client.flush();
        teardown = () => {
          unsubSource();
          unsubLang();
          clock.dispose();
          client.dispose();
        };
      })
      .catch(() => {
        if (!disposed) store.getState().applyPipelineEvent({ kind: "failed", jobId: store.getState().compile.jobId, message: "The compile pipeline could not be loaded." });
      });
    return () => {
      disposed = true;
      teardown?.();
    };
  }, [store]);

  return <PlaygroundStoreContext.Provider value={store}>{children}</PlaygroundStoreContext.Provider>;
}
