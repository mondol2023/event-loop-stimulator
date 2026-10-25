"use client";

import { Circle, CircleDot, SkipForward, Timer } from "lucide-react";
import { type ReactNode, useId, useMemo } from "react";
import { useFidelityWarnings, useQueues } from "@/features/playground/hooks/useTickSelectors";
import { CallStackRegion } from "./CallStackRegion";
import { ConsolePanel } from "./ConsolePanel";
import { HostApisRegion } from "./HostApisRegion";
import { PhaseRing } from "./PhaseRing";
import { QueueRegion } from "./QueueRegion";
import { ordersAtRisk } from "./warnings";

// The view reads no tick itself: each connected region below subscribes to exactly the slice it draws,
// so a seek re-renders only the regions whose data changed (the console, for one, is untouched by a queue change).

function MicrotaskRegion() {
  const { microtask } = useQueues();
  return <QueueRegion testId="region-microtask" title="Microtask queue" owner="V8" tasks={microtask} tone="microtask" icon={CircleDot} />;
}

function NextTickRegion() {
  const { nextTick } = useQueues();
  return <QueueRegion testId="region-nexttick" title="nextTick queue" owner="Node/libuv" tasks={nextTick} tone="nextTick" icon={Circle} />;
}

/** The chips a live nondeterminism warning puts in doubt: stable while the pending timers, immediates and warnings are. */
function useAtRisk() {
  const { timers, immediates } = useQueues();
  const warnings = useFidelityWarnings();
  return useMemo(() => ordersAtRisk(timers, immediates, warnings), [timers, immediates, warnings]);
}

function TimersRegion() {
  const { timers } = useQueues();
  const atRisk = useAtRisk();
  return <QueueRegion testId="region-timers" title="Timers queue" owner="Node/libuv" tasks={timers} tone="macrotask" icon={Timer} atRisk={atRisk} />;
}

function CheckRegion() {
  const { immediates } = useQueues();
  const atRisk = useAtRisk();
  return <QueueRegion testId="region-check" title="Check queue (setImmediate)" owner="Node/libuv" tasks={immediates} tone="macrotask" icon={SkipForward} atRisk={atRisk} />;
}

function HostRegion() {
  const { hostApis } = useQueues();
  return <HostApisRegion hosts={hostApis} />;
}

/** One side of the boundary the product teaches, named in text. */
function OwnerGroup({ name, caption, className, children }: { name: string; caption: string; className?: string; children: ReactNode }) {
  const headingId = useId();
  return (
    <div role="group" aria-labelledby={headingId} className={`flex min-w-0 flex-col gap-3 ${className ?? ""}`}>
      <div className="flex items-baseline gap-2">
        <h2 id={headingId} className="text-sm font-semibold text-foreground">
          {name}
        </h2>
        <p className="text-xs text-muted-foreground">{caption}</p>
      </div>
      {children}
    </div>
  );
}

/**
 * The 2D event loop: V8's call stack and microtask queue on one side, Node/libuv's phase ring, queues and host
 * APIs on the other, and the console beside them (docs/design/playground-shape.md 10.7 and 10.8).
 */
export function EventLoopView() {
  return (
    <div className="grid h-full min-h-0 grid-cols-1 content-start gap-4 overflow-y-auto p-3 xl:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="grid min-w-0 grid-cols-1 content-start gap-4 lg:grid-cols-[minmax(0,35fr)_minmax(0,65fr)]">
        <OwnerGroup name="V8" caption="owned by V8">
          <CallStackRegion />
          <MicrotaskRegion />
        </OwnerGroup>
        <OwnerGroup name="Node / libuv" caption="owned by Node/libuv">
          <PhaseRing />
          <NextTickRegion />
          <TimersRegion />
          <CheckRegion />
          <HostRegion />
        </OwnerGroup>
      </div>
      <ConsolePanel />
    </div>
  );
}
