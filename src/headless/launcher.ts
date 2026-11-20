// run_cmd: `node dist/headless/launcher.js` serves the built web game (dist/web) with the leaderboard API and opens the browser.
//          `node dist/headless/launcher.js --export-leaderboard out.json` writes {"entries": [...]} and exits.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { exportJson } from "../leaderboard/board";
import { handleApi, readBoard } from "../leaderboard/store";

const here = dirname(fileURLToPath(import.meta.url)); // dist/headless
const root = resolve(here, "../..");
const dataFile = process.env.LEADERBOARD_FILE ?? join(root, "data", "leaderboard.json");
const webDir = join(root, "dist", "web");
const MIME: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon" };

function openBrowser(url: string): void {
  const [cmd, args]: [string, string[]] = process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : process.platform === "darwin" ? ["open", [url]] : ["xdg-open", [url]];
  try {
    spawn(cmd, args, { stdio: "ignore", detached: true }).on("error", () => {}).unref();
  } catch {
    /* no browser to open: the URL is printed */
  }
}

function main(): number {
  const a = process.argv.slice(2);
  const ei = a.indexOf("--export-leaderboard");
  if (ei >= 0) {
    const out = a[ei + 1];
    if (!out) {
      process.stderr.write("error: --export-leaderboard needs a file name\n");
      return 1;
    }
    mkdirSync(dirname(resolve(out)), { recursive: true });
    writeFileSync(out, exportJson(readBoard(dataFile)));
    return 0;
  }
  if (!existsSync(join(webDir, "index.html"))) {
    process.stderr.write("error: dist/web is missing; run `npm run build` first\n");
    return 1;
  }
  const port = Number(process.env.PORT ?? 4173);
  const server = createServer((req, res) => {
    if (handleApi(req, res, dataFile)) return;
    const url = decodeURIComponent((req.url ?? "/").split("?")[0] ?? "/");
    let file = normalize(join(webDir, url === "/" ? "index.html" : url));
    if (!file.startsWith(webDir + sep) && file !== webDir) file = join(webDir, "index.html");
    if (!existsSync(file) || statSync(file).isDirectory()) file = join(webDir, "index.html");
    res.setHeader("content-type", MIME[extname(file)] ?? "application/octet-stream");
    res.end(readFileSync(file));
  });
  server.listen(port, () => {
    const url = `http://localhost:${port}/`;
    process.stdout.write(`Lantern Island is running at ${url}  (Ctrl+C to stop)\n`);
    if (!process.argv.includes("--no-open")) openBrowser(url);
  });
  server.on("error", (e) => {
    process.stderr.write(`error: ${(e as Error).message}\n`);
    process.exit(1);
  });
  return 0;
}

process.exitCode = main();
