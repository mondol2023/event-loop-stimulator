/** Per-index flash levels that fade from 1 to 0 over `duration` seconds; `advance` is scaled by the frame delta. */
export class Flashes {
  // Seconds since each flash started; Infinity means off.
  readonly #age: Float32Array;
  readonly #duration: number;

  constructor(count: number, duration: number) {
    this.#age = new Float32Array(count).fill(Infinity);
    this.#duration = duration;
  }

  start(i: number): void {
    this.#age[i] = 0;
  }

  clear(): void {
    this.#age.fill(Infinity);
  }

  level(i: number): number {
    const age = this.#age[i] ?? Infinity;
    return Number.isFinite(age) ? 1 - age / this.#duration : 0;
  }

  /** Moves every flash on by `delta`. With `instant` (reduced motion) a flash holds at full level until `clear`; returns whether more frames are needed. */
  advance(delta: number, instant: boolean): boolean {
    if (instant) return false;
    let animating = false;
    for (let i = 0; i < this.#age.length; i++) {
      const age = this.#age[i] ?? Infinity;
      if (!Number.isFinite(age)) continue;
      const next = age + delta;
      if (next >= this.#duration) this.#age[i] = Infinity;
      else {
        this.#age[i] = next;
        animating = true;
      }
    }
    return animating;
  }
}
