// r13-relative IsolateData slots, after V8's src/execution/isolate-data.h (BuiltinEntrySlotOffset, root_slot_offset).

import { fnv1a32 } from "./illustrativePointers";
import { mem, type Operand } from "./x64/Encoder";
import { RegisterRoles } from "./x64/registers";

// Illustrative: real offsets depend on the whole IsolateData layout, so a name hash stands in and keeps each slot stable as names are added.
const ILLUSTRATIVE_SLOTS = 2048;

function illustrativeSlot(qualifiedName: string): number {
  return fnv1a32(qualifiedName) % ILLUSTRATIVE_SLOTS;
}

/** `[r13 + IsolateData::BuiltinEntrySlotOffset(Builtin::k<name>)]`, the slot MacroAssembler::EntryFromBuiltinAsOperand reads. */
export function builtinEntry(builtin: string): Operand {
  return mem(RegisterRoles.root, 8 * illustrativeSlot(`Builtin::k${builtin}`));
}

/** `[r13 + root_slot_offset(RootIndex::k<name>)]`, the operand MacroAssembler::RootAsOperand builds. */
export function rootSlot(root: string): Operand {
  return mem(RegisterRoles.root, 8 * illustrativeSlot(`RootIndex::k${root}`));
}

// Illustrative tagged HeapObject pointer (low bit set) for the handle a template embeds, as Constant<T>(i) does in baseline-compiler.cc.
export function constantHandle(functionId: number, index: number): bigint {
  return 0x0000_0800_0000_0001n + (BigInt(functionId) << 24n) + (BigInt(index) << 3n);
}

// Illustrative address for ExternalReference::Create(Runtime::Function), the value MacroAssembler::CallRuntime loads into rbx.
export function runtimeFunctionAddress(runtime: string): bigint {
  return 0x0000_7ff6_0000_0000n + BigInt(illustrativeSlot(`Runtime::k${runtime}`)) * 16n;
}

// Illustrative address for an ExternalReference such as address_of_pending_message, loaded with one movabs.
export function externalReferenceAddress(name: string): bigint {
  return 0x0000_7ff6_2000_0000n + BigInt(illustrativeSlot(`ExternalReference::${name}`)) * 8n;
}
