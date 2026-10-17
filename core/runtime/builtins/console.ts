import type { JSValue } from "../values/JSValue";
import { formatWithOptions } from "./formatWithOptions";
import type { InspectRealm } from "./inspect";

// console.log, console.error and console.warn (lib/internal/console/constructor.js kWriteToConsole,
// Node 24.19.0): `formatWithOptions(inspectOptions, ...args) + '\n'` written to stdout for log and
// to stderr for error and warn. Installing the console object on the global is the realm's job.

export type ConsoleStream = "stdout" | "stderr";
export type ConsoleMethod = "log" | "error" | "warn";

export interface ConsoleHost {
  write(stream: ConsoleStream, text: string): void;
}

export interface ConsoleRealm extends InspectRealm {
  readonly host: ConsoleHost;
}

const STREAM: Readonly<Record<ConsoleMethod, ConsoleStream>> = { log: "stdout", error: "stderr", warn: "stderr" };

export function consoleMethod(realm: ConsoleRealm, method: ConsoleMethod, args: readonly JSValue[]): void {
  realm.host.write(STREAM[method], `${formatWithOptions(realm, args)}\n`);
}
