"use client";

import { ChevronDown, ChevronUp } from "lucide-react";
import Link from "next/link";
import { useId, useRef, useState } from "react";
import { useStore } from "zustand";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { ModeSpeedSync } from "@/features/preferences/ModeSpeedSync";
import { usePlaygroundStore } from "../store/PlaygroundContext";
import { LangToggle } from "./editor/LangToggle";
import { ProblemsList } from "./editor/ProblemsList";
import type { SourceEditorHandle } from "./editor/SourceEditor";
import { ExamplesList, ExamplesMenu } from "./examples/ExamplesMenu";
import { VerifiedBadge } from "./examples/VerifiedBadge";
import { AstPaneLazy, BytecodePaneLazy, MachineCodePaneLazy, SourceEditorLazy } from "./lazy";
import { ResizableSplit } from "./ResizableSplit";
import { EventLoopPlaceholder, HARDWARE_COPY, PlaybackPlaceholder, V8_INTERNALS_COPY, ViewPlaceholder } from "./shell/ShellPlaceholders";
import { StatusIndicator } from "./shell/StatusIndicator";
import { TabPanel, tabTriggerProps } from "./shell/TabPanel";
import { TruthBadge } from "./TruthBadge";

type Segment = "editor" | "code" | "run";
const isSegment = (v: string): v is Segment => v === "editor" || v === "code" || v === "run";

type CodeTab = "ast" | "bytecode" | "asm";
const isCodeTab = (v: string): v is CodeTab => v === "ast" || v === "bytecode" || v === "asm";

type BottomTab = "event-loop" | "v8" | "hardware";
const isBottomTab = (v: string): v is BottomTab => v === "event-loop" || v === "v8" || v === "hardware";

// Below 1024 px one region shows at a time behind the segmented control; from 1024 px all three show.
// Hidden regions stay mounted, so each keeps its scroll position and active tab across segment switches.
// A tab panel fills the region under its tab strip; its content scrolls inside it.
const PANEL = "min-h-0 flex-1 outline-none";

const showBelowLg = (active: boolean): string => (active ? "flex" : "hidden lg:flex");

/**
 * The IDE: the editor on the left, V8's views of the program on the right, the run below, and the
 * playback bar under all of them (docs/design/playground-shape.md sections 7 and 10).
 */
export function PlaygroundShell() {
  const store = usePlaygroundStore();
  const source = useStore(store, (s) => s.editor.source);
  const diagnostics = useStore(store, (s) => s.editor.diagnostics);
  const editorRef = useRef<SourceEditorHandle>(null);
  const [segment, setSegment] = useState<Segment>("editor");
  const [codeTab, setCodeTab] = useState<CodeTab>("ast");
  const [bottomTab, setBottomTab] = useState<BottomTab>("event-loop");
  const [collapsed, setCollapsed] = useState(false);
  const bottomContentId = useId();
  const codeGroup = useId();
  const runGroup = useId();

  return (
    <main className="flex h-dvh min-h-0 flex-col bg-background text-foreground">
      <ModeSpeedSync />
      <header className="flex min-h-10 shrink-0 items-center gap-4 border-b border-border bg-panel px-3">
        <Link href="/" className="text-sm font-semibold tracking-tight focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
          Silicon Loop
        </Link>
        <h1 className="sr-only">Playground</h1>
        <StatusIndicator />
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
              <section aria-label="Editor" className="flex min-h-0 flex-1 flex-col bg-panel">
                <div className="flex min-h-10 shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b border-border px-3 py-1">
                  <LangToggle />
                  <ExamplesMenu />
                  <TruthBadge level="exact" />
                  <div className="ml-auto">
                    <VerifiedBadge />
                  </div>
                </div>
                <div className="relative min-h-0 flex-1">
                  <SourceEditorLazy ref={editorRef} />
                  {source === "" ? (
                    // The wrapper lets clicks through to the editor; only the list itself takes them.
                    <div className="pointer-events-none absolute inset-x-3 top-10 bottom-3 flex items-start">
                      <div className="pointer-events-auto max-h-full w-full">
                        <ExamplesList />
                      </div>
                    </div>
                  ) : null}
                </div>
                <div className="max-h-[40%] shrink-0 overflow-y-auto">
                  <ProblemsList diagnostics={diagnostics} source={source} onSelect={(d) => editorRef.current?.focusRange(d.range)} />
                </div>
              </section>
            }
            second={
              <Tabs value={codeTab} onValueChange={(v) => isCodeTab(v) && setCodeTab(v)} className="min-h-0 flex-1 gap-0 bg-panel">
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
          <Tabs value={bottomTab} onValueChange={(v) => isBottomTab(v) && setBottomTab(v)} className="min-h-0 flex-1 gap-0 bg-panel">
            <div className="flex min-h-10 shrink-0 items-center gap-2 border-y border-border px-2">
              <TabsList variant="line" aria-label="Run views">
                <TabsTrigger value="event-loop" {...tabTriggerProps(runGroup, "event-loop")}>
                  Event Loop
                </TabsTrigger>
                <TabsTrigger value="v8" {...tabTriggerProps(runGroup, "v8")}>
                  V8 Internals
                </TabsTrigger>
                {/* The 3D view needs room; it is not offered on phones. */}
                <TabsTrigger value="hardware" {...tabTriggerProps(runGroup, "hardware")} className="hidden md:inline-flex">
                  Hardware
                </TabsTrigger>
              </TabsList>
              <div className="ml-auto flex items-center gap-2">
                {bottomTab === "hardware" ? <TruthBadge level="illustrative" /> : null}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-expanded={!collapsed}
                  aria-controls={bottomContentId}
                  aria-label={collapsed ? "Expand the run panel" : "Collapse the run panel"}
                  onClick={() => setCollapsed((c) => !c)}
                  className="hidden lg:inline-flex"
                >
                  {collapsed ? <ChevronUp aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}
                </Button>
              </div>
            </div>
            {/* Collapsing hides only the tab content; the tab strip and the playback bar stay. */}
            <div id={bottomContentId} className={`min-h-0 flex-1 flex-col ${collapsed ? "flex lg:hidden" : "flex"}`}>
              <TabPanel group={runGroup} value="event-loop" active={bottomTab === "event-loop"} className={PANEL}>
                <EventLoopPlaceholder />
              </TabPanel>
              <TabPanel group={runGroup} value="v8" active={bottomTab === "v8"} className={PANEL}>
                <ViewPlaceholder title="V8 Internals">{V8_INTERNALS_COPY}</ViewPlaceholder>
              </TabPanel>
              <TabPanel group={runGroup} value="hardware" active={bottomTab === "hardware"} className={PANEL}>
                <ViewPlaceholder title="Hardware">{HARDWARE_COPY}</ViewPlaceholder>
              </TabPanel>
            </div>
          </Tabs>
        }
      />
      <PlaybackPlaceholder />
    </main>
  );
}
