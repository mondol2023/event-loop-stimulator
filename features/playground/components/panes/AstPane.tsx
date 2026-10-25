"use client";

import { useMemo } from "react";
import { useStore } from "zustand";
import { usePlaygroundStore } from "../../store/PlaygroundContext";
import { CodePane } from "./CodePane";
import { paneDoc } from "./paneDocs";

export function AstPane() {
  const views = useStore(usePlaygroundStore(), (s) => s.compile.views);
  const doc = useMemo(() => (views ? paneDoc(views, "ast") : ""), [views]);
  return <CodePane pane="ast" doc={doc} label="AST" truth="exact" />;
}
