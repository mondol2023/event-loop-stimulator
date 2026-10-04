import { z } from "zod";

// The one place Zod is imported. `jitless` stops Zod v4 from compiling object
// parsers with `new Function`: generating code at runtime is banned by the
// "never execute" invariant (PROMPT.md §2.1) and would be blocked by a CSP
// without 'unsafe-eval'. Zod keeps this config on globalThis, so it applies
// process-wide once this module has loaded.
z.config({ jitless: true });

export { z };
