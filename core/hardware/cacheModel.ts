// Illustrative (D2, ADR-033/039): a two-level cache with deterministic LRU. The sizes are a teaching scale, not Node's host CPU.

export type CacheLevel = "l1" | "l2" | "ram";

export const LINE_BYTES = 64n;
export const L1_LINES = 8;
export const L2_LINES = 32;

export class CacheModel {
  // Distinct resident line tags, least recently used first. L2 is inclusive of L1, so L1 is its newest L1_LINES and one list is the whole state.
  #lines: number[] = [];

  /** Looks the address's line up, then makes it the most recently used. */
  access(address: bigint): CacheLevel {
    const tag = Number(address / LINE_BYTES);
    const at = this.#lines.lastIndexOf(tag);
    const level: CacheLevel = at < 0 ? "ram" : this.#lines.length - at <= L1_LINES ? "l1" : "l2";
    if (at >= 0) this.#lines.splice(at, 1);
    this.#lines.push(tag);
    if (this.#lines.length > L2_LINES) this.#lines.shift();
    return level;
  }

  /** The line tags in L1 after the last access, oldest first. */
  l1(): number[] {
    return this.#lines.slice(-L1_LINES);
  }

  /** The line tags in L2 (L1's lines included), oldest first. */
  l2(): number[] {
    return [...this.#lines];
  }
}
