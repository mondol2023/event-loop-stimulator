import type { JSFunction } from "./JSFunction";

/** The name the timeline shows for a function: its own `name` data property, or `(anonymous)`. */
export function displayName(fn: JSFunction): string {
  const entry = fn.getOwnNamed("name");
  return typeof entry?.value === "string" && entry.value !== "" ? entry.value : "(anonymous)";
}
