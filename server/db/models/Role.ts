import "server-only";
import "../mongooseConfig";
import { type InferSchemaType, type Model, model, models, Schema } from "mongoose";

const roleSchema = new Schema({
  name: { type: String, required: true, unique: true },
  permissions: { type: [String], default: [] },
});

export type RoleDoc = InferSchemaType<typeof roleSchema>;

export const Role = (models["Role"] as Model<RoleDoc> | undefined) ?? model<RoleDoc>("Role", roleSchema);
