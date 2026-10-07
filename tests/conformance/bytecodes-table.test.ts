import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BYTECODES, BYTECODE_COUNT, BYTECODE_TABLE_SOURCE } from "@/core/bytecode/bytecodes";
import { readTarget } from "../../scripts/conformance/target.mts";

// The opcode table is transcribed from V8's bytecodes.h at the pinned tag. The header itself is
// not checked in; support/bytecodes.h.sha256 records the hash of the file that was transcribed,
// its tag and its opcode count, so a re-transcription is visible in review.

const record = readFileSync(new URL("./support/bytecodes.h.sha256", import.meta.url), "utf8");

describe("bytecodes.h record", () => {
  it("names the hash, tag and opcode count the table was transcribed from", () => {
    const [hashLine, tagLine, countLine] = record.trim().split("\n");
    expect(hashLine).toBe(`${BYTECODE_TABLE_SOURCE.sha256}  ${BYTECODE_TABLE_SOURCE.file}`);
    expect(tagLine).toBe(`tag ${BYTECODE_TABLE_SOURCE.tag}`);
    expect(countLine).toBe(`opcodes ${BYTECODE_TABLE_SOURCE.count}`);
  });

  it("is a SHA-256 hash", () => {
    expect(BYTECODE_TABLE_SOURCE.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is for the V8 that docs/TARGET.md pins", () => {
    expect(readTarget().v8.startsWith(BYTECODE_TABLE_SOURCE.tag)).toBe(true);
  });

  it("matches the number of entries in the table", () => {
    expect(Object.keys(BYTECODES)).toHaveLength(BYTECODE_COUNT);
  });
});
