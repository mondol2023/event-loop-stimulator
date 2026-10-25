"use client";

import { useContext } from "react";
import { PreferencesContext, type PreferencesValue } from "./PreferencesProvider";

/** Throws outside a provider: a missing provider is a programmer error. */
export function usePreferences(): PreferencesValue {
  const value = useContext(PreferencesContext);
  if (!value) throw new Error("usePreferences must be used inside a PreferencesProvider.");
  return value;
}
