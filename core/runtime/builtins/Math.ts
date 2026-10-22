import { type Completion, isThrow, normal } from "@/core/interpreter/Completion";
import type { JSObject } from "../objects/JSObject";
import type { Realm } from "../Realm";
import { ToNumber } from "../spec/conversions";
import type { JSValue } from "../values/JSValue";

// Math.{abs, ceil, floor, max, min, round, sign, sqrt, trunc} (ECMA-262 Math object). Each coerces
// its arguments with ToNumber, then applies the host's IEEE-754 operation, which is bit-exact
// (§3.3) and implements the spec's -0 / NaN rules.

const UNARY: Readonly<Record<string, (x: number) => number>> = {
  abs: Math.abs,
  ceil: Math.ceil,
  floor: Math.floor,
  round: Math.round,
  sign: Math.sign,
  sqrt: Math.sqrt,
  trunc: Math.trunc,
};

/** ToNumber of every argument, in order, before any result is computed (Math.max / Math.min). */
function numbersOf(realm: Realm, args: readonly JSValue[]): Completion<number[]> {
  const numbers: number[] = [];
  for (const arg of args) {
    const n = ToNumber(realm, arg);
    if (isThrow(n)) return n;
    numbers.push(n.value);
  }
  return normal(numbers);
}

export function installMath(realm: Realm, math: JSObject): void {
  for (const [name, op] of Object.entries(UNARY)) {
    realm.defineMethod(math, name, 1, (r, _receiver, args) => {
      const n = ToNumber(r, args[0]);
      return isThrow(n) ? n : normal(op(n.value));
    });
  }
  for (const [name, op] of [["max", Math.max], ["min", Math.min]] as const) {
    realm.defineMethod(math, name, 2, (r, _receiver, args) => {
      const numbers = numbersOf(r, args);
      // A fold, not a spread: `apply` can pass many arguments.
      return isThrow(numbers) ? numbers : normal(numbers.value.reduce((acc, n) => op(acc, n), op()));
    });
  }
}
