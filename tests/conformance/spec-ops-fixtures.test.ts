import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isThrow, normal, type Completion } from "@/core/interpreter/Completion";
import { ToBoolean, ToNumber, ToString, type SpecRealm } from "@/core/runtime/spec/conversions";
import { GreaterThanOrEqual, IsLooselyEqual, IsStrictlyEqual, LessThan } from "@/core/runtime/spec/equality";
import { Add, Div, Mul, Sub } from "@/core/runtime/spec/operators";
import type { JSValue } from "@/core/runtime/values/JSValue";

// Unit cases for the spec operations whose expected text is the recorded stdout of real Node
// (loose-equality-coercions, number-to-string). The expected values are read from the
// `*.expected.json`, never retyped.

const FIXTURES = join(__dirname, "fixtures");

function recordedStdout(fixture: string): string[] {
  const e = JSON.parse(readFileSync(join(FIXTURES, `${fixture}.expected.json`), "utf8")) as {
    outcomes: { stdout: string }[];
  };
  const first = e.outcomes[0];
  if (!first) throw new Error(`${fixture} has no recorded outcome`);
  return first.stdout.split("\n");
}

const realm: SpecRealm = {
  strings: { charge: () => undefined },
  call: () => {
    throw new Error("primitives never call user code");
  },
  throwTypeError: (message) => ({ type: "throw", value: message }),
};

function completed(c: Completion): JSValue {
  if (isThrow(c)) throw new Error("unexpected throw");
  return c.value;
}

function show(c: Completion): string {
  return String(completed(c));
}

const bool = (b: boolean): Completion => normal(b);

describe("loose-equality-coercions (primitive lines)", () => {
  const recorded = new Map(
    recordedStdout("loose-equality-coercions")
      .filter((line) => line.includes(" -> "))
      .map((line) => {
        const at = line.indexOf(" -> ");
        return [line.slice(0, at), line.slice(at + 4)] as const;
      }),
  );

  // label -> the operation, with operands written as data. Labels are the fixture's own.
  const cases: Record<string, () => Completion> = {
    "null == undefined": () => IsLooselyEqual(realm, null, undefined),
    "null == 0": () => IsLooselyEqual(realm, null, 0),
    "null >= 0": () => GreaterThanOrEqual(realm, null, 0),
    "undefined == 0": () => IsLooselyEqual(realm, undefined, 0),
    "0 == ''": () => IsLooselyEqual(realm, 0, ""),
    "0 == '0'": () => IsLooselyEqual(realm, 0, "0"),
    "'' == '0'": () => IsLooselyEqual(realm, "", "0"),
    "false == '0'": () => IsLooselyEqual(realm, false, "0"),
    "false == ''": () => IsLooselyEqual(realm, false, ""),
    "true == 1": () => IsLooselyEqual(realm, true, 1),
    "true == '1'": () => IsLooselyEqual(realm, true, "1"),
    "true == 2": () => IsLooselyEqual(realm, true, 2),
    "1 == '1'": () => IsLooselyEqual(realm, 1, "1"),
    "1 === '1'": () => bool(IsStrictlyEqual(1, "1")),
    "NaN == NaN": () => IsLooselyEqual(realm, NaN, NaN),
    "'b' == 'B'": () => IsLooselyEqual(realm, "b", "B"),
    "'10' < '9'": () => LessThan(realm, "10", "9"),
    "'10' < 9": () => LessThan(realm, "10", 9),
    "'a' < 'b'": () => LessThan(realm, "a", "b"),
    "null < 1": () => LessThan(realm, null, 1),
    "undefined < 1": () => LessThan(realm, undefined, 1),
    "'abc' < 1": () => LessThan(realm, "abc", 1),
    "1 + '2'": () => Add(realm, 1, "2"),
    "'3' - 1": () => Sub(realm, "3", 1),
    "'5' * '2'": () => Mul(realm, "5", "2"),
    "true + 1": () => Add(realm, true, 1),
    "null + 1": () => Add(realm, null, 1),
    "undefined + 1": () => Add(realm, undefined, 1),
    "'a' - 1": () => Sub(realm, "a", 1),
    "1 + 2 + '3'": () => {
      const sum = Add(realm, 1, 2);
      return isThrow(sum) ? sum : Add(realm, sum.value, "3");
    },
    "'1' + 2 + 3": () => {
      const sum = Add(realm, "1", 2);
      return isThrow(sum) ? sum : Add(realm, sum.value, 3);
    },
    "+''": () => ToNumber(realm, ""),
    "+' 12 '": () => ToNumber(realm, " 12 "),
    "+'0x10'": () => ToNumber(realm, "0x10"),
    "+'1e3'": () => ToNumber(realm, "1e3"),
    "+'12px'": () => ToNumber(realm, "12px"),
    "+null": () => ToNumber(realm, null),
    "+undefined": () => ToNumber(realm, undefined),
    "+true": () => ToNumber(realm, true),
    "!!''": () => bool(ToBoolean("")),
    "!!'0'": () => bool(ToBoolean("0")),
    "!!NaN": () => bool(ToBoolean(NaN)),
  };

  it.each(Object.keys(cases))("%s", (label) => {
    const expected = recorded.get(label);
    expect(expected, `label "${label}" is not in the recorded stdout`).toBeDefined();
    expect(show((cases[label] as () => Completion)())).toBe(expected);
  });
});

describe("number-to-string (the first eight recorded lines)", () => {
  const lines = recordedStdout("number-to-string");
  const ops: [string, JSValue][] = [
    ["0.1 + 0.2", completed(Add(realm, 0.1, 0.2))],
    ["0.1 * 3", completed(Mul(realm, 0.1, 3))],
    ["1 / 3", completed(Div(realm, 1, 3))],
    ["2 / 3", completed(Div(realm, 2, 3))],
    ["1e21", 1e21],
    ["1e21 - 1e5", completed(Sub(realm, 1e21, 1e5))],
    ["123456789012345680000", 123456789012345680000],
    ["1e20", 1e20],
  ];
  it.each(ops.map(([label, v], i) => [label, v, i] as const))("%s", (_label, value, i) => {
    expect(show(ToString(realm, value))).toBe(lines[i]);
  });
});
