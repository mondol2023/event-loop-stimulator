import type { FrameSnapshot, ValueSnapshot } from "@/core/timeline/Tick";

export type FrameRow = {
  name: "acc" | `r${number}`;
  text: string;
  tag: "Smi" | "HeapObject" | "Oddball" | "internal";
  tagged: string | null;
};

function describe(value: ValueSnapshot, predictFirst: boolean): Omit<FrameRow, "name"> {
  switch (value.kind) {
    case "smi":
      return { text: String(value.value), tag: "Smi", tagged: value.tagged };
    case "heap-number":
      return { text: value.text, tag: "HeapObject", tagged: null };
    // D7: under predict-first the printed text and object contents stay hidden.
    case "string":
      return { text: predictFirst ? '"…"' : JSON.stringify(value.value), tag: "HeapObject", tagged: null };
    case "oddball":
      return { text: value.name, tag: "Oddball", tagged: null };
    case "object":
      return { text: predictFirst ? "{…}" : value.preview, tag: "HeapObject", tagged: null };
    case "internal":
      return { text: value.name, tag: "internal", tagged: null };
    default:
      return value satisfies never;
  }
}

export function frameRows(frame: FrameSnapshot, opts: { predictFirst: boolean }): FrameRow[] {
  return [
    { name: "acc", ...describe(frame.accumulator, opts.predictFirst) },
    ...frame.registers.map((value, n): FrameRow => ({ name: `r${n}`, ...describe(value, opts.predictFirst) })),
  ];
}
