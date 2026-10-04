import "server-only";
import * as React from "react";

type TaintUniqueValue = (message: string, lifetime: object, value: string) => void;

/**
 * Marks a secret so React refuses to serialize it into a Client Component or
 * Server Action result. `experimental_taintUniqueValue` only exists in React's
 * experimental channel (Next ships it when `experimental.taint` is on); where
 * it is absent (Vitest, stock React) this is a no-op.
 */
export function taintSecret(value: string): void {
  const taint = (React as unknown as Record<string, unknown>)["experimental_taintUniqueValue"];
  if (typeof taint !== "function" || value === "") return;
  (taint as TaintUniqueValue)("A server secret must not be passed to the client.", globalThis, value);
}
