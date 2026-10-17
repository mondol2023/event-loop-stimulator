// V8 with pointer compression: a Smi is a 31-bit signed integer (src/common/globals.h,
// kSmiValueSize = 31). -0 is a HeapNumber, never a Smi.

const SMI_MIN = -(2 ** 30);
const SMI_MAX = 2 ** 30 - 1;

export function isSmi(n: number): boolean {
  return Number.isInteger(n) && !Object.is(n, -0) && n >= SMI_MIN && n <= SMI_MAX;
}
