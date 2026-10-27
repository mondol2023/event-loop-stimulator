import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { VERIFIED_SLOT_KINDS } from "@/core/runtime/ic/verifiedSlotKinds";

describe("VERIFIED_SLOT_KINDS", () => {
  const recorded = JSON.parse(readFileSync(join(process.cwd(), "tests/conformance/internals/ic-states.expected.json"), "utf8")) as {
    outcomes: { stdout: string }[];
  };
  const stdout = recorded.outcomes[0]?.stdout ?? "";

  it("lists only kinds that real %DebugPrint recorded", () => {
    expect(VERIFIED_SLOT_KINDS.size).toBeGreaterThan(0);
    for (const kind of VERIFIED_SLOT_KINDS) expect(stdout).toMatch(new RegExp(`^slot #\\d+ ${kind} `, "m"));
  });

  it("lists every kind the recording shows", () => {
    const shown = new Set([...stdout.matchAll(/^slot #\d+ (\w+) /gm)].map((m) => m[1]));
    expect(new Set(VERIFIED_SLOT_KINDS)).toEqual(shown);
  });
});
