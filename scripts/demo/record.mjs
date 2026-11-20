// Records the demo video of Lantern Island with Playwright (system Chrome, 1280x720) and writes WebM files.
//   part 1: the real game, played through real key presses by a small bot that reads positions from the running game
//           (it never writes to the game state), including a hit by a shade, one pause + settings, the end screen and a replay
//   part 2+3: real command outputs (captured by capture-commands.mjs) shown on a plain HTML page
// Usage (outside the repo run `npm i playwright-core ffmpeg-static` in a temp folder and point PW_DIR at it):
//   PW_DIR=<temp folder> node scripts/demo/record.mjs <commands.json> <out dir>
// Needs the dev server on http://localhost:5173 (`npm run dev`) for part 1 because the bot reads the game through
// the dev-only handle `window.__game`. The video is therefore the dev build of the same commit as the release.
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, renameSync, readdirSync } from "node:fs";
import path from "node:path";

const PW_DIR = process.env.PW_DIR;
if (!PW_DIR) throw new Error("set PW_DIR to the folder where playwright-core is installed");
const { chromium } = createRequire(path.join(PW_DIR, "x.js"))("playwright-core");
const commandsFile = process.argv[2];
const outDir = path.resolve(process.argv[3] ?? "demo-out");
const BASE = process.env.BASE_URL ?? "http://localhost:5173/";
const PLAY_SECONDS = Number(process.env.PLAY_SECONDS ?? 150);
mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (m) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);

const SUB_CSS = `#demo-sub{position:fixed;left:50%;top:190px;transform:translateX(-50%);z-index:99999;max-width:1000px;text-align:center;font:600 24px/1.3 "Trebuchet MS",system-ui,sans-serif;color:#fff;background:rgba(0,0,0,.78);padding:8px 20px;border-radius:12px;pointer-events:none;display:none}`;
async function addSub(page, top = 190) {
  await page.evaluate(([css, top]) => {
    if (!document.getElementById("demo-sub")) {
      const st = document.createElement("style");
      st.textContent = css;
      document.head.appendChild(st);
      const d = document.createElement("div");
      d.id = "demo-sub";
      document.body.appendChild(d);
    }
    document.getElementById("demo-sub").style.top = top + "px";
  }, [SUB_CSS, top]);
}
async function sub(page, text) {
  await page.evaluate((t) => {
    const d = document.getElementById("demo-sub");
    if (!d) return;
    d.textContent = t;
    d.style.display = t ? "block" : "none";
  }, text);
}
const finishVideo = async (context, page, name) => {
  const v = page.video();
  await context.close();
  const p = await v.path();
  const target = path.join(outDir, name);
  renameSync(p, target);
  log(`saved ${target}`);
};

// ---------------------------------------------------------------- part 1: the game
async function playGame(browser) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, recordVideo: { dir: outDir, size: { width: 1280, height: 720 } } });
  const page = await context.newPage();
  page.on("pageerror", (e) => log(`page error: ${e.message}`));
  await page.goto(BASE);
  await page.waitForFunction(() => !!window.__game);
  await addSub(page);
  const state = () =>
    page.evaluate(() => {
      const g = window.__game;
      const s = g.sim;
      const P = s.player;
      return {
        mode: g.mode,
        status: s.status,
        paused: s.paused,
        pos: [P.pos[0], P.pos[2]],
        carried: P.carried,
        cap: s.capacity,
        flames: P.flames,
        timeLeft: s.timeLeft,
        lit: s.litCount,
        score: s.score,
        pulseCd: P.pulseCd,
        motes: s.motes.map((m) => [m.pos[0], m.pos[2]]),
        lanterns: s.lanterns.map((l) => ({ id: l.id, x: l.pos[0], z: l.pos[2], lit: l.lit, fuel: l.fuel60 / 60, dep: l.deposited })),
        shades: s.shades.map((x) => [x.pos[0], x.pos[2], s.shadeState(x)]),
        hits: 0,
      };
    });

  // menu
  await sub(page, "Lantern Island: pick a character, press Enter");
  await sleep(4500);
  await sub(page, "Default character Mây. Enter starts, Enter again begins the night");
  await page.keyboard.press("Enter");
  await sleep(2500);
  await sub(page, "");
  await page.keyboard.press("Enter");
  await sleep(500);

  const held = new Set();
  const setKeys = async (want) => {
    for (const k of [...held]) if (!want.has(k)) { await page.keyboard.up(k); held.delete(k); }
    for (const k of want) if (!held.has(k)) { await page.keyboard.down(k); held.add(k); }
  };
  const t0 = Date.now();
  let lastE = 0;
  let lastQ = 0;
  let pausedShown = false;
  let resultShownAt = 0;
  let replays = 0;
  let replayAt = 0;
  let lastFlames = 3;
  let said = new Set();
  log("playing");
  for (;;) {
    const elapsed = (Date.now() - t0) / 1000;
    const st = await state();
    if (st.mode === "result") {
      await setKeys(new Set());
      if (!resultShownAt) {
        resultShownAt = Date.now();
        await sub(page, st.status === "won" ? "The night ended: dawn with enough lanterns lit. A win" : "The night ended: no flames left. A loss. Nothing was forced");
        log(`result: ${st.status}, score ${st.score}`);
      }
      if (Date.now() - resultShownAt > 5000) {
        await sub(page, "Enter plays the night again");
        await page.keyboard.press("Enter");
        await sleep(1500);
        await sub(page, "");
        await page.keyboard.press("Enter");
        resultShownAt = 0;
        replays++;
        replayAt = Date.now();
        said = new Set();
        lastFlames = 3;
      }
      await sleep(200);
      continue;
    }
    if (st.mode !== "playing") { await sleep(200); continue; }
    if (replays === 0 && elapsed > PLAY_SECONDS) {
      // the night has not ended by itself: stop here with the real pause menu and start the night again
      log("time cap reached without a result: restarting the night from the pause menu");
      await setKeys(new Set());
      await sub(page, "Still playing after two minutes. Pause, then restart the night");
      await page.keyboard.press("Escape");
      await sleep(2500);
      await page.locator("#pause-restart").click();
      replays++;
      replayAt = Date.now();
      said = new Set();
      lastFlames = 3;
      continue;
    }
    if (replays >= 1 && replayAt && Date.now() - replayAt > 25000) break;

    if (Math.floor(elapsed) % 15 === 0 && Math.floor(elapsed) !== (globalThis.__lastLog ?? -1)) {
      globalThis.__lastLog = Math.floor(elapsed);
      log(`t=${Math.floor(elapsed)}s pos=${st.pos.map((v) => v.toFixed(1))} carried=${st.carried} lit=${st.lit} flames=${st.flames} shades=${st.shades.length} score=${st.score}`);
    }
    // subtitles that describe what really happens
    if (elapsed > 1 && !said.has("walk")) { said.add("walk"); await sub(page, "Walk with the arrow keys (or right mouse button), pick up fireflies"); }
    if (st.carried >= 1 && !said.has("carry")) { said.add("carry"); await sub(page, "Fireflies carried: bring them to a lantern, press E"); }
    if (st.lit >= 1 && !said.has("lit")) { said.add("lit"); await sub(page, "A lantern is lit. It burns down: feed it fireflies to keep it alive"); }
    if (st.flames < lastFlames) { await sub(page, "An Ink Shade touched Mây: a flame is lost and fireflies drop"); lastFlames = st.flames; said.add("hit"); }

    // pause + settings once, about 60 s in the first night
    if (!pausedShown && replays === 0 && elapsed > 60) {
      pausedShown = true;
      await setKeys(new Set());
      await sub(page, "Esc pauses the game");
      await page.keyboard.press("Escape");
      await sleep(2500);
      await sub(page, "Settings: volume, colours, reduce motion, large text, keys");
      await page.locator("#pause-settings").click();
      await sleep(4500);
      await sub(page, "Keys can be rebound; a duplicate key is refused with a warning");
      await sleep(3000);
      await page.locator("#set-close").click();
      await sleep(1000);
      await sub(page, "Resume");
      await page.locator("#pause-resume").click();
      await sleep(1000);
      await sub(page, "");
      continue;
    }

    // choose a target: pick up fireflies, deliver them in several visits (a lantern takes deposits), keep away from shades
    let tx = null;
    let tz = null;
    const needy = st.lanterns.filter((l) => !l.lit || l.fuel < 85);
    const nearest = (arr, f) => arr.reduce((b, a) => (b === null || f(a) < f(b) ? a : b), null);
    const dist = (x, z) => Math.hypot(x - st.pos[0], z - st.pos[1]);
    const deliver = st.carried >= 4 || (st.carried > 0 && st.motes.length === 0);
    if (deliver && needy.length) {
      const l = nearest(needy, (a) => dist(a.x, a.z) - a.dep * 3);
      tx = l.x;
      tz = l.z - 1.0;
      if (dist(l.x, l.z) < 1.8 && Date.now() - lastE > 350) { await page.keyboard.press("e"); lastE = Date.now(); }
    } else if (st.motes.length) {
      const m = nearest(st.motes, (a) => dist(a[0], a[1]));
      tx = m[0]; tz = m[1];
    }
    // glow (Q) once a shade is very close
    const close = st.shades.filter((x) => dist(x[0], x[1]) < 3.5 && x[2] !== "stunned");
    if (close.length && st.carried >= 3 && st.pulseCd === 0 && Date.now() - lastQ > 800) {
      await page.keyboard.press("q");
      lastQ = Date.now();
      if (!said.has("glow")) { said.add("glow"); await sub(page, "Q: glow. Shades near Mây are stunned and pushed away (costs 3 fireflies)"); }
    }
    const want = new Set();
    if (tx !== null) {
      let dx = tx - st.pos[0];
      let dz = tz - st.pos[1];
      const n0 = Math.hypot(dx, dz) || 1;
      dx /= n0;
      dz /= n0;
      // steer away from the nearest chasing shade within 7 m (not perfect: hits still happen)
      const threats = st.shades.filter((x) => (x[2] === "chase" || x[2] === "spawning") && dist(x[0], x[1]) < 7);
      for (const x of threats) {
        const d = dist(x[0], x[1]) || 1;
        dx += ((st.pos[0] - x[0]) / d) * 1.6;
        dz += ((st.pos[1] - x[1]) / d) * 1.6;
      }
      if (dz > 0.35) want.add("ArrowUp");
      if (dz < -0.35) want.add("ArrowDown");
      if (dx > 0.35) want.add("ArrowLeft"); // camera yaw 0: the left key walks towards +X
      if (dx < -0.35) want.add("ArrowRight");
    }
    await setKeys(want);
    await sleep(70);
  }
  await setKeys(new Set());
  await sub(page, "");
  await sleep(500);
  await finishVideo(context, page, "part1-game.webm");
}

// ---------------------------------------------------------------- part 2 + 3: real command output
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
async function showCommands(browser) {
  const steps = JSON.parse(readFileSync(commandsFile, "utf8"));
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, recordVideo: { dir: outDir, size: { width: 1280, height: 720 } } });
  const page = await context.newPage();
  const groups = [
    [2, "Part 2: the evidence, real commands, real output"],
    [3, "Part 3: the repository and the AI harness"],
  ];
  for (const [part, title] of groups) {
    await page.setContent(`<body style="margin:0;background:#0b1020;color:#f5f1e6;font:600 44px 'Trebuchet MS',sans-serif;display:grid;place-items:center;height:100vh">${esc(title)}</body>`);
    await sleep(2200);
    for (const s of steps.filter((x) => x.part === part)) {
      const lines = s.output.trim().split("\n");
      const shown = lines.slice(-s.keep);
      const note = lines.length > shown.length ? `(last ${shown.length} of ${lines.length} lines)` : `(${lines.length} lines)`;
      await page.setContent(`<body style="margin:0;background:#0b1020;color:#e8e6d9;font:20px/1.35 Consolas,'Courier New',monospace;padding:28px 36px;height:100vh;box-sizing:border-box;overflow:hidden">
        <div style="color:#f2c14e;font:600 26px 'Trebuchet MS',sans-serif;margin-bottom:10px">${esc(s.title)}</div>
        <div style="color:#8fd18f">$ ${esc(s.cmd.length > 150 ? s.cmd.slice(0, 150) + " ..." : s.cmd)}</div>
        <pre style="margin:12px 0;white-space:pre-wrap;word-break:break-all">${esc(shown.join("\n"))}</pre>
        <div style="position:absolute;left:36px;bottom:12px;color:#9aa3c7">exit code ${s.exit} &middot; ${s.secs} s &middot; ran at ${esc(s.at)} &middot; ${note}</div></body>`);
      await addSub(page, 640);
      await sub(page, s.cmd.startsWith("npm run check") ? "npm run check: typecheck, 323 tests, determinism" : s.title);
      await sleep(Math.max(4500, shown.length * 380));
    }
  }
  await sleep(800);
  await finishVideo(context, page, "part23-commands.webm");
}

const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const only = process.env.ONLY;
  if (!only || only === "game") await playGame(browser);
  if (!only || only === "commands") await showCommands(browser);
} finally {
  await browser.close();
}
log(`files in ${outDir}: ${readdirSync(outDir).join(", ")}`);
