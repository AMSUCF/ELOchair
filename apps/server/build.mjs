// Bundle the server and CLI for production. Workspace packages (@elochair/*) are TypeScript
// source and get bundled in; third-party dependencies stay external and come from node_modules.
import { readFileSync } from "node:fs";
import { build } from "esbuild";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));
const external = Object.keys(pkg.dependencies).filter((d) => !d.startsWith("@elochair/"));

await build({
  entryPoints: { main: "src/main.ts", cli: "src/cli.ts" },
  outdir: "dist",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  sourcemap: true,
  external: [
    ...external,
    "@electric-sql/pglite/*",
    "drizzle-orm/*",
    "@hono/node-server/*",
    "hono/*",
  ],
  logLevel: "info",
});
