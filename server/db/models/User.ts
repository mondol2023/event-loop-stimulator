import "server-only";
import { type InferSchemaType, type Model, model, models, Schema } from "mongoose";

const userSchema = new Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    displayName: { type: String, required: true, trim: true },
    role: { type: String, enum: ["user", "admin"], default: "user", required: true },
    status: { type: String, enum: ["active", "banned"], default: "active", required: true },
    sessionVersion: { type: Number, default: 0, required: true },
    lastLoginAt: { type: Date, default: null },
  },
  { timestamps: true },
);

export type UserDoc = InferSchemaType<typeof userSchema>;

export const User = (models["User"] as Model<UserDoc> | undefined) ?? model<UserDoc>("User", userSchema);
