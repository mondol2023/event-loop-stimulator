import { describe, expect, it } from "vitest";
import { findBannedApis } from "../../scripts/check-build.mts";

describe("findBannedApis (production-build guard, PROMPT.md §3.4)", () => {
  it.each([
    ['const x = eval("1")', "eval("],
    ["globalThis.eval(src)", "eval("],
    ['require("child_process")', "child_process"],
    ['import("node:child_process")', "child_process"],
    ['require("vm")', "vm"],
    ["import 'node:vm'", "vm"],
    ["new ShadowRealm()", "ShadowRealm"],
  ])("flags %s", (text, api) => {
    expect(findBannedApis([{ path: "chunk.js", text }])).toEqual([{ path: "chunk.js", api }]);
  });

  it.each([
    "retrieval(x)", // identifier merely ending in "eval"
    "const vm = model.vm;", // a variable named vm is not the module
    'const s = "evaluate"',
  ])("does not flag %s", (text) => {
    expect(findBannedApis([{ path: "chunk.js", text }])).toEqual([]);
  });
});
