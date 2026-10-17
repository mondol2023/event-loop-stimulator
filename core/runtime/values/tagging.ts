import { isSmi } from "./Smi";

/** The tagged word of a Smi as `%DebugPrint` shows it: `n << 1` as a uint32 (kSmiTag = 0). */
export function taggedSmi(n: number): string {
  if (!isSmi(n)) throw new RangeError(`not a Smi: ${String(n)}`);
  return `0x${((n << 1) >>> 0).toString(16).padStart(8, "0")}`;
}
