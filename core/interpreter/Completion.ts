import type { JSValue } from "@/core/runtime/values/JSValue";

// ECMA-262 Completion Records, reduced to what an interpreter value needs: a JS exception is data
// (`throw`), never a TS throw. `break`/`continue`/`return` are bytecode jumps, not completions.

export type Completion<T = JSValue> =
  | { readonly type: "normal"; readonly value: T }
  | { readonly type: "throw"; readonly value: JSValue };

export function normal<T>(value: T): { readonly type: "normal"; readonly value: T } {
  return { type: "normal", value };
}

export function thrown(value: JSValue): { readonly type: "throw"; readonly value: JSValue } {
  return { type: "throw", value };
}

export function isThrow<T>(c: Completion<T>): c is { readonly type: "throw"; readonly value: JSValue } {
  return c.type === "throw";
}
