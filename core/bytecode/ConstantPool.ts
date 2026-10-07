import type { FunctionId } from "@/core/shared/ids";

// V8's constant pool (the `ConstantArrayBuilder`): an insertion-ordered list of the values a
// function's bytecode refers to by index. Strings and numbers are deduplicated; shared function
// infos, scope infos and boilerplate descriptions are not, because each one is a distinct heap object.

export type ConstantEntry =
  | { readonly kind: "string"; readonly value: string }
  | { readonly kind: "number"; readonly value: number }
  /** A function the bytecode can create a closure for; `functionId` finds its own bytecode. */
  | { readonly kind: "sfi"; readonly name: string; readonly functionId: FunctionId }
  /** An object or array literal description, printed as `<{text}>`. */
  | { readonly kind: "boilerplate"; readonly text: string }
  | { readonly kind: "scope-info"; readonly scope: string };

export class ConstantPool {
  private readonly list: ConstantEntry[] = [];
  private readonly index = new Map<string, number>();

  get size(): number {
    return this.list.length;
  }

  get entries(): readonly ConstantEntry[] {
    return this.list;
  }

  get(index: number): ConstantEntry | undefined {
    return this.list[index];
  }

  /** The index of `entry`: that of an equal string or number if there is one, else a new slot. */
  add(entry: ConstantEntry): number {
    const key = dedupeKey(entry);
    if (key !== undefined) {
      const existing = this.index.get(key);
      if (existing !== undefined) return existing;
    }
    this.list.push(entry);
    const at = this.list.length - 1;
    if (key !== undefined) this.index.set(key, at);
    return at;
  }

  /** Each entry in the normalized form the recorded listings use (addresses are stripped). */
  printEntries(): string[] {
    return this.list.map(printEntry);
  }
}

function dedupeKey(entry: ConstantEntry): string | undefined {
  if (entry.kind === "string") return `s:${entry.value}`;
  if (entry.kind === "number") return `n:${Object.is(entry.value, -0) ? "-0" : String(entry.value)}`;
  return undefined;
}

function printEntry(entry: ConstantEntry): string {
  switch (entry.kind) {
    case "string":
      // Control characters and non-ASCII text are escaped by V8 here; that arrives with the
      // strings-and-templates fixture, which is the first to need it.
      return `<String[${entry.value.length}]: #${entry.value}>`;
    case "number":
      return `<HeapNumber ${formatHeapNumber(entry.value)}>`;
    case "sfi":
      return entry.name === "" ? "<SharedFunctionInfo>" : `<SharedFunctionInfo ${entry.name}>`;
    case "boilerplate":
      return `<${entry.text}>`;
    case "scope-info":
      return `<ScopeInfo ${entry.scope}>`;
  }
}

const SIGNIFICANT_DIGITS = 6;

/**
 * A number the way V8 prints a `HeapNumber`: an integer below 2**53 as `N.0`, anything else as C's
 * `%g` with six significant digits. Both rules and the tie rounding were read off the pinned Node.
 */
export function formatHeapNumber(value: number): string {
  if (Number.isNaN(value)) return "nan";
  if (value === Infinity) return "inf";
  if (value === -Infinity) return "-inf";
  if (Object.is(value, -0)) return "-0.0";
  if (Number.isInteger(value) && Math.abs(value) < 2 ** 53) return `${value}.0`;
  return formatG(value);
}

/** `%g` with six significant digits: exponent form below 1e-4 and from 1e6, trailing zeros dropped. */
function formatG(value: number): string {
  const sign = value < 0 ? "-" : "";
  const { digits, exponent } = roundToSignificant(Math.abs(value));
  const trimmed = digits.replace(/0+$/, "") || "0";
  if (exponent < -4 || exponent >= SIGNIFICANT_DIGITS) {
    const mantissa = trimmed.length > 1 ? `${trimmed[0]}.${trimmed.slice(1)}` : trimmed;
    const power = String(Math.abs(exponent)).padStart(2, "0");
    return `${sign}${mantissa}e${exponent < 0 ? "-" : "+"}${power}`;
  }
  if (exponent < 0) return `${sign}0.${"0".repeat(-exponent - 1)}${trimmed}`;
  const whole = digits.slice(0, exponent + 1);
  const fraction = digits.slice(exponent + 1).replace(/0+$/, "");
  return `${sign}${whole}${fraction === "" ? "" : `.${fraction}`}`;
}

/**
 * The first six significant digits of a positive finite number, rounded half to even on its exact
 * value (what C's printf does), and the decimal exponent of the first digit.
 */
function roundToSignificant(value: number): { digits: string; exponent: number } {
  // 100 digits are enough to tell an exact tie from a value that merely starts with ...5.
  const [mantissa = "", power = "0"] = value.toExponential(100).split("e");
  const all = mantissa.replace(".", "");
  let exponent = Number(power);
  let head = all.slice(0, SIGNIFICANT_DIGITS);
  const next = all[SIGNIFICANT_DIGITS] ?? "0";
  const rest = all.slice(SIGNIFICANT_DIGITS + 1);
  const lastDigitOdd = Number(head.at(-1)) % 2 === 1;
  const roundUp = next > "5" || (next === "5" && (/[1-9]/.test(rest) || lastDigitOdd));
  if (roundUp) {
    head = String(Number(head) + 1);
    if (head.length > SIGNIFICANT_DIGITS) {
      head = head.slice(0, SIGNIFICANT_DIGITS);
      exponent += 1;
    }
  }
  return { digits: head, exponent };
}
