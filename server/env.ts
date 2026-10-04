import "server-only";
import { z } from "@/core/shared/zod";
import { taintSecret } from "@/server/security/taint";

// Empty strings are common in copied .env files; treat them as "unset" rather
// than as invalid values.
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((v) => (v === "" ? undefined : v), schema.optional());

const EnvSchema = z.object({
  MONGODB_URI: z
    .string()
    .regex(/^mongodb(\+srv)?:\/\//, "must be a mongodb:// or mongodb+srv:// URI"),
  // iron-session requires a ≥32-char password to seal cookies.
  SESSION_SECRET: z.string().min(32, "must be at least 32 characters"),
  REDIS_URL: optional(z.url({ protocol: /^rediss?$/ })),
  ADMIN_BOOTSTRAP_EMAIL: optional(z.email()),
});

export type Env = z.infer<typeof EnvSchema>;

/**
 * Validates raw environment variables. Throws one error that names every
 * invalid key. Values are never echoed, because they may be secrets.
 */
export function parseEnv(raw: Readonly<Record<string, string | undefined>>): Env {
  const result = EnvSchema.safeParse(raw);
  if (!result.success) {
    const problems = result.error.issues.map(
      (issue) => `  - ${issue.path.join(".")}: ${issue.code === "invalid_type" ? "is required" : issue.message}`,
    );
    throw new Error(`Invalid environment configuration:\n${problems.join("\n")}`);
  }
  // Optional keys parsed to `undefined` would break exactOptionalPropertyTypes
  // consumers and `"KEY" in env` checks, so drop them.
  return Object.fromEntries(
    Object.entries(result.data).filter(([, v]) => v !== undefined),
  ) as Env;
}

let cached: Env | undefined;

/**
 * The validated process environment, parsed once (first call fails fast).
 * Secret-bearing values are tainted so React refuses to serialize them to the
 * client (a no-op unless React's experimental taint API is present).
 */
export function getEnv(): Env {
  if (cached === undefined) {
    const env = parseEnv(process.env);
    // Connection strings may embed credentials, so they are treated as secrets too.
    for (const value of [env.SESSION_SECRET, env.MONGODB_URI, env.REDIS_URL]) {
      if (value !== undefined) taintSecret(value);
    }
    cached = env;
  }
  return cached;
}
