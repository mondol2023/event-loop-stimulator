export type ShortcutAction =
  | "toggle-play"
  | "step-back"
  | "step-forward"
  | "boundary-back"
  | "boundary-forward"
  | "first"
  | "last"
  // A held Space: consumed so it cannot scroll the page, but it must not toggle again.
  | "swallow";

export type ShortcutKeyEvent = {
  key: string;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  /** The auto-repeat of a held key. */
  repeat: boolean;
  /** The target owns every shortcut key: typing, or a widget that uses the arrows itself. */
  editable: boolean;
  /** The target activates on Space (a button or link), but has no use for the arrows. */
  activatable: boolean;
};

export function shortcutFor(e: ShortcutKeyEvent): ShortcutAction | null {
  // Typing and browser/OS chords must never drive playback.
  if (e.editable || e.ctrlKey || e.metaKey || e.altKey) return null;
  switch (e.key) {
    case " ":
      // A focused button already handles Space itself; a held Space on anything else must not flicker playback.
      if (e.activatable) return null;
      return e.repeat ? "swallow" : "toggle-play";
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

const OWNS_KEYS =
  "input, textarea, select, [contenteditable]:not([contenteditable='false']), " +
  "[role='slider'], [role='spinbutton'], [role='textbox'], [role='combobox'], [role='listbox'], " +
  "[role='tab'], [role='tablist'], [role='menu'], [role='menuitem'], [role='radiogroup'], [role='radio']";
const ACTIVATES_ON_SPACE = "button, summary, [role='button'], [role='switch'], [role='checkbox']";

function closestMatch(t: EventTarget | null, selector: string): boolean {
  // window and document are not Elements; a cross-realm Element still has closest().
  if (!t || typeof (t as Partial<Element>).closest !== "function") return false;
  return (t as Element).closest(selector) !== null;
}

const OPEN_MODAL = "[role='dialog'][data-state='open'], [role='alertdialog'][data-state='open']";

/** A Radix modal is open: keys belong to it, not to the page behind it. */
export function isModalOpen(): boolean {
  return document.querySelector(OPEN_MODAL) !== null;
}

export function isEditableTarget(t: EventTarget | null): boolean {
  return closestMatch(t, OWNS_KEYS);
}

export function isActivatableTarget(t: EventTarget | null): boolean {
  return closestMatch(t, ACTIVATES_ON_SPACE);
}
