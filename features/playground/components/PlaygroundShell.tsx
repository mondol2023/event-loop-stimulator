"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { useStore } from "zustand";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { ModeSpeedSync } from "@/features/preferences/ModeSpeedSync";
import { usePlaygroundStore } from "../store/PlaygroundContext";
import { BottomPanel, type BottomTab } from "./bottom/BottomPanel";
import { LangToggle } from "./editor/LangToggle";
import type { Diagnostic } from "@/core/shared/diagnostics";
import { ProblemsList } from "./editor/ProblemsList";
import type { SourceEditorHandle } from "./editor/SourceEditor";
import { ExamplesList, ExamplesMenu } from "./examples/ExamplesMenu";
import { VerifiedBadge } from "./examples/VerifiedBadge";
import { AstPaneLazy, BytecodePaneLazy, CoachMarksLazy, MachineCodePaneLazy, SourceEditorLazy } from "./lazy";
import { PaletteLauncher } from "./palette/PaletteLauncher";
import { ResizableSplit } from "./ResizableSplit";
import { PlaybackBar } from "./playback/PlaybackBar";
import { StatusIndicator } from "./shell/StatusIndicator";
import { TopBarControls } from "./shell/TopBarControls";
import { TabPanel, tabTriggerProps } from "./shell/TabPanel";
import { TruthBadge } from "./TruthBadge";

type Segment = "editor" | "code" | "run";
const isSegment = (v: string): v is Segment => v === "editor" || v === "code" || v === "run";

type CodeTab = "ast" | "bytecode" | "asm";
const isCodeTab = (v: string): v is CodeTab => v === "ast" || v === "bytecode" || v === "asm";

// Below 1024 px one region shows at a time behind the segmented control; from 1024 px all three show.
// Hidden regions stay mounted, so each keeps its scroll position and active tab across segment switches.
// A tab panel fills the region under its tab strip; its content scrolls inside it.
const PANEL = "min-h-0 flex-1 outline-none";

const showBelowLg = (active: boolean): string => (active ? "flex" : "hidden lg:flex");

/** Subscribes to the source and diagnostics itself, so typing re-renders this list and not the whole shell. */
function ConnectedProblems({ onSelect }: { onSelect: (diagnostic: Diagnostic) => void }) {
  const store = usePlaygroundStore();
  const diagnostics = useStore(store, (s) => s.editor.diagnostics);
  const source = useStore(store, (s) => s.editor.source);
  return <ProblemsList diagnostics={diagnostics} source={source} onSelect={onSelect} />;
}

/**
 * The IDE: the editor on the left, V8's views of the program on the right, the run below, and the
 * playback bar under all of them (docs/design/playground-shape.md sections 7 and 10).
 */
export function PlaygroundShell() {
  const store = usePlaygroundStore();
  const sourceEmpty = useStore(store, (s) => s.editor.source === "");
  const editorRef = useRef<SourceEditorHandle>(null);
  const [segment, setSegment] = useState<Segment>("editor");
  const [codeTab, setCodeTab] = useState<CodeTab>("ast");
  const [bottomTab, setBottomTab] = useState<BottomTab>("event-loop");
  const [collapsed, setCollapsed] = useState(false);

  // The Hardware tab is hidden below md (768 px); leaving it selected would show a panel with no visible tab.
  useEffect(() => {
    const query = window.matchMedia("(min-width: 768px)");
    const onChange = (e: MediaQueryListEvent): void => {
      if (!e.matches) setBottomTab((tab) => (tab === "hardware" ? "event-loop" : tab));
    };
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  const codeGroup = useId();
  // The palette offers this only from md (768 px) up, where the Hardware tab exists.
  const showHardware = (): void => {
    setBottomTab("hardware");
    setCollapsed(false);
  };

  return (
    <main className="flex h-dvh min-h-0 flex-col bg-background text-foreground">
      <ModeSpeedSync />
      <header className="flex min-h-10 shrink-0 items-center gap-3 border-b border-border bg-panel px-3 sm:gap-4">
        <Link href="/" className="shrink-0 text-sm font-semibold whitespace-nowrap tracking-tight focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
          Silicon Loop
        </Link>
        <h1 className="sr-only">Playground</h1>
        <StatusIndicator />
        <div className="ml-auto flex shrink-0 items-center gap-2 py-1">
          <TopBarControls />
          <PaletteLauncher onShowHardware={showHardware} />
        </div>
      </header>

      <ToggleGroup
        type="single"
        variant="outline"
        spacing={0}
        value={segment}
        onValueChange={(v) => isSegment(v) && setSegment(v)}
        aria-label="Playground section"
        className="w-full shrink-0 rounded-none lg:hidden"
      >
        <ToggleGroupItem value="editor" className="h-11 flex-1">
          Editor
        </ToggleGroupItem>
        <ToggleGroupItem value="code" className="h-11 flex-1">
          Code
        </ToggleGroupItem>
        <ToggleGroupItem value="run" className="h-11 flex-1">
          Run
        </ToggleGroupItem>
      </ToggleGroup>

      <ResizableSplit
        orientation="vertical"
        label="Resize the run panel"
        defaultPercent={60}
        minPercent={25}
        className="flex-1"
        firstClassName={`${segment === "run" ? "hidden lg:flex" : "flex"} flex-1 ${collapsed ? "lg:flex-1" : "lg:flex-none lg:basis-3/5"}`}
        secondClassName={`${segment === "run" ? "flex" : "hidden lg:flex"} ${collapsed ? "lg:flex-none" : ""}`}
        handleClassName={`hidden ${collapsed ? "" : "lg:block"}`}
        first={
          <ResizableSplit
            orientation="horizontal"
            label="Resize the editor"
            defaultPercent={40}
            minPercent={25}
            className="flex-1"
            firstClassName={`${showBelowLg(segment === "editor")} flex-1 lg:flex-none lg:basis-2/5`}
            secondClassName={showBelowLg(segment === "code")}
            handleClassName="hidden lg:block"
            first={
              <section aria-label="Editor" data-tour="editor" className="flex min-h-0 flex-1 flex-col bg-panel">
                <div className="flex min-h-10 shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b border-border px-3 py-1">
                  <LangToggle />
                  <ExamplesMenu />
                  <TruthBadge level="exact" />
                  {/* It shares the row while 12 rem are left and truncates; with less it takes a line of its own. */}
                  <div className="ml-auto flex min-w-0 grow basis-48 justify-end">
                    <VerifiedBadge />
                  </div>
                </div>
                <div className="relative min-h-0 flex-1">
                  <SourceEditorLazy ref={editorRef} />
                  {sourceEmpty ? (
                    // The wrapper lets clicks through to the editor; only the list itself takes them.
                    <div className="pointer-events-none absolute inset-x-3 top-10 bottom-3 flex items-start">
                      <div className="pointer-events-auto max-h-full w-full">
                        <ExamplesList />
                      </div>
                    </div>
                  ) : null}
                </div>
                <div className="max-h-[40%] shrink-0 overflow-y-auto">
                  <ConnectedProblems onSelect={(d) => editorRef.current?.focusRange(d.range)} />
                </div>
              </section>
            }
            second={
              <Tabs value={codeTab} onValueChange={(v) => isCodeTab(v) && setCodeTab(v)} data-tour="panes" className="min-h-0 flex-1 gap-0 bg-panel">
                <div className="flex min-h-10 shrink-0 items-center border-b border-border px-2">
                  <TabsList variant="line" aria-label="Compiled views">
                    <TabsTrigger value="ast" {...tabTriggerProps(codeGroup, "ast")}>
                      AST
                    </TabsTrigger>
                    <TabsTrigger value="bytecode" {...tabTriggerProps(codeGroup, "bytecode")}>
                      Bytecode
                    </TabsTrigger>
                    <TabsTrigger value="asm" {...tabTriggerProps(codeGroup, "asm")}>
                      Machine Code
                    </TabsTrigger>
                  </TabsList>
                </div>
                <TabPanel group={codeGroup} value="ast" active={codeTab === "ast"} className={PANEL}>
                  <AstPaneLazy />
                </TabPanel>
                <TabPanel group={codeGroup} value="bytecode" active={codeTab === "bytecode"} className={PANEL}>
                  <BytecodePaneLazy />
                </TabPanel>
                <TabPanel group={codeGroup} value="asm" active={codeTab === "asm"} className={PANEL}>
                  <MachineCodePaneLazy />
                </TabPanel>
              </Tabs>
            }
          />
        }
        second={
          <BottomPanel tab={bottomTab} onTabChange={setBottomTab} collapsed={collapsed} onCollapsedChange={setCollapsed} />
        }
      />
      <PlaybackBar />
      <CoachMarksLazy />
    </main>
  );
}
