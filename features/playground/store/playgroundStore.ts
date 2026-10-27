import { subscribeWithSelector } from "zustand/middleware";
import { createStore, type Mutate, type StoreApi } from "zustand/vanilla";
import type { BaselineCode } from "@/core/baseline/Template";
import type { Language } from "@/core/compile/CompilationManager";
import type { HardwareStep } from "@/core/hardware/traceHardware";
import type { TierTrack } from "@/core/interpreter/tiering/tierTimeline";
import type { Diagnostic } from "@/core/shared/diagnostics";
import type { FunctionId } from "@/core/shared/ids";
import type { SimulationStop } from "@/core/shared/simulationHalt";
import type { TimelineMarker } from "@/core/timeline/boundaries";
import { TimelineStore } from "@/core/timeline/TimelineStore";
import type { LineIndex, Pane } from "@/core/views/lineIndex";
import type { PipelineEvent } from "../worker/PipelineClient";
import type { ClientViews } from "../worker/protocol";
import { setTimeline } from "./timelineHolder";

export type PipelineStatus = "idle" | "compiling" | "simulating" | "ready" | "refused" | "failed";

export const PLAYBACK_SPEEDS = [0.25, 0.5, 1, 2, 4, 8] as const;
export type PlaybackSpeed = (typeof PLAYBACK_SPEEDS)[number];

/** The assembly syntax the Machine Code pane shows; the Hardware board's readout follows it. */
export type AsmSyntax = "att" | "intel";

export type PlaygroundState = {
  editor: { source: string; lang: Language; diagnostics: readonly Diagnostic[] };
  compile: {
    jobId: number;
    status: PipelineStatus;
    message: string | null;
    strippedJs: string | null;
    views: ClientViews | null;
    lineIndex: LineIndex | null;
    baselines: readonly BaselineCode[] | null;
    boundaries: readonly number[];
    markers: readonly TimelineMarker[];
    /** Modeled (D5): per-function tier segments and deopts. */
    tierTracks: readonly TierTrack[];
    /** Illustrative (D2): one step per tick. */
    hardware: readonly HardwareStep[];
    /** Bumped whenever the held TimelineStore is replaced or dropped, so readers know to refetch it. */
    timelineVersion: number;
    exitCode: number | null;
    warnings: readonly string[];
    stop: SimulationStop | null;
  };
  playback: { index: number; isPlaying: boolean; speed: PlaybackSpeed; length: number };
  hover: { pane: Pane | null; line: number | null };
  /** The feedback slot a bytecode operand linked to; the V8 Internals IC table selects its row (PROMPT §8.3). */
  focusSlot: { functionId: FunctionId; slot: number } | null;
  asmSyntax: AsmSyntax;
  setSource(source: string): void;
  setLang(lang: Language): void;
  applyPipelineEvent(e: PipelineEvent): void;
  play(): void;
  pause(): void;
  togglePlay(): void;
  seek(index: number): void;
  step(delta: number): void;
  jumpBoundary(direction: -1 | 1): void;
  setSpeed(speed: PlaybackSpeed): void;
  setHover(pane: Pane | null, line: number | null): void;
  clearHover(): void;
  focusFeedbackSlot(v: { functionId: FunctionId; slot: number }): void;
  setAsmSyntax(syntax: AsmSyntax): void;
};

export type PlaygroundStore = Mutate<StoreApi<PlaygroundState>, [["zustand/subscribeWithSelector", never]]>;

const EMPTY_PLAYBACK = { index: 0, isPlaying: false, length: 0 } as const;

const clamp = (n: number, min: number, max: number): number => Math.min(Math.max(n, min), max);

export function createPlaygroundStore(initial: { source?: string; lang?: Language; speed?: PlaybackSpeed } = {}): PlaygroundStore {
  const store: PlaygroundStore = createStore<PlaygroundState>()(
    subscribeWithSelector((set, get) => {
      /** Moves the cursor within the timeline; a no-op while there is nothing to move through. */
      function moveTo(index: number): void {
        const { playback } = get();
        if (playback.length === 0 || Number.isNaN(index)) return;
        set({ playback: { ...playback, index: clamp(Math.trunc(index), 0, playback.length - 1) } });
      }

      function failWith(jobId: number, message: string): void {
        const { compile, playback } = get();
        // Before this job's `compiled` arrived, the views, diagnostics and timeline still belong to the
        // previous source; leaving them navigable under the new text would show a different program.
        if (compile.status === "compiling") {
          setTimeline(store, null);
          set((s) => ({
            editor: { ...s.editor, diagnostics: [] },
            compile: {
              ...compile,
              jobId,
              status: "failed",
              message,
              strippedJs: null,
              views: null,
              lineIndex: null,
              baselines: null,
              boundaries: [],
              markers: [],
              tierTracks: [],
              hardware: [],
              timelineVersion: compile.timelineVersion + 1,
              exitCode: null,
              warnings: [],
              stop: null,
            },
            playback: { ...s.playback, ...EMPTY_PLAYBACK },
            hover: { pane: null, line: null },
            focusSlot: null,
          }));
          return;
        }
        set({ compile: { ...compile, jobId, status: "failed", message }, playback: { ...playback, isPlaying: false } });
      }

      function onCompiled(response: Extract<PipelineEventResponse, { type: "compiled" }>): void {
        const { compile } = get();
        const refused = response.diagnostics.length > 0;
        // One set(): the old timeline, its length and the cursor must change together (D2).
        setTimeline(store, null);
        set((s) => ({
          editor: { ...s.editor, diagnostics: response.diagnostics },
          compile: {
            ...compile,
            jobId: response.jobId,
            status: refused ? "refused" : "simulating",
            message: null,
            strippedJs: response.strippedJs,
            views: response.views,
            lineIndex: response.lineIndex,
            baselines: response.baselines,
            boundaries: [],
            markers: [],
            tierTracks: [],
            hardware: [],
            timelineVersion: compile.timelineVersion + 1,
            exitCode: null,
            warnings: [],
            stop: null,
          },
          playback: { ...s.playback, ...EMPTY_PLAYBACK },
          // Line numbers from the old program would highlight unrelated lines in the new one.
          hover: { pane: null, line: null },
          // A slot of the old program names a different function in the new one.
          focusSlot: null,
        }));
      }

      function onSimulated(response: Extract<PipelineEventResponse, { type: "simulated" }>): void {
        const { compile, playback } = get();
        let timeline: TimelineStore;
        try {
          timeline = TimelineStore.deserialize(response.timeline);
          if (timeline.length !== response.tickCount) throw new Error("The timeline does not match its tick count.");
        } catch (error) {
          setTimeline(store, null);
          set({
            compile: { ...compile, jobId: response.jobId, status: "failed", message: error instanceof Error ? error.message : "The timeline could not be read.", timelineVersion: compile.timelineVersion + 1 },
            playback: { ...playback, ...EMPTY_PLAYBACK },
          });
          return;
        }
        setTimeline(store, timeline);
        set({
          compile: {
            ...compile,
            jobId: response.jobId,
            status: "ready",
            message: null,
            boundaries: response.boundaries,
            markers: response.markers,
            tierTracks: response.tierTracks,
            hardware: response.hardware,
            timelineVersion: compile.timelineVersion + 1,
            exitCode: response.exitCode,
            warnings: response.warnings,
            stop: response.stop,
          },
          playback: { ...playback, index: 0, length: response.tickCount },
        });
      }

      return {
        editor: { source: initial.source ?? "", lang: initial.lang ?? "js", diagnostics: [] },
        compile: {
          jobId: 0,
          status: "idle",
          message: null,
          strippedJs: null,
          views: null,
          lineIndex: null,
          baselines: null,
          boundaries: [],
          markers: [],
          tierTracks: [],
          hardware: [],
          timelineVersion: 0,
          exitCode: null,
          warnings: [],
          stop: null,
        },
        playback: { ...EMPTY_PLAYBACK, speed: initial.speed ?? 1 },
        hover: { pane: null, line: null },
        focusSlot: null,
        asmSyntax: "att",

        setSource: (source) => set((s) => ({ editor: { ...s.editor, source } })),
        setLang: (lang) => set((s) => ({ editor: { ...s.editor, lang } })),

        applyPipelineEvent: (e) => {
          const jobId = e.kind === "response" ? e.response.jobId : e.jobId;
          // The client already drops stale jobs; this guards the store against any other caller.
          if (jobId < get().compile.jobId) return;
          switch (e.kind) {
            case "started": {
              const { compile } = get();
              set({ compile: { ...compile, jobId, status: "compiling" } });
              return;
            }
            case "failed":
              failWith(jobId, e.message);
              return;
            case "response":
              switch (e.response.type) {
                case "compiled":
                  onCompiled(e.response);
                  return;
                case "simulated":
                  onSimulated(e.response);
                  return;
                case "failed":
                  failWith(jobId, e.response.message);
                  return;
                default:
                  return assertNever(e.response);
              }
            default:
              return assertNever(e);
          }
        },

        play: () => {
          const { playback } = get();
          if (playback.length === 0) return;
          // Playing from the last tick restarts, since the clock would otherwise stop on its first frame.
          const index = playback.index >= playback.length - 1 ? 0 : playback.index;
          set({ playback: { ...playback, index, isPlaying: true } });
        },
        pause: () => set((s) => ({ playback: { ...s.playback, isPlaying: false } })),
        togglePlay: () => {
          if (get().playback.isPlaying) get().pause();
          else get().play();
        },
        seek: (index) => moveTo(index),
        step: (delta) => moveTo(get().playback.index + delta),
        jumpBoundary: (direction) => {
          const { playback, compile } = get();
          if (playback.length === 0) return;
          const { index } = playback;
          const target =
            direction === 1
              ? (compile.boundaries.find((b) => b > index) ?? playback.length - 1)
              : (compile.boundaries.findLast((b) => b < index) ?? 0);
          moveTo(target);
        },
        setSpeed: (speed) => set((s) => ({ playback: { ...s.playback, speed } })),
        setHover: (pane, line) => set({ hover: { pane, line } }),
        clearHover: () => set({ hover: { pane: null, line: null } }),
        // A fresh object each time, so choosing the same slot again still tells the shell to reopen the tab.
        focusFeedbackSlot: (v) => set({ focusSlot: { functionId: v.functionId, slot: v.slot } }),
        setAsmSyntax: (asmSyntax) => set({ asmSyntax }),
      };
    }),
  );
  return store;
}

type PipelineEventResponse = Extract<PipelineEvent, { kind: "response" }>["response"];

function assertNever(value: never): never {
  throw new Error(`unhandled pipeline event: ${JSON.stringify(value)}`);
}
