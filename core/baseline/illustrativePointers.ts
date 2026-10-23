// The one illustrative pointer scheme: compressed tagged pointers (offsets from the cage base r14), as the machine panes show them.
// Illustrative: real addresses depend on the allocator, so every value is derived from an id or a name and is stable across runs.

import type { FunctionId, ObjectId } from "../shared/ids";

// V8's kHeapObjectTag; a Smi has tag 0 (src/common/globals.h).
const HEAP_OBJECT_TAG = 1n;

/** FNV-1a, 32 bit: a stable stand-in for a layout the model does not have. */
export function fnv1a32(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193) >>> 0;
  }
  return hash;
}

// Pointer compression keeps a 32-bit offset from the cage base, 8-aligned objects, then the tag.
const compressed = (offset: number): bigint => BigInt.asUintN(32, BigInt(offset) | HEAP_OBJECT_TAG);

const READ_ONLY_BASE = 0x0000_1000;
const CODE_BASE = 0x0004_0000;
const OBJECT_BASE = 0x0010_0000;
const CONTEXT_BASE = 0x0020_0000;
const HASHED_BASE = 0x0100_0000;

const ODDBALLS = ["undefined", "null", "true", "false", "the_hole"] as const;
export type OddballName = (typeof ODDBALLS)[number];

/** A read-only-space oddball, as `[r13 + root_slot_offset]` would hold it. */
export const oddballPointer = (name: OddballName): bigint => compressed(READ_ONLY_BASE + ODDBALLS.indexOf(name) * 0x20);

/** The BytecodeArray handle a function's baseline code embeds. */
export const bytecodeArrayPointer = (functionId: FunctionId): bigint => compressed(CODE_BASE + functionId * 0x100);

/** A JS object, from its identity in the modeled heap. */
export const objectPointer = (id: ObjectId): bigint => compressed(OBJECT_BASE + id * 0x40);

/** A Context, from the sequential id the timeline gives it. */
export const contextPointer = (contextId: number): bigint => compressed(CONTEXT_BASE + contextId * 0x40);

/** A value the timeline has no identity for (a string, a HeapNumber, an internal): a pointer hashed from what it holds. */
export const hashedPointer = (kind: string, content: string): bigint => compressed(HASHED_BASE + (fnv1a32(`${kind}:${content}`) & 0xf_ffff) * 8);

// The timeline only reports kind "smi" within isSmi's 31-bit range (-2^30..2^30-1), so no value here needs a HeapNumber.
/** A Smi in a 32-bit compressed register: `value << 1` (31-bit Smis, kSmiTag = 0). */
export const smiWord = (value: number): bigint => BigInt.asUintN(32, BigInt(value) << 1n);
