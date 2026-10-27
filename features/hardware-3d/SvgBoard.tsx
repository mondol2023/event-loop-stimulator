"use client";

import { Cpu, MemoryStick } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MemRegion } from "@/core/hardware/classifyInstruction";
import { useHardwareFrame, type HardwareFrame } from "../playground/hooks/useHardwareFrame";
import { boardLayout, compositionFor, REGION_CELLS, REGION_OFFSET, type BoardLayout, type Composition, type Vec2 } from "./board/layout";
import { useReducedMotionRef } from "./board/reducedMotion";
import { REGISTER_NAMES, roleOf } from "./board/registerRoles";
import { NO_VALUE } from "./board/registerText";
import { BoardPainter } from "./svg/boardPainter";
import { mapperFor, type Mapper } from "./svg/coords";

// The 3D board's sizes in board units, so both boards read alike. Nothing here is a pixel size: the viewBox scales it all.
const MONO_GLYPH = 0.6;
const CUE_OFFSET = 3.1;
const ICON = 0.9;
const REGIONS: readonly MemRegion[] = ["code", "stack", "young", "old"];
const REGION_TITLE: Readonly<Record<MemRegion, string>> = { code: "code", stack: "stack", young: "young gen", old: "old gen" };

const TITLE = "fill-muted-foreground font-mono";
const SURFACE = "fill-card stroke-border";

// Literal class names, so Tailwind generates each token utility.
const FILL_OF = { "muted-foreground": "fill-muted-foreground", "bus-read": "fill-bus-read", "bus-write": "fill-bus-write", primary: "fill-primary", destructive: "fill-destructive" } as const;
const STROKE_OF = { "muted-foreground": "stroke-muted-foreground", "bus-read": "stroke-bus-read", "bus-write": "stroke-bus-write", primary: "stroke-primary", destructive: "stroke-destructive" } as const;

/** Fits `chars` of sans text into `width`, never larger than `size`. */
const fit = (size: number, chars: number, width: number): number => Math.min(size, (width * 0.9) / (Math.max(1, chars) * 0.5));

function Title({ at, m, text, size = 0.5, className = TITLE }: { at: Vec2; m: Mapper; text: string; size?: number; className?: string }) {
  return (
    <text x={m.x(at[0])} y={m.y(at[1])} fontSize={size} textAnchor="middle" dominantBaseline="central" className={className}>
      {text}
    </text>
  );
}

/** A lucide icon beside a centred title; the icon sits just left of the text. */
function IconTitle({ at, m, text, icon: Icon }: { at: Vec2; m: Mapper; text: string; icon: typeof Cpu }) {
  const size = 0.6;
  const half = (text.length * size * MONO_GLYPH) / 2;
  return (
    <>
      <Icon aria-hidden="true" x={m.x(at[0] - half - ICON - 0.2)} y={m.y(at[1]) - ICON / 2} width={ICON} height={ICON} className="stroke-muted-foreground" />
      <Title at={at} m={m} text={text} size={size} />
    </>
  );
}

function Legend({ layout, m }: { layout: BoardLayout; m: Mapper }) {
  const size = 0.45;
  const icon = 0.6;
  const gap = 1.1;
  const items = [
    { text: "fetch", kind: "arrow-left", tone: "muted-foreground" },
    { text: "read", kind: "arrow-left", tone: "bus-read" },
    { text: "write", kind: "arrow-right", tone: "bus-write" },
    { text: "hit", kind: "dot", tone: "primary" },
    { text: "miss", kind: "ring", tone: "destructive" },
  ] as const;
  const widths = items.map((it) => icon + 0.3 + it.text.length * size * MONO_GLYPH);
  const total = widths.reduce((a, b) => a + b, 0) + gap * (items.length - 1);
  let left = layout.labels.legend[0] - total / 2;
  const y = layout.labels.legend[1];
  return (
    <g data-legend="">
      {items.map((it, i) => {
        const x0 = left;
        left += (widths[i] ?? 0) + gap;
        const cy = m.y(y);
        const cx = m.x(x0);
        return (
          <g key={it.text}>
            {it.kind === "arrow-left" ? <polygon points={`${cx},${cy} ${cx + icon},${cy - icon / 2} ${cx + icon},${cy + icon / 2}`} className={FILL_OF[it.tone]} /> : null}
            {it.kind === "arrow-right" ? <polygon points={`${cx + icon},${cy} ${cx},${cy - icon / 2} ${cx},${cy + icon / 2}`} className={FILL_OF[it.tone]} /> : null}
            {it.kind === "dot" ? <circle cx={cx + icon / 2} cy={cy} r={icon / 2.4} className={FILL_OF[it.tone]} /> : null}
            {it.kind === "ring" ? <circle cx={cx + icon / 2} cy={cy} r={icon / 2.4} strokeWidth={0.1} className={`fill-none ${STROKE_OF[it.tone]}`} /> : null}
            <text x={cx + icon + 0.3} y={cy} fontSize={size} dominantBaseline="central" className={TITLE}>
              {it.text}
            </text>
          </g>
        );
      })}
    </g>
  );
}

function Registers({ layout, m }: { layout: BoardLayout; m: Mapper }) {
  return (
    <>
      {layout.registers.map((r, i) => {
        const name = REGISTER_NAMES[i] ?? "";
        const role = roleOf(REGISTER_NAMES[i] ?? "rax");
        const box = m.box(r);
        const cx = m.x(r.x);
        return (
          <g key={name} data-register={name}>
            <rect data-reg-tile={name} {...box} rx={0.12} className="fill-secondary transition-[fill] duration-150 motion-reduce:transition-none" />
            <text x={cx} y={m.y(r.y + r.h * 0.26)} fontSize={0.5} textAnchor="middle" dominantBaseline="central" className="fill-foreground font-mono font-bold">
              {name}
            </text>
            <text x={cx} y={m.y(r.y + r.h * 0.02)} fontSize={fit(0.3, role.length, r.w)} textAnchor="middle" dominantBaseline="central" className="fill-muted-foreground">
              {role}
            </text>
            <text
              data-reg-value={name}
              x={cx}
              y={m.y(r.y - r.h * 0.34)}
              fontSize={0.3}
              textAnchor="middle"
              dominantBaseline="central"
              className="fill-muted-foreground font-mono tabular-nums"
            >
              {NO_VALUE}
            </text>
          </g>
        );
      })}
    </>
  );
}

function CacheLevel({ level, layout, m, title }: { level: "l1" | "l2"; layout: BoardLayout; m: Mapper; title: string }) {
  const grid = layout[level];
  const at = layout.labels[level];
  return (
    <g data-cache={level}>
      {grid.positions.map(([x, y], i) => (
        <rect key={i} data-cell={level} data-i={i} x={m.x(x - grid.cell / 2)} y={m.y(y + grid.cell / 2)} width={grid.cell} height={grid.cell} rx={0.08} className="fill-secondary transition-[fill] duration-300 motion-reduce:transition-none" />
      ))}
      <Title at={at} m={m} text={title} />
      <text data-cue={level} x={m.x(at[0] + CUE_OFFSET)} y={m.y(at[1])} fontSize={0.5} textAnchor="middle" dominantBaseline="central" className="hidden font-mono font-bold" />
    </g>
  );
}

function Ram({ layout, m }: { layout: BoardLayout; m: Mapper }) {
  return (
    <>
      {REGIONS.map((region) => {
        const grid = layout.ram[region];
        return (
          <g key={region} data-region={region}>
            {grid.positions.slice(0, REGION_CELLS[region]).map(([x, y], i) => (
              <rect
                key={i}
                data-cell="ram"
                data-i={REGION_OFFSET[region] + i}
                x={m.x(x - grid.cell / 2)}
                y={m.y(y + grid.cell / 2)}
                width={grid.cell}
                height={grid.cell}
                rx={0.08}
                className="fill-secondary transition-[fill] duration-300 motion-reduce:transition-none"
              />
            ))}
            <Title at={layout.labels.regions[region]} m={m} text={REGION_TITLE[region]} />
          </g>
        );
      })}
    </>
  );
}

function Alu({ layout, m }: { layout: BoardLayout; m: Mapper }) {
  const { alu } = layout;
  const inset = 0.5;
  const top = m.y(alu.y + alu.h / 2);
  const bottom = m.y(alu.y - alu.h / 2);
  const left = m.x(alu.x - alu.w / 2);
  const right = m.x(alu.x + alu.w / 2);
  return (
    <g data-alu="">
      <polygon data-alu-body="" points={`${left + inset},${top} ${right - inset},${top} ${right},${bottom} ${left},${bottom}`} className="fill-secondary transition-[fill] duration-150 motion-reduce:transition-none" />
      <text data-alu-title="" x={m.x(alu.x)} y={m.y(alu.y + alu.h * 0.22)} fontSize={0.4} textAnchor="middle" dominantBaseline="central" className="fill-muted-foreground font-mono">
        ALU
      </text>
      <text data-alu-op="" x={m.x(alu.x)} y={m.y(alu.y - alu.h * 0.1)} fontSize={0.62} textAnchor="middle" dominantBaseline="central" className="fill-foreground font-mono font-bold">
        idle
      </text>
    </g>
  );
}

const preferenceOf = (ref: { readonly current: boolean }): boolean => ref.current;

/**
 * The 2D board: the 3D board's regions, labels and legend in flat SVG, for narrow screens and for browsers without WebGL.
 * React renders it once per composition; each tick reaches it through `BoardPainter`, which edits attributes and text on the elements directly.
 */
export default function SvgBoard() {
  const [painter] = useState(() => new BoardPainter());
  const reduced = useReducedMotionRef();
  const svg = useRef<SVGSVGElement>(null);
  const [composition, setComposition] = useState<Composition>("wide");
  const layout = useMemo(() => boardLayout(composition), [composition]);
  const m = useMemo(() => mapperFor(layout), [layout]);

  const onFrame = useCallback((f: HardwareFrame | null) => painter.apply(f, layout, preferenceOf(reduced)), [painter, layout, reduced]);
  const frame = useHardwareFrame(onFrame);

  // The initial frame, and the same frame again after a composition change moved the elements.
  useEffect(() => {
    if (svg.current) painter.attach(svg.current);
    painter.apply(frame.current, layout, preferenceOf(reduced));
  }, [painter, frame, layout, reduced]);
  useEffect(() => () => painter.dispose(), [painter]);

  // Composition follows the container's aspect, as the 3D board's does; a flip is the only re-render.
  useEffect(() => {
    const el = svg.current;
    if (el === null || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const box = entries.at(-1)?.contentRect;
      if (box && box.width > 0 && box.height > 0) setComposition(compositionFor(box.width / box.height));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const [w, h] = layout.size;
  const die = m.box(layout.die);
  const ram = m.box(layout.ramModule);
  const paths = [...layout.internalBus, ...Object.values(layout.memoryBus)];

  return (
    <svg ref={svg} role="group" aria-label="2D hardware board" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="xMidYMid meet" data-composition={composition} className="h-full w-full">
      <rect {...m.box(layout.substrate)} className="fill-secondary" />
      <rect {...die} rx={0.3} strokeWidth={0.08} className={SURFACE} />
      <rect {...ram} rx={0.3} strokeWidth={0.08} className={SURFACE} />
      <IconTitle at={layout.labels.die} m={m} text="CPU (x86-64)" icon={Cpu} />
      <IconTitle at={layout.labels.ram} m={m} text="RAM" icon={MemoryStick} />
      <g>
        {paths.map((path, i) => (
          <polyline key={i} points={path.map(m.point).join(" ")} strokeWidth={0.16} strokeLinejoin="round" className="fill-none stroke-border" />
        ))}
        <polyline data-bus-line="" strokeWidth={0.24} strokeLinejoin="round" className="hidden" />
        <polygon data-bus-head="" className="hidden" />
      </g>
      <Registers layout={layout} m={m} />
      <Alu layout={layout} m={m} />
      <CacheLevel level="l1" layout={layout} m={m} title="L1 · 8 lines" />
      <CacheLevel level="l2" layout={layout} m={m} title="L2 · 32 lines" />
      <Ram layout={layout} m={m} />
      <Legend layout={layout} m={m} />
    </svg>
  );
}
