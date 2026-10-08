import { asFunctionId } from "@/core/shared/ids";
import { describe, expect, it } from "vitest";
import { ConstantPool, formatHeapNumber } from "./ConstantPool";

describe("ConstantPool", () => {
  it("returns indexes in insertion order", () => {
    const pool = new ConstantPool();
    expect(pool.add({ kind: "string", value: "console" })).toBe(0);
    expect(pool.add({ kind: "string", value: "log" })).toBe(1);
    expect(pool.size).toBe(2);
  });

  it("deduplicates equal strings and equal numbers", () => {
    const pool = new ConstantPool();
    const first = pool.add({ kind: "string", value: "log" });
    pool.add({ kind: "string", value: "console" });
    expect(pool.add({ kind: "string", value: "log" })).toBe(first);
    const number = pool.add({ kind: "number", value: 1.5 });
    expect(pool.add({ kind: "number", value: 1.5 })).toBe(number);
    expect(pool.size).toBe(3);
  });

  it("keeps a string and a number with the same text apart", () => {
    const pool = new ConstantPool();
    expect(pool.add({ kind: "string", value: "1.5" })).not.toBe(pool.add({ kind: "number", value: 1.5 }));
  });

  it("does not merge 0 and -0", () => {
    const pool = new ConstantPool();
    expect(pool.add({ kind: "number", value: 0 })).not.toBe(pool.add({ kind: "number", value: -0 }));
  });

  it("does not deduplicate two shared-function-info entries", () => {
    const pool = new ConstantPool();
    const a = pool.add({ kind: "sfi", name: "f", functionId: asFunctionId(1) });
    const b = pool.add({ kind: "sfi", name: "f", functionId: asFunctionId(2) });
    expect(a).not.toBe(b);
    expect(pool.size).toBe(2);
  });

  it("does not deduplicate boilerplates or scope infos", () => {
    const pool = new ConstantPool();
    const boilerplate = { kind: "boilerplate", text: "ObjectBoilerplateDescription[2]" } as const;
    expect(pool.add(boilerplate)).not.toBe(pool.add(boilerplate));
    const scope = { kind: "scope-info", scope: "FUNCTION_SCOPE" } as const;
    expect(pool.add(scope)).not.toBe(pool.add(scope));
  });

  it("prints entries in the recorded normalized form", () => {
    const pool = new ConstantPool();
    pool.add({ kind: "scope-info", scope: "FUNCTION_SCOPE" });
    pool.add({ kind: "sfi", name: "makeCounter", functionId: asFunctionId(1) });
    pool.add({ kind: "sfi", name: "", functionId: asFunctionId(2) });
    pool.add({ kind: "string", value: "console" });
    pool.add({ kind: "number", value: 1.5 });
    pool.add({ kind: "boilerplate", text: "ArrayBoilerplateDescription PACKED_SMI_ELEMENTS, <FixedArray[2]>" });
    expect(pool.printEntries()).toEqual([
      "<ScopeInfo FUNCTION_SCOPE>",
      "<SharedFunctionInfo makeCounter>",
      "<SharedFunctionInfo>",
      "<String[7]: #console>",
      "<HeapNumber 1.5>",
      "<ArrayBoilerplateDescription PACKED_SMI_ELEMENTS, <FixedArray[2]>>",
    ]);
  });

  it("measures a string in UTF-16 code units", () => {
    const pool = new ConstantPool();
    pool.add({ kind: "string", value: "a" });
    expect(pool.printEntries()).toEqual(["<String[1]: #a>"]);
  });

  it("prints a Smi entry (a far jump's distance) as a plain integer and keeps it apart from a number", () => {
    const pool = new ConstantPool();
    expect(pool.add({ kind: "smi", value: 322 })).toBe(0);
    expect(pool.add({ kind: "number", value: 322 })).toBe(1);
    expect(pool.add({ kind: "smi", value: 322 })).toBe(0);
    expect(pool.printEntries()).toEqual(["322", "<HeapNumber 322.0>"]);
  });

  it("reserves an entry per forward jump: 8-bit while the first 256 indexes have room, then 16-bit", () => {
    // ConstantArrayBuilder::CreateReservedEntry takes the smallest index slice with room left.
    const pool = new ConstantPool();
    expect(pool.reserve()).toBe(1);
    for (let i = 0; i < 255; i++) pool.add({ kind: "number", value: i + 0.5 });
    expect(pool.reserve()).toBe(2); // 255 entries and 1 reservation fill the 256 indexes an 8-bit operand reaches
    pool.discard();
    pool.discard();
    expect(pool.reserve()).toBe(1); // 255 entries leave room for exactly one more
  });

  it("commits a reservation as a Smi, sharing an equal one that is already there", () => {
    const pool = new ConstantPool();
    pool.reserve();
    pool.reserve();
    expect(pool.commit(322)).toBe(0);
    expect(pool.commit(322)).toBe(0);
    expect(pool.printEntries()).toEqual(["322"]);
  });

  it("reads an entry back by index", () => {
    const pool = new ConstantPool();
    pool.add({ kind: "string", value: "x" });
    expect(pool.get(0)).toEqual({ kind: "string", value: "x" });
    expect(pool.get(5)).toBeUndefined();
  });
});

describe("formatHeapNumber", () => {
  // Every expectation below is a number V8 printed in a recorded constant pool, or in
  // `node --print-bytecode` on the pinned Node (see the number-to-string fixture).
  it.each([
    [1.5, "1.5"],
    [0.3, "0.3"],
    [0.1, "0.1"],
    [0.75, "0.75"],
    [-3.5, "-3.5"],
    [1 / 3, "0.333333"],
    [2 / 3, "0.666667"],
    [10 / 3, "3.33333"],
    [-10 / 3, "-3.33333"],
    [0.5, "0.5"],
    [1e21, "1e+21"],
    [-1e21, "-1e+21"],
    [1e20, "1e+20"],
    [123456789012345680000, "1.23457e+20"],
    [1e-6, "1e-06"],
    [1e-7, "1e-07"],
    [1.234e-6, "1.234e-06"],
    [5e-324, "4.94066e-324"],
    [Number.MAX_VALUE, "1.79769e+308"],
    [2 ** 64, "1.84467e+19"],
    [100000.5, "100000"],
    [1000000.5, "1e+06"],
    [2147483647.5, "2.14748e+09"],
    [4294967295.5, "4.29497e+09"],
    // Exact ties round to even, as the C library's %g does; the rest from `node --print-bytecode`.
    [100001.5, "100002"],
    [100002.5, "100002"],
    [999999.5, "1e+06"],
    [99999.95, "99999.9"],
    [0.00001, "1e-05"],
    [0.0001, "0.0001"],
    [123456.7, "123457"],
  ])("prints %s as %s", (value, text) => {
    expect(formatHeapNumber(value)).toBe(text);
  });

  it.each([
    [2147483648, "2147483648.0"],
    [4294967296, "4294967296.0"],
    [4294967297, "4294967297.0"],
    [123456789012, "123456789012.0"],
    [1099511627776, "1099511627776.0"],
    [4503599627370496, "4503599627370496.0"],
    [-0, "-0.0"],
  ])("appends .0 to the integer %s: %s", (value, text) => {
    expect(formatHeapNumber(value)).toBe(text);
  });

  it("switches to the exponent form at 2**53", () => {
    expect(formatHeapNumber(2 ** 53)).toBe("9.0072e+15");
  });

  it("prints infinities and NaN like V8", () => {
    expect(formatHeapNumber(Infinity)).toBe("inf");
    expect(formatHeapNumber(-Infinity)).toBe("-inf");
    expect(formatHeapNumber(NaN)).toBe("nan");
  });
});

describe("ConstantPool string printing", () => {
  const printed = (value: string, folded = false): string => {
    const pool = new ConstantPool();
    pool.add(folded ? { kind: "string", value, folded } : { kind: "string", value });
    return pool.printEntries()[0] as string;
  };

  // Every expectation is what the pinned Node printed for a string constant of that text.
  it("escapes control characters and Latin-1 text as V8 prints them", () => {
    expect(printed("tab\there")).toBe("<String[8]: #tab\\x09here>");
    expect(printed("a\nb")).toBe("<String[3]: #a\\nb>");
    expect(printed("é")).toBe("<String[1]: #\\xe9>");
    expect(printed("\0\x01\x7f")).toBe("<String[3]: #\\x00\\x01\\x7f>");
    expect(printed("")).toBe("<String[0]: #>");
  });

  it("marks a two-byte string with u# and escapes every non-ASCII unit with four digits", () => {
    expect(printed("\u{1F600}")).toBe("<String[2]: u#\\xd83d\\xde00>");
    expect(printed("日本")).toBe("<String[2]: u#\\x65e5\\x672c>");
  });

  it("prints a concatenation V8 folded as a quoted cons string", () => {
    expect(printed("xy", true)).toBe('<String[2]: "xy">');
  });

  it("does not deduplicate two folded strings", () => {
    const pool = new ConstantPool();
    const first = pool.add({ kind: "string", value: "xy", folded: true });
    expect(pool.add({ kind: "string", value: "xy", folded: true })).not.toBe(first);
  });

  it("prints a BigInt in decimal", () => {
    const pool = new ConstantPool();
    pool.add({ kind: "bigint", text: "0x10" });
    expect(pool.printEntries()).toEqual(["<BigInt 16>"]);
  });
});
