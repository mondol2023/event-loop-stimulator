import type { Node } from "estree";

// Source positions the way V8's parser assigns them, read off the text and the ESTree ranges.

/** Where V8 says an expression starts: a parenthesized expression starts at its `(`. */
export function startOf(node: Node): number {
  const extra = (node as { extra?: { parenthesized?: boolean; parenStart?: number } }).extra;
  if (extra?.parenthesized && typeof extra.parenStart === "number") return extra.parenStart;
  return node.range?.[0] ?? 0;
}

/** The end of a node's range, excluding any parentheses around it. */
export function endOf(node: Node): number {
  return node.range?.[1] ?? 0;
}

/**
 * The first token after `from`, skipping whitespace, comments and the `)` that close a
 * parenthesized left operand: for `(a) + b` with `from` at the end of `a`, the `+`.
 */
export function operatorPosition(source: string, from: number): number {
  let i = from;
  while (i < source.length) {
    const c = source[i];
    if (c === " " || c === "\t" || c === "\n" || c === "\r" || c === ")" || c === " " || c === " " || c === "\v" || c === "\f" || c === " " || c === "﻿") {
      i++;
    } else if (c === "/" && source[i + 1] === "/") {
      while (i < source.length && source[i] !== "\n" && source[i] !== "\r") i++;
    } else if (c === "/" && source[i + 1] === "*") {
      const close = source.indexOf("*/", i + 2);
      i = close < 0 ? source.length : close + 2;
    } else {
      break;
    }
  }
  return i;
}
