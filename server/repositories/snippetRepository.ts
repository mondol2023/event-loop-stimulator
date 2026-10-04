import "server-only";
import type { ClientSession } from "mongoose";
import { sessionOption } from "./session";
import { isSlug, parseSnippetId, parseUserId, type SnippetId, type UserId } from "@/core/shared/ids";
import { Snippet } from "@/server/db/models/Snippet";
import type { SnippetRecord, SnippetVisibility } from "./types";

type SnippetLean = {
  _id: { toString(): string };
  ownerId: { toString(): string };
  title: string;
  source: string;
  lang: string;
  slug: string;
  visibility: SnippetVisibility;
  forkedFrom?: { toString(): string } | null;
  stats?: { views?: number; forks?: number };
  createdAt: Date;
  updatedAt: Date;
};

function toSnippetRecord(doc: SnippetLean): SnippetRecord {
  return {
    id: doc._id.toString() as SnippetId,
    ownerId: doc.ownerId.toString() as UserId,
    title: doc.title,
    source: doc.source,
    lang: doc.lang,
    slug: doc.slug,
    visibility: doc.visibility,
    forkedFrom: doc.forkedFrom == null ? null : (doc.forkedFrom.toString() as SnippetId),
    stats: { views: doc.stats?.views ?? 0, forks: doc.stats?.forks ?? 0 },
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

export const snippetRepository = {
  async create(
    input: {
      ownerId: UserId;
      title: string;
      source: string;
      lang: string;
      visibility?: SnippetVisibility;
      forkedFrom?: SnippetId;
    },
    session?: ClientSession,
  ): Promise<SnippetRecord> {
    if (parseUserId(input.ownerId) === null) throw new TypeError("Snippet ownerId must be a valid user id");
    if (input.forkedFrom !== undefined && parseSnippetId(input.forkedFrom) === null) {
      throw new TypeError("Snippet forkedFrom must be a valid snippet id");
    }
    const [doc] = await Snippet.create([input], sessionOption(session));
    if (doc === undefined) throw new Error("Snippet.create returned no document");
    return toSnippetRecord(doc.toObject() as unknown as SnippetLean);
  },

  async findBySlug(slug: string, session?: ClientSession): Promise<SnippetRecord | null> {
    if (!isSlug(slug)) return null;
    const doc = await Snippet.findOne({ slug })
      .session(session ?? null)
      .lean<SnippetLean>();
    return doc === null ? null : toSnippetRecord(doc);
  },

  async listByOwner(ownerId: UserId, session?: ClientSession): Promise<SnippetRecord[]> {
    if (parseUserId(ownerId) === null) return [];
    const docs = await Snippet.find({ ownerId })
      .sort({ updatedAt: -1 })
      .session(session ?? null)
      .lean<SnippetLean[]>();
    return docs.map(toSnippetRecord);
  },
};
