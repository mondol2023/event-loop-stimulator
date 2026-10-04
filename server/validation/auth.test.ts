import { describe, expect, it } from "vitest";
import { ChangePasswordInput, LoginInput, RegisterInput } from "./auth";

const ok = { email: "alice@x.com", password: "p".repeat(12), displayName: "Alice" };

describe("RegisterInput", () => {
  it("trims and lowercases the email", () => {
    const r = RegisterInput.safeParse({ ...ok, email: "  Alice@X.COM " });
    expect(r.success && r.data.email).toBe("alice@x.com");
  });

  it("rejects an invalid or over-long email", () => {
    expect(RegisterInput.safeParse({ ...ok, email: "nope" }).success).toBe(false);
    expect(RegisterInput.safeParse({ ...ok, email: `${"a".repeat(250)}@x.com` }).success).toBe(false);
  });

  it("enforces password length 12..128", () => {
    expect(RegisterInput.safeParse({ ...ok, password: "p".repeat(11) }).success).toBe(false);
    expect(RegisterInput.safeParse({ ...ok, password: "p".repeat(12) }).success).toBe(true);
    expect(RegisterInput.safeParse({ ...ok, password: "p".repeat(128) }).success).toBe(true);
    expect(RegisterInput.safeParse({ ...ok, password: "p".repeat(129) }).success).toBe(false);
  });

  it("does not trim the password", () => {
    const r = RegisterInput.safeParse({ ...ok, password: `  ${"p".repeat(10)}  ` });
    expect(r.success && r.data.password).toBe(`  ${"p".repeat(10)}  `);
  });

  it("rejects operator objects where a string is expected", () => {
    expect(RegisterInput.safeParse({ ...ok, email: { $ne: null } }).success).toBe(false);
    expect(LoginInput.safeParse({ email: { $ne: null }, password: { $ne: null } }).success).toBe(false);
  });

  it("rejects unknown keys (.strict())", () => {
    expect(RegisterInput.safeParse({ ...ok, role: "admin" }).success).toBe(false);
    expect(LoginInput.safeParse({ email: ok.email, password: ok.password, extra: 1 }).success).toBe(false);
    expect(ChangePasswordInput.safeParse({ currentPassword: ok.password, newPassword: ok.password, x: 1 }).success).toBe(false);
  });

  it("validates displayName: trimmed, 1..50, no control chars", () => {
    expect(RegisterInput.safeParse({ ...ok, displayName: "Al\u0000ice" }).success).toBe(false);
    expect(RegisterInput.safeParse({ ...ok, displayName: "Al\nice" }).success).toBe(false);
    expect(RegisterInput.safeParse({ ...ok, displayName: "   " }).success).toBe(false);
    expect(RegisterInput.safeParse({ ...ok, displayName: "a".repeat(51) }).success).toBe(false);
    const r = RegisterInput.safeParse({ ...ok, displayName: "  Ünï Çödé  " });
    expect(r.success && r.data.displayName).toBe("Ünï Çödé");
  });
});

describe("LoginInput", () => {
  it("normalizes the email but does not length-check the password beyond a sane bound", () => {
    const r = LoginInput.safeParse({ email: " A@B.co ", password: "short" });
    // Login must not leak the registration policy, but must still bound input size.
    expect(r.success && r.data.email).toBe("a@b.co");
    expect(LoginInput.safeParse({ email: "a@b.co", password: "p".repeat(129) }).success).toBe(false);
    expect(LoginInput.safeParse({ email: "a@b.co", password: "" }).success).toBe(false);
  });
});

describe("ChangePasswordInput", () => {
  it("applies the 12..128 rule to the new password only", () => {
    expect(ChangePasswordInput.safeParse({ currentPassword: "old", newPassword: "p".repeat(12) }).success).toBe(true);
    expect(ChangePasswordInput.safeParse({ currentPassword: "old", newPassword: "p".repeat(11) }).success).toBe(false);
  });
});
