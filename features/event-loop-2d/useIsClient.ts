import { useSyncExternalStore } from "react";

const subscribe = (): (() => void) => () => {};

/**
 * False on the server and during hydration, true afterwards. Motion sets inline styles, which the
 * nonce CSP blocks in server-rendered HTML (D1), so every Motion element renders only once this is true.
 */
export function useIsClient(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}
