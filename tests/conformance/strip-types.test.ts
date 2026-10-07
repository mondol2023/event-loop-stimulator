import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { stripTypes } from "@/core/frontend/strip-types";
import { parseExpectation } from "../../scripts/conformance/expectation.mts";

// The refusal text comes from what real node recorded for the `ts-*-refused`
// fixtures, never from a string typed here.

const ROOT = dirname(fileURLToPath(import.meta.url));

function recordedMessage(fixture: string): string {
  const expected = parseExpectation(
    JSON.parse(readFileSync(join(ROOT, "fixtures", `${fixture}.expected.json`), "utf8")),
  );
  const stderr = expected.outcomes[0]?.stderr ?? "";
  const m = /SyntaxError \[ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX\]: (.+)/.exec(stderr);
  if (!m?.[1]) throw new Error(`no ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX line in ${fixture}.expected.json`);
  return m[1];
}

describe("stripTypes against the recorded real-node refusals", () => {
  for (const fixture of ["ts-enum-refused", "ts-namespace-refused", "ts-param-props-refused"]) {
    it(`${fixture}: our message is node's message`, () => {
      const source = readFileSync(join(ROOT, "fixtures", `${fixture}.cts`), "utf8");
      const r = stripTypes(source);
      expect(r.ok).toBe(false);
      if (!r.ok) {
        // Node stops at the first refused construct; we report every one (the
        // param-props fixture has two), so only the first is compared to node.
        expect(r.error.length).toBeGreaterThanOrEqual(1);
        expect(r.error[0]?.code).toBe("E_TS_UNSUPPORTED");
        expect(r.error[0]?.message).toBe(recordedMessage(fixture));
      }
    });
  }

  it("ts-strip-basic strips cleanly", () => {
    const source = readFileSync(join(ROOT, "fixtures", "ts-strip-basic.cts"), "utf8");
    const r = stripTypes(source);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.length).toBe(source.length);
  });
});
