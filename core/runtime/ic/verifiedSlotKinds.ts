// The slot kinds tests/conformance/internals/ic-states.cjs asserts against real %DebugPrint; any other kind is modeled only.
export const VERIFIED_SLOT_KINDS: ReadonlySet<string> = new Set(["LoadProperty", "LoadKeyed", "SetNamedSloppy"]);
