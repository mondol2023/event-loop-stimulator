import "server-only";
import "../mongooseConfig";
import { type InferSchemaType, type Model, model, models, Schema } from "mongoose";

const settingSchema = new Schema({
  key: { type: String, required: true, unique: true },
  value: { type: Schema.Types.Mixed },
});

export type SettingDoc = InferSchemaType<typeof settingSchema>;

export const Setting = (models["Setting"] as Model<SettingDoc> | undefined) ?? model<SettingDoc>("Setting", settingSchema);
