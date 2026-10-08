import type { BytecodeArrayBuilder, Label } from "./BytecodeArrayBuilder";

// V8's BytecodeLabels: a set of jump targets that are bound together to one place. Each jump
// takes a label of its own from `new`; labels nothing jumps to are left alone by `bind`.
export class BytecodeLabels {
  private readonly labels: Label[] = [];
  private isBound = false;

  constructor(private readonly builder: BytecodeArrayBuilder) {}

  /** A fresh target for one jump. */
  new(): Label {
    const label = this.builder.newLabel();
    this.labels.push(label);
    return label;
  }

  get bound(): boolean {
    return this.isBound;
  }

  /** True when at least one written jump goes here. */
  get hasReferrer(): boolean {
    return this.labels.some((label) => label.referenced);
  }

  bind(): void {
    for (const label of this.labels) this.builder.bind(label);
    this.isBound = true;
  }
}
