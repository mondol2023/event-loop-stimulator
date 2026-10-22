// r13-relative IsolateData slots, after V8's src/execution/isolate-data.h (BuiltinEntrySlotOffset, root_slot_offset).

import { mem, type Operand } from "./x64/Encoder";
import { RegisterRoles } from "./x64/registers";

// Illustrative: real offsets depend on the whole IsolateData layout, so a name hash stands in and keeps each slot stable as names are added.
const ILLUSTRATIVE_SLOTS = 2048;

function illustrativeSlot(qualifiedName: string): number {
  let hash = 0x811c9dc5; // FNV-1a 32-bit offset basis
  for (let i = 0; i < qualifiedName.length; i++) {
    hash = Math.imul(hash ^ qualifiedName.charCodeAt(i), 0x01000193) >>> 0;
  }
  return hash % ILLUSTRATIVE_SLOTS;
}

/** `[r13 + IsolateData::BuiltinEntrySlotOffset(Builtin::k<name>)]`, the slot MacroAssembler::EntryFromBuiltinAsOperand reads. */
export function builtinEntry(builtin: string): Operand {
  return mem(RegisterRoles.root, 8 * illustrativeSlot(`Builtin::k${builtin}`));
}

/** `[r13 + root_slot_offset(RootIndex::k<name>)]`, the operand MacroAssembler::RootAsOperand builds. */
export function rootSlot(root: string): Operand {
  return mem(RegisterRoles.root, 8 * illustrativeSlot(`RootIndex::k${root}`));
}
