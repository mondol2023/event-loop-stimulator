import type { Diagnostic } from "@/core/shared/diagnostics";

// D7: `Diagnostic.docs` points at docs/SUPPORTED_SUBSET.md, which the app serves as /docs/subset with one anchor per code.
export function docsHref(d: Diagnostic): string {
  return d.docs ? `/docs/subset#${d.code}` : "/docs/subset";
}
