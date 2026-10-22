// `%DebugPrint(fn)` under --allow-natives-syntax --no-lazy-feedback-allocation
// prints the function's feedback vector among a lot of address-bearing noise.
// An `extract: "feedback"` fixture keeps only what our model can reproduce
// (D2): the function name and the property-IC slots, normalized to
//   function NAME
//   slot #N KIND STATE

const KEPT_SLOT_KINDS = new Set([
  "LoadProperty",
  "LoadKeyed",
  "SetNamedSloppy",
  "SetNamedStrict",
  "SetKeyedSloppy",
  "SetKeyedStrict",
  "DefineNamedOwn",
]);

// The function's own line sits at one-space indent; a nested object's dump is indented deeper.
// The second alternative is the normalized line itself, so extraction is idempotent: the
// simulator's %DebugPrint prints the normalized lines and goes through the same filter.
const SHARED_INFO = /^(?: - shared_info: .*<SharedFunctionInfo ([^>]*)>|function (.*))$/;
const SLOT = /^(?: - )?slot #(\d+) (\w+) (\w+)(?: \{)?$/;

/** Pure: the kept lines of a `%DebugPrint` transcript, in print order, each ending in "\n". */
export function extractFeedback(stdout: string): string {
  let out = "";
  for (const line of stdout.split("\n")) {
    const info = SHARED_INFO.exec(line);
    if (info) {
      out += `function ${info[1] ?? info[2] ?? ""}\n`;
      continue;
    }
    const slot = SLOT.exec(line);
    if (slot && KEPT_SLOT_KINDS.has(slot[2] as string)) out += `slot #${slot[1]} ${slot[2]} ${slot[3]}\n`;
  }
  return out;
}
