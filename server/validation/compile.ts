import "server-only";
import { z } from "@/core/shared/zod";

/** Source size cap, in UTF-8 bytes (not UTF-16 length). */
export const MAX_CODE_BYTES = 10_240;

/**
 * Request body cap. The code may be 10,240 bytes and JSON escaping can double
 * the newlines, tabs and quotes in it, so the envelope is sized for that worst
 * case (about 20.5 KB) plus a little overhead.
 */
export const MAX_BODY_BYTES = 24 * 1024;

const encoder = new TextEncoder();

// Control characters other than \n \t \r. NUL is among them.
const FORBIDDEN_CONTROL = /(?![\n\t\r])\p{Cc}/u;

export const CompileInput = z
  .object({
    code: z
      .string()
      .refine((code) => encoder.encode(code).length <= MAX_CODE_BYTES, `must be at most ${MAX_CODE_BYTES} bytes`)
      .refine((code) => !FORBIDDEN_CONTROL.test(code), "must not contain NUL or control characters"),
    lang: z.enum(["js", "ts"]),
  })
  .strict();
export type CompileInput = z.infer<typeof CompileInput>;

export type BoundedJson = { ok: true; value: unknown } | { ok: false; status: 400 | 413 };

/**
 * Reads the body stream incrementally and gives up the moment it passes
 * `maxBytes`: neither a missing nor a lying Content-Length is trusted, and the
 * process never buffers more than the cap plus one chunk.
 */
export async function readBoundedJson(request: Request, maxBytes: number): Promise<BoundedJson> {
  const declared = request.headers.get("content-length");
  if (declared !== null && /^\d+$/.test(declared) && Number(declared) > maxBytes) {
    // Honestly too large: refuse without reading anything.
    await request.body?.cancel().catch(() => undefined);
    return { ok: false, status: 413 };
  }
  if (request.body === null) return { ok: false, status: 400 };

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return { ok: false, status: 413 };
      }
      chunks.push(value);
    }
  } catch {
    return { ok: false, status: 400 };
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return { ok: true, value: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown };
  } catch {
    return { ok: false, status: 400 };
  }
}
