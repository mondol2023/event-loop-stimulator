import { JSError, errorStack } from "@/core/runtime/builtins/errors";
import { HeapObject } from "@/core/runtime/objects/HeapObject";
import { OrdinaryGetOwnProperty, OrdinaryOwnPropertyKeys } from "@/core/runtime/spec/objectOps";
import { SCRIPT_NAME, type SourcePosition, sourceLine } from "@/core/runtime/stack";
import type { JSValue } from "@/core/runtime/values/JSValue";
import { SimulationHalt } from "@/core/shared/simulationHalt";
import { NODE_VERSION } from "./nodeFrames";

// Node's fatal-exception printer (src/node_errors.cc PrintUncaughtException, GetErrorSource) and
// the unhandled-rejection path of lib/internal/process/promises.js. Shapes no fixture covers
// stop the run (Decision D3) instead of printing guessed text.

export interface ErrorPrintContext {
  /** The program source, for the code frame. */
  readonly source: string;
  /** util.inspect for a thrown object that is not an Error. */
  readonly inspect: (value: JSValue) => string;
}

export interface UncaughtContext extends ErrorPrintContext {
  /** Where the exception was thrown: the code frame's caret. */
  readonly throwPosition: SourcePosition;
}

const FOOTER = `\nNode.js v${NODE_VERSION}\n`;
const TRACE_UNCAUGHT_HINT = "(Use `node --trace-uncaught ...` to show where the exception was thrown)\n";

/** UTF-8 byte length of a code point (a lone surrogate becomes U+FFFD, 3 bytes). */
function utf8Length(codePoint: number): number {
  if (codePoint < 0x80) return 1;
  if (codePoint < 0x800) return 2;
  return codePoint < 0x10000 ? 3 : 4;
}

/**
 * GetErrorSource's underline: one character per UTF-8 *byte* of the line for the first
 * `column - 1` positions (Node indexes the UTF-8 line with a UTF-16 column), a tab kept as a tab.
 */
function underline(line: string, column: number): string {
  const width = column - 1;
  let out = "";
  for (const ch of line) {
    const cp = ch.codePointAt(0) ?? 0;
    const pad = cp === 0x09 ? "\t" : " ";
    for (let b = utf8Length(cp); b > 0 && out.length < width; b--) out += pad;
    if (out.length >= width) break;
  }
  return out;
}

/** `main.cjs:L`, the source line, and the caret line. */
export function codeFrame(source: string, pos: SourcePosition): string {
  const line = sourceLine(source, pos.line);
  return `${SCRIPT_NAME}:${pos.line}\n${line}\n${underline(line, pos.column)}^\n`;
}

/** Node prints an Error with util.inspect, which appends enumerable own properties; that path is not modeled. */
function plainErrorStack(error: JSError): string {
  const extra = OrdinaryOwnPropertyKeys(error).some((k) => OrdinaryGetOwnProperty(error, k)?.enumerable);
  if (extra) throw new SimulationHalt({ kind: "unsupported", reason: "printing an Error with extra own properties" });
  return errorStack(error);
}

/** An exception that reached the top of a callback uncaught. Exit code 1 follows. */
export function printUncaught(error: JSValue, ctx: UncaughtContext): string {
  const frame = codeFrame(ctx.source, ctx.throwPosition);
  if (error instanceof JSError) return `${frame}\n${plainErrorStack(error)}\n${FOOTER}`;
  if (error instanceof HeapObject) return `\n${frame}${ctx.inspect(error)}\n${FOOTER}`;
  return `\n${frame}${String(error)}\n${TRACE_UNCAUGHT_HINT}${FOOTER}`;
}

/**
 * The fatal report for an unhandled rejection (the default `--unhandled-rejections=throw` mode).
 * An Error is printed like an uncaught one, with the caret at its construction position; any
 * other reason is wrapped in ERR_UNHANDLED_REJECTION (fixture unhandled-rejection-non-error).
 */
export function printUnhandledRejection(reason: JSValue, ctx: ErrorPrintContext): string {
  if (reason instanceof JSError) {
    const top = reason.callSites[0];
    if (!top || "native" in top) {
      throw new SimulationHalt({ kind: "unsupported", reason: "a rejected Error constructed outside the script" });
    }
    return `${codeFrame(ctx.source, top.pos)}\n${plainErrorStack(reason)}\n${FOOTER}`;
  }
  if (reason instanceof HeapObject) {
    throw new SimulationHalt({ kind: "unsupported", reason: "an unhandled rejection with a non-Error object reason" });
  }
  return (
    "node:internal/process/promises:392\n" +
    "      new UnhandledPromiseRejection(reason);\n" +
    "      ^\n\n" +
    "UnhandledPromiseRejection: This error originated either by throwing inside of an async function without a " +
    "catch block, or by rejecting a promise which was not handled with .catch(). The promise rejected with the " +
    `reason "${String(reason)}".\n` +
    "    at throwUnhandledRejectionsMode (node:internal/process/promises:392:7)\n" +
    "    at processPromiseRejections (node:internal/process/promises:475:17)\n" +
    "    at process.processTicksAndRejections (node:internal/process/task_queues:106:37) {\n" +
    "  code: 'ERR_UNHANDLED_REJECTION'\n" +
    "}\n" +
    FOOTER
  );
}
