"use client";

import { MotionConfig } from "motion/react";
import type { ReactNode } from "react";
import { useNonce } from "./useNonce";

/**
 * Motion's configuration for the playground: reduced motion follows the user's setting, and the CSP nonce
 * reaches the `<style>` that `AnimatePresence mode="popLayout"` injects on every exit. Without the nonce the
 * production `style-src 'self' 'nonce-...'` blocks that element (D1).
 */
export function NonceMotionConfig({ children }: { children: ReactNode }) {
  const nonce = useNonce();
  return (
    <MotionConfig reducedMotion="user" {...(nonce ? { nonce } : {})}>
      {children}
    </MotionConfig>
  );
}
