/** A cell per line tag: a tag hashes to `tag mod cells` and probes forward past taken cells, oldest line first, so one list always lays out the same way. */
export function placeLines(tags: readonly number[], cells: number): readonly number[] {
  const taken = new Set<number>();
  return tags.map((tag) => {
    let cell = ((tag % cells) + cells) % cells;
    while (taken.has(cell) && taken.size < cells) cell = (cell + 1) % cells;
    taken.add(cell);
    return cell;
  });
}
