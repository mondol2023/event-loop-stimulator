// Lives in server/db/ because only the data layer may import models. Deliberately imports NO connection module: Mongoose reads the global
// `strictQuery` when a Schema is constructed, so the config must be applied by
// the models themselves, whatever the import order. Keep this file standalone
// (Vitest isolates files, so mongoose's globals start fresh here).
import { describe, expect, it } from "vitest";
import { AuditLog } from "@/server/db/models/AuditLog";
import { Role } from "@/server/db/models/Role";
import { Setting } from "@/server/db/models/Setting";
import { Snippet } from "@/server/db/models/Snippet";
import { User } from "@/server/db/models/User";

describe("mongoose global config precedes schema construction", () => {
  it.each([
    ["User", User],
    ["Role", Role],
    ["Snippet", Snippet],
    ["AuditLog", AuditLog],
    ["Setting", Setting],
  ])("%s schema has strictQuery: throw", (_name, model) => {
    expect(model.schema.get("strictQuery")).toBe("throw");
  });
});
