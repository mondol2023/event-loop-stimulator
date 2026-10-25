"use client";

import { useMemo } from "react";
import { useStore } from "zustand";
import { usePlaygroundStore } from "../../store/PlaygroundContext";
import { CodePane } from "./CodePane";
import { paneDoc, paneHeaders } from "./paneDocs";

export function BytecodePane() {
  const views = useStore(usePlaygroundStore(), (s) => s.compile.views);
  const doc = useMemo(() => (views ? paneDoc(views, "bytecode") : ""), [views]);
  const headers = useMemo(() => (views ? paneHeaders(views, "bytecode") : []), [views]);
  return <CodePane pane="bytecode" doc={doc} label="Bytecode" truth="verified-model" headers={headers} />;
}
