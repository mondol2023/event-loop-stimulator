// Runs once when a Next.js server instance starts (see node_modules/next/dist/
// docs/01-app/03-api-reference/03-file-conventions/instrumentation.md).
// Validating env here makes a misconfigured deploy fail on boot instead of on
// the first request that happens to touch the database or session.
export async function register() {
  // Builds don't need runtime secrets; only a serving Node.js instance does.
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NEXT_PHASE === "phase-production-build") {
    return;
  }
  const { getEnv } = await import("./server/env");
  getEnv();
}
