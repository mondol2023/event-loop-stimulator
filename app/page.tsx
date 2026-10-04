import Link from "next/link";
import { Button } from "@/components/ui/button";

// Placeholder. The landing page (Persuade mode, live mini-visualizer as hero)
// is designed in a later phase.
export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-6 px-6 py-24">
      <h1 className="text-4xl font-semibold tracking-tight">Silicon Loop</h1>
      <p className="max-w-[65ch] text-lg text-muted-foreground">
        Write a little JavaScript and watch how V8 really runs it: the bytecode, the machine code, the
        hidden classes and Node&apos;s event loop, tick by tick, with exactly the output real Node gives.
      </p>
      <div>
        <Button asChild size="lg">
          <Link href="/playground">Open the playground</Link>
        </Button>
      </div>
    </main>
  );
}
