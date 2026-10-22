// Stack traces: CallSite capture at Error construction and V8's frame formatting
// (src/objects/call-site-info.cc, SerializeJSStackFrame / AppendMethodCall).

/** The script name Node reports for the CommonJS entry module. */
export const SCRIPT_NAME = "main.cjs";

/** `Error.stackTraceLimit`'s default: at most 10 frames in total, host-internal frames included. */
export const STACK_TRACE_LIMIT = 10;

/** 1-based line and 1-based UTF-16 column, as V8 prints them. */
export interface SourcePosition {
  readonly line: number;
  readonly column: number;
}

/**
 * One frame of a captured stack. A JS frame keeps what `CallSiteInfo` serializes: the function
 * name, the receiver's type name (its constructor name) and the property the function was called
 * through. `isTopLevel` is V8's IsToplevel: the receiver is undefined, null or the global proxy, so
 * the frame is not printed as a method call. A host-internal frame is its text after `at `.
 */
export type CallSite =
  | {
      readonly functionName: string | null;
      readonly typeName: string | null;
      readonly methodName: string | null;
      readonly isTopLevel: boolean;
      readonly isAsync: boolean;
      /** CallSiteInfo::IsConstructor: the frame is a `new F`. */
      readonly isConstructor?: boolean;
      readonly pos: SourcePosition;
    }
  | { readonly native: string };

/** What `captureStack` reads from the running interpreter and its embedder. */
export interface StackSource {
  /** The JS frames, innermost first. */
  userCallSites(): readonly CallSite[];
  /** The embedder's internal frames below the current entry point (see core/host/nodeFrames). */
  hostTail(): readonly CallSite[];
}

/** `Isolate::CaptureSimpleStackTrace`, cut at `Error.stackTraceLimit`. */
export function captureStack(source: StackSource): CallSite[] {
  return [...source.userCallSites(), ...source.hostTail()].slice(0, STACK_TRACE_LIMIT);
}

/** One stack line without its `    at ` prefix. */
export function formatCallSite(cs: CallSite): string {
  if ("native" in cs) return cs.native;
  const location = `${SCRIPT_NAME}:${cs.pos.line}:${cs.pos.column}`;
  const prefix = cs.isAsync ? "async " : "";
  const functionName = cs.functionName ?? "";
  if (cs.isConstructor) return `${prefix}new ${functionName === "" ? "<anonymous>" : functionName} (${location})`;
  if (!cs.isTopLevel) return `${prefix}${methodCall(cs.typeName, functionName, cs.methodName)} (${location})`;
  if (functionName !== "") return `${prefix}${functionName} (${location})`;
  return `${prefix}${location}`;
}

/** AppendMethodCall: `Type.name [as method]`, or `Type.method` / `Type.<anonymous>` for an anonymous function. */
function methodCall(typeName: string | null, functionName: string, methodName: string | null): string {
  if (functionName === "") return `${typeName ? `${typeName}.` : ""}${methodName ?? "<anonymous>"}`;
  let out = typeName && !functionName.startsWith(`${typeName}.`) ? `${typeName}.${functionName}` : functionName;
  if (methodName && methodName !== functionName && !functionName.endsWith(`.${methodName}`)) {
    out += ` [as ${methodName}]`;
  }
  return out;
}

const LINE_TERMINATOR = /\r\n|[\n\r\u2028\u2029]/g;

/** The line and column of a UTF-16 offset; lines end at every ECMAScript LineTerminatorSequence. */
export function positionOf(source: string, offset: number): SourcePosition {
  let line = 1;
  let lineStart = 0;
  for (const m of source.matchAll(LINE_TERMINATOR)) {
    const end = m.index + m[0].length;
    if (end > offset) break;
    line += 1;
    lineStart = end;
  }
  return { line, column: offset - lineStart + 1 };
}

/** The text of a 1-based line, without its terminator (empty past the end). */
export function sourceLine(source: string, line: number): string {
  return source.split(LINE_TERMINATOR)[line - 1] ?? "";
}
