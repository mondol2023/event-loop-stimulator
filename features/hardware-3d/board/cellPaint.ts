import type { Color, InstancedMesh } from "three";

/** Writes instance colours only when one differs from what was last written, so `instanceColor` uploads on change alone. */
export class CellPaint {
  readonly #mesh: InstancedMesh;
  readonly #last: Float64Array;
  #dirty = false;

  constructor(mesh: InstancedMesh) {
    this.#mesh = mesh;
    // -1 is no colour (every packed value is 0 to 0xffffff), so the first paint always writes.
    this.#last = new Float64Array(mesh.count).fill(-1);
  }

  paint(i: number, color: Color): void {
    const packed = color.getHex();
    if (this.#last[i] === packed) return;
    this.#last[i] = packed;
    this.#mesh.setColorAt(i, color);
    this.#dirty = true;
  }

  commit(): void {
    if (this.#dirty && this.#mesh.instanceColor) this.#mesh.instanceColor.needsUpdate = true;
    this.#dirty = false;
  }

  /** Forgets what was written, e.g. after a theme change recoloured every token. */
  reset(): void {
    this.#last.fill(-1);
  }
}
