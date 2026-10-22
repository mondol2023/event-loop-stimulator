import type { BytecodeFunction } from "@/core/bytecode/BytecodeProgram";
import { FeedbackVector } from "../ic/FeedbackVector";

/**
 * V8's FeedbackCell (src/objects/feedback-cell.h): what a closure points to for its feedback. Every
 * closure made at one creation site shares the cell, and so its FeedbackVector. The cell also holds
 * the cells of the closure sites inside the function (V8's ClosureFeedbackCellArray).
 */
export class FeedbackCell {
  readonly closureCells = new Map<number, FeedbackCell>();
  #vector: FeedbackVector | undefined;

  /** Allocates the vector for `code` unless an earlier closure of this site did (eager allocation). */
  allocateVector(code: BytecodeFunction): FeedbackVector {
    this.#vector ??= FeedbackVector.forFunction(code);
    return this.#vector;
  }

  /** The vector if one was allocated (a builtin has none). Read-only: the timeline's view. */
  vectorOrUndefined(): FeedbackVector | undefined {
    return this.#vector;
  }

  requireVector(): FeedbackVector {
    if (!this.#vector) throw new Error("this feedback cell has no vector (a builtin has no inline caches)");
    return this.#vector;
  }

  /** The cell of the closure created at `slot`, made on first use. */
  closureCell(slot: number): FeedbackCell {
    let cell = this.closureCells.get(slot);
    if (!cell) {
      cell = new FeedbackCell();
      this.closureCells.set(slot, cell);
    }
    return cell;
  }
}
