import { describe, expect, it } from "vitest";
import { ANON_PERMISSIONS, PERMISSIONS, ROLE_PERMISSIONS, can } from "./permissions";

describe("permissions", () => {
  it("denies admin-only permissions to the user role and grants them to admin", () => {
    expect(can(ROLE_PERMISSIONS.user, "user:ban")).toBe(false);
    expect(can(ROLE_PERMISSIONS.admin, "user:ban")).toBe(true);
  });

  it("grants admin every permission", () => {
    for (const permission of PERMISSIONS) expect(can(ROLE_PERMISSIONS.admin, permission)).toBe(true);
  });

  it("gives the user role compile plus the snippet own-row permissions only", () => {
    expect([...ROLE_PERMISSIONS.user].sort()).toEqual(
      [
        "compile",
        "snippet:create",
        "snippet:update_own",
        "snippet:delete_own",
        "snippet:share",
        "snippet:fork",
      ].sort(),
    );
    expect(can(ROLE_PERMISSIONS.user, "snippet:moderate")).toBe(false);
  });

  it("gives anonymous callers only compile", () => {
    expect(ANON_PERMISSIONS).toEqual(["compile"]);
    expect(can(ANON_PERMISSIONS, "compile")).toBe(true);
    expect(can(ANON_PERMISSIONS, "snippet:create")).toBe(false);
  });

  it("has no duplicate permissions", () => {
    expect(new Set(PERMISSIONS).size).toBe(PERMISSIONS.length);
  });
});
