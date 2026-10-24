import { useEffect } from "react";
import type { PlaygroundStore } from "../store/playgroundStore";
import { isEditableTarget, type ShortcutAction, shortcutFor } from "./shortcuts";

function dispatch(store: PlaygroundStore, action: ShortcutAction): void {
  const s = store.getState();
  switch (action) {
    case "toggle-play":
      return s.togglePlay();
    case "step-back":
      return s.step(-1);
    case "step-forward":
      return s.step(1);
    case "boundary-back":
      return s.jumpBoundary(-1);
    case "boundary-forward":
      return s.jumpBoundary(1);
    case "first":
      return s.seek(0);
    case "last":
      // seek is a no-op on an empty timeline, so length 0 is safe.
      return s.seek(s.playback.length - 1);
    default: {
      const unreachable: never = action;
      throw new Error(`unhandled shortcut: ${String(unreachable)}`);
    }
  }
}

export function useShortcuts(store: PlaygroundStore): void {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent): void {
      const action = shortcutFor({
        key: e.key,
        shiftKey: e.shiftKey,
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey,
        altKey: e.altKey,
        editable: isEditableTarget(e.target),
      });
      if (!action) return;
      e.preventDefault();
      dispatch(store, action);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [store]);
}
