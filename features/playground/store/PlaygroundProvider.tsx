"use client";

import { type ReactNode, useEffect, useState } from "react";
import type { Language } from "@/core/compile/CompilationManager";
import { useShortcuts } from "../keyboard/useShortcuts";
import { createPlaybackClock } from "../playback/PlaybackClock";
import { createPipelineClient, type WorkerLike } from "../worker/PipelineClient";
import { PlaygroundStoreContext } from "./PlaygroundContext";
import { createPlaygroundStore } from "./playgroundStore";

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
  worker.onerror = (e) => adapter.onerror?.(e);
  worker.onmessageerror = (e) => adapter.onmessageerror?.(e);
  return adapter;
}

export function PlaygroundProvider({
  initialSource,
  initialLang,
  children,
}: {
  initialSource?: string;
  initialLang?: Language;
  children: ReactNode;
}) {
  const [store] = useState(() =>
    createPlaygroundStore({
      ...(initialSource !== undefined ? { source: initialSource } : {}),
      ...(initialLang !== undefined ? { lang: initialLang } : {}),
    }),
  );

  useShortcuts(store);

  // Created in an effect and fully disposed on cleanup, so React StrictMode's double effect leaves one live worker.
  useEffect(() => {
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
    return () => {
      unsubSource();
      unsubLang();
      clock.dispose();
      client.dispose();
    };
  }, [store]);

  return <PlaygroundStoreContext.Provider value={store}>{children}</PlaygroundStoreContext.Provider>;
}
