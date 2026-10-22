import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { REGISTER_HEADER_SOURCE } from "@/core/baseline/x64/registers";
import { readTarget } from "../../scripts/conformance/target.mts";

// The header is not checked in; support/register-x64.h.sha256 records the hash of the file the roles were read from.
const record = readFileSync(new URL("./support/register-x64.h.sha256", import.meta.url), "utf8");

it("records the hash and tag of the register-x64.h the roles were read from", () => {
  const [hashLine, tagLine] = record.trim().split("\n");
  expect(hashLine).toBe(`${REGISTER_HEADER_SOURCE.sha256}  ${REGISTER_HEADER_SOURCE.file}`);
  expect(tagLine).toBe(`tag ${REGISTER_HEADER_SOURCE.tag}`);
  expect(readTarget().v8.startsWith(REGISTER_HEADER_SOURCE.tag)).toBe(true);
});
