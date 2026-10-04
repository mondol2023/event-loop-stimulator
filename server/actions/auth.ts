"use server";

import "server-only";
import { redirect } from "next/navigation";
import type { z } from "@/core/shared/zod";
import { changePassword, login, logout, register, type AuthResult } from "@/server/auth/authService";
import { getCurrentUser } from "@/server/auth/dal";
import { getRequestContext } from "@/server/security/requestContext";
import {
  ChangePasswordInput,
  LoginInput,
  RegisterInput,
  type AuthFormState,
} from "@/server/validation/auth";

// This file may only export async Server Actions, so every helper stays private.
// Next's built-in Origin check guards these actions; origin policy lives in proxy.ts.

const GENERIC_FAILURE = "Something went wrong. Please try again.";

/**
 * Reads ONLY the named fields. Next adds its own `$ACTION_*` entries to every
 * form post and a client can add more; none of them may reach the strict
 * schemas (which would reject the lot) or the service. A missing or non-text
 * field becomes "" so it fails validation with the field's own message.
 */
function pick(formData: FormData, keys: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of keys) {
    const value = formData.get(key);
    out[key] = typeof value === "string" ? value : "";
  }
  return out;
}

function fieldErrorsOf(error: z.ZodError): Record<string, string[]> {
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const field = String(issue.path[0] ?? "form");
    (fieldErrors[field] ??= []).push(issue.message);
  }
  return fieldErrors;
}

/** Failure -> form state. Wording is fixed per code; nothing from the input is echoed back. */
function failureState(result: Extract<AuthResult, { ok: false }>): AuthFormState {
  switch (result.code) {
    case "invalid_credentials":
      return { ok: false, message: "Invalid email or password." };
    case "email_taken":
      return { ok: false, message: "An account with that email already exists." };
    case "invalid_current_password":
      return { ok: false, message: "Your current password is incorrect.", fieldErrors: { currentPassword: ["is incorrect"] } };
    case "rate_limited":
      return {
        ok: false,
        message:
          result.retryAfterSec === undefined
            ? "Too many attempts. Please try again later."
            : `Too many attempts. Try again in ${result.retryAfterSec} seconds.`,
      };
    default:
      return { ok: false, message: GENERIC_FAILURE };
  }
}

export async function registerAction(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const parsed = RegisterInput.safeParse(pick(formData, ["email", "password", "displayName"]));
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrorsOf(parsed.error) };

  const result = await register(parsed.data, await getRequestContext());
  if (!result.ok) return failureState(result);
  // redirect() throws: it must stay outside any try/catch.
  redirect("/playground");
}

export async function loginAction(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const parsed = LoginInput.safeParse(pick(formData, ["email", "password"]));
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrorsOf(parsed.error) };

  const result = await login(parsed.data, await getRequestContext());
  if (!result.ok) return failureState(result);
  redirect("/playground");
}

export async function logoutAction(): Promise<void> {
  await logout(await getRequestContext());
  redirect("/");
}

export async function changePasswordAction(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const parsed = ChangePasswordInput.safeParse(pick(formData, ["currentPassword", "newPassword"]));
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrorsOf(parsed.error) };

  const user = await getCurrentUser();
  if (user === null) return { ok: false, message: "You need to sign in to change your password." };

  const result = await changePassword(user, parsed.data, await getRequestContext());
  if (!result.ok) return failureState(result);
  return { ok: true, message: "Password updated. Your other sessions were signed out." };
}
