import { CanvasTexture, LinearFilter, SRGBColorSpace, Sprite, SpriteMaterial } from "three";
import type { BoardColors, BoardTheme, ColorToken } from "./boardColors";

// D4: labels are CanvasTexture sprites (no troika, no Html). Only plain strings are ever drawn, with fillText, never as markup.

/** Texture pixels per board unit; 2D-canvas text is sharp enough at the camera's largest zoom. */
const PX_PER_UNIT = 64;

export type Pen = {
  readonly ctx: CanvasRenderingContext2D;
  readonly colors: BoardColors;
  /** Canvas size in pixels. */
  readonly w: number;
  readonly h: number;
  /** Draws `text` with its anchor at (`x`, `y`) in pixels; `size` is in board units. */
  text(text: string, o: { x: number; y: number; size: number; color: string; mono?: boolean; align?: CanvasTextAlign; bold?: boolean }): void;
  /** Width in pixels `text` would take. */
  measure(text: string, size: number, mono: boolean): number;
};

export type Label = { readonly sprite: Sprite; redraw(): void; dispose(): void };

function families(): { mono: string; sans: string } {
  const style = getComputedStyle(document.documentElement);
  const pick = (name: string, fallback: string): string => {
    const v = style.getPropertyValue(name).trim();
    return v === "" ? fallback : `${v}, ${fallback}`;
  };
  return { mono: pick("--font-jetbrains-mono", "ui-monospace, monospace"), sans: pick("--font-plex-sans", "system-ui, sans-serif") };
}

/**
 * A sprite `width` x `height` board units, drawn by `draw` once, and again on `redraw()`, a theme change or when the web fonts load.
 * The caller owns the label and must `dispose()` it.
 */
export function createLabel(theme: BoardTheme, spec: { width: number; height: number; draw: (pen: Pen) => void }): Label {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.ceil(spec.width * PX_PER_UNIT));
  canvas.height = Math.max(1, Math.ceil(spec.height * PX_PER_UNIT));
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.minFilter = LinearFilter;
  texture.generateMipmaps = false;
  const material = new SpriteMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false });
  const sprite = new Sprite(material);
  sprite.scale.set(spec.width, spec.height, 1);
  sprite.renderOrder = 10;

  let disposed = false;

  function redraw(): void {
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const font = families();
    const fontOf = (size: number, mono: boolean, bold: boolean): string => `${bold ? "600 " : ""}${Math.round(size * PX_PER_UNIT)}px ${mono ? font.mono : font.sans}`;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.textBaseline = "middle";
    spec.draw({
      ctx,
      colors: theme.colors,
      w: canvas.width,
      h: canvas.height,
      text(text, o) {
        ctx.font = fontOf(o.size, o.mono ?? false, o.bold ?? false);
        ctx.fillStyle = o.color;
        ctx.textAlign = o.align ?? "center";
        ctx.fillText(text, o.x, o.y);
      },
      measure(text, size, mono) {
        ctx.font = fontOf(size, mono, false);
        return ctx.measureText(text).width;
      },
    });
    texture.needsUpdate = true;
  }

  redraw();
  const unsubscribe = theme.subscribe(redraw);
  // The first draw can use a fallback face; draw again once the web fonts are in.
  void document.fonts?.ready.then(() => {
    if (disposed) return;
    redraw();
    theme.invalidate();
  });

  return {
    sprite,
    redraw() {
      redraw();
      theme.invalidate();
    },
    dispose() {
      disposed = true;
      unsubscribe();
      texture.dispose();
      material.dispose();
    },
  };
}

/** Canvas fill style for a token colour. */
export const css = (color: { getStyle(): string }): string => color.getStyle();

export type TextLine = { text: string; size: number; tone: ColorToken; mono?: boolean; bold?: boolean };
export type TextLabel = Label & { set(lines: readonly TextLine[]): void; show(visible: boolean): void };

/** A label of centred lines of text, stacked top to bottom and shrunk to fit its width; `set` redraws it. */
export function createTextLabel(theme: BoardTheme, width: number, height: number, name = ""): TextLabel {
  let lines: readonly TextLine[] = [];
  const label = createLabel(theme, {
    width,
    height,
    draw: (pen) => {
      const pitch = pen.h / Math.max(1, lines.length);
      lines.forEach((line, i) => {
        const natural = pen.measure(line.text, line.size, line.mono ?? false);
        const size = natural > pen.w * 0.96 ? (line.size * pen.w * 0.96) / natural : line.size;
        pen.text(line.text, { x: pen.w / 2, y: pitch * (i + 0.5), size, color: css(pen.colors[line.tone]), mono: line.mono ?? false, bold: line.bold ?? false });
      });
    },
  });
  label.sprite.name = name;
  return {
    ...label,
    set(next) {
      lines = next;
      // The drawn words are also on the sprite, so a scene test can read what the texture says.
      label.sprite.userData.text = next.map((l) => l.text).join(" ");
      label.redraw();
    },
    show(visible) {
      label.sprite.visible = visible;
    },
  };
}
