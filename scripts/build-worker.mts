import { build } from "esbuild";

// Prebuilds the compile worker (`npm run build` and `npm run dev` run this first). Turbopack
// copies a `new Worker(new URL("./x.ts", import.meta.url))` entry as a raw asset instead of
// bundling it, so the TypeScript entry and the core/ pipeline it imports are bundled here into one
// plain ESM file. `pool.ts` points its Worker at that file and Next copies it next to the route.
// esbuild reads the `@/` paths from tsconfig.json.

const OUT_FILE = "server/security/sandbox/dist/compile-worker.mjs";

await build({
  entryPoints: ["server/security/sandbox/compile-worker.ts"],
  outfile: OUT_FILE,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  // Deterministic output: same sources, same bytes.
  legalComments: "none",
  logLevel: "warning",
});

console.log(`Compile worker bundled into ${OUT_FILE}.`);
