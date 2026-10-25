"use client";

import { useMemo } from "react";
import { useStore } from "zustand";
import { usePlaygroundStore } from "../store/PlaygroundContext";
import { type Example, exampleForSource } from "./index";

/** The example whose source the editor holds byte for byte, or null once the text differs at all. */
export function useActiveExample(): Example | null {
  const source = useStore(usePlaygroundStore(), (s) => s.editor.source);
  return useMemo(() => exampleForSource(source), [source]);
}
