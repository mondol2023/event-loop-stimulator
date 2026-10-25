"use client";

import { setNonce } from "get-nonce";
import { createContext, createElement, type ReactNode, useContext } from "react";

const NonceContext = createContext<string | undefined>(undefined);

// createElement keeps this a .ts file; the page passes the per-request nonce from the x-nonce header.
export function NonceProvider({ nonce, children }: { nonce: string | undefined; children: ReactNode }) {
  // Radix Dialog's scroll lock injects a <style> through get-nonce; without this it carries no nonce and the CSP blocks it.
  if (nonce && typeof window !== "undefined") setNonce(nonce);
  return createElement(NonceContext.Provider, { value: nonce }, children);
}

// For injected <style> elements (CodeMirror's EditorView.cspNonce); style attributes are never allowed.
export function useNonce(): string | undefined {
  return useContext(NonceContext);
}
