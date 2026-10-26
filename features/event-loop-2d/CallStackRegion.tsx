"use client";

import { Layers } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useCallStack } from "@/features/playground/hooks/useTickSelectors";
import { EmptyState, RegionFrame } from "./RegionFrame";
import { useIsClient } from "./useIsClient";

// A frame drops in with a spring and no overshoot, and leaves with a fade-up (docs/design/playground-shape.md 10.7).
// The outer li fades and is moved by the layout animation; the inner box owns the transform, so the two never fight.
const SPRING = { type: "spring", stiffness: 500, damping: 32 } as const;
// Reduced motion: MotionConfig drops transform and layout animations but keeps opacity fades, so those are made instant here.
const INSTANT = { duration: 0 } as const;
const LEAVE = { duration: 0.15, ease: [0.22, 1, 0.36, 1] } as const;
// min-h-8 is the empty state's height too, so the first frame arriving or the last leaving (0 and 1 frames) does not move the regions below it.
const FRAME_CLASS = "flex min-h-8 items-center rounded-md border border-border border-l-4 border-l-primary bg-card px-3 py-1 text-sm text-card-foreground";

/**
 * A function with no name (the CommonJS module wrapper, an anonymous callback) reads "(anonymous)", as V8's stack
 * traces do. It is generated content, so the element's text stays the frame's real name.
 */
function FrameName({ name }: { name: string }) {
  return (
    <span data-testid="frame-name" className="font-mono empty:text-muted-foreground empty:italic empty:before:content-['(anonymous)']">
      {name}
    </span>
  );
}

/** The call stack, newest frame on top. */
export function CallStackRegion() {
  const stack = useCallStack();
  const client = useIsClient();
  const reduce = useReducedMotion() === true;
  // The stack grows at its end; the view is upside down so the newest frame is first.
  const frames = stack.map((frame, depth) => ({ frame, key: `${depth}:${frame.functionId}` })).reverse();
  return (
    <RegionFrame testId="region-call-stack" title="Call Stack" owner="V8" count={stack.length} Icon={Layers}>
      {stack.length === 0 ? (
        <EmptyState>empty: nothing is running</EmptyState>
      ) : (
        <ol className="flex flex-col gap-1.5">
          {client ? (
            <AnimatePresence mode="popLayout" initial={false}>
              {frames.map(({ frame, key }) => (
                <motion.li
                  key={key}
                  layout="position"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1, transition: { opacity: reduce ? INSTANT : SPRING, layout: SPRING } }}
                  exit={{ opacity: 0, transition: { opacity: reduce ? INSTANT : LEAVE } }}
                  transition={{ layout: SPRING }}
                >
                  <motion.div
                    className={FRAME_CLASS}
                    initial={{ transform: "translateY(-12px)" }}
                    animate={{ transform: "translateY(0px)", transition: SPRING }}
                    exit={{ transform: "translateY(-8px)", transition: LEAVE }}
                  >
                    <FrameName name={frame.functionName} />
                  </motion.div>
                </motion.li>
              ))}
            </AnimatePresence>
          ) : (
            frames.map(({ frame, key }) => (
              <li key={key} className={FRAME_CLASS}>
                <FrameName name={frame.functionName} />
              </li>
            ))
          )}
        </ol>
      )}
    </RegionFrame>
  );
}
