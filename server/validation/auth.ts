import "server-only";
import { z } from "@/core/shared/zod";

// Every schema is `.strict()`: unknown keys (`role`, `status`, ...) are rejected
// rather than silently dropped, so a form can never smuggle in a privileged field.
// Every field is a `z.string()`, so an operator object like `{ $ne: null }` fails
// on type before it can get anywhere near a query.

const email = z.string().trim().toLowerCase().max(254).pipe(z.email());

/** The policy for a password being chosen. */
const newPassword = z.string().min(12, "must be at least 12 characters").max(128, "must be at most 128 characters");

/**
 * A password being presented (login, "current password"). Only bounded, never
 * policy-checked, so the sign-in form cannot be used to probe the policy and a
 * future policy change cannot lock out existing users. Not trimmed.
 */
const presentedPassword = z.string().min(1, "is required").max(128, "must be at most 128 characters");

const displayName = z
  .string()
  .trim()
  .min(1, "is required")
  .max(50, "must be at most 50 characters")
  .regex(/^[^\p{Cc}]*$/u, "must not contain control characters");

export const RegisterInput = z.object({ email, password: newPassword, displayName }).strict();
export type RegisterInput = z.infer<typeof RegisterInput>;

export const LoginInput = z.object({ email, password: presentedPassword }).strict();
export type LoginInput = z.infer<typeof LoginInput>;

export const ChangePasswordInput = z
  .object({ currentPassword: presentedPassword, newPassword })
  .strict();
export type ChangePasswordInput = z.infer<typeof ChangePasswordInput>;

/** What a form-bound Server Action returns to `useActionState`. */
export type AuthFormState = {
  ok: boolean;
  message?: string;
  fieldErrors?: Record<string, string[]>;
};
