import type { FunctionId } from "@/core/shared/ids";
import type { ArrayBoilerplate, ObjectBoilerplate } from "./boilerplate";

// V8's constant pool (the `ConstantArrayBuilder`): an insertion-ordered list of the values a
// function's bytecode refers to by index. Strings and numbers are deduplicated; shared function
// infos, scope infos and boilerplate descriptions are not, because each one is a distinct heap object.

export type ConstantEntry =
  /** `folded` is a concatenation the parser made: a cons string, which V8 neither internalizes nor deduplicates. */
  | { readonly kind: "string"; readonly value: string; readonly folded?: boolean }
  | { readonly kind: "number"; readonly value: number }
  /** A small integer stored as a Smi: the distance of a jump too far for its operand. */
  | { readonly kind: "smi"; readonly value: number }
  /** `text` is the literal as written, without the `n`; it may be hexadecimal, octal or binary. */
  | { readonly kind: "bigint"; readonly text: string }
  /** One case of a jump table: the distance from the switch to where the case lands. Never deduplicated, and set after layout. */
  | { readonly kind: "jump-offset"; readonly value: number }
  /** A function the bytecode can create a closure for; `functionId` finds its own bytecode. */
  | { readonly kind: "sfi"; readonly name: string; readonly functionId: FunctionId }
  /** An object or array literal description, printed as `<{text}>`; `literal` is the data the interpreter copies. */
  | { readonly kind: "boilerplate"; readonly text: string; readonly literal?: ObjectBoilerplate | ArrayBoilerplate }
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

  /** V8's ConstantArrayBuilder::InsertJumpTable: `size` consecutive entries, filled in by `setJumpOffset` once the cases are placed. Returns the first index. */
  addJumpTable(size: number): number {
    const first = this.list.length;
    for (let i = 0; i < size; i++) this.list.push({ kind: "jump-offset", value: 0 });
    return first;
  }

  setJumpOffset(index: number, value: number): void {
    if (this.list[index]?.kind !== "jump-offset") throw new Error(`constant-pool entry ${index} is not a jump-table entry`);
    this.list[index] = { kind: "jump-offset", value };
  }

  // Reserved entries (V8's ConstantArrayBuilder::CreateReservedEntry). Every forward jump reserves
  // one when it is written, because its distance is unknown; the entry is committed as a Smi only
  // if the distance turns out too long for the operand, and handed back otherwise. A reservation
  // takes the smallest operand size with an index to spare, so the jump's operand is wide enough
  // for whatever index it later receives. Where V8 would push later ordinary entries into the next
  // index slice to keep a reservation's index free, they are appended here: a pool that crosses 256
  // entries while a jump is pending is the one case this does not reproduce.
  private reserved = 0;

  /** The operand scale (1, 2 or 4 bytes) of a new reservation. */
  reserve(): 1 | 2 | 4 {
    const taken = this.list.length + this.reserved;
    this.reserved++;
    return taken < 0x100 ? 1 : taken < 0x10000 ? 2 : 4;
  }

  /** Gives a reservation back unused. */
  discard(): void {
    if (this.reserved === 0) throw new Error("no reserved constant-pool entry to discard");
    this.reserved--;
  }

  /** Turns a reservation into a Smi entry (an equal one is reused) and returns its index. */
  commit(value: number): number {
    this.discard();
    return this.add({ kind: "smi", value });
  }

  /** Each entry in the normalized form the recorded listings use (addresses are stripped). */
  printEntries(): string[] {
    return this.list.map(printEntry);
  }
}

function dedupeKey(entry: ConstantEntry): string | undefined {
  if (entry.kind === "string") return entry.folded ? undefined : `s:${entry.value}`;
  if (entry.kind === "number") return `n:${Object.is(entry.value, -0) ? "-0" : String(entry.value)}`;
  if (entry.kind === "smi") return `i:${entry.value}`;
  return undefined;
}

function printEntry(entry: ConstantEntry): string {
  switch (entry.kind) {
    case "string":
      return printString(entry);
    case "smi":
    case "jump-offset":
      return String(entry.value);
    case "bigint":
      return `<BigInt ${BigInt(entry.text).toString()}>`;
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

/**
 * A string constant as V8 prints it: `#text` for an internalized string (`u#` when it has two-byte
 * characters), `"text"` for a cons string. Printable ASCII is literal; newline, carriage return and
 * backslash are escaped, and every other code unit is `\x` and its hex digits, two at least.
 */
function printString(entry: { readonly value: string; readonly folded?: boolean }): string {
  const text = entry.value;
  let body = "";
  let twoByte = false;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code > 0xff) twoByte = true;
    if (code === 10) body += "\\n";
    else if (code === 13) body += "\\r";
    else if (code === 92) body += "\\\\";
    else if (code >= 32 && code <= 126) body += text.charAt(i);
    else body += `\\x${code.toString(16).padStart(2, "0")}`;
  }
  if (entry.folded) return `<String[${text.length}]: "${body}">`;
  return `<String[${text.length}]: ${twoByte ? "u" : ""}#${body}>`;
}
