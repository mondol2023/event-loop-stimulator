import type { Metadata } from "next";
import { PipelineSmoke } from "@/features/playground/components/PipelineSmoke";
import { PlaygroundProvider } from "@/features/playground/store/PlaygroundProvider";

export const metadata: Metadata = { title: "Playground" };

// Server Component: composes the client provider and the temporary shell until the IDE lands in Phase 6.
export default function PlaygroundPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 px-6 py-16">
      <h1 className="text-3xl font-semibold tracking-tight">Playground</h1>
      <PlaygroundProvider>
        <PipelineSmoke />
      </PlaygroundProvider>
    </main>
  );
}
