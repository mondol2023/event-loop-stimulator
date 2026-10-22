// The V8 runtime functions natives mode (Decision D2) compiles `%Name(args)` to, as V8 does under
// --allow-natives-syntax: the probes the `internals` fixtures use. Test-only; no user input can
// enable natives mode.
export const RUNTIME_NATIVES: ReadonlySet<string> = new Set([
  "HaveSameMap",
  "HasFastProperties",
  "HasSmiElements",
  "HasDoubleElements",
  "HasObjectElements",
  "HasHoleyElements",
  "HasDictionaryElements",
  "DebugPrint",
]);
