import { useEffect, useRef } from "react";

/** The user's reduced-motion preference in a ref, so reading it per frame never re-renders. */
export function useReducedMotionRef(): { readonly current: boolean } {
  const ref = useRef(false);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    ref.current = query.matches;
    const onChange = (e: MediaQueryListEvent) => {
      ref.current = e.matches;
    };
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return ref;
}
