import type { Metadata } from "next";

export const metadata: Metadata = { title: "Playground" };

// Placeholder until the IDE lands in Phase 5.
export default function PlaygroundPage() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-3 px-6 py-24">
      <h1 className="text-3xl font-semibold tracking-tight">Playground</h1>
      <p className="max-w-[65ch] text-muted-foreground">
        The editor, the bytecode and machine-code panes and the event-loop view are on their way. Soon
        you&apos;ll be able to pick an example like{" "}
        <code className="font-mono text-foreground">nextTick vs Promise</code>, press Play, and see exactly
        why it prints in that order.
      </p>
    </main>
  );
}
