/**
 * V8's FeedbackCell (src/objects/feedback-cell.h): what a closure points to for its feedback. Every
 * closure made at one creation site shares the cell. Until Task 10 adds the FeedbackVector, the
 * cell holds the cells of the closure sites inside the function (V8's ClosureFeedbackCellArray).
 */
export class FeedbackCell {
  readonly closureCells = new Map<number, FeedbackCell>();

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
