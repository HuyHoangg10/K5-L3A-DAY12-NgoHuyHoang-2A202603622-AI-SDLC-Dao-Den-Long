// Bundles the headless CLI into dist/headless/cli.js (plain Node ESM, no deps).
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export async function buildHeadless() {
  await build({
    entryPoints: { cli: path.join(root, "src/headless/cli.ts"), soak: path.join(root, "src/headless/soak.ts"), launcher: path.join(root, "src/headless/launcher.ts") },
    outdir: path.join(root, "dist/headless"),
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
