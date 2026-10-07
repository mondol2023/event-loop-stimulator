import { parse } from "yaml";

// test262 front matter: a YAML document between `/*---` and `---*/`
// (https://github.com/tc39/test262/blob/main/INTERPRETING.md#metadata).

export type Metadata = {
  readonly includes: string[];
  readonly flags: string[];
  readonly features: string[];
  readonly negative?: { readonly phase: string; readonly type: string };
  readonly description: string;
};

const FRONT_MATTER = /\/\*---([\s\S]*?)---\*\//;

function stringList(value: unknown, key: string): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || !value.every((v) => typeof v === "string")) {
    throw new Error(`invalid test262 metadata: \`${key}\` must be a list of strings`);
  }
  return value;
}

export function parseMetadata(source: string): Metadata {
  const match = FRONT_MATTER.exec(source);
  if (!match?.[1]) throw new Error("test262 file has no front matter (/*--- ... ---*/)");

  let doc: unknown;
  try {
    doc = parse(match[1]);
  } catch (e) {
    throw new Error(`invalid test262 metadata: ${e instanceof Error ? (e.message.split("\n")[0] ?? "") : String(e)}`);
  }
  if (typeof doc !== "object" || doc === null || Array.isArray(doc)) {
    throw new Error("invalid test262 metadata: the front matter is not a mapping");
  }
  const fields = doc as Record<string, unknown>;

  const base = {
    includes: stringList(fields["includes"], "includes"),
    flags: stringList(fields["flags"], "flags"),
    features: stringList(fields["features"], "features"),
    description: typeof fields["description"] === "string" ? fields["description"] : "",
  };

  const negative = fields["negative"];
  if (negative === undefined || negative === null) return base;
  const n = negative as Record<string, unknown>;
  if (typeof n !== "object" || typeof n["phase"] !== "string" || typeof n["type"] !== "string") {
    throw new Error("invalid test262 metadata: `negative` needs a `phase` and a `type`");
  }
  return { ...base, negative: { phase: n["phase"], type: n["type"] } };
}
