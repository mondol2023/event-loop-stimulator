import type { HardwareFrame } from "../../playground/hooks/useHardwareFrame";
import { aluLabel } from "../board/aluLabel";
import { busToken, travelsTowardRam, type BusToken } from "../board/busKinds";
import { placeLines } from "../board/cachePlacement";
import type { BoardLayout, Vec2 } from "../board/layout";
import { RAM_CELL_COUNT, REGION_CELLS, REGION_OFFSET } from "../board/layout";
import { pointAlong } from "../board/pulsePath";
import { ramCell, ramFill } from "../board/ramFill";
import { REGISTER_NAMES } from "../board/registerRoles";
import { NO_VALUE, registerText } from "../board/registerText";
import { CACHE_FLASH_SECONDS, FLASH_SECONDS } from "../board/sceneTypes";
import { servedFlash, type CacheFlash } from "../board/served";
import { mapperFor } from "./coords";

type Level = "l1" | "l2";
type CellGroup = Level | "ram";
type El = Element | null;

// Literal class strings, so Tailwind sees them; each one is a token-backed utility.
const FILL = { idle: "fill-secondary", used: "fill-muted-foreground", hit: "fill-primary", miss: "fill-destructive" } as const;
const CELL = "transition-[fill] duration-300 motion-reduce:transition-none";
const TILE = "transition-[fill] duration-150 motion-reduce:transition-none";
const CUE = "font-mono font-bold";
const BUS_STROKE: Readonly<Record<BusToken, string>> = { mutedForeground: "stroke-muted-foreground", busRead: "stroke-bus-read", busWrite: "stroke-bus-write" };
const BUS_FILL: Readonly<Record<BusToken, string>> = { mutedForeground: "fill-muted-foreground", busRead: "fill-bus-read", busWrite: "fill-bus-write" };
const BUS_LINE = "fill-none";
const HIDDEN = "hidden";

const VALUE_SIZE = 0.3;
const ARROW = 0.55;

const setClass = (el: El, value: string): void => {
  if (el && el.getAttribute("class") !== value) el.setAttribute("class", value);
};

/**
 * Applies a hardware frame to the SVG board by touching element attributes only.
 * React renders the board once; every tick and seek lands here, so playback never commits a React render.
 */
export class BoardPainter {
  readonly #tile: El[] = Array.from({ length: 16 }, () => null);
  readonly #value: El[] = Array.from({ length: 16 }, () => null);
  readonly #cells: Record<CellGroup, El[]> = { l1: [], l2: [], ram: Array.from({ length: RAM_CELL_COUNT }, () => null) };
  readonly #cue: Record<Level, El> = { l1: null, l2: null };
  #alu: El = null;
  #aluLabel: El = null;
  #aluOp: El = null;
  #busLine: El = null;
  #busHead: El = null;

  readonly #shown: (string | undefined)[] = Array.from({ length: 16 }, () => undefined);
  readonly #regFlash: boolean[] = Array.from({ length: 16 }, () => false);
  readonly #occupied: Record<Level, Uint8Array> = { l1: new Uint8Array(0), l2: new Uint8Array(0) };
  readonly #served: Record<Level, { cell: number; kind: CacheFlash } | null> = { l1: null, l2: null };
  #ramUsed = { stack: 0, young: 0, old: 0 };
  #ramFlash: number | null = null;
  #bus: { path: readonly Vec2[]; token: BusToken } | null = null;
  #aluOpName: string | null = null;
  #last: HardwareFrame | null | undefined = undefined;
  #layout: BoardLayout | null = null;
  #timers: ReturnType<typeof setTimeout>[] = [];

  /** Holds a reference to each element React rendered, found by its data attributes; call again if the board is re-rendered. */
  attach(root: Element): void {
    const one = (selector: string): El => root.querySelector(selector);
    REGISTER_NAMES.forEach((name, i) => {
      this.#tile[i] = one(`[data-reg-tile="${name}"]`);
      this.#value[i] = one(`[data-reg-value="${name}"]`);
    });
    for (const group of ["l1", "l2", "ram"] as const) {
      this.#cells[group] = [];
      for (const el of root.querySelectorAll(`[data-cell="${group}"]`)) this.#cells[group][Number(el.getAttribute("data-i"))] = el;
    }
    this.#cue.l1 = one('[data-cue="l1"]');
    this.#cue.l2 = one('[data-cue="l2"]');
    this.#alu = one("[data-alu-body]");
    this.#aluLabel = one("[data-alu-title]");
    this.#aluOp = one("[data-alu-op]");
    this.#busLine = one("[data-bus-line]");
    this.#busHead = one("[data-bus-head]");
  }

  /** A new frame (or `null` for none) lands on the board. `instant` is the reduced-motion preference: flashes then hold until the next frame. */
  apply(frame: HardwareFrame | null, layout: BoardLayout, instant: boolean): void {
    this.#layout = layout;
    if (frame !== this.#last) {
      this.#last = frame;
      this.#clearTimers();
      this.#observe(frame, layout);
      if (!instant) this.#scheduleFades();
    }
    this.#paintAll();
  }

  dispose(): void {
    this.#clearTimers();
    this.#last = undefined;
  }

  #clearTimers(): void {
    for (const t of this.#timers) clearTimeout(t);
    this.#timers = [];
  }

  #scheduleFades(): void {
    if (this.#regFlash.some(Boolean)) {
      this.#timers.push(
        setTimeout(() => {
          this.#regFlash.fill(false);
          this.#paintRegisters();
        }, FLASH_SECONDS * 1000),
      );
    }
    if (this.#served.l1 || this.#served.l2 || this.#ramFlash !== null) {
      this.#timers.push(
        setTimeout(() => {
          this.#served.l1 = null;
          this.#served.l2 = null;
          this.#ramFlash = null;
          this.#paintCaches();
          this.#paintRam();
        }, CACHE_FLASH_SECONDS * 1000),
      );
    }
  }

  // Derives everything the paint needs from the frame; a stale or missing `hw` reads as an idle board.
  #observe(f: HardwareFrame | null, layout: BoardLayout): void {
    const hw = f?.hw ?? null;
    REGISTER_NAMES.forEach((name, i) => {
      const text = registerText(name, f);
      const previous = this.#shown[i];
      this.#shown[i] = text;
      // The first value after mount is not a change.
      this.#regFlash[i] = previous !== undefined && previous !== text && text !== NO_VALUE;
    });
    for (const level of ["l1", "l2"] as const) {
      const count = layout[level].positions.length;
      const cells = placeLines(hw?.[level] ?? [], count);
      this.#occupied[level] = new Uint8Array(count);
      for (const cell of cells) this.#occupied[level][cell] = 1;
      const flash = servedFlash(hw?.servedBy ?? null)[level];
      const cell = cells.at(-1);
      this.#served[level] = flash && cell !== undefined ? { cell, kind: flash } : null;
    }
    this.#ramUsed = f ? ramFill(f.tick) : { stack: 0, young: 0, old: 0 };
    const tag = hw?.l2.at(-1);
    this.#ramFlash = hw?.bus && tag !== undefined && servedFlash(hw.servedBy).ram ? ramCell(hw.bus.region, tag) : null;
    const bus = hw?.bus ?? null;
    if (bus) {
      // A write travels toward RAM; a fetch or read comes back toward the die.
      const path = layout.memoryBus[bus.region];
      this.#bus = { path: travelsTowardRam(bus.kind) ? path : [...path].reverse(), token: busToken(bus.kind) };
    } else this.#bus = null;
    this.#aluOpName = hw?.alu ? aluLabel(hw.alu) : null;
  }

  #paintAll(): void {
    this.#paintRegisters();
    this.#paintAlu();
    this.#paintCaches();
    this.#paintRam();
    this.#paintBus();
  }

  #paintRegisters(): void {
    const tileWidth = this.#layout?.registers[0]?.w ?? 1;
    for (let i = 0; i < 16; i++) {
      setClass(this.#tile[i] ?? null, `${TILE} ${this.#regFlash[i] ? FILL.hit : FILL.idle}`);
      const text = this.#shown[i] ?? NO_VALUE;
      const el = this.#value[i];
      if (!el) continue;
      if (el.textContent !== text) el.textContent = text;
      // A long hex value shrinks to fit its tile; a mono glyph is about 0.6 em wide.
      el.setAttribute("font-size", String(Math.min(VALUE_SIZE, (tileWidth * 0.92) / (Math.max(1, text.length) * 0.6))));
      const base = "font-mono tabular-nums";
      setClass(el, `${base} ${text === NO_VALUE ? "fill-muted-foreground" : "fill-foreground"}`);
    }
  }

  #paintAlu(): void {
    const lit = this.#aluOpName !== null;
    setClass(this.#alu, `${TILE} ${lit ? FILL.hit : FILL.idle}`);
    setClass(this.#aluLabel, `font-mono ${lit ? "fill-primary-foreground" : "fill-muted-foreground"}`);
    setClass(this.#aluOp, `font-mono font-bold ${lit ? "fill-primary-foreground" : "fill-foreground"}`);
    const text = this.#aluOpName ?? "idle";
    if (this.#aluOp && this.#aluOp.textContent !== text) this.#aluOp.textContent = text;
  }

  #paintCaches(): void {
    for (const level of ["l1", "l2"] as const) {
      const served = this.#served[level];
      const occupied = this.#occupied[level];
      this.#cells[level].forEach((el, i) => {
        const fill = served?.cell === i ? FILL[served.kind] : occupied[i] ? FILL.used : FILL.idle;
        setClass(el, `${CELL} ${fill}`);
      });
      // Colour never stands alone: while a cell flashes, "hit" or "miss" is written beside the level's title.
      const cue = this.#cue[level];
      if (!cue) continue;
      if (served) {
        if (cue.textContent !== served.kind) cue.textContent = served.kind;
        setClass(cue, `${CUE} ${served.kind === "hit" ? "fill-primary" : "fill-destructive"}`);
      } else setClass(cue, `${CUE} ${HIDDEN}`);
    }
  }

  #paintRam(): void {
    const cells = this.#cells.ram;
    for (const region of ["code", "stack", "young", "old"] as const) {
      const used = region === "code" ? REGION_CELLS.code : this.#ramUsed[region];
      for (let i = 0; i < REGION_CELLS[region]; i++) {
        const cell = REGION_OFFSET[region] + i;
        const fill = cell === this.#ramFlash ? FILL.miss : i < used ? FILL.used : FILL.idle;
        setClass(cells[cell] ?? null, `${CELL} ${fill}`);
      }
    }
  }

  // The access's bus lights up with an arrowhead at its far end, so direction never rests on colour.
  #paintBus(): void {
    const line = this.#busLine;
    const head = this.#busHead;
    const layout = this.#layout;
    const bus = this.#bus;
    if (!line || !head || !layout) return;
    if (!bus) {
      setClass(line, HIDDEN);
      setClass(head, HIDDEN);
      return;
    }
    const m = mapperFor(layout);
    line.setAttribute("points", bus.path.map(m.point).join(" "));
    setClass(line, `${BUS_LINE} ${BUS_STROKE[bus.token]}`);
    const tip = pointAlong(bus.path, 1);
    const [cos, sin] = [Math.cos(tip.angle), Math.sin(tip.angle)];
    const corner = (back: number, side: number): Vec2 => [tip.x - cos * back - sin * side, tip.y - sin * back + cos * side];
    const points: Vec2[] = [[tip.x, tip.y], corner(ARROW, ARROW / 2), corner(ARROW, -ARROW / 2)];
    head.setAttribute("points", points.map(m.point).join(" "));
    setClass(head, BUS_FILL[bus.token]);
  }
}
