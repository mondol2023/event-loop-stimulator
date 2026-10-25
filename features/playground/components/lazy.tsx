"use client";

import dynamic from "next/dynamic";
import { Skeleton } from "@/components/ui/skeleton";

// CodeMirror needs the DOM, so the editors load on the client only. The skeleton fills the pane's final box, so nothing shifts.
function PaneSkeleton() {
  return <Skeleton className="h-full min-h-48 w-full rounded-none" aria-hidden="true" />;
}

// next/dynamic reads its options statically, so each call spells the object literal out.
export const SourceEditorLazy = dynamic(() => import("./editor/SourceEditor").then((m) => m.SourceEditor), { ssr: false, loading: PaneSkeleton });
export const AstPaneLazy = dynamic(() => import("./panes/AstPane").then((m) => m.AstPane), { ssr: false, loading: PaneSkeleton });
export const BytecodePaneLazy = dynamic(() => import("./panes/BytecodePane").then((m) => m.BytecodePane), { ssr: false, loading: PaneSkeleton });
export const MachineCodePaneLazy = dynamic(() => import("./panes/MachineCodePane").then((m) => m.MachineCodePane), { ssr: false, loading: PaneSkeleton });

// Motion's layout engine lives behind this boundary (D6); the skeleton fills the panel's final box, so nothing shifts.
export const EventLoopViewLazy = dynamic(() => import("@/features/event-loop-2d/EventLoopView").then((m) => m.EventLoopView), { ssr: false, loading: PaneSkeleton });

// Rendered after hydration only, and its chunk is not part of the first load.
export const CoachMarksLazy = dynamic(() => import("./onboarding/CoachMarks").then((m) => m.CoachMarks), { ssr: false });
