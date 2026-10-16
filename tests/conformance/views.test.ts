import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CompilationManager } from "@/core/compile/CompilationManager";
import { sourceRangeForPos } from "@/core/views/types";
import { parseExpectation } from "../../scripts/conformance/expectation.mts";

// The views against recorded reality: the bytecode view of a function shows the instruction texts
// V8 printed for it, and both views of a real fixture are pinned by snapshot.

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const read = (name: string): string => readFileSync(join(FIXTURES, name), "utf8");
const manager = new CompilationManager();

function compileFixture(name: string) {
  const result = manager.compile(read(`${name}.cjs`), "js");
  if (!result.views || !result.program || !result.ast) throw new Error(`${name} did not compile: ${JSON.stringify(result.diagnostics)}`);
  return { ...result, views: result.views, program: result.program, ast: result.ast };
}

describe("bytecode view against the recorded listing", () => {
  const expectation = parseExpectation(JSON.parse(read("bc-functions.expected.json")));
  const root = expectation.bytecode;
  if (!root) throw new Error("bc-functions has no recorded bytecode");
  const compiled = compileFixture("bc-functions");

  it("shows `add` with exactly the instruction texts V8 printed", () => {
    const real = Object.values(root.children).find((child) => child.name === "add");
    const ours = compiled.views.bytecode.functions.find((fn) => fn.name === "add");
    expect(real).toBeDefined();
    expect(ours?.lines.map((l) => l.text)).toEqual(real?.instructions.map((i) => i.text));
    expect(ours?.lines.map((l) => l.offset)).toEqual(real?.instructions.map((i) => i.offset));
  });

  it("shows the wrapper's instruction texts too", () => {
    const wrapper = compiled.views.bytecode.functions[0];
    expect(wrapper?.lines.map((l) => l.text)).toEqual(root.instructions.map((i) => i.text));
  });
});

describe("views of nexttick-vs-promise", () => {
  const compiled = compileFixture("nexttick-vs-promise");

  it("the ast view", () => {
    expect(compiled.views.ast.lines.map((l) => `${"  ".repeat(l.depth)}${l.text} [${l.range.start},${l.range.end}] -> ${l.positions.length}`)).toMatchSnapshot();
  });

  it("the bytecode view", () => {
    const text = compiled.views.bytecode.functions.flatMap((fn) => [
      `function ${fn.functionId} ${JSON.stringify(fn.name)} params=${fn.header.parameterCount} registers=${fn.header.registerCount}`,
      ...fn.lines.map((l) => `  ${l.offset} ${l.sourcePosition ? `${l.sourcePosition.kind}>${l.sourcePosition.at} ` : ""}${l.text}`),
      ...fn.constantPool.map((entry, i) => `  pool ${i}: ${entry}`),
    ]);
    expect(text).toMatchSnapshot();
  });

  it("every position V8 records maps back into the source", () => {
    const source = compiled.strippedJs ?? "";
    for (const fn of compiled.program.functions) {
      for (const entry of fn.positions.entries) {
        const range = sourceRangeForPos(compiled.program, { functionId: fn.id, bytecodeOffset: entry.offset });
        expect(range?.start).toBe(entry.position);
        expect(range?.end).toBeLessThanOrEqual(source.length + 1);
      }
    }
  });
});
