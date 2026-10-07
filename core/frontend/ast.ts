import type { Node } from "estree";
import type { SourceRange } from "@/core/shared/diagnostics";

// Small helpers over the ESTree that `parseScript` produces (every node has
// `range: [start, end]`, UTF-16 code units).

const METADATA_KEYS = new Set([
  "type",
  "range",
  "start",
  "end",
  "loc",
  "extra",
  "comments",
  "leadingComments",
  "trailingComments",
  "innerComments",
  "errors",
  "tokens",
]);

export function isNode(value: unknown): value is Node {
  return typeof value === "object" && value !== null && typeof (value as { type?: unknown }).type === "string";
}

/** The `[start, end)` of a node. A node without a range is a programmer error (not user input). */
export function rangeOf(node: Node): SourceRange {
  const range = node.range;
  if (!range) throw new Error(`ESTree node ${node.type} has no range; parse with ranges: true`);
  return { start: range[0], end: range[1] };
}

/** Every direct child node of `node`, in the order the properties were created (source order for Babel). */
export function childNodes(node: Node): Node[] {
  const out: Node[] = [];
  for (const key of Object.keys(node)) {
    if (METADATA_KEYS.has(key)) continue;
    const value = (node as unknown as Record<string, unknown>)[key];
    if (Array.isArray(value)) {
      for (const item of value) if (isNode(item)) out.push(item);
    } else if (isNode(value)) {
      out.push(value);
    }
  }
  return out;
}

/** True when the statements start with a "use strict" directive prologue entry (unescaped spelling only). */
export function hasUseStrictDirective(statements: readonly Node[]): boolean {
  for (const statement of statements) {
    const directive = (statement as { directive?: unknown }).directive;
    if (statement.type !== "ExpressionStatement" || typeof directive !== "string") return false;
    if (directive === "use strict") return true;
  }
  return false;
}
