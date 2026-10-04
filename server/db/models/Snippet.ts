import "server-only";
import "../mongooseConfig";
import { type InferSchemaType, type Model, model, models, Schema } from "mongoose";
import { nanoid } from "nanoid";

const snippetSchema = new Schema(
  {
    ownerId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    title: { type: String, required: true, trim: true },
    source: { type: String, required: true },
    lang: { type: String, required: true },
    slug: { type: String, required: true, unique: true, default: () => nanoid(10) },
    visibility: { type: String, enum: ["private", "unlisted", "public"], default: "private", required: true },
    forkedFrom: { type: Schema.Types.ObjectId, ref: "Snippet" },
    stats: {
      views: { type: Number, default: 0 },
      forks: { type: Number, default: 0 },
    },
  },
  { timestamps: true },
);

snippetSchema.index({ ownerId: 1, updatedAt: -1 });

export type SnippetDoc = InferSchemaType<typeof snippetSchema>;

export const Snippet = (models["Snippet"] as Model<SnippetDoc> | undefined) ?? model<SnippetDoc>("Snippet", snippetSchema);
