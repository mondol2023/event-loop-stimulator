import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { Completion } from "@/core/interpreter/Completion";
import { ToBoolean, ToInt32, ToNumber, ToString, ToUint32, type SpecRealm } from "./conversions";
import { GreaterThan, GreaterThanOrEqual, IsLooselyEqual, LessThan, LessThanOrEqual } from "./equality";
import {
  Add,
  BitwiseAnd,
  BitwiseNot,
  BitwiseOr,
  BitwiseXor,
  Div,
  Exp,
  Mod,
  Mul,
  Negate,
  ShiftLeft,
  ShiftRight,
  ShiftRightLogical,
  Sub,
} from "./operators";

// The oracle compares generated *data* with the host's operators: the host is the reference for
// IEEE-754 and string semantics (§3.3), and no program text is evaluated. Objects are covered by
// the unit tests; only primitives can be compared against the host here.

type Primitive = undefined | null | boolean | number | string;

const realm: SpecRealm = {
  strings: { charge: () => undefined },
  call: () => {
    throw new Error("primitives never call user code");
  },
  throwTypeError: (message) => ({ type: "throw", value: message }),
};

const NUMBERS = [0, -0, NaN, Infinity, -Infinity, 1, -1, 2 ** 31, 2 ** 32, 0.1, 5e-324, 1.7976931348623157e308];
const NUMERIC_STRINGS = ["", " ", "0", "-0", "1", " 12 ", "0x10", "0b11", "1e3", "Infinity", "-Infinity", "abc", "12px", "1_0"];

const primitive: fc.Arbitrary<Primitive> = fc.oneof(
  fc.constant(undefined),
  fc.constant(null),
  fc.boolean(),
  fc.double({ noDefaultInfinity: false, noNaN: false }),
  fc.constantFrom(...NUMBERS),
  fc.string({ maxLength: 4 }),
  fc.constantFrom(...NUMERIC_STRINGS),
);

const RUNS = { numRuns: 1000 };

function valueOf<T>(c: Completion<T>): T {
  if (c.type !== "normal") throw new Error("unexpected throw completion");
  return c.value;
}

/** Same value, with -0 and NaN distinguished the way `Object.is` does. */
const same = (a: unknown, b: unknown): boolean => Object.is(a, b);

// The host reference runs the real operator on mixed primitives; `n` only silences the static
// type check (the operands really are mixed at run time, which is the point).
const n = (v: Primitive): number => v as number;
type Op = (a: Primitive, b: Primitive) => unknown;
const hostBinary: Record<string, [Op, Op]> = {};
function binary(name: string, ours: Op, host: Op): void {
  hostBinary[name] = [ours, host];
}

binary("Add", (a, b) => valueOf(Add(realm, a, b)), (a, b) => n(a) + n(b));
binary("Sub", (a, b) => valueOf(Sub(realm, a, b)), (a, b) => n(a) - n(b));
binary("Mul", (a, b) => valueOf(Mul(realm, a, b)), (a, b) => n(a) * n(b));
binary("Div", (a, b) => valueOf(Div(realm, a, b)), (a, b) => n(a) / n(b));
binary("Mod", (a, b) => valueOf(Mod(realm, a, b)), (a, b) => n(a) % n(b));
binary("Exp", (a, b) => valueOf(Exp(realm, a, b)), (a, b) => n(a) ** n(b));
binary("BitwiseAnd", (a, b) => valueOf(BitwiseAnd(realm, a, b)), (a, b) => n(a) & n(b));
binary("BitwiseOr", (a, b) => valueOf(BitwiseOr(realm, a, b)), (a, b) => n(a) | n(b));
binary("BitwiseXor", (a, b) => valueOf(BitwiseXor(realm, a, b)), (a, b) => n(a) ^ n(b));
binary("ShiftLeft", (a, b) => valueOf(ShiftLeft(realm, a, b)), (a, b) => n(a) << n(b));
binary("ShiftRight", (a, b) => valueOf(ShiftRight(realm, a, b)), (a, b) => n(a) >> n(b));
binary("ShiftRightLogical", (a, b) => valueOf(ShiftRightLogical(realm, a, b)), (a, b) => n(a) >>> n(b));
binary("IsLooselyEqual", (a, b) => valueOf(IsLooselyEqual(realm, a, b)), (a, b) => (a as unknown) == (b as unknown));
binary("LessThan", (a, b) => valueOf(LessThan(realm, a, b)), (a, b) => n(a) < n(b));
binary("GreaterThan", (a, b) => valueOf(GreaterThan(realm, a, b)), (a, b) => n(a) > n(b));
binary("LessThanOrEqual", (a, b) => valueOf(LessThanOrEqual(realm, a, b)), (a, b) => n(a) <= n(b));
binary("GreaterThanOrEqual", (a, b) => valueOf(GreaterThanOrEqual(realm, a, b)), (a, b) => n(a) >= n(b));

describe("spec operators agree with the host on primitives", () => {
  for (const [name, [ours, host]] of Object.entries(hostBinary)) {
    it(name, () => {
      fc.assert(
        fc.property(primitive, primitive, (a, b) => {
          expect(same(ours(a, b), host(a, b))).toBe(true);
        }),
        RUNS,
      );
    });
  }

  it("Negate and BitwiseNot", () => {
    fc.assert(
      fc.property(primitive, (a) => {
        expect(same(valueOf(Negate(realm, a)), -(a as number))).toBe(true);
        expect(same(valueOf(BitwiseNot(realm, a)), ~(a as number))).toBe(true);
      }),
      RUNS,
    );
  });
});

describe("spec conversions agree with the host on primitives", () => {
  it("ToNumber, ToString, ToBoolean", () => {
    fc.assert(
      fc.property(primitive, (a) => {
        expect(same(valueOf(ToNumber(realm, a)), +(a as number))).toBe(true);
        expect(valueOf(ToString(realm, a))).toBe(`${a as string}`);
        expect(ToBoolean(a)).toBe(!!a);
      }),
      RUNS,
    );
  });

  it("ToInt32 and ToUint32 match the host shifts for every double", () => {
    fc.assert(
      fc.property(fc.double(), (n) => {
        expect(same(ToInt32(n), n | 0)).toBe(true);
        expect(ToUint32(n)).toBe(n >>> 0);
      }),
      RUNS,
    );
  });
});

describe("Exp is bit-exact against Math.pow on random doubles and integer exponents", () => {
  it("agrees", () => {
    fc.assert(
      fc.property(fc.double({ noNaN: false }), fc.oneof(fc.integer({ min: -64, max: 64 }), fc.double()), (base, exponent) => {
        expect(same(valueOf(Exp(realm, base, exponent)), Math.pow(base, exponent))).toBe(true);
      }),
      RUNS,
    );
  });
});
