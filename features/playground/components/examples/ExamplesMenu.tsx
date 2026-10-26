"use client";

import { BookOpen } from "lucide-react";
import { DropdownMenu } from "radix-ui";
import { Component, type ComponentType, lazy, type ReactNode, type RefObject, Suspense, useRef, useState } from "react";
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
      <DropdownMenu.Root modal={false} onOpenChange={(open) => open && preloadReplaceExampleDialog()}>
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

type DialogProps = { choice: ChooseExample; returnFocusRef?: RefObject<HTMLElement | null> | undefined };
export type LoadReplaceDialog = () => Promise<{ ReplaceExampleDialogContent: ComponentType<DialogProps> }>;

const loadReplaceDialog: LoadReplaceDialog = () => import("./ReplaceExampleDialog");

// A new lazy per attempt: React keeps a rejected lazy rejected, so retrying needs a fresh one.
const lazyDialog = (load: LoadReplaceDialog) => lazy(() => load().then((m) => ({ default: m.ReplaceExampleDialogContent })));

/** Fetches the dialog's chunk ahead of need (the Examples menu or the palette opening); a failure here is retried on use. */
export function preloadReplaceExampleDialog(): void {
  loadReplaceDialog().catch(() => undefined);
}

/** A chunk that fails to load (offline, or a stale hash after a redeploy) lands here instead of unmounting the page. */
class DialogLoadBoundary extends Component<{ onError(): void; children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }
  override componentDidCatch(): void {
    this.props.onError();
  }
  override render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}

/**
 * The confirmation before an example replaces the learner's own code. Its dialog code loads the first time it is
 * needed and then stays mounted, so its exit animation still runs. If the code cannot load, the browser's own
 * confirm asks the same question, so the learner's code is never replaced without a yes; the next choice retries.
 */
export function ReplaceExampleDialog({ choice, returnFocusRef, load = loadReplaceDialog }: DialogProps & { load?: LoadReplaceDialog }) {
  const [needed, setNeeded] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [{ Content }, setContent] = useState(() => ({ Content: lazyDialog(load) }));
  if (!needed && choice.pending !== null) setNeeded(true);
  const onError = (): void => {
    const yes = window.confirm(`Replace your code with '${choice.title}'? Your current code is not one of the examples, so it will be lost.`);
    if (yes) choice.confirm();
    else choice.cancel();
    setNeeded(false);
    setContent({ Content: lazyDialog(load) });
    setAttempt((n) => n + 1);
  };
  return needed ? (
    <DialogLoadBoundary key={attempt} onError={onError}>
      <Suspense fallback={null}>
        <Content choice={choice} returnFocusRef={returnFocusRef} />
      </Suspense>
    </DialogLoadBoundary>
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
