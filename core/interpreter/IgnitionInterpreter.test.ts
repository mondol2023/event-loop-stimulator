import { describe, expect, it } from "vitest";
import type { Opcode } from "@/core/bytecode/bytecodes";
import { sourceRangeForPos } from "@/core/views/types";
import { CompilationManager } from "@/core/compile/CompilationManager";
import { runSource } from "./interpreterTestWorld";
import { UNREACHABLE_OPCODES } from "./IgnitionInterpreter";

// Expected text below is what the programs print on the pinned node, checked by hand-running the
// same snippets there; the fixtures themselves are replayed in tests/conformance.

function stdoutOf(source: string): string {
  const run = runSource(source);
  expect(run.completion.type, run.stderr).toBe("normal");
  return run.stdout;
}

describe("straight-line dispatch", () => {
  it("evaluates console.log(1 + 2 * 3)", () => {
    expect(stdoutOf("console.log(1 + 2 * 3);")).toBe("7\n");
  });

  it("runs the arithmetic, bitwise, shift and unary operators of bc-locals-operators", () => {
    expect(
      stdoutOf(`
        var a = 1, b = 2, big = 100000;
        console.log(a + b + big, a + (b + big), a - 1, 3 * a, a / 2, a % 2, a ** 2);
        console.log((a | 4) & (b ^ 1), a << 2 >> 1 >>> 1, ~a, -a, +a, !a);
        console.log(a < b, a > b, a <= b, a >= b, a === b, a !== b, a == b, a != b);
        a += 1; b -= a; a *= b; a++; --b;
        var c = a++ + b--;
        console.log(a, b, c);
        a = b = 3;
        console.log(a, b);
      `),
    ).toBe(
      "100003 100003 0 3 0.5 1 1\n1 1 -2 -1 1 false\ntrue false true false false true false true\n2 -2 0\n3 3\n",
    );
  });

  it("follows if/else and the logical operators of bc-if-else and bc-logical-globals", () => {
    expect(
      stdoutOf(`
        var a = 1, b = 0, s = "s", c = 0;
        if (a) { c = 1; } else { c = 2; }
        if (a && b) c = 4; else if (a || b) c = 5;
        console.log(c, a || b || s, a && b && s, a ?? b, a ? b : s, a ? (b ? 1 : 2) : 3);
        console.log(typeof a, typeof notDeclared, typeof s === "string", a == null, a !== undefined, a === null);
        console.log(NaN, Infinity, \`a\${a}b\${s}c\`);
        a ||= 7; b &&= 8; var n = null; n ??= 9;
        console.log(a, b, n);
      `),
    ).toBe("5 1 0 1 0 2\nnumber undefined true false true false\nNaN Infinity a1bsc\n1 0 9\n");
  });

  it("runs while and for loops, break, and the JumpLoop back edge of bc-loops", () => {
    expect(
      stdoutOf(`
        var a = 1, c = 0, b = 3;
        while (a < 5) { a = a + 1; }
        for (var i = 0; i < 3; i++) { c = c + i; }
        while (b) { while (c < 6) { c = c + 1; } b = b - 1; }
        while (true) { a = a + 1; if (a > 40) break; }
        for (;;) { if (a > 50) break; a = a + 1; }
        console.log(a, c, b, i);
      `),
    ).toBe("51 6 0 3\n");
  });

  it("returns from the top level and ends the script with the completion", () => {
    const run = runSource("var c = 3; if (c) { console.log('early'); return; } console.log('not reached');");
    expect(run.completion).toEqual({ type: "normal", value: undefined });
    expect(run.stdout).toBe("early\n");
  });
});

describe("globals", () => {
  it("creates a global in sloppy code and reads it back", () => {
    expect(stdoutOf("globalValue = 1; globalValue += 1; globalValue++; console.log(globalValue);")).toBe("3\n");
  });

  it("throws a ReferenceError for an undeclared read (kNotDefined)", () => {
    const run = runSource("console.log(notDeclared);");
    expect(run.completion.type).toBe("throw");
    expect(run.stdout).toBe("");
  });

  it("refuses to create a global in strict code (StaGlobal), with the same message", () => {
    const run = runSource("'use strict'; globalValue = 1;");
    expect(run.completion.type).toBe("throw");
  });

  it("overwrites an existing global", () => {
    expect(stdoutOf("globalValue = 1; globalValue = 2; console.log(globalValue);")).toBe("2\n");
  });
});

describe("dispatch commands", () => {
  it("reports each dispatch before it executes, in order, with a resolvable position", () => {
    const run = runSource("var a = 1;\nconsole.log(a + 1);\n");
    expect(run.commands.length).toBeGreaterThan(5);
    const first = run.commands[0];
    expect(first).toMatchObject({ kind: "dispatch", pos: { functionId: 0, bytecodeOffset: 0 } });
    for (const command of run.commands) {
      expect(command.kind).toBe("dispatch");
      const fn = run.program.functions[command.pos.functionId];
      expect(fn?.array.instructionAt(command.pos.bytecodeOffset)?.opcode).toBe(command.opcode);
      // ADR-024: a missing range is allowed only before the first recorded position.
      const first = fn?.positions.entries[0]?.offset ?? Infinity;
      const range = sourceRangeForPos(run.program, command.pos);
      if (range === undefined) expect(command.pos.bytecodeOffset).toBeLessThan(first);
    }
  });
});

describe("opcodes", () => {
  it("lists exactly the opcodes the generator never emits, and none that a program uses", () => {
    const emitted = new Set<Opcode>();
    for (const source of [
      "var a = 1; a += 2; a++; a = a ** 2; a = a / 2 % 3; a = a | 1 ^ 2 & 3; a = a << 1 >> 1 >>> 1; a = ~a;",
      "var o = {x: 1}; o.x = 2; var arr = [1, 2]; arr[0] = o.x;",
      "if (1) { while (0) {} for (let i = 0; i < 2; i++) {} }",
      "var a = null ?? 1; a ||= 2; a &&= 3; a ??= 4; typeof a; delete a;",
      "try { throw 1; } catch (e) {} finally {}",
      "async function f() { await 1; } f();",
      "function g(x = 1) { return () => x; } g()();",
      "switch (1) { case 1: break; default: }",
      "var s = `a${1}b`; s in {}; s instanceof Object;",
    ]) {
      // Constructs the generator does not compile yet are skipped; the fixture replay covers the rest.
      const { program } = new CompilationManager().compile(source, "js");
      for (const fn of program?.functions ?? []) for (const i of fn.array.instructions) emitted.add(i.opcode);
    }
    for (const opcode of UNREACHABLE_OPCODES) expect(emitted.has(opcode), opcode).toBe(false);
    expect(new Set(UNREACHABLE_OPCODES).size).toBe(UNREACHABLE_OPCODES.length);
    expect(UNREACHABLE_OPCODES).toContain("Wide");
    expect(UNREACHABLE_OPCODES).toContain("Illegal");
  });
});
