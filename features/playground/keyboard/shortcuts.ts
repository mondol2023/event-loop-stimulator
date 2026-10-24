export type ShortcutAction =
  | "toggle-play"
  | "step-back"
  | "step-forward"
  | "boundary-back"
  | "boundary-forward"
  | "first"
  | "last";

export type ShortcutKeyEvent = {
  key: string;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  editable: boolean;
};

export function shortcutFor(e: ShortcutKeyEvent): ShortcutAction | null {
  // Typing and browser/OS chords must never drive playback.
  if (e.editable || e.ctrlKey || e.metaKey || e.altKey) return null;
  switch (e.key) {
    case " ":
      return "toggle-play";
    case "ArrowLeft":
      return e.shiftKey ? "boundary-back" : "step-back";
    case "ArrowRight":
      return e.shiftKey ? "boundary-forward" : "step-forward";
    case "Home":
      return "first";
    case "End":
      return "last";
    default:
      return null;
  }
}

export function isEditableTarget(t: EventTarget | null): boolean {
  // window and document are not Elements; a cross-realm Element still has closest().
  if (!t || typeof (t as Partial<Element>).closest !== "function") return false;
  return (t as Element).closest("input, textarea, select, [contenteditable]:not([contenteditable='false'])") !== null;
}
