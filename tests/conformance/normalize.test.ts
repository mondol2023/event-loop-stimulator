import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { normalizeOutput } from "../../scripts/conformance/normalize.mts";

// Fabricated directories: none of these exist, so normalization must work from
// the spelling alone. Real Node prints the script path in several shapes
// depending on the platform and on whether the error is a stack frame, a
// source-line header, or an ESM-style URL.
const WIN = "C:\\Users\\Administrator\\AppData\\Local\\Temp\\sl-real-AbC123";
const POSIX = "/tmp/sl-real-AbC123";

describe("normalizeOutput: script path", () => {
  it("replaces a Windows backslash path", () => {
    const text = `${WIN}\\main.cjs:1\nundefined.x\n    at Object.<anonymous> (${WIN}\\main.cjs:1:11)\n`;
    expect(normalizeOutput(text, { dir: WIN })).toBe("main.cjs:1\nundefined.x\n    at Object.<anonymous> (main.cjs:1:11)\n");
  });

  it("replaces a Windows path written with forward slashes", () => {
    const fwd = WIN.replaceAll("\\", "/");
    expect(normalizeOutput(`at ${fwd}/main.cjs:2:3`, { dir: WIN })).toBe("at main.cjs:2:3");
  });

  it("replaces a file:/// URL for main.cjs and main.cts", () => {
    const url = `file:///${WIN.replaceAll("\\", "/")}`;
    expect(normalizeOutput(`at ${url}/main.cjs:1:1`, { dir: WIN })).toBe("at main.cjs:1:1");
    expect(normalizeOutput(`at ${url}/main.cts:1:1`, { dir: WIN })).toBe("at main.cjs:1:1");
  });

  it("replaces a file:// URL for a POSIX directory", () => {
    expect(normalizeOutput(`at file://${POSIX}/main.cjs:7:9`, { dir: POSIX })).toBe("at main.cjs:7:9");
  });

  it("replaces a POSIX path and a main.cts path", () => {
    expect(normalizeOutput(`${POSIX}/main.cjs:1`, { dir: POSIX })).toBe("main.cjs:1");
    expect(normalizeOutput(`${POSIX}/main.cts:1`, { dir: POSIX })).toBe("main.cjs:1");
  });

  it("accepts a percent-encoded file URL and a lowercase drive letter", () => {
    const spaced = "C:\\Users\\A B\\Temp\\sl-real-x";
    expect(normalizeOutput("at file:///C:/Users/A%20B/Temp/sl-real-x/main.cjs:1:1", { dir: spaced })).toBe(
      "at main.cjs:1:1",
    );
    expect(normalizeOutput("at c:\\Users\\A B\\Temp\\sl-real-x\\main.cjs:1:1", { dir: spaced })).toBe("at main.cjs:1:1");
  });

  it("replaces every occurrence", () => {
    const text = `${WIN}\\main.cjs:1\n  at f (${WIN}\\main.cjs:2:3)\n  at g (${WIN}\\main.cjs:4:5)`;
    expect(normalizeOutput(text, { dir: WIN })).toBe("main.cjs:1\n  at f (main.cjs:2:3)\n  at g (main.cjs:4:5)");
  });

  it("matches the real-path spelling of the directory (8.3 short vs long Windows names)", () => {
    // os.tmpdir() is often an 8.3 short path on Windows (C:\Users\ADMINI~1\...)
    // while Node prints the long, real one. mkdtemp gives a directory that exists
    // so realpath can resolve it; on a machine without short names both spellings
    // coincide and the assertion holds trivially.
    const dir = mkdtempSync(join(tmpdir(), "sl-norm-"));
    try {
      const real = realpathSync.native(dir);
      expect(normalizeOutput(`at ${real}\\main.cjs:1:1`, { dir })).toBe("at main.cjs:1:1");
      expect(normalizeOutput(`at ${real}/main.cjs:1:1`, { dir })).toBe("at main.cjs:1:1");
      expect(normalizeOutput(`at ${dir}\\main.cjs:1:1`, { dir })).toBe("at main.cjs:1:1");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does not touch other paths, other file names or similar prefixes", () => {
    const text = `${WIN}\\other.cjs:1\n${WIN}-2\\main.cjs:1\nC:\\elsewhere\\main.cjs:1\nmain.cjs:1\n${WIN}\\main.cjsx`;
    expect(normalizeOutput(text, { dir: WIN })).toBe(text);
  });
});

describe("normalizeOutput: pid and line endings", () => {
  it("replaces the pid in a process warning", () => {
    expect(normalizeOutput("(node:23248) TimeoutOverflowWarning: x\n(node:7) Warning", { dir: POSIX })).toBe(
      "(node:PID) TimeoutOverflowWarning: x\n(node:PID) Warning",
    );
  });

  it("leaves node: that is not a pid alone", () => {
    expect(normalizeOutput("(node:fs) (node:) node:internal/x", { dir: POSIX })).toBe("(node:fs) (node:) node:internal/x");
  });

  it("converts CRLF to LF and nothing else", () => {
    expect(normalizeOutput("a\r\nb\rc\n  d \r\n", { dir: POSIX })).toBe("a\nb\rc\n  d \n");
  });
});

