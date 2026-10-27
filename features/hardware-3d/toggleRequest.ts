/** The palette's "Toggle 3D" reaches an already-mounted HardwareView through this event, so no view-mode state is lifted into the shell. */
export const HW_TOGGLE_EVENT = "sl:hw-toggle";

export function requestHwToggle(): void {
  window.dispatchEvent(new Event(HW_TOGGLE_EVENT));
}
