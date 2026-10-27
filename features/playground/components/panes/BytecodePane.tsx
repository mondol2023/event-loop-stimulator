"use client";

import { useCallback, useMemo } from "react";
import { useStore } from "zustand";
import type { FunctionId } from "@/core/shared/ids";
import { usePlaygroundStore } from "../../store/PlaygroundContext";
import { CodePane } from "./CodePane";
import { paneDoc, paneHeaders } from "./paneDocs";
import { type SlotLink, slotLinkExtension, slotLinksOf } from "./slotLinks";

export function BytecodePane() {
  const store = usePlaygroundStore();
  const views = useStore(store, (s) => s.compile.views);
  const doc = useMemo(() => (views ? paneDoc(views, "bytecode") : ""), [views]);
  const headers = useMemo(() => (views ? paneHeaders(views, "bytecode") : []), [views]);
  // Opening the V8 Internals tab is the shell's job: it watches focusSlot, so this pane stays unaware of the tabs.
  const select = useCallback((link: SlotLink) => store.getState().focusFeedbackSlot({ functionId: link.functionId as FunctionId, slot: link.slot }), [store]);
  const extension = useMemo(() => slotLinkExtension(views ? slotLinksOf(views.bytecode.functions) : [], select), [views, select]);
  return <CodePane pane="bytecode" doc={doc} label="Bytecode" truth="verified-model" headers={headers} extension={extension} />;
}
