"use client";

import type { RefObject } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { ChooseExample } from "./ExamplesMenu";

/** The confirmation before an example replaces the learner's own code. Loaded on first use (D6 budget). */
export function ReplaceExampleDialogContent({ choice, returnFocusRef }: { choice: ChooseExample; returnFocusRef?: RefObject<HTMLElement | null> | undefined }) {
  const { pending, title, confirm, cancel } = choice;
  return (
    <AlertDialog open={pending !== null} onOpenChange={(open) => !open && cancel()}>
      <AlertDialogContent
        // The menu item that opened this has unmounted, so Radix has nowhere to return focus to.
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          returnFocusRef?.current?.focus();
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>{`Replace your code with '${title}'?`}</AlertDialogTitle>
          <AlertDialogDescription>Your current code is not one of the examples, so it will be lost.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={confirm}>Replace</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
