// npm run evidence
// Runs every scenario through the real built CLI, runs the test suite, checks determinism, and GENERATES
// docs/evidence/phase-1/README.md + docs/evidence/harness-check.md. Pass/fail comes only from the assertions below.
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildHeadless } from "./build-headless.mjs";
import { runHarnessChecks } from "./harness-check.mjs";
import { root, readManifest, runCli, runEntry } from "./lib.mjs";

const argPhase = process.argv.indexOf("--phase");
const PHASE = argPhase > 0 ? process.argv[argPhase + 1] : "phase-2"; // "phase-2", "phase-3" or "extras"
const outDir = path.join(root, "docs/evidence", PHASE);
const rel = (p) => path.relative(root, p).split(path.sep).join("/");

await buildHeadless();
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

// ---- 1. run scenarios through the real CLI --------------------------------------------------
const manifest = readManifest();
const outputs = new Map(); // name -> { file, raw, lines, ms, status }
for (const e of manifest) {
  const file = path.join(outDir, `${e.name}.jsonl`);
  const t0 = process.hrtime.bigint();
  const r = runEntry(e, file);
  const ms = Number((process.hrtime.bigint() - t0) / 1000000n);
  let raw = "";
  try {
    raw = readFileSync(file, "utf8");
  } catch {
    /* CLI failed: checks will report it */
  }
  const lines = raw.trim() ? raw.trim().split("\n").map((l) => JSON.parse(l)) : [];
  outputs.set(e.name, { file, raw, lines, ms, status: r.status, entry: e });
}
const out = (n) => {
  const o = outputs.get(n);
  if (!o || o.status !== 0 || !o.lines.length) throw new Error(`scenario ${n} did not produce output`);
  return o;
};
const snaps = (n) => out(n).lines.filter((l) => l.type === "snapshot");
const snapAt = (n, t) => {
  const s = snaps(n).find((x) => x.tick === t);
  if (!s) throw new Error(`${n}: no snapshot at tick ${t}`);
  return s;
};
const events = (n, name) => out(n).lines.filter((l) => l.type === "event" && (!name || l.name === name));
const endOf = (n) => out(n).lines[out(n).lines.length - 1];

// ---- 2. vitest ------------------------------------------------------------------------------
const vitestJson = path.join(os.tmpdir(), `ddl-vitest-${process.pid}.json`);
const vt = spawnSync(process.execPath, [path.join(root, "node_modules/vitest/vitest.mjs"), "run", "--reporter=json", `--outputFile=${vitestJson}`], { cwd: root, encoding: "utf8" });
let vitest = null;
try {
  vitest = JSON.parse(readFileSync(vitestJson, "utf8"));
} catch {
  /* reported as failure below */
}
rmSync(vitestJson, { force: true });
const testFiles = (vitest?.testResults ?? []).map((f) => ({
  file: path.relative(root, f.name).split(path.sep).join("/"),
  tests: f.assertionResults.map((a) => ({ name: a.fullName, status: a.status })).sort((a, b) => a.name.localeCompare(b.name)),
}));
testFiles.sort((a, b) => a.file.localeCompare(b.file));
writeFileSync(path.join(outDir, "tests.json"), JSON.stringify({ passed: vitest?.numPassedTests ?? 0, failed: vitest?.numFailedTests ?? -1, total: vitest?.numTotalTests ?? 0, files: testFiles }, null, 2) + "\n");

// ---- 3. CLI error cases (temp files) --------------------------------------------------------
const tmp = mkdtempSync(path.join(os.tmpdir(), "ddl-ev-"));
const tmpFile = (n, c) => {
  const p = path.join(tmp, n);
  writeFileSync(p, c);
  return p;
};
const base = ["--seed", "1", "--night", "1", "--ticks", "10", "--out", path.join(tmp, "o.jsonl")];
const cliCases = [
  { name: "valid call", args: base, expect: 0 },
  { name: "inputs: invalid JSON", args: [...base, "--inputs", tmpFile("a.json", "{ nope")], expect: 2 },
  { name: "inputs: duplicate tick", args: [...base, "--inputs", tmpFile("b.json", '{"frames":[{"tick":2},{"tick":2}]}')], expect: 2 },
  { name: "inputs: decreasing tick", args: [...base, "--inputs", tmpFile("c.json", '{"frames":[{"tick":5},{"tick":1}]}')], expect: 2 },
  { name: "inputs: missing frames", args: [...base, "--inputs", tmpFile("d.json", "{}")], expect: 2 },
  { name: "scenario: bad pos", args: [...base, "--scenario", tmpFile("e.json", '{"player":{"pos":[1,2]}}')], expect: 2 },
  { name: "inputs: file not found", args: [...base, "--inputs", path.join(tmp, "missing.json")], expect: 2 },
  { name: "usage: --out missing", args: ["--seed", "1", "--ticks", "5"], expect: 1 },
  { name: "usage: --night 4", args: ["--seed", "1", "--night", "4", "--ticks", "5", "--out", path.join(tmp, "o.jsonl")], expect: 1 },
  { name: "valid call, night 2", args: ["--seed", "1", "--night", "2", "--ticks", "10", "--out", path.join(tmp, "o2.jsonl")], expect: 0 },
  { name: "valid call, night 3", args: ["--seed", "1", "--night", "3", "--ticks", "10", "--out", path.join(tmp, "o3.jsonl")], expect: 0 },
].map((c) => ({ ...c, got: runCli(c.args) }));

// ---- 4. determinism: re-run every scenario, compare to the evidence file --------------------
const detRows = [];
for (const e of manifest) {
  const again = path.join(tmp, `${e.name}.again.jsonl`);
  runEntry(e, again);
  let same = false;
  try {
    same = readFileSync(again).equals(readFileSync(outputs.get(e.name).file));
  } catch {
    /* same stays false */
  }
  detRows.push({ name: e.name, same });
}

// ---- 5. checks (assertion decides) ----------------------------------------------------------
const near = (a, b, eps = 0.0011) => Math.abs(a - b) <= eps;
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** each check returns an array of failure strings; empty means met */
const evOf = (n, name) => events(n, name);
const first = (n, name) => events(n, name)[0];
const dxz = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);
const fails = (...pairs) => pairs.filter(([ok]) => !ok).map(([, msg]) => msg);

const checks = {
  movement() {
    return fails(
      [eq(snapAt("accel", 6).player.vel, [0, 0, 6]), "full speed is not reached in 6 ticks"],
      [near(snapAt("accel", 60).player.pos[2], 5.75, 1e-6), `z at tick 60 = ${snapAt("accel", 60).player.pos[2]}, expected 5.75`],
      [near(snapAt("jump", 1).player.pos[1], 0.111, 1e-3) && near(snapAt("jump", 1).player.vel[1], 7 - 20 / 60, 2e-3), "jump start wrong"],
      [near(Math.max(...snaps("jump").map((s) => s.player.pos[1])), 1.167, 2e-3), "jump peak is not about 1.167 m"],
      [snapAt("jump", 60).player.grounded === true && snapAt("jump", 60).player.pos[1] === 0, "Mây did not land"],
    );
  },
  dash() {
    return fails(
      [eq(events("dash", "dash").map((e) => e.tick), [1, 92]), `dash ticks ${JSON.stringify(events("dash", "dash").map((e) => e.tick))}, expected [1,92] (a press at 89 must be refused)`],
      [snapAt("dash", 1).player.dash_cd_s === 1.5 && snapAt("dash", 91).player.dash_cd_s === 0, "dash cooldown is not 1.5 s from the start"],
      [near(snapAt("dash", 12).player.pos[2], 2.8, 2e-3), "dash distance is not 14 m/s x 12 ticks = 2.8 m"],
      [eq(snapAt("dash_facing", 12).player.pos, [0, 0, 2.8]), "standing dash does not go toward the facing direction (+Z)"],
    );
  },
  pickups() {
    return fails(
      [eq(events("pickup_height", "mote_picked").map((e) => e.data.carried), [1, 2]), "pickup radius / height rule wrong"],
      [snapAt("capacity", 10).player.carried === 10 && snapAt("capacity", 10).motes_active === 1, "capacity 10 not enforced"],
      [endOf("capacity").score === 0, "picking up gave points"],
    );
  },
  lanterns() {
    return fails(
      [eq(events("deposit_full").map((e) => [e.name, e.data]), [["night_start", { night: 1 }], ["deposit", { lantern_id: "L1", amount: 10, deposited: 10 }], ["lantern_lit", { lantern_id: "L1" }]]), "full deposit events wrong"],
      [snapAt("deposit_full", 1).score === 200, "score after lighting a lantern is not 10x10 + 100"],
      [eq(first("deposit_partial", "deposit").data, { lantern_id: "L1", amount: 6, deposited: 6 }), "partial deposit wrong"],
      [eq(first("deposit_topup", "deposit").data, { lantern_id: "L1", amount: 4, deposited: 10 }) && snapAt("deposit_topup", 1).player.carried === 3, "top-up deposit wrong"],
      [events("deposit_far", "deposit").length === 0, "interact worked at 2.1 m"],
    );
  },
  falling() {
    const hit = first("fall", "player_hit");
    const t = hit?.tick ?? 0;
    return fails(
      [eq(hit?.data, { by: "fall", flames: 2, dropped: 0, lost: 4 }), `fall event ${JSON.stringify(hit?.data)}`],
      [snapAt("fall", t).player.pos[1] < -10 && snapAt("fall", t).player.carried === 0, "fall: Y not below -10 or fireflies kept"],
      [snapAt("fall", t + 59).player.pos[1] < -10, "Mây came back before 60 ticks"],
      [eq(snapAt("fall", t + 60).player.pos, [0, 0, 0]) && eq(snapAt("fall", t + 60).player.vel, [0, 0, 0]) && snapAt("fall", t + 60).player.invuln === true, "respawn wrong"],
      [snapAt("fall", t + 60 + 90).player.invuln === false && snapAt("fall", t + 60 + 88).player.invuln === true, "respawn invulnerability is not 90 ticks"],
    );
  },
  shade_hit() {
    const hits = events("shade_hit", "player_hit");
    return fails(
      [eq(hits.map((e) => e.tick), [1, 91, 181]), `hit ticks ${JSON.stringify(hits.map((e) => e.tick))}, expected [1,91,181]`],
      [eq(hits[0]?.data, { by: "shade", flames: 2, dropped: 2, lost: 0 }), "first hit data wrong"],
      [snapAt("shade_hit", 1).shades[0].state === "recoil" && snapAt("shade_hit", 60).shades[0].state === "recoil" && snapAt("shade_hit", 61).shades[0].state === "chase", "recoil is not 60 ticks"],
      [snapAt("shade_hit", 1).motes.every((m) => m.kind === "dropped" && m.ttl_s === 8 && dxz(m.pos, snapAt("shade_hit", 1).player.pos) >= 1.499 && dxz(m.pos, snapAt("shade_hit", 1).player.pos) <= 2.501), "dropped fireflies wrong"],
      [eq(events("lose_flames", "game_over")[0]?.data, { result: "lost", reason: "no_flames" }) && endOf("lose_flames").ticks === 1, "no_flames loss wrong"],
    );
  },
  pulse() {
    return fails(
      [eq(first("pulse", "pulse").data, { stunned_ids: ["S1", "S3"] }), "pulse targets wrong"],
      [snapAt("pulse", 1).player.carried === 1 && snapAt("pulse", 1).score === 10, "pulse cost or +5 per shade wrong"],
      [snapAt("pulse", 120).shades[0].state === "stunned" && snapAt("pulse", 121).shades[0].state !== "stunned", "stun is not 120 ticks"],
      [near(snapAt("pulse", 15).shades[0].pos[0], 7, 2e-3) && near(snapAt("pulse", 60).shades[0].pos[0], 7, 2e-3), "push is not 4 m in 15 ticks"],
      [eq(events("pulse_cooldown", "pulse").map((e) => e.tick), [1, 182]), "cooldown not 3 s from the press"],
      [events("pulse_no_light", "pulse").length === 0, "pulse worked with fewer than 3 fireflies"],
    );
  },
  safe_zone() {
    const f = [];
    for (const s of snaps("safe_zone")) for (const sh of s.shades) if (dxz(sh.pos, [0, 0, 25]) < 5.999) f.push(`tick ${s.tick}: shade ${dxz(sh.pos, [0, 0, 25]).toFixed(3)} m from the lit lantern`);
    if (events("safe_zone", "player_hit").length) f.push("hit inside the safe zone");
    const d = (t) => dxz(snapAt("lit_pushout", t).shades[0].pos, [0, 0, 25]);
    if (events("lit_pushout", "player_hit").length) f.push("a shade hurt Mây while being pushed out");
    if (!(d(1) < 6 && d(31) >= 5.999 && d(31) <= 6.05)) f.push(`push-out: ${d(1).toFixed(2)} -> ${d(31).toFixed(2)} m`);
    return f.slice(0, 4);
  },
  win_lose() {
    const e = endOf("win");
    return fails(
      [eq(e, { type: "end", ticks: 1, state: "won", score: 100 + 100 + 198 + 150 }), `win end line ${JSON.stringify(e)}`],
      [eq(events("win", "game_over")[0]?.data, { result: "won", reason: "all_lit" }), "win reason"],
      [eq(events("win_last_tick", "game_over")[0]?.data, { result: "won", reason: "all_lit" }), "a win on the last tick must be a win"],
      [eq(events("lose_dawn", "game_over")[0], { type: "event", tick: 120, name: "game_over", data: { result: "lost", reason: "dawn" } }), "dawn loss wrong"],
    );
  },
  shade_spawns() {
    const sp = events("shade_random", "shade_spawned").map((e) => [e.tick, e.data.id]);
    return fails(
      [eq(sp.slice(0, 4), [[300, "S1"], [300, "S2"], [780, "S3"], [1260, "S4"]]), `spawns ${JSON.stringify(sp.slice(0, 5))}`],
      [snapAt("shade_random", 300).shades.every((s) => s.state === "spawning" && near(Math.hypot(s.pos[0], s.pos[2]), 37, 0.01)), "new shades are not spawning on the r=37 ring"],
      [snapAt("shade_random", 350).shades[0].state === "spawning" && snapAt("shade_random", 360).shades[0].state !== "spawning", "spawning lasts 60 ticks"],
      [snapAt("shade_detect", 1).shades[0].state === "chase" && snapAt("shade_detect", 1).shades[1].state === "wander", "12 m detection wrong"],
    );
  },
  motes() {
    return fails(
      [snapAt("mote_spawn", 0).motes_active === 20 && new Set(snapAt("mote_spawn", 0).motes.map((m) => m.pos.join(","))).size === 20, "20 distinct start points"],
      [snapAt("mote_spawn", 230).motes_active === 20 && snapAt("mote_spawn", 240).motes_active === 21 && snapAt("mote_spawn", 480).motes_active === 22, "one firefly every 240 ticks"],
    );
  },
  pause() {
    return fails(
      [eq(events("pause", "paused").map((e) => e.tick), [11, 31]) && eq(events("pause", "resumed").map((e) => e.tick), [21, 41]), "paused / resumed events"],
      [snapAt("pause", 11).state === "paused" && snapAt("pause", 11).tick === 11 && snapAt("pause", 11).sim_tick === 10, "paused snapshot wrong"],
      [snapAt("pause", 20).sim_tick === 10 && eq(snapAt("pause", 20).player.pos, snapAt("pause", 11).player.pos), "the world moved while paused"],
      [snapAt("pause", 21).state === "playing" && snapAt("pause", 21).sim_tick === 11, "resume tick should run"],
    );
  },
  night2() {
    const t = first("night2_off_bridge", "player_hit")?.tick ?? 0;
    return fails(
      [snapAt("night2_bridge", 600).player.grounded && snapAt("night2_bridge", 700).player.pos[0] > 70 && events("night2_bridge", "player_hit").length === 0, "could not cross the bridge"],
      [t > 55 && t < 75, `fall beside the bridge at tick ${t}`],
      [snapAt("random_night2", 0).lanterns.length === 6 && snapAt("random_night2", 0).night === 2 && snapAt("random_night2", 0).time_left_s === 330, "night 2: 6 lanterns, 330 s"],
    );
  },
  pads() {
    const v = snapAt("night2_pad", 1).player.vel;
    const land = snapAt("night2_pad", 86).player;
    const p3 = snapAt("night3_pad", 60).player;
    return fails(
      [near(v[1], 14 - 20 / 60, 2e-3) && near(Math.hypot(v[0], v[2]), 24, 0.02) && v[0] > 0, "night 2 pad launch"],
      [snapAt("night2_pad", 80).player.grounded === false && land.grounded === true && dxz(land.pos, [70, 0, 0]) < 28, "night 2 flight is not about 1.4 s onto island B"],
      [near(snapAt("night2_pad", 50).player.vel[0], v[0], 1e-6), "launch velocity changed in the air"],
      [near(snapAt("night3_pad", 1).player.vel[1], 12 - 20 / 60, 2e-3) && snapAt("night3_pad", 1).player.vel[2] === -8, "night 3 pad launch"],
      [p3.pos[1] === 6 && p3.grounded && Math.hypot(p3.pos[0], p3.pos[2]) <= 8, "did not land on floor 2"],
    );
  },
  charm() {
    return fails(
      [eq(first("night2_charm", "charm_picked").data, { charm_id: "C1", charm_ticks: 600 }), "charm event"],
      [snapAt("night2_charm", 1).player.charm_s === 10 && near(snapAt("night2_charm", 13).player.vel[0], 7.2, 1e-6), "charm speed 7.2 m/s for 600 ticks"],
      [snapAt("night2_charm", 32).player.dash_cd_s === 0 && snapAt("night2_charm", 31).player.vel[0] === 14, "dash without cooldown at 14 m/s"],
      [eq(snapAt("night2_charm", 1).charms, [{ id: "C1", available: false, respawn_s: 45 }]), "charm respawn 45 s"],
    );
  },
  night3() {
    const cliff = Math.min(...snaps("night3_cliff").map((s) => Math.hypot(s.player.pos[0], s.player.pos[2])));
    return fails(
      [snapAt("random_night3", 0).lanterns.length === 7 && snapAt("random_night3", 0).time_left_s === 360, "night 3: 7 lanterns, 360 s"],
      [cliff > 7.9 && snaps("night3_cliff").at(-1).player.pos[1] === 0, `cliff: closest approach ${cliff.toFixed(2)} m`],
      [snapAt("night3_ramp", 60).player.pos[1] > 2 && snapAt("night3_ramp", 60).player.pos[1] < 3 && snapAt("night3_ramp", 120).player.pos[1] === 3 && snapAt("night3_ramp", 300).player.pos[1] === 0, "ramp / floor 1 / drop"],
    );
  },
  wind() {
    const a = snapAt("night3_wind", 1800);
    const b = snapAt("night3_wind", 2100);
    const d = Math.hypot(b.player.pos[0] - a.player.pos[0], b.player.pos[2] - a.player.pos[2]);
    return fails(
      [snapAt("night3_wind", 1750).wind.active === false && a.wind.active === true && snapAt("night3_wind", 2050).wind.active && b.wind.active === false, "gust window 1800..2099"],
      [near(d, 10, 0.05), `gust moved Mây ${d.toFixed(3)} m, expected about 10`],
      [a.wind.dir_deg === b.wind.dir_deg, "wind direction changed during the gust"],
    );
  },
  drifters() {
    const e = first("drifter_steal", "drifter_steal");
    const dp = snapAt("drifter_pulse", 1);
    return fails(
      [eq(e?.data, { drifter_id: "D1", amount: 3, carried: 3 }) && events("drifter_steal", "player_hit").length === 0, "steal event / flame lost"],
      [eq(first("drifter_pulse", "drifter_drop").data, { drifter_id: "D2", amount: 3 }) && dp.motes.filter((m) => m.kind === "dropped").length === 3, "pulse on a loaded drifter"],
      [dp.drifters.find((d) => d.id === "D1").state === "flee" && dp.drifters.find((d) => d.id === "D1").stolen === 0, "pulse on a chasing drifter"],
    );
  },
  determinism() {
    return detRows.filter((r) => !r.same).map((r) => `${r.name}: second run differs`);
  },
  output_format() {
    const f = [];
    for (const [name, o] of outputs) {
      if (o.status !== 0) {
        f.push(`${name}: CLI exit ${o.status}`);
        continue;
      }
      const L = o.lines;
      if (L[0].type !== "snapshot" || L[0].tick !== 0) f.push(`${name}: first line is not snapshot tick 0`);
      if (L[L.length - 1].type !== "end" || L.filter((l) => l.type === "end").length !== 1) f.push(`${name}: end line missing or not last`);
      if (/\d\.\d{4,}/.test(o.raw)) f.push(`${name}: a number has more than 3 decimals`);
      let last = -1;
      for (const l of L) if (l.type !== "end") (l.tick < last ? f.push(`${name}: tick went backwards`) : (last = l.tick));
      const s0 = L[0];
      for (const k of ["night", "wind", "motes", "drifters", "charms"]) if (!(k in s0)) f.push(`${name}: snapshot lacks ${k}`);
      for (const k of ["vel", "grounded", "invuln", "dash_cd_s", "pulse_cd_s", "charm_s"]) if (!(k in s0.player)) f.push(`${name}: player lacks ${k}`);
    }
    return f.slice(0, 5);
  },
  exit_codes() {
    return cliCases.filter((c) => c.got.status !== c.expect || (c.expect !== 0 && !c.got.stderr.includes("error:"))).map((c) => `${c.name}: exit ${c.got.status}, expected ${c.expect}`);
  },
  speed() {
    const f = [];
    for (const [n, ticks] of [["full_night1", 18000], ["full_night2", 19800], ["full_night3", 21600]]) {
      const o = out(n);
      if (endOf(n).ticks !== ticks) f.push(`${n}: ran ${endOf(n).ticks} ticks, expected ${ticks}`);
      if (o.ms > 30000) f.push(`${n}: ${o.ms} ms (limit 30000)`);
    }
    return f;
  },
  unit_tests() {
    return vitest && vitest.numFailedTests === 0 && vitest.numTotalTests > 0 ? [] : [`vitest failed: ${vitest ? vitest.numFailedTests + " failing" : "no report"}`];
  },
  contract() {
    const f = [];
    const rows = testFiles.find((x) => x.file === "tests/io.test.ts")?.tests.filter((t) => t.name.startsWith("contract ")) ?? [];
    if (rows.length < 5 || rows.some((t) => t.status !== "passed")) f.push("contract tests missing or failing");
    const c = JSON.parse(readFileSync(path.join(root, "game.contract.json"), "utf8"));
    if (c.contract_version !== "1.1" || c.team !== "2A202603622-NgoHuyHoang") f.push("contract header wrong");
    return f;
  },
  extras_off() {
    // headless output with the extras in the repo must equal the files recorded in docs/evidence/phase-2
    const f = [];
    if (/CardKit|CubKit|WeaverKit|KitBase/.test(readFileSync(path.join(root, "dist/headless/cli.js"), "utf8"))) f.push("built CLI contains extras code");
    for (const [name, o] of outputs) {
      let ref;
      try {
        ref = readFileSync(path.join(root, "docs/evidence/phase-2", `${name}.jsonl`), "utf8");
      } catch {
        f.push(`${name}: no docs/evidence/phase-2 file to compare with`);
        continue;
      }
      if (ref !== o.raw) f.push(`${name}: output differs from docs/evidence/phase-2`);
    }
    return f.slice(0, 5);
  },
  extras_tests() {
    const mine = testFiles.filter((x) => ["tests/extras.test.ts", "tests/champions.test.ts", "tests/steer.test.ts"].includes(x.file));
    const t = mine.flatMap((x) => x.tests);
    const bad = t.filter((x) => x.status !== "passed").length;
    return mine.length === 3 && t.length >= 70 && bad === 0 ? [] : [`extras tests: ${mine.length}/3 files, ${t.length} tests, ${bad} failing`];
  },
};

// ---- 6. requirements table ------------------------------------------------------------------
const reqs = JSON.parse(readFileSync(path.join(root, `docs/evidence/requirements-${PHASE}.json`), "utf8")).requirements;
const rows = reqs.map((r) => {
  let fails;
  try {
    fails = checks[r.check] ? checks[r.check]() : [`no check named "${r.check}"`];
  } catch (e) {
    fails = [`check crashed: ${e.message}`];
  }
  const paths = (r.scenarios ?? []).map((n) => `docs/evidence/${PHASE}/${n}.jsonl`);
  if (r.check === "unit_tests" || r.check === "contract") paths.push(`docs/evidence/${PHASE}/tests.json`);
  if (r.check === "exit_codes") paths.push("(CLI exit codes, see section below)");
  return { ...r, paths, pass: fails.length === 0, fails };
});

// ---- 7. write README + harness-check --------------------------------------------------------
const git = (...a) => {
  try {
    return execFileSync("git", a, { cwd: root, encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
};
const dirty = git("status", "--porcelain", "--", ".", ":(exclude)docs/evidence").split("\n").filter(Boolean);
const cpu = os.cpus();
const esc = (s) => String(s).replace(/\|/g, "\\|").replace(/\n/g, " ");
const met = rows.filter((r) => r.pass).length;
const md = [];
md.push(`# Evidence: ${PHASE}`, "", "Generated by `npm run evidence` (scripts/evidence.mjs). Do not edit by hand: results come from assertions in that script, run against the real CLI output in this folder.", "");
md.push("| field | value |", "|---|---|");
md.push(`| code commit (HEAD when generated) | \`${git("rev-parse", "HEAD")}\` |`);
md.push(`| uncommitted changes outside docs/evidence | ${dirty.length ? `YES (${dirty.length} files)` : "none"} |`);
md.push(`| generated at | ${new Date().toISOString()} |`);
md.push(`| node | ${process.version} |`);
md.push(`| machine | ${os.platform()} ${os.release()} ${os.arch()}, ${cpu[0]?.model.trim()} x${cpu.length}, ${(os.totalmem() / 2 ** 30).toFixed(1)} GiB RAM |`);
md.push(`| requirements met | **${met} / ${rows.length}** |`);
md.push(`| unit tests | ${vitest ? `${vitest.numPassedTests} passed, ${vitest.numFailedTests} failed, ${vitest.numTotalTests} total` : "no report"} |`);
md.push("", "## Requirements", "", "| id | requirement | how it is checked | evidence | result |", "|---|---|---|---|---|");
for (const r of rows) {
  md.push(`| ${r.id} | ${esc(r.requirement)} | ${esc(r.how)} | ${r.paths.map((p) => `\`${p}\``).join("<br>")} | ${r.pass ? "met" : "**not met**: " + esc(r.fails.join("; "))} |`);
}
md.push("", "## Scenario runs", "", "| scenario | seed | ticks asked | ticks run | final state | score | CLI exit | wall ms |", "|---|---|---|---|---|---|---|---|");
for (const [name, o] of outputs) {
  const end = o.lines[o.lines.length - 1];
  md.push(`| ${name} | ${o.entry.seed} | ${o.entry.ticks} | ${end?.ticks ?? "-"} | ${end?.state ?? "-"} | ${end?.score ?? "-"} | ${o.status} | ${o.ms} |`);
}
md.push("", "## CLI exit codes", "", "| case | expected | got |", "|---|---|---|");
for (const c of cliCases) md.push(`| ${c.name} | ${c.expect} | ${c.got.status} |`);
md.push("", "## Determinism", "", "Each scenario was run a second time into a temp file and compared with the file in this folder, byte for byte.", "", "| scenario | identical |", "|---|---|");
for (const d of detRows) md.push(`| ${d.name} | ${d.same ? "yes" : "**NO**"} |`);
md.push("");
writeFileSync(path.join(outDir, "README.md"), md.join("\n"));

const hc = runHarnessChecks();
const hmd = ["# Harness check", "", "Generated by `npm run evidence` (scripts/harness-check.mjs). Real hook scripts, real payloads; exit code 2 means the hook blocked the call.", "", `Generated at ${new Date().toISOString()}, code commit \`${git("rev-parse", "HEAD")}\`, node ${process.version}.`, "", "| case | expected | got | result |", "|---|---|---|---|"];
for (const r of hc) hmd.push(`| ${esc(r.name)} | ${r.expect} | ${esc(r.got)} | ${r.pass ? "ok" : "**FAIL**"} |`);
hmd.push("", `${hc.filter((r) => r.pass).length} / ${hc.length} ok`, "");
writeFileSync(path.join(root, "docs/evidence/harness-check.md"), hmd.join("\n"));

rmSync(tmp, { recursive: true, force: true });
const bad = rows.filter((r) => !r.pass);
console.log(`evidence: ${met}/${rows.length} requirements met; harness ${hc.filter((r) => r.pass).length}/${hc.length}; see docs/evidence/${PHASE}/README.md`);
for (const r of bad) console.log(`  not met ${r.id}: ${r.fails.join("; ")}`);
process.exit(bad.length || hc.some((r) => !r.pass) ? 1 : 0);
