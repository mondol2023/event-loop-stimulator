"use client";

import { createContext, createElement, type ReactNode, useContext } from "react";

const NonceContext = createContext<string | undefined>(undefined);

// createElement keeps this a .ts file; the page passes the per-request nonce from the x-nonce header.
export function NonceProvider({ nonce, children }: { nonce: string | undefined; children: ReactNode }) {
  return createElement(NonceContext.Provider, { value: nonce }, children);
}

// For injected <style> elements (CodeMirror's EditorView.cspNonce); style attributes are never allowed.
export function useNonce(): string | undefined {
  return useContext(NonceContext);
}
