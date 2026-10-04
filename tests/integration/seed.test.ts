import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import mongoose from "mongoose";
import { ROLE_PERMISSIONS } from "@/server/auth/permissions";
import { seed } from "@/server/db/seed";
import { roleRepository } from "@/server/repositories/roleRepository";
import { userRepository } from "@/server/repositories/userRepository";
import { startTestDb } from "./helpers/db";

type TestDb = Awaited<ReturnType<typeof startTestDb>>;
let db: TestDb;

beforeAll(async () => {
  db = await startTestDb();
}, 120_000);

afterAll(async () => {
  await db.stop();
}, 60_000);

beforeEach(async () => {
  await db.reset();
});

const countCollection = (name: string) => mongoose.connection.db!.collection(name).countDocuments();

describe("seed", () => {
  it("is idempotent: running twice leaves exactly two roles", async () => {
    const first = await seed();
    const second = await seed();
    expect(first).toEqual({ rolesUpserted: 2, promotedAdmin: false });
    expect(second).toEqual({ rolesUpserted: 2, promotedAdmin: false });
    expect(await countCollection("roles")).toBe(2);
  });

  it("stores the permissions from ROLE_PERMISSIONS", async () => {
    await seed();
    for (const name of ["user", "admin"] as const) {
      const role = await roleRepository.findByName(name);
      expect([...(role?.permissions ?? [])].sort()).toEqual([...ROLE_PERMISSIONS[name]].sort());
    }
  });

  it("repairs a role whose stored permissions drifted", async () => {
    await roleRepository.upsertAll([{ name: "user", permissions: ["user:ban"] }]);
    await seed();
    const role = await roleRepository.findByName("user");
    expect([...(role?.permissions ?? [])].sort()).toEqual([...ROLE_PERMISSIONS.user].sort());
  });

  it("never creates a user for an unregistered admin email", async () => {
    const result = await seed({ adminEmail: "nobody@example.com" });
    expect(result.promotedAdmin).toBe(false);
    expect(await userRepository.findByEmail("nobody@example.com")).toBeNull();
    expect(await countCollection("users")).toBe(0);
  });

  it("promotes an existing user to admin and bumps sessionVersion", async () => {
    const created = await userRepository.create({ email: "boss@example.com", passwordHash: "h", displayName: "Boss" });
    if (!created.ok) throw new Error("setup: user not created");
    const result = await seed({ adminEmail: "Boss@Example.com" });
    expect(result.promotedAdmin).toBe(true);
    const after = await userRepository.findById(created.user.id);
    expect(after?.role).toBe("admin");
    expect(after?.sessionVersion).toBe(created.user.sessionVersion + 1);
  });

  it("does not bump sessionVersion again when the user is already admin", async () => {
    const created = await userRepository.create({ email: "boss@example.com", passwordHash: "h", displayName: "Boss" });
    if (!created.ok) throw new Error("setup: user not created");
    await seed({ adminEmail: "boss@example.com" });
    const again = await seed({ adminEmail: "boss@example.com" });
    expect(again.promotedAdmin).toBe(false);
    const after = await userRepository.findById(created.user.id);
    expect(after?.sessionVersion).toBe(created.user.sessionVersion + 1);
  });
});
