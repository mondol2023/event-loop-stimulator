import { useState } from "react";
import { Check, FlaskConical, Gauge, PencilLine, type LucideIcon } from "lucide-react";
import { cn } from "cn";
import { TRUTH_TOOLTIPS, type TruthLevel } from "@/core/shared/fidelity";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

export type TruthBadgeLevel = TruthLevel | "exact-encoding";

const EXACT_ENCODING_TOOLTIP =
  "Exact encoding of the shown assembly: the bytes are what a real assembler produces for these instructions.";

interface BadgeSpec {
  readonly label: string;
  readonly tooltip: string;
  readonly Icon: LucideIcon;
  readonly dashed: boolean;
}

function specFor(level: TruthBadgeLevel): BadgeSpec {
  switch (level) {
    case "exact":
      return { label: "Exact", tooltip: TRUTH_TOOLTIPS.exact, Icon: Check, dashed: false };
    case "verified-model":
      return { label: "Verified model", tooltip: TRUTH_TOOLTIPS["verified-model"], Icon: FlaskConical, dashed: false };
    case "modeled":
      return { label: "Modeled", tooltip: TRUTH_TOOLTIPS.modeled, Icon: Gauge, dashed: true };
    case "illustrative":
      return { label: "Illustrative", tooltip: TRUTH_TOOLTIPS.illustrative, Icon: PencilLine, dashed: false };
    case "exact-encoding":
      return { label: "Exact encoding", tooltip: EXACT_ENCODING_TOOLTIP, Icon: Check, dashed: false };
    default: {
      const unreachable: never = level;
      return unreachable;
    }
  }
}

// Own provider so the badge works standalone (tests) and inside the app.
// `compact` drops the visible word for table rows; "narrow" drops it only below sm (a crowded strip at phone width).
// The accessible name keeps it either way.
export function TruthBadge({ level, compact = false }: { level: TruthBadgeLevel; compact?: boolean | "narrow" }) {
  const { label, tooltip, Icon, dashed } = specFor(level);
  // Radix ignores touch pointers, so a tap toggles the tooltip by hand.
  const [open, setOpen] = useState(false);
  return (
    <TooltipProvider>
      <Tooltip open={open} onOpenChange={setOpen}>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-label={`${label}: ${tooltip}`}
            className={cn(
              "inline-flex min-h-6 items-center gap-1 rounded-md border px-1.5 text-xs text-muted-foreground",
              "hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
              dashed ? "border-dashed border-border" : "border-transparent",
            )}
          >
            <Icon aria-hidden="true" className="size-3" />
            {compact === true ? null : compact === "narrow" ? <span className="hidden sm:inline">{label}</span> : label}
          </button>
        </TooltipTrigger>
        <TooltipContent>{tooltip}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
