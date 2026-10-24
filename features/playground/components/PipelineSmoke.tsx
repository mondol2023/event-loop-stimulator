"use client";

import { useEffect } from "react";
import { useStore } from "zustand";
import { useConsole } from "../hooks/useTickSelectors";
import { usePlaygroundStore } from "../store/PlaygroundContext";

// Minimal stand-in shell that Phase 6 replaces: a source box, the pipeline status and the console
// at the final tick.
export function PipelineSmoke() {
  const store = usePlaygroundStore();
  const source = useStore(store, (s) => s.editor.source);
  const status = useStore(store, (s) => s.compile.status);
  const message = useStore(store, (s) => s.compile.message);
  const length = useStore(store, (s) => s.playback.length);
  const lines = useConsole();

  // Show the finished run's output: jump to the last tick whenever a new timeline lands.
  useEffect(() => {
    if (status === "ready" && length > 0) store.getState().seek(length - 1);
  }, [store, status, length]);

  return (
    <div className="flex flex-col gap-3">
      <textarea
        aria-label="Source"
        value={source}
        onChange={(e) => store.getState().setSource(e.target.value)}
        spellCheck={false}
        rows={10}
        className="w-full rounded-md border border-border bg-panel p-3 font-mono text-sm text-foreground"
      />
      <p className="text-sm text-muted-foreground">
        Status: <span data-testid="status">{status}</span>
        {message ? <span className="text-warning"> {message}</span> : null}
      </p>
      <pre data-testid="console" className="min-h-12 rounded-md border border-border bg-panel p-3 font-mono text-sm text-foreground">
        {lines.map((l) => `${l.text}\n`).join("")}
      </pre>
    </div>
  );
}
