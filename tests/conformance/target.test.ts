import { describe, expect, it } from "vitest";
import { checkPinnedRuntime, parseTarget, readTarget } from "../../scripts/conformance/target.mts";

const TARGET_MD = `# Target

| Component | Version |
|---|---|
| Node.js | \`24.19.0\` |
| V8 | \`13.6.233.17-node.51\` |
`;

describe("parseTarget", () => {
  it("reads the pinned Node and V8 versions from docs/TARGET.md's table", () => {
    expect(parseTarget(TARGET_MD)).toEqual({ node: "24.19.0", v8: "13.6.233.17-node.51" });
  });

  it("throws when a version row is missing, rather than recording against nothing", () => {
    expect(() => parseTarget("| Node.js | `24.19.0` |")).toThrow(/V8/);
    expect(() => parseTarget("| V8 | `13.6.233.17-node.51` |")).toThrow(/Node\.js/);
  });

  it("parses the committed docs/TARGET.md", () => {
    const target = readTarget();
    expect(target.node).toMatch(/^\d+\.\d+\.\d+$/);
    expect(target.v8).toMatch(/^\d+\.\d+\.\d+/);
  });
});

describe("checkPinnedRuntime", () => {
  const target = { node: "24.19.0", v8: "13.6.233.17-node.51" };

  it("accepts the exact pinned pair", () => {
    expect(checkPinnedRuntime({ node: "24.19.0", v8: "13.6.233.17-node.51" }, target)).toEqual([]);
  });

  it("rejects any other Node or V8, naming both versions", () => {
    expect(checkPinnedRuntime({ node: "24.20.0", v8: "13.6.233.17-node.51" }, target)).toEqual([
      "Node.js 24.20.0 is not the pinned 24.19.0",
    ]);
    expect(checkPinnedRuntime({ node: "24.19.0", v8: "13.6.233.18-node.52" }, target)).toEqual([
      "V8 13.6.233.18-node.52 is not the pinned 13.6.233.17-node.51",
    ]);
  });
});
