import "server-only";
import mongoose from "mongoose";

// Global query hardening (PROMPT.md §7.7): `sanitizeFilter` wraps any `$`
// operator found in a user-supplied filter value in `$eq`, and `strictQuery`
// throws on filter paths that are not in the schema.
//
// Mongoose reads `strictQuery` when a Schema is CONSTRUCTED, not at query time,
// so this module must be evaluated before any schema exists. Import it first
// (side-effect import) in connection.ts and in every model file; then import
// order can never leave a model with lenient queries.
mongoose.set("sanitizeFilter", true);
mongoose.set("strictQuery", "throw");
