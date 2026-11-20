// Bundles the headless CLI into dist/headless/cli.js (plain Node ESM, no deps).
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export async function buildHeadless() {
  await build({
    entryPoints: [path.join(root, "src/headless/cli.ts")],
    outfile: path.join(root, "dist/headless/cli.js"),
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    logLevel: "warning",
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await buildHeadless();
}
