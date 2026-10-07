import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { type Instruction, instructionSize } from "@/core/bytecode/BytecodeArray";
import {
  BYTECODES,
  CLOSURE,
  CURRENT_CONTEXT,
  THIS,
  type Opcode,
  type Operand,
  type OperandScale,
  type OperandType,
  argument,
  isJump,
  isWithoutExternalSideEffects,
  local,
  requiredScale,
} from "@/core/bytecode/bytecodes";
import { formatInstruction } from "@/core/bytecode/printer";
import { type RealFunctionBytecode, type RealInstruction, parseExpectation } from "../../scripts/conformance/expectation.mts";

// The opcode table, operand sizes, scaling rule and text formatting of core/bytecode, checked
// against every instruction of every recorded fixture: each recorded text is parsed back into
// operands, must print identically, and the recorded offsets must advance by exactly the size
// we compute. Nothing here is a hand-written expectation: it is all from `*.expected.json`.

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

function recorded(): { name: string; bytecode: RealFunctionBytecode }[] {
  const out: { name: string; bytecode: RealFunctionBytecode }[] = [];
  for (const file of readdirSync(FIXTURES).sort()) {
    if (!file.endsWith(".expected.json")) continue;
    const expectation = parseExpectation(JSON.parse(readFileSync(join(FIXTURES, file), "utf8")));
    if (expectation.bytecode) out.push({ name: expectation.fixture, bytecode: expectation.bytecode });
  }
  return out;
}

function* walk(fn: RealFunctionBytecode, path = fn.name || "<anonymous>"): Generator<{ path: string; fn: RealFunctionBytecode }> {
  yield { path, fn };
  for (const [index, child] of Object.entries(fn.children)) yield* walk(child, `${path}/${index}:${child.name || "<anonymous>"}`);
}

function parseRegister(token: string): number {
  if (token === "<this>") return THIS;
  if (token === "<context>") return CURRENT_CONTEXT;
  if (token === "<closure>") return CLOSURE;
  const m = /^([ra])(\d+)$/.exec(token);
  if (!m) throw new Error(`not a register: ${token}`);
  return m[1] === "r" ? local(Number(m[2])) : argument(Number(m[2]));
}

const bracket = (token: string): string => /^\[(.*)\]$/.exec(token)?.[1] ?? "";

function parseOperand(type: OperandType, token: string): Operand {
  switch (type) {
    case "Reg":
    case "RegOut":
    case "RegInOut":
      return parseRegister(token);
    case "Flag8":
    case "Flag16":
      return Number(token.slice(1));
    case "RuntimeId":
    case "IntrinsicId":
      return bracket(token);
    default:
      return Number(bracket(token));
  }
}

/** Reads a recorded text back into an instruction. Jump-table suffixes are cut off and ignored. */
function parseInstruction(real: RealInstruction): { instruction: Instruction; base: string; table: boolean } {
  const table = / \{ .* \}$/.test(real.text);
  const base = real.text.replace(/ \{ .* \}$/, "");
  const m = /^([A-Za-z0-9]+)(?:\.(Wide|ExtraWide))?(?: (.*?))?(?: \(@(\d+)\))?$/.exec(base);
  if (!m) throw new Error(`cannot read ${real.text}`);
  const opcode = m[1] as Opcode;
  if (!(opcode in BYTECODES)) throw new Error(`${opcode} is not in the opcode table (${real.text})`);
  const scale: OperandScale = m[2] === "Wide" ? 2 : m[2] === "ExtraWide" ? 4 : 1;
  const tokens = m[3] === undefined ? [] : m[3].split(", ");

  const operands: Operand[] = [];
  let at = 0;
  const types = BYTECODES[opcode].operands;
  for (let i = 0; i < types.length; i++) {
    const type = types[i] as OperandType;
    const token = tokens[at++] ?? "";
    if (type === "RegList" || type === "RegOutList") {
      const [first = "", last = first] = token.split("-");
      const from = parseRegister(first);
      operands.push(from, from - parseRegister(last) + 1);
      i++; // the RegCount that follows a list
    } else if (type === "RegPair" || type === "RegOutPair" || type === "RegOutTriple") {
      operands.push(parseRegister(token.split("-")[0] ?? ""));
    } else {
      operands.push(parseOperand(type, token));
    }
  }
  const target = m[4] === undefined ? undefined : Number(m[4]);
  const size = instructionSize(opcode, scale);
  const instruction: Instruction =
    target === undefined
      ? { offset: real.offset, opcode, scale, operands, size }
      : { offset: real.offset, opcode, scale, operands, size, jumpTarget: target };
  return { instruction, base, table };
}

describe("recorded listings against core/bytecode", () => {
  const fixtures = recorded();

  it("has recorded bytecode to check", () => {
    expect(fixtures.length).toBeGreaterThan(40);
  });

  it.each(fixtures.map((f) => [f.name, f.bytecode] as const))("%s: every instruction prints, sizes and scales like V8", (_name, bytecode) => {
    for (const { path, fn } of walk(bytecode)) {
      const parsed = fn.instructions.map(parseInstruction);
      parsed.forEach(({ instruction, base, table }, i) => {
        const where = `${path} @${instruction.offset}: ${base}`;
        // Printing: the recorded text is reproduced exactly.
        expect(formatInstruction(instruction), where).toBe(base);
        // Sizing: the next recorded offset is this offset plus the size we compute.
        const next = fn.instructions[i + 1];
        const end = next ? next.offset : fn.header.length;
        expect(instruction.offset + instruction.size, `${where}: size`).toBe(end);
        // Scaling: V8 uses the smallest scale that fits every operand.
        expect(requiredScale(instruction.opcode, instruction.operands), `${where}: scale`).toBe(instruction.scale);
        // Jumps: the target is the offset operand applied from the opcode byte, forward or back.
        if (instruction.jumpTarget !== undefined) {
          const from = instruction.offset + (instruction.scale === 1 ? 0 : 1);
          const delta = instruction.operands[0] as number;
          const expected = instruction.opcode === "JumpLoop" ? from - delta : from + delta;
          expect(instruction.jumpTarget, `${where}: jump target`).toBe(expected);
        }
        if (table) expect(instruction.opcode, where).toMatch(/^Switch/);
      });
    }
  });

  it("puts an expression position only on opcodes that can have external side effects", () => {
    for (const { name, bytecode } of fixtures) {
      for (const { path, fn } of walk(bytecode)) {
        for (const real of fn.instructions) {
          if (real.position?.kind !== "E") continue;
          const { instruction } = parseInstruction(real);
          expect(isWithoutExternalSideEffects(instruction.opcode), `${name} ${path} @${real.offset}: ${real.text}`).toBe(false);
        }
      }
    }
  });

  it("agrees that every recorded jump opcode is a jump", () => {
    for (const { bytecode } of fixtures) {
      for (const { fn } of walk(bytecode)) {
        for (const real of fn.instructions) {
          const { instruction } = parseInstruction(real);
          expect(isJump(instruction.opcode) === (instruction.jumpTarget !== undefined || /^Jump.*Constant$/.test(instruction.opcode))).toBe(true);
        }
      }
    }
  });

  it("derives the frame size from the register count in every recorded function", () => {
    for (const { bytecode } of fixtures) {
      for (const { path, fn } of walk(bytecode)) {
        expect(fn.header.frameSize, path).toBe(fn.header.registerCount * 8);
      }
    }
  });
});
