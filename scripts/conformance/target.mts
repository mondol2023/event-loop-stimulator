import { readFileSync } from "node:fs";

// docs/TARGET.md is the single place the pinned Node/V8 pair is written down
// (PROMPT.md §3.1). Recording against any other runtime would silently change
// what "real" means, so the recorder refuses to run on a mismatch.

export type Target = { readonly node: string; readonly v8: string };

// A table row such as: | Node.js | `24.19.0` |
const VERSION_ROW = /^\|\s*([^|]+?)\s*\|\s*`([^`]+)`/gm;

export function parseTarget(markdown: string): Target {
  const rows = new Map([...markdown.matchAll(VERSION_ROW)].map((m) => [m[1], m[2]]));
  const version = (component: string) => {
    const v = rows.get(component);
    if (!v) throw new Error(`docs/TARGET.md has no "${component}" version row`);
    return v;
  };
  return { node: version("Node.js"), v8: version("V8") };
}

export function readTarget(): Target {
  return parseTarget(readFileSync(new URL("../../docs/TARGET.md", import.meta.url), "utf8"));
}

/** Returns one problem per mismatched component; empty means this is the pinned runtime. */
export function checkPinnedRuntime(versions: Target, target: Target): string[] {
  const problems: string[] = [];
  if (versions.node !== target.node) problems.push(`Node.js ${versions.node} is not the pinned ${target.node}`);
  if (versions.v8 !== target.v8) problems.push(`V8 ${versions.v8} is not the pinned ${target.v8}`);
  return problems;
}
