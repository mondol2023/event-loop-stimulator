import { EXAMPLES } from "./catalog.generated";
import type { Example } from "./examples.config";

export type { Example, ExampleConfig } from "./examples.config";
export { EXAMPLES };

/** The example whose source is exactly `source` (byte for byte), or null once the editor text differs at all. */
export function exampleForSource(source: string): Example | null {
  return EXAMPLES.find((example) => example.source === source) ?? null;
}
