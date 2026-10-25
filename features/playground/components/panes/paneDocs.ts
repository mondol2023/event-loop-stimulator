import type { Pane } from "@/core/views/lineIndex";
import type { ClientViews } from "../../worker/protocol";

// One document per code pane. Line i of the document is line i of LineIndex.panes[pane], so the
// highlight lines the store computes address the document directly. Function headers are not lines:
// they are returned separately and rendered as CodeMirror block widgets.

export type PaneName = Exclude<Pane, "source">;
export type PaneDocOptions = { readonly asmSyntax?: "att" | "intel"; readonly byteFormat?: "hex" | "bin" };

/** A function's heading, shown above document line `line` (0-based; `line === lines.length` means after the last line). */
export type PaneHeader = { readonly line: number; readonly text: string };

// A raw literal ("a\<newline>b") can hold a line break; CodeMirror splits lines on CR, LF, U+2028 and U+2029, which would shift every later line.
const LINE_BREAKS = new Set([10, 13, 0x2028, 0x2029]);
const oneLine = (text: string): string =>
  Array.from(text, (ch) => {
    const code = ch.charCodeAt(0);
    return LINE_BREAKS.has(code) ? `\\u${code.toString(16).padStart(4, "0")}` : ch;
  }).join("");

const hex = (n: number, width: number): string => n.toString(16).padStart(width, "0");

export function paneLines(views: ClientViews, pane: PaneName, opts: PaneDocOptions = {}): string[] {
  return rawLines(views, pane, opts).map(oneLine);
}

function rawLines(views: ClientViews, pane: PaneName, opts: PaneDocOptions): string[] {
  switch (pane) {
    case "ast":
      return views.ast.lines.map((l) => `${"  ".repeat(l.depth)}${l.text}`);
    case "bytecode":
      return views.bytecode.functions.flatMap((fn) => fn.lines.map((l) => `${String(l.offset).padStart(4)}  ${l.text}`));
    case "asm":
      return views.asm.functions.flatMap((fn) => fn.lines.map((l) => `${hex(l.address, 4)}  ${opts.asmSyntax === "intel" ? l.intel : l.text}`));
    case "binary":
      return views.binary.functions.flatMap((fn) => fn.lines.map((l) => `${hex(l.address, 4)}  ${opts.byteFormat === "bin" ? l.bytes.map((b) => b.toString(2).padStart(8, "0")).join(" ") : l.text}`));
  }
}

export function paneDoc(views: ClientViews, pane: PaneName, opts: PaneDocOptions = {}): string {
  return paneLines(views, pane, opts).join("\n");
}

export function paneHeaders(views: ClientViews, pane: PaneName): PaneHeader[] {
  if (pane === "ast") return [];
  const headers: PaneHeader[] = [];
  let line = 0;
  for (const fn of views[pane].functions) {
    let text = fn.name === "" ? "(anonymous)" : fn.name;
    if ("header" in fn) text += `  ·  params ${fn.header.parameterCount}, registers ${fn.header.registerCount}, frame ${fn.header.frameSize} B`;
    if ("unavailable" in fn && fn.unavailable) text += `  ·  unavailable: ${fn.unavailable}`;
    headers.push({ line, text });
    line += fn.lines.length;
  }
  return headers;
}
