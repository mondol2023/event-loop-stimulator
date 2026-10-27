import type { HardwareFrame } from "../../playground/hooks/useHardwareFrame";
import type { BoardTheme } from "./boardColors";
import type { BoardLayout } from "./layout";

/** What every scene component reads: refs and objects that change without a React render. */
export type SceneProps = {
  readonly frame: { readonly current: HardwareFrame | null };
  readonly theme: BoardTheme;
  readonly layout: BoardLayout;
  /** True while the learner prefers reduced motion; pulses and flashes then switch instantly. */
  readonly reduced: { readonly current: boolean };
  /** Board height is under about 160 px: register tiles drop their value line. */
  readonly compact: boolean;
};

// Heights above the substrate, in board units.
export const Z = {
  substrateTop: -0.2,
  dieCenter: -0.05,
  dieDepth: 0.3,
  dieTop: 0.1,
  cellDepth: 0.16,
  tileDepth: 0.3,
  aluDepth: 0.5,
  busZ: 0.12,
  label: 1,
} as const;

export const FLASH_SECONDS = 0.15;
export const CACHE_FLASH_SECONDS = 0.3;
