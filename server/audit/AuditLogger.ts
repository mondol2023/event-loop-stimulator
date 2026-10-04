import "server-only";
import { createHash } from "node:crypto";
import type { UserId } from "@/core/shared/ids";
import { auditRepository } from "@/server/repositories/auditRepository";
import { getRequestContext } from "@/server/security/requestContext";

export type AuditEvent =
  | "auth.register"
  | "auth.login"
  | "auth.login_failed"
  | "auth.logout"
  | "auth.password_changed"
  | "rbac.denied"
  | "ratelimit.hit"
  | "csrf.rejected"
  | "compile.rejected"
  | "compile.slow"
  | "sandbox.timeout"
  | "snippet.moderated"
  | "user.role_changed"
  | "user.banned";

export type AuditSeverity = "info" | "warn" | "critical";

export type AuditDetails = Record<string, string | number | boolean | null>;

export type AuditEntry = {
  event: AuditEvent;
  severity: AuditSeverity;
  actorId?: UserId;
  ipHash: string;
  requestId: string;
  details?: AuditDetails;
  codeHash?: string;
};

// Audit rows must never carry user source, credentials or tokens. Any detail
// key that even looks like one is dropped before the entry is queued.
const SENSITIVE_KEY = /code|source|password|secret|token/i;

/** Hex SHA-256: the only thing we ever record about a piece of user source. */
export function hashCode(source: string): string {
  return createHash("sha256").update(source).digest("hex");
}

function sanitizeDetails(details: unknown): AuditDetails | undefined {
  if (typeof details !== "object" || details === null) return undefined;
  const out: AuditDetails = {};
  for (const [key, value] of Object.entries(details)) {
    if (SENSITIVE_KEY.test(key)) continue;
    if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      out[key] = value;
    }
  }
  return out;
}

/** Copies only the known fields, so nothing extra can ride along into the sink. */
function snapshot(entry: AuditEntry): AuditEntry {
  const details = sanitizeDetails(entry.details);
  return {
    event: entry.event,
    severity: entry.severity,
    ipHash: entry.ipHash,
    requestId: entry.requestId,
    ...(entry.actorId === undefined ? {} : { actorId: entry.actorId }),
    ...(details === undefined ? {} : { details }),
    ...(entry.codeHash === undefined ? {} : { codeHash: entry.codeHash }),
  };
}

export type AuditLoggerOptions = {
  sink: (entries: readonly AuditEntry[]) => Promise<void>;
  /** Default 1000. When full, the oldest queued entry is dropped. */
  maxQueue?: number;
  /** Default 250. */
  flushDelayMs?: number;
};

/**
 * A bounded, fire-and-forget audit queue. `log` is synchronous and never
 * throws, so auditing can never fail or slow the request it describes.
 */
export class AuditLogger {
  readonly #sink: AuditLoggerOptions["sink"];
  readonly #maxQueue: number;
  readonly #flushDelayMs: number;
  #queue: AuditEntry[] = [];
  #timer: ReturnType<typeof setTimeout> | undefined;
  #chain: Promise<void> = Promise.resolve();
  #dropped = 0;

  constructor(opts: AuditLoggerOptions) {
    this.#sink = opts.sink;
    this.#maxQueue = Math.max(1, opts.maxQueue ?? 1000);
    this.#flushDelayMs = opts.flushDelayMs ?? 250;
  }

  get dropped(): number {
    return this.#dropped;
  }

  log(entry: AuditEntry): void {
    try {
      const queued = snapshot(entry);
      if (this.#queue.length >= this.#maxQueue) {
        this.#queue.shift();
        this.#dropped += 1;
      }
      this.#queue.push(queued);
      this.#schedule();
    } catch {
      // Malformed input (or a hostile getter): count it, never surface it.
      this.#dropped += 1;
    }
  }

  /** Delivers everything queued so far. Never rejects. Concurrent calls are serialized, preserving order. */
  flush(): Promise<void> {
    if (this.#timer !== undefined) {
      clearTimeout(this.#timer);
      this.#timer = undefined;
    }
    this.#chain = this.#chain.then(() => this.#drain());
    return this.#chain;
  }

  #schedule(): void {
    if (this.#timer !== undefined) return;
    this.#timer = setTimeout(() => {
      this.#timer = undefined;
      void this.flush();
    }, this.#flushDelayMs);
    // Never keep the process (or a test run) alive just to flush audit rows.
    this.#timer.unref();
  }

  async #drain(): Promise<void> {
    if (this.#queue.length === 0) return;
    const batch = this.#queue;
    this.#queue = [];
    try {
      await this.#sink(batch);
    } catch {
      this.#dropped += batch.length;
      // Counts only: entry contents must never reach the console.
      console.error(`audit: sink failed, dropped ${batch.length} entries`);
    }
  }
}

type GlobalWithAudit = typeof globalThis & { __siliconLoopAudit?: AuditLogger };
const globalForAudit = globalThis as GlobalWithAudit;

// One logger per process, even when Next's dev HMR re-evaluates this module.
export const auditLogger: AuditLogger = (globalForAudit.__siliconLoopAudit ??= new AuditLogger({
  sink: (entries) => auditRepository.insertMany(entries),
}));

export type WithAuditOptions<A extends unknown[], R> = {
  event: AuditEvent;
  severity?: AuditSeverity;
  actor?: (o: { args: A; result?: R }) => UserId | undefined;
  details?: (o: { args: A; result?: R; error?: unknown }) => AuditEntry["details"];
  /** Defaults to the process-wide `auditLogger`; injectable for tests. */
  logger?: AuditLogger;
};

/**
 * Wraps an async action so it logs exactly one entry per call, success or
 * failure (a failure is rethrown unchanged). The audit step is best-effort:
 * if building the entry throws, the wrapped call's outcome is unaffected.
 */
export function withAudit<A extends unknown[], R>(
  fn: (...args: A) => Promise<R>,
  opts: WithAuditOptions<A, R>,
): (...args: A) => Promise<R> {
  const record = async (o: { args: A; result?: R; error?: unknown }): Promise<void> => {
    try {
      const logger = opts.logger ?? auditLogger;
      let context: { requestId: string; ipHash: string };
      try {
        context = await getRequestContext();
      } catch {
        // Called outside a request scope (no headers): still record the event.
        context = { requestId: crypto.randomUUID(), ipHash: "unknown" };
      }
      const safe = <T>(read: () => T): T | undefined => {
        try {
          return read();
        } catch {
          return undefined;
        }
      };
      const actorId = opts.actor ? safe(() => opts.actor?.(o)) : undefined;
      const details = opts.details ? safe(() => opts.details?.(o)) : undefined;
      logger.log({
        event: opts.event,
        severity: opts.severity ?? "info",
        ...(actorId === undefined ? {} : { actorId }),
        ipHash: context.ipHash,
        requestId: context.requestId,
        ...(details === undefined ? {} : { details }),
      });
    } catch {
      // Auditing must never change the audited call's outcome.
    }
  };

  return async (...args: A): Promise<R> => {
    let result: R;
    try {
      result = await fn(...args);
    } catch (error) {
      await record({ args, error });
      throw error;
    }
    await record({ args, result });
    return result;
  };
}
