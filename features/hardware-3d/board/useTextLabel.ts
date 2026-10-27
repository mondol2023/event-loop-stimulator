import { useEffect, useMemo } from "react";
import type { BoardTheme } from "./boardColors";
import { createTextLabel, type TextLabel } from "./labels";

/** A text sprite that lives as long as the component; the caller sets its lines. */
export function useTextLabel(theme: BoardTheme, width: number, height: number, name = ""): TextLabel {
  const label = useMemo(() => createTextLabel(theme, width, height, name), [theme, width, height, name]);
  useEffect(() => () => label.dispose(), [label]);
  return label;
}

/** `count` text sprites of one size, for a row of tiles or cells. */
export function useTextLabelSet(theme: BoardTheme, count: number, width: number, height: number): readonly TextLabel[] {
  const labels = useMemo(() => Array.from({ length: count }, () => createTextLabel(theme, width, height)), [theme, count, width, height]);
  useEffect(
    () => () => {
      for (const label of labels) label.dispose();
    },
    [labels],
  );
  return labels;
}
