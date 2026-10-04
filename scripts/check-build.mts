import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Runs after `next build` (PROMPT.md §3.4: "CI also greps the production build").
// The ESLint bans cover our source; this also catches code-execution APIs that
// a dependency pulls into the shipped bundle. Source maps are skipped because
// they quote library source that is never shipped as code.

const BANNED: readonly { readonly api: string; readonly pattern: RegExp }[] = [
  { api: "eval(", pattern: /(?<![\w$])eval\s*\(/ },
  { api: "child_process", pattern: /["'](node:)?child_process["']/ },
  { api: "vm", pattern: /["'](node:)?vm["']/ },
  { api: "ShadowRealm", pattern: /(?<![\w$])ShadowRealm(?![\w$])/ },
];

export type Finding = { readonly path: string; readonly api: string };

export function findBannedApis(files: Iterable<{ readonly path: string; readonly text: string }>): Finding[] {
  const findings: Finding[] = [];
  for (const { path, text } of files) {
    for (const { api, pattern } of BANNED) if (pattern.test(text)) findings.push({ path, api });
  }
  return findings;
}

function* builtFiles(dir: string): Generator<{ path: string; text: string }> {
  for (const entry of readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile() || !/\.(c|m)?js$/.test(entry.name)) continue;
    const path = join(entry.parentPath, entry.name);
    yield { path, text: readFileSync(path, "utf8") };
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const findings = findBannedApis([...builtFiles(".next/static"), ...builtFiles(".next/server")]);
  if (findings.length > 0) {
    console.error("Banned code-execution APIs in the production build:");
    for (const f of findings) console.error(`  - ${f.api} in ${f.path}`);
    process.exit(1);
  }
  console.log("Build check OK: no eval, child_process, vm or ShadowRealm in .next/static or .next/server.");
}
