import type { Context } from "../objects/Context";
import type { HeapObject } from "../objects/HeapObject";
import type { JSMessageObject } from "../objects/JSMessageObject";
import type { TheHoleValue } from "./TheHole";

/** Primitives are host primitives (only bit-exact operations are borrowed, §3.3). */
export type JSValue = undefined | null | boolean | number | string | HeapObject;

/** What an Ignition register or accumulator may hold: a JS value, the hole, a pushed Context, or a pending message a finally block saved. */
export type RegisterValue = JSValue | TheHoleValue | Context | JSMessageObject;
