import { describe, expect, it } from "vitest";
import { Encoder, labelRef, mem, reg } from "./Encoder";

function bytesOf(build: (e: Encoder) => void): number[] {
  const e = new Encoder();
  build(e);
  const r = e.assemble();
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  return [...r.value.bytes];
}

describe("x64 encoder goldens (Intel SDM)", () => {
  it("encodes push %rbp as 55", () => {
    expect(bytesOf((e) => e.emit("push", reg("rbp")))).toEqual([0x55]);
  });
  it("encodes mov %rsp,%rbp as 48 89 e5", () => {
    expect(bytesOf((e) => e.emit("mov", reg("rbp"), reg("rsp")))).toEqual([0x48, 0x89, 0xe5]);
  });
  it("encodes pop %rbp as 5d", () => {
    expect(bytesOf((e) => e.emit("pop", reg("rbp")))).toEqual([0x5d]);
  });
  it("encodes ret as c3", () => {
    expect(bytesOf((e) => e.emit("ret"))).toEqual([0xc3]);
  });
});

describe("branch relaxation", () => {
  it("widens a jmp from rel8 to rel32 once the target is out of range", () => {
    const e = new Encoder();
    const far = e.label("far");
    e.emit("jmp", labelRef(far));
    for (let i = 0; i < 200; i++) e.emit("ret");
    e.bind(far);
    e.emit("ret");
    const r = e.assemble();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // E9 rel32 where rel32 = 200 (the ret bytes between the jmp and its target).
    expect([...r.value.bytes.slice(0, 5)]).toEqual([0xe9, 200, 0, 0, 0]);
    expect(r.value.instructions[0]).toMatchObject({ offset: 0, length: 5 });
    expect(r.value.instructions[1]).toMatchObject({ offset: 5, length: 1 });
  });
});

describe("unknown forms", () => {
  it("returns an error for a mnemonic/operand combination outside the table", () => {
    const e = new Encoder();
    e.emit("mov", mem("rbp", -8), mem("rbp", -16));
    const r = e.assemble();
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error[0]?.code).toBe("E_UNKNOWN_FORM");
  });
});
