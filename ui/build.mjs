import { build } from "esbuild";
import { copyFileSync, mkdirSync } from "node:fs";

await build({
  entryPoints: ["src/entry.ts"],
  bundle: true,
  minify: true,
  format: "iife",
  target: "es2020",
  loader: { ".css": "text" },
  define: { "process.env.NODE_ENV": '"production"' },
  outfile: "dist/moscow-planner.js",
  logLevel: "info",
});
mkdirSync("../custom_components/moscow_planner/frontend", { recursive: true });
copyFileSync("dist/moscow-planner.js", "../custom_components/moscow_planner/frontend/moscow-planner.js");
