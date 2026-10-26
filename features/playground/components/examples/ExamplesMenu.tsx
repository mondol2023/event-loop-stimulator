"use client";

import { BookOpen } from "lucide-react";
import { DropdownMenu } from "radix-ui";
import { lazy, type RefObject, Suspense, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { EXAMPLES, type Example, exampleForSource } from "../../examples";
import { usePlaygroundStore } from "../../store/PlaygroundContext";
import type { PlaygroundStore } from "../../store/playgroundStore";
import { ExampleStatus } from "./VerifiedBadge";

/** Loads an example's source and language into the editor. */
export function applyExample(store: PlaygroundStore, example: Example): void {
  const { setLang, setSource } = store.getState();
  setLang(example.lang);
  setSource(example.source);
}

export type ChooseExample = { choose(example: Example): void; pending: Example | null; title: string; confirm(): void; cancel(): void };

/**
 * Choosing an example over the learner's own code asks first (nothing silently destroys their work);
 * over an empty editor or another example it just loads.
 */
export function useChooseExample(): ChooseExample {
  const store = usePlaygroundStore();
  const [pending, setPending] = useState<Example | null>(null);
  // The last asked-about title stays after closing, so the dialog text does not blank during its exit animation.
  const [title, setTitle] = useState("");
  return {
    choose(example) {
      const { source } = store.getState().editor;
      if (source !== "" && exampleForSource(source) === null) {
        setTitle(example.title);
        setPending(example);
      } else applyExample(store, example);
    },
    pending,
    title,
    confirm() {
      if (pending) applyExample(store, pending);
      setPending(null);
    },
    cancel: () => setPending(null),
  };
}

export function ExamplesMenu() {
  const choice = useChooseExample();
  const triggerRef = useRef<HTMLButtonElement>(null);
  return (
    <>
      {/* Non-modal, so closing the menu to open the confirmation never leaves the page inert. */}
      <DropdownMenu.Root modal={false}>
        <DropdownMenu.Trigger asChild>
          <Button ref={triggerRef} type="button" variant="outline" size="sm">
            <BookOpen aria-hidden="true" />
            Examples
          </Button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="start"
            sideOffset={4}
            aria-label="Examples"
            className="z-50 max-h-[min(70dvh,34rem)] w-[min(92vw,28rem)] overflow-y-auto rounded-lg bg-popover p-1 text-popover-foreground ring-1 ring-foreground/10"
          >
            {EXAMPLES.map((example) => (
              <DropdownMenu.Item
                key={example.id}
                onSelect={() => choice.choose(example)}
                className="flex cursor-default flex-col gap-1 rounded-md px-2 py-1.5 text-sm outline-none data-highlighted:bg-muted"
              >
                <span className="font-medium">{example.title}</span>
                <span className="text-xs text-muted-foreground">{example.blurb}</span>
                <ExampleStatus example={example} />
              </DropdownMenu.Item>
            ))}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>

      <ReplaceExampleDialog choice={choice} returnFocusRef={triggerRef} />
    </>
  );
}

const ReplaceExampleDialogContent = lazy(() => import("./ReplaceExampleDialog").then((m) => ({ default: m.ReplaceExampleDialogContent })));

/**
 * The confirmation before an example replaces the learner's own code. Its dialog code loads the first time it is
 * needed and then stays mounted, so its exit animation still runs.
 */
export function ReplaceExampleDialog({ choice, returnFocusRef }: { choice: ChooseExample; returnFocusRef?: RefObject<HTMLElement | null> }) {
  const [needed, setNeeded] = useState(false);
  if (!needed && choice.pending !== null) setNeeded(true);
  return needed ? (
    <Suspense fallback={null}>
      <ReplaceExampleDialogContent choice={choice} returnFocusRef={returnFocusRef} />
    </Suspense>
  ) : null;
}

/** The empty editor's teaching state: the same examples as the menu, one tap from running. */
export function ExamplesList() {
  const store = usePlaygroundStore();
  return (
    <section aria-label="Start with an example" className="flex max-h-full flex-col gap-2 overflow-y-auto rounded-lg bg-card p-3 text-card-foreground ring-1 ring-foreground/10">
      <h3 className="text-sm font-medium">Type some code, or start from an example</h3>
      <ul className="flex flex-col gap-1">
        {EXAMPLES.map((example) => (
          <li key={example.id}>
            <button
              type="button"
              onClick={() => applyExample(store, example)}
              className="flex w-full flex-col gap-0.5 rounded-md px-2 py-1.5 text-left hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              <span className="text-sm font-medium">{example.title}</span>
              <span className="text-xs text-muted-foreground">{example.blurb}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
