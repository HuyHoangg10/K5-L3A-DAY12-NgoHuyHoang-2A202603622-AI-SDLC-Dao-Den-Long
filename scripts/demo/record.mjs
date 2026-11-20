// Records the demo video of Lantern Island with Playwright (system Chrome, 1280x720) and writes WebM files.
//   part 1: the real game, played through real key presses by a small bot that reads positions from the running game
//           (it never writes game state while playing). The champion is Mây the Card Reader, not the default Mây.
//           Phase 1: core night. Phase 2: pause menu, Night 2. Phase 3: lantern fuel, relight, win at dawn (Night 3).
//           Phase 4: leaderboard, settings, key rebinding, large text, colour-blind and reduce-motion options.
//   part 2+3: real command outputs (captured by capture-commands.mjs) shown on a plain HTML page
// DEV SHORTCUTS (only in the dev build, always announced by a subtitle "DEV SHORTCUT" on screen): jump to Night 2 or 3,
// shorten the night, start some lanterns lit with chosen fuel. Nothing forces the result: the bot plays and the sim decides.
// Usage: PW_DIR=<folder with playwright-core> node scripts/demo/record.mjs <commands.json> <out dir>
// Needs the dev server on http://localhost:5173 (`npm run dev`): the bot reads the game through the dev-only handle window.__game.
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, renameSync, readdirSync } from "node:fs";
import path from "node:path";

const PW_DIR = process.env.PW_DIR;
if (!PW_DIR) throw new Error("set PW_DIR to the folder where playwright-core is installed");
const { chromium } = createRequire(path.join(PW_DIR, "x.js"))("playwright-core");
const commandsFile = process.argv[2];
const outDir = path.resolve(process.argv[3] ?? "demo-out");
const BASE = process.env.BASE_URL ?? "http://localhost:5173/";
mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (m) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);

const SUB_CSS = `#demo-sub{position:fixed;left:50%;top:190px;transform:translateX(-50%);z-index:99999;max-width:1040px;text-align:center;font:600 24px/1.3 "Trebuchet MS",system-ui,sans-serif;color:#fff;background:rgba(0,0,0,.8);padding:8px 20px;border-radius:12px;pointer-events:none;display:none}#demo-sub b{color:#f2c14e}#demo-sub.dev{background:rgba(120,30,30,.9)}`;
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
async function sub(page, text, dev = false) {
  await page.evaluate(([t, dev]) => {
    const d = document.getElementById("demo-sub");
    if (!d) return;
    d.textContent = t;
    d.classList.toggle("dev", dev);
    d.style.display = t ? "block" : "none";
  }, [text, dev]);
}
const finishVideo = async (context, page, name) => {
  const v = page.video();
  await context.close();
  const p = await v.path();
  renameSync(p, path.join(outDir, name));
  log(`saved ${name}`);
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
        mode: g.mode, status: s.status, pos: [P.pos[0], P.pos[2]], carried: P.carried, cap: s.capacity, flames: P.flames,
        timeLeft: s.timeLeft, lit: s.litCount, score: s.score, pulseCd: P.pulseCd, night: g.night,
        motes: s.motes.map((m) => [m.pos[0], m.pos[2]]),
        lanterns: s.lanterns.map((l) => ({ id: l.id, x: l.pos[0], z: l.pos[2], lit: l.lit, fuel: l.fuel60 / 60, dep: l.deposited })),
        shades: s.shades.map((x) => [x.pos[0], x.pos[2], s.shadeState(x)]),
        drifters: s.drifters.length,
      };
    });
  const held = new Set();
  const setKeys = async (want) => {
    for (const k of [...held]) if (!want.has(k)) { await page.keyboard.up(k); held.delete(k); }
    for (const k of want) if (!held.has(k)) { await page.keyboard.down(k); held.add(k); }
  };
  const dev = (text, ms = 4200) => sub(page, `DEV SHORTCUT: ${text}`, true).then(() => sleep(ms));

  // The bot: real arrow keys, F to put fireflies in a lantern, D to glow. `events` are timed extras (skills, dash).
  async function bot(seconds, { events = [], stopOnResult = true, note = null } = {}) {
    const t0 = Date.now();
    let lastE = 0;
    let lastQ = 0;
    const done = new Set();
    let lastFlames = null;
    for (;;) {
      const el = (Date.now() - t0) / 1000;
      const st = await state();
      if (st.mode === "result" && stopOnResult) { await setKeys(new Set()); return "result"; }
      if (st.mode !== "playing") { await sleep(150); continue; }
      if (el > seconds) { await setKeys(new Set()); return "time"; }
      for (const [at, fn] of events) if (el >= at && !done.has(at)) { done.add(at); await fn(st); }
      if (lastFlames !== null && st.flames < lastFlames) await sub(page, "An Ink Shade touched Mây: a flame is lost and fireflies drop");
      lastFlames = st.flames;
      const needy = st.lanterns.filter((l) => !l.lit || l.fuel < 85);
      const nearest = (arr, f) => arr.reduce((b, a) => (b === null || f(a) < f(b) ? a : b), null);
      const dist = (x, z) => Math.hypot(x - st.pos[0], z - st.pos[1]);
      let tx = null;
      let tz = null;
      const deliver = st.carried >= 4 || (st.carried > 0 && st.motes.length === 0);
      if (deliver && needy.length) {
        const l = nearest(needy, (a) => dist(a.x, a.z) - a.dep * 3 - (a.lit && a.fuel < 30 ? 25 : 0)); // weak lanterns first
        tx = l.x; tz = l.z - 1.0;
        if (dist(l.x, l.z) < 1.8 && Date.now() - lastE > 350) { await page.keyboard.press("f"); lastE = Date.now(); }
      } else if (st.motes.length) {
        const m = nearest(st.motes, (a) => dist(a[0], a[1]));
        tx = m[0]; tz = m[1];
      }
      const close = st.shades.filter((x) => dist(x[0], x[1]) < 3.5 && x[2] !== "stunned");
      if (close.length && st.carried >= 3 && st.pulseCd === 0 && Date.now() - lastQ > 900) { await page.keyboard.press("d"); lastQ = Date.now(); }
      const want = new Set();
      if (tx !== null) {
        let dx = tx - st.pos[0];
        let dz = tz - st.pos[1];
        const n0 = Math.hypot(dx, dz) || 1;
        dx /= n0; dz /= n0;
        for (const x of st.shades.filter((x) => (x[2] === "chase" || x[2] === "spawning") && dist(x[0], x[1]) < 7)) {
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
  }

  // ------------------------------------------------ Phase 1: menu, champion, core night
  await sub(page, "PHASE 1: core game. Menu with four characters; I pick a champion, not the default Mây");
  await sleep(4200);
  await page.keyboard.press("2");
  await sub(page, "PHASE 1: Mây the Card Reader selected (key 2). Enter starts, Enter again begins the night");
  await sleep(3000);
  await page.keyboard.press("Enter");
  await sleep(2200);
  await sub(page, "");
  await page.keyboard.press("Enter");
  await sleep(600);
  await page.mouse.move(820, 330);
  await sub(page, "PHASE 1: walk, pick up fireflies, put them in a lantern (F), shades chase you");
  const skill = (key, text) => async () => { await sub(page, `CHAMPION SKILL (my own addition): ${text}`); await page.keyboard.press(key); };
  await bot(28, {
    events: [
      [7, skill("q", "Q Card Fan, cards fly toward the mouse")],
      [13, skill("w", "W Roll the Card, gold / blue / pink card")],
      [19, skill("e", "E Lure Lantern, shades follow the light")],
      [25, async () => { await sub(page, "PHASE 2: Shift dashes (14 m/s, 1.5 s cooldown)"); await page.keyboard.press("Shift"); }],
    ],
  });

  // ------------------------------------------------ Phase 2: pause menu, Night 2
  await setKeys(new Set());
  await sub(page, "PHASE 2: Esc pauses the game (resume, restart, settings, menu)");
  await page.keyboard.press("Escape");
  await sleep(3500);
  await dev("jump to Night 2 (the real chain needs a win first); the pause card closes", 4000);
  await page.evaluate(() => { const g = window.__game; g.hud.show("pause", false); g.night = 2; g.total = 0; g.newSim(); g.showIntro(); });
  await sub(page, "PHASE 2: Night 2, Đảo Cau: two islands, a bridge, pads, Drifters, wind charm");
  await sleep(5500);
  await sub(page, "");
  await page.keyboard.press("Enter");
  await sleep(500);
  await sub(page, "PHASE 2: Night 2 played with real keys. 6 lanterns, 4:30 on the clock");
  await bot(18, { events: [[8, async () => { await sub(page, "PHASE 2: bounce pad, Drifter ribbons and the charm are on this map"); }]], stopOnResult: true });

  // ------------------------------------------------ Phase 3 + dawn: fuel, relight, win rule, Night 3
  await setKeys(new Set());
  await dev("jump to Night 3, shorten it to 55 s and start 4 of 7 lanterns lit with 90 / 45 / 26 / 12 fuel", 5000);
  await page.evaluate(() => {
    const g = window.__game;
    g.hud.show("end", false); g.hud.show("pause", false);
    g.night = 3; g.total = 0; g.newSim();
    g.sim.timeLeftStart = 55;
    [90, 45, 26, 12].forEach((f, i) => { const l = g.sim.lanterns[i]; l.lit = true; l.everLit = true; l.fuel60 = f * 60; l.deposited = 10; });
    g.showIntro();
  });
  await sub(page, "PHASE 3: Night 3, Đảo Chuông: three floors. Lanterns burn down: fuel bars on the left, blink below 30");
  await sleep(5000);
  await sub(page, "");
  await page.keyboard.press("Enter");
  await sleep(400);
  await sub(page, "PHASE 3: feed lanterns with fireflies (refuel), relight one that went out for 5, capacity grows");
  const r3 = await bot(80, {
    events: [
      [12, async () => { await sub(page, "PHASE 3: win at dawn needs 60% of the lanterns lit (5 of 7). The sim decides, nothing is forced"); }],
      [30, async () => { await sub(page, "PHASE 3: a weak lantern loses its safe zone; shades walk to it and drain 5 fuel per second"); }],
    ],
  });
  log(`night 3 ended by ${r3}`);
  await sleep(300);
  const end3 = await state();
  log(`night 3 result: ${end3.status} score ${end3.score} lit ${end3.lit} flames ${end3.flames}`);
  await sub(page, end3.flames === 0 ? "PHASE 3: Night 3 ended as it happened: the last flame was lost to shades (no forced result)" : "PHASE 3: Night 3 ended as it happened, see the card");
  await sleep(3000);
  await sub(page, "PHASE 4: local leaderboard: name 3-12 characters, then Save");
  await page.locator("#name-input").click();
  await page.keyboard.type("Hoang_Demo", { delay: 80 });
  await sleep(600);
  await page.keyboard.press("Enter");
  await sleep(2500);
  await sleep(500);

  // ------------------------------------------------ Dawn: the win rule of Phase 3 on a short Night 1
  await dev("Night 1 shortened to 40 s, 4 of 5 lanterns start lit with 95 / 85 / 70 / 55 fuel, so dawn comes within the video", 5000);
  await page.evaluate(() => {
    const g = window.__game;
    g.hud.show("end", false);
    g.night = 1; g.total = 0; g.newSim();
    g.sim.timeLeftStart = 40;
    [95, 85, 70, 55].forEach((f, i) => { const l = g.sim.lanterns[i]; l.lit = true; l.everLit = true; l.fuel60 = f * 60; l.deposited = 10; });
    g.showIntro();
  });
  await sub(page, "PHASE 3: win at dawn: alive with at least 3 of 5 lanterns lit (60%). Lighting all five does not end the night early");
  await sleep(5000);
  await sub(page, "");
  await page.keyboard.press("Enter");
  await sleep(300);
  await sub(page, "PHASE 3: keep the lanterns fed until dawn; the sim decides the result");
  const r1 = await bot(70, { events: [[14, async () => { await sub(page, "PHASE 3: a lantern below 30 fuel blinks, shows a warning sign and loses its safe zone"); }]] });
  await sleep(300);
  const end = await state();
  log(`dawn result: ${end.status} score ${end.score} lit ${end.lit} flames ${end.flames} timeLeft ${end.timeLeft}`);
  await sub(page, end.status === "won" ? "PHASE 3: DAWN. At least 3 lanterns lit and Mây alive: the night is won. Score = 50 + fuel per lit lantern + 50 per flame" : end.flames === 0 ? "PHASE 3: the last flame was lost before dawn (no forced result)" : "PHASE 3: dawn came with too few lanterns lit: a loss");
  await sleep(6500);

  // ------------------------------------------------ Phase 4: leaderboard, settings, accessibility
  await sub(page, "PHASE 4: back to the menu, then the Leaderboard screen");
  await page.locator("#change-btn").click();
  await sleep(1800);
  await page.locator("#start-board").click();
  await sleep(3500);
  await page.locator("#board-close").click();
  await sub(page, "PHASE 4 accessibility: Settings with large text, easy colours, reduce motion, subtitles");
  await page.locator("#start-settings").click();
  await sleep(1800);
  await page.locator("#set-big").click();
  await sleep(1500);
  await page.locator("#set-cb").click();
  await sleep(1200);
  await page.locator("#set-rm").click();
  await sleep(1500);
  await sub(page, "PHASE 4: rebind a key: Jump, press E (already used): refused with a warning");
  await page.locator('button[data-a="jump"]').click();
  await sleep(700);
  await page.keyboard.press("e");
  await sleep(3200);
  await sub(page, "PHASE 4: Jump, press J: the key changes (Restore default keys undoes it)");
  await page.locator('button[data-a="jump"]').click();
  await sleep(500);
  await page.keyboard.press("j");
  await sleep(3000);
  await page.locator("#keys-reset").click();
  await sleep(1200);
  await page.locator("#set-close").click();
  await sub(page, "PHASE 4: subtitles and edge arrows showed up during play; the benchmark and soak files come next");
  await sleep(2500);
  await sub(page, "");
  await finishVideo(context, page, "part1-game.webm");
}

// ---------------------------------------------------------------- part 2 + 3: real command output
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
async function showCommands(browser) {
  const steps = JSON.parse(readFileSync(commandsFile, "utf8"));
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, recordVideo: { dir: outDir, size: { width: 1280, height: 720 } } });
  const page = await context.newPage();
  const groups = [
    [2, "Evidence: real commands, real output"],
    [3, "The repository and the AI harness"],
  ];
  for (const [part, title] of groups) {
    await page.setContent(`<body style="margin:0;background:#0b1020;color:#f5f1e6;font:600 44px 'Trebuchet MS',sans-serif;display:grid;place-items:center;height:100vh">${esc(title)}</body>`);
    await sleep(1600);
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
      await sleep(Math.max(3200, shown.length * 300));
    }
  }
  await sleep(600);
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
