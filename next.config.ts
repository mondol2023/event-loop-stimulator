import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // forbidden() / unauthorized() from next/navigation (ADR-011).
    authInterrupts: true,
    // experimental_taintUniqueValue: secrets cannot be serialized to the client (ADR-011).
    taint: true,
  },
  turbopack: {
    // Pin the root so a stray lockfile in a parent directory can't change
    // module resolution or file watching.
    root: path.join(__dirname),
  },
};

export default nextConfig;
