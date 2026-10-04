import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // Production build: e2e exercises what ships, including CSP and headers.
    command: `npm run build && npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 300_000,
    // instrumentation.ts validates env on boot. These are throwaway test
    // values, not secrets; nothing in e2e connects to Mongo yet.
    env: {
      MONGODB_URI: process.env.MONGODB_URI ?? "mongodb://127.0.0.1:27017/silicon-loop-e2e?replicaSet=rs0",
      SESSION_SECRET: process.env.SESSION_SECRET ?? "e2e-only-session-secret-not-for-prod-0000",
    },
  },
});
