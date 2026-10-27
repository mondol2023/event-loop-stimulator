export type FrameloopMode = "always" | "demand" | "never";

/** D4: nothing renders while the tab or document is hidden, every frame while playing, and a frame per change while paused. */
export function frameloopMode(state: { playing: boolean; hidden: boolean }): FrameloopMode {
  if (state.hidden) return "never";
  return state.playing ? "always" : "demand";
}
