// Illustrative Smi range: 31-bit signed integers, as V8 builds WITH pointer compression have (src/common/globals.h,
// kSmiValueSize = 31). The pinned Node (24.19.0, V8 13.6) has pointer compression OFF and 32-bit Smis (value << 32), so
// %IsSmi(2**30) is true there and false here. The model keeps 31 bits on purpose (the kOverflow deopt at 2**30).
// -0 is a HeapNumber, never a Smi.

const SMI_MIN = -(2 ** 30);
const SMI_MAX = 2 ** 30 - 1;

export function isSmi(n: number): boolean {
  return Number.isInteger(n) && !Object.is(n, -0) && n >= SMI_MIN && n <= SMI_MAX;
}
