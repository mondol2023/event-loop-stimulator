import type { Context } from "../objects/Context";
import type { HeapObject } from "../objects/HeapObject";
import type { TheHoleValue } from "./TheHole";

/** Primitives are host primitives (only bit-exact operations are borrowed, §3.3). */
export type JSValue = undefined | null | boolean | number | string | HeapObject;

/** What an Ignition register or accumulator may hold: a JS value, the hole, or a pushed Context. */
export type RegisterValue = JSValue | TheHoleValue | Context;
