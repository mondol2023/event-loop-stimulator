// Branded identifiers. Every id that reaches a database filter goes through a
// parser here first, so a request body like `{ "$ne": null }` can never become
// a query operator: the parsers accept only strings of an exact shape.

declare const brand: unique symbol;
type Brand<T, B extends string> = T & { readonly [brand]: B };

export type UserId = Brand<string, "UserId">;
export type SnippetId = Brand<string, "SnippetId">;

const OBJECT_ID = /^[0-9a-fA-F]{24}$/;
const SLUG = /^[A-Za-z0-9_-]{10}$/;

function isObjectIdString(input: unknown): input is string {
  return typeof input === "string" && OBJECT_ID.test(input);
}

/** A 24-hex ObjectId string as a `UserId`, or `null` for anything else. */
export function parseUserId(input: unknown): UserId | null {
  return isObjectIdString(input) ? (input as UserId) : null;
}

/** A 24-hex ObjectId string as a `SnippetId`, or `null` for anything else. */
export function parseSnippetId(input: unknown): SnippetId | null {
  return isObjectIdString(input) ? (input as SnippetId) : null;
}

/** True for a 10-character url-safe snippet slug (nanoid alphabet). */
export function isSlug(input: unknown): input is string {
  return typeof input === "string" && SLUG.test(input);
}
