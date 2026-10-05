import { realpathSync } from "node:fs";

// Real Node output is compared byte-for-byte against our model's, so the only
// machine-dependent text in it is rewritten here, and nothing else (docs/TARGET.md:
// "Error output is normalized in one way only: the script path becomes main.cjs",
// plus the process id Node prints in every process warning, and CRLF).

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// One path segment: literal, or percent-encoded as it appears in a file: URL.
// A drive letter matches in either case (Windows paths are case-insensitive).
function segmentPattern(segment: string): string {
  if (/^[A-Za-z]:$/.test(segment)) return `[${segment[0]!.toLowerCase()}${segment[0]!.toUpperCase()}]:`;
  const literal = escapeRegExp(segment);
  const encoded = escapeRegExp(encodeURIComponent(segment));
  return encoded === literal ? literal : `(?:${literal}|${encoded})`;
}

// Every separator spelling matches every other: `\` and `/` are interchangeable
// on Windows, and a file: URL always uses `/`.
function directoryPattern(dir: string): string {
  return dir.split(/[\\/]+/).map(segmentPattern).join("[\\\\/]+");
}

// The directory as the caller wrote it, plus the spellings the OS may report
// for it: realpath resolves symlinks, and the native variant expands Windows
// 8.3 short names (C:\Users\ADMINI~1) to the long names Node prints.
function directorySpellings(dir: string): string[] {
  const spellings = new Set([dir]);
  for (const resolve of [realpathSync, realpathSync.native]) {
    try {
      spellings.add(resolve(dir));
    } catch {
      // The directory is gone or fabricated (unit tests): the spelling given is all there is.
    }
  }
  return [...spellings];
}

export function normalizeOutput(text: string, ctx: { dir: string }): string {
  return normalizeWithSpellings(text, directorySpellings(ctx.dir));
}

/** The same normalization for an explicit set of directory spellings (exported so tests can fabricate real-path aliases). */
export function normalizeWithSpellings(text: string, spellings: readonly string[]): string {
  let out = text;
  for (const dir of [...spellings].sort((a, b) => b.length - a.length)) {
    const pattern = directoryPattern(dir);
    // file:///C:/dir/main.cts (Windows) and file:///tmp/dir/main.cts (POSIX, where the
    // pattern itself starts at the third slash) are both covered by an optional slash.
    // Longest spelling first (above) plus a left boundary: a short spelling can be the tail of a
    // longer one (macOS /var/... vs /private/var/...) and must not match inside it.
    const script = new RegExp(`(?<![A-Za-z0-9_.~-])(?:file:///?)?${pattern}[\\\\/]main\\.c[jt]s(?![A-Za-z0-9_])`, "g");
    out = out.replace(script, "main.cjs");
  }
  return out.replace(/\(node:\d+\)/g, "(node:PID)").replace(/\r\n/g, "\n");
}
