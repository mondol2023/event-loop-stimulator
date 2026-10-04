import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    // Pin the root so a stray lockfile in a parent directory can't change
    // module resolution or file watching.
    root: path.join(__dirname),
  },
};

export default nextConfig;
