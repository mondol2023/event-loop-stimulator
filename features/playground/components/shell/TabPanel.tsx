"use client";

import type { ReactNode } from "react";

// Radix's TabsContent renders style="animation-duration:0s" on the first selected panel, which the
// nonce CSP blocks in SSR output (D1). The shell renders its own panels instead and gives the Radix
// triggers matching ids, which Radix lets a trigger override, so the ARIA tab wiring stays intact.

/** Props for a TabsTrigger so that it names `group`'s panel for `value`. */
export function tabTriggerProps(group: string, value: string): { id: string; "aria-controls": string } {
  return { id: `${group}-tab-${value}`, "aria-controls": `${group}-panel-${value}` };
}

/** The panel for the selected tab; unselected panels are not mounted. */
export function TabPanel({ group, value, active, className, children }: { group: string; value: string; active: boolean; className?: string; children: ReactNode }) {
  if (!active) return null;
  return (
    <div role="tabpanel" id={`${group}-panel-${value}`} aria-labelledby={`${group}-tab-${value}`} tabIndex={0} className={className}>
      {children}
    </div>
  );
}
