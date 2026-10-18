// process.emitWarning's default handler (lib/internal/process/warning.js): `(node:PID) Name: message`
// on stderr, with the `--trace-warnings` hint after the first warning of the process only. The pid
// prints as the literal `PID`, the form the conformance recorder normalizes real output to.

export interface ProcessWarning {
  readonly name: string;
  readonly message: string;
}

const TRACE_WARNINGS_HINT = "(Use `node --trace-warnings ...` to show where the warning was created)\n";

export class ProcessWarnings {
  #hinted = false;

  /** The stderr text of one warning. */
  emit(warning: ProcessWarning): string {
    const text = `(node:PID) ${warning.name}: ${warning.message}\n`;
    if (this.#hinted) return text;
    this.#hinted = true;
    return text + TRACE_WARNINGS_HINT;
  }
}

/** The warning `setTimeout`/`setInterval` emit for a delay above 2**31 - 1 (lib/internal/timers.js). */
export function timeoutOverflowWarning(after: number): ProcessWarning {
  return {
    name: "TimeoutOverflowWarning",
    message: `${String(after)} does not fit into a 32-bit signed integer.\nTimeout duration was set to 1.`,
  };
}

/** The warning for a negative delay, emitted once per process (lib/internal/timers.js Timeout). */
export function timeoutNegativeWarning(after: number): ProcessWarning {
  return { name: "TimeoutNegativeWarning", message: `${String(after)} is a negative number.\nTimeout duration was set to 1.` };
}

/** The warning for a delay that is NaN after `after *= 1`, emitted once per process (lib/internal/timers.js Timeout). */
export function timeoutNaNWarning(after: number): ProcessWarning {
  return { name: "TimeoutNaNWarning", message: `${String(after)} is not a number.\nTimeout duration was set to 1.` };
}
