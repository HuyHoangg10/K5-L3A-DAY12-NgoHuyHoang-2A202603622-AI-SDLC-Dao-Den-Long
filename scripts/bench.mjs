// bench_cmd: node scripts/bench.mjs --seed 42 --duration 30 --out bench.json  [--headed] [--browser <path>]
// Serves dist/web, opens it in Chrome or Edge at 1280x720 with vsync and the frame limiter off, waits for the page to post its
// result (src/render/bench.ts), adds what only the runner knows (start-up time, OS, vsync flags) and writes bench.json.
// Exit code 0 when bench.json was written, 1 on any problem (no browser, no build, timeout).
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const webDir = path.join(root, "dist", "web");
const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : def;
};
const seed = Number(opt("--seed", "42"));
const duration = Number(opt("--duration", "30"));
const out = opt("--out", "bench.json");
const headed = args.includes("--headed");
const fail = (msg) => {
  process.stderr.write(`error: ${msg}\n`);
  process.exit(1);
};
if (!Number.isFinite(seed) || !Number.isFinite(duration) || duration <= 0) fail("--seed and --duration must be numbers (duration > 0)");
if (!existsSync(path.join(webDir, "index.html"))) fail("dist/web is missing; run `npm run build` first");

function findBrowser() {
  const given = opt("--browser", process.env.CHROME_PATH);
  if (given) return existsSync(given) ? given : null;
  const w = process.env["ProgramFiles"] ?? "C:\\Program Files";
  const w86 = process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)";
  const local = process.env["LOCALAPPDATA"] ?? "";
  const list =
    process.platform === "win32"
      ? [
          path.join(w, "Google/Chrome/Application/chrome.exe"),
          path.join(w86, "Google/Chrome/Application/chrome.exe"),
          path.join(local, "Google/Chrome/Application/chrome.exe"),
          path.join(w86, "Microsoft/Edge/Application/msedge.exe"),
          path.join(w, "Microsoft/Edge/Application/msedge.exe"),
        ]
      : process.platform === "darwin"
        ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge", "/Applications/Chromium.app/Contents/MacOS/Chromium"]
        : ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser", "/snap/bin/chromium", "/usr/bin/microsoft-edge"];
  return list.find((p) => existsSync(p)) ?? null;
}
const browser = findBrowser();
if (!browser) fail("no Chrome or Edge found; pass --browser <path> or set CHROME_PATH");

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon" };
const tSpawn = Date.now();
let tIndex = 0;
let resolveResult;
const result = new Promise((res) => (resolveResult = res));

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://x");
  if (req.method === "POST" && url.pathname === "/api/bench") {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      res.end("ok");
      try {
        resolveResult(JSON.parse(raw));
      } catch {
        resolveResult(null);
      }
    });
    return;
  }
  let rel = decodeURIComponent(url.pathname);
  if (rel === "/") {
    rel = "/index.html";
    if (!tIndex) tIndex = Date.now();
  }
  const file = path.normalize(path.join(webDir, rel));
  if (!file.startsWith(webDir) || !existsSync(file) || !statSync(file).isFile()) {
    res.statusCode = 404;
    res.end("not found");
    return;
  }
  res.setHeader("content-type", MIME[path.extname(file)] ?? "application/octet-stream");
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;

const profile = mkdtempSync(path.join(os.tmpdir(), "ddl-bench-"));
const chromeArgs = [
  `--user-data-dir=${profile}`,
  "--window-size=1280,720",
  "--disable-gpu-vsync",
  "--disable-frame-rate-limit",
  "--enable-precise-memory-info",
  "--no-first-run",
  "--no-default-browser-check",
  "--disable-background-timer-throttling",
  "--disable-renderer-backgrounding",
  "--disable-backgrounding-occluded-windows",
  ...(headed ? [] : ["--headless=new"]),
  `http://127.0.0.1:${port}/?bench=1&seed=${seed}&duration=${duration}`,
];
const child = spawn(browser, chromeArgs, { stdio: "ignore" });
child.on("error", (e) => fail(`could not start ${browser}: ${e.message}`));
const stop = () => {
  try {
    if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    else child.kill("SIGKILL");
  } catch {
    /* already gone */
  }
};

const timeout = setTimeout(() => {
  stop();
  fail(`no result after ${duration + 90} s`);
}, (duration + 90) * 1000);

const page = await result;
clearTimeout(timeout);
stop();
server.close();
await new Promise((r) => setTimeout(r, 400));
try {
  rmSync(profile, { recursive: true, force: true });
} catch {
  /* the browser may still hold a file; the temp folder is harmless */
}
if (!page) fail("the page sent a result that could not be read");

let version = "";
try {
  if (process.platform === "win32") version = spawnSync("powershell", ["-NoProfile", "-Command", `(Get-Item '${browser}').VersionInfo.ProductVersion`], { encoding: "utf8" }).stdout.trim();
  else version = spawnSync(browser, ["--version"], { encoding: "utf8" }).stdout.trim();
} catch {
  /* optional */
}
const cpu = os.cpus();
const bench = {
  contract_version: "1.3",
  avg_fps: page.avg_fps,
  p1_low_fps: page.p1_low_fps,
  frame_ms_p95: page.frame_ms_p95,
  frames: page.frames,
  load_ms: (tIndex ? tIndex - tSpawn : 0) + page.load_ms, // browser start-up until the page was requested + page load up to the first frame
  peak_mem_mb: page.peak_mem_mb,
  vsync_off: true, // asked with --disable-gpu-vsync --disable-frame-rate-limit (Chrome honours it; see README)
  renderer: page.renderer,
  os: `${os.type()} ${os.release()} ${os.arch()}; ${cpu[0]?.model.trim()} x${cpu.length}; ${(os.totalmem() / 2 ** 30).toFixed(1)} GiB RAM; ${path.basename(browser)} ${version}${headed ? " (window)" : " (headless=new)"}`,
  notes: [page.heap_note, "peak_mem_mb covers the JavaScript heap only: a web build cannot read the RSS of the browser process."],
  seed: page.seed,
  duration_s: page.duration_s,
  viewport: page.viewport,
};
mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
writeFileSync(out, JSON.stringify(bench, null, 2) + "\n");
console.log(`bench: ${bench.avg_fps} fps avg, ${bench.p1_low_fps} fps 1% low, p95 ${bench.frame_ms_p95} ms, ${bench.frames} frames, load ${bench.load_ms} ms -> ${out}`);
process.exit(0);
