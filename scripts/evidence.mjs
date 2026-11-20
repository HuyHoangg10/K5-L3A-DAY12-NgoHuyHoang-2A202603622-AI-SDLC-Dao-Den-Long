// npm run evidence
// Runs every scenario through the real built CLI, runs the test suite, checks determinism, and GENERATES
// docs/evidence/phase-1/README.md + docs/evidence/harness-check.md. Pass/fail comes only from the assertions below.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildHeadless } from "./build-headless.mjs";
import { runHarnessChecks } from "./harness-check.mjs";
import { root, readManifest, runCli, runEntry } from "./lib.mjs";

const argPhase = process.argv.indexOf("--phase");
const PHASE = argPhase > 0 ? process.argv[argPhase + 1] : "phase-4"; // "phase-2" and "phase-3" are frozen at their tags; "phase-4" is the release; "extras"
const P3 = PHASE !== "phase-2"; // Ticket-03 rules (fuel, dawn win rule, new durations)
const REF_PHASE = existsSync(path.join(root, "docs/evidence/phase-4")) ? "phase-4" : "phase-3"; // newest recorded output // the extras must not change the headless output recorded here
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
      [eq(events("deposit_full").map((e) => [e.name, e.data]), [["night_start", { night: 1 }], ["deposit", { lantern_id: "L1", amount: 10, deposited: 10 }], ["lantern_lit", P3 ? { lantern_id: "L1", relight: false } : { lantern_id: "L1" }]]), "full deposit events wrong"],
      [snapAt("deposit_full", 1).score === (P3 ? 150 : 200), P3 ? "score after lighting a lantern is not 10x5 + 100" : "score after lighting a lantern is not 10x10 + 100"],
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
      [eq(hits[0]?.data, { by: "shade", flames: 2, dropped: 2 }), "first hit data wrong"],
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
      [snapAt("random_night2", 0).lanterns.length === 6 && snapAt("random_night2", 0).night === 2 && snapAt("random_night2", 0).time_left_s === (P3 ? 270 : 330), "night 2: 6 lanterns, " + (P3 ? 270 : 330) + " s"],
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
      [snapAt("random_night3", 0).lanterns.length === 7 && snapAt("random_night3", 0).time_left_s === (P3 ? 300 : 360), "night 3: 7 lanterns, " + (P3 ? 300 : 360) + " s"],
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
  // ---- Ticket-03 (phase 3) -----------------------------------------------------------------
  fuel() {
    const L = (n, t) => snapAt(n, t).lanterns.find((l) => l.id === "L1");
    return fails(
      [L("fuel_decay", 0).fuel === 100 && L("fuel_decay", 60).fuel === 99 && L("fuel_decay", 600).fuel === 90, "a lit lantern must lose 1 fuel per second"],
      [eq(events("lantern_out", "lantern_out"), [{ type: "event", tick: 120, name: "lantern_out", data: { lantern_id: "L1" } }]), "lantern_out must come at tick 120 for 2 fuel"],
      [L("lantern_out", 120).lit === false && L("lantern_out", 120).deposited === 0 && L("lantern_out", 120).ever_lit === true && L("lantern_out", 100).lit === true, "an empty lantern goes out, forgets its fireflies, remembers it was lit"],
    );
  },
  refuel() {
    return fails(
      [eq(first("refuel", "refuel")?.data, { lantern_id: "L1", amount: 6, fuel: 100 }) && snapAt("refuel", 1).player.carried === 4, "45 fuel with 10 carried must use 6 fireflies (ceil(55/10)) and give 100"],
      [snapAt("refuel", 1).score === 30, "a refuel gives +5 per firefly used"],
      [eq(first("refuel_small", "refuel")?.data, { lantern_id: "L1", amount: 2, fuel: 100 }), "85 fuel needs 2 fireflies"],
      [events("refuel_no_light", "refuel").length === 0 && endOf("refuel_no_light").score === 0, "with nothing carried nothing happens"],
    );
  },
  relight() {
    const L1 = snapAt("relight", 1).lanterns.find((l) => l.id === "L1");
    const p = snapAt("relight_partial", 1).lanterns.find((l) => l.id === "L1");
    return fails(
      [eq(first("relight", "deposit")?.data, { lantern_id: "L1", amount: 5, deposited: 5 }) && eq(first("relight", "lantern_lit")?.data, { lantern_id: "L1", relight: true }), "a lantern lit before needs only 5 fireflies"],
      [L1.lit && L1.fuel === 100 && L1.relit_count === 1 && snapAt("relight", 1).score === 5 * 5 + 40, "relight: fuel 100, relit_count 1, +5 each and +40"],
      [p.lit === false && p.deposited === 3 && events("relight_partial", "lantern_lit").length === 0, "3 of 5 fireflies must not light it"],
    );
  },
  drain() {
    const ticks = events("drain", "fuel_drain").map((e) => e.tick);
    return fails(
      [snapAt("drain", 10).shades[0].state === "drain", "the wandering shade must stop and drain the weak lantern"],
      [eq(ticks.slice(0, 4), [61, 121, 181, 241]), `fuel_drain ticks ${JSON.stringify(ticks.slice(0, 4))}`],
      [eq(first("drain", "fuel_drain")?.data, { lantern_id: "L1", shade_id: "S1", fuel: 19 }), "after 60 ticks of draining: 25 - 6 = 19"],
      [events("drain", "lantern_out").length === 1, "the drained lantern must go out"],
      [events("drain_two_shades", "fuel_drain").filter((e) => e.tick === 61).length === 2, "two shades each report their drain"],
      [snapAt("drain_chase", 0).shades[0].state === "drain" && snapAt("drain_chase", 1).shades[0].state === "chase", "Mây within 6 m: the draining shade turns to chase"],
      [eq(first("drain_pulse", "pulse")?.data, { stunned_ids: ["S1"] }) && snapAt("drain_pulse", 1).score === 15, "a pulse on a draining shade gives +15"],
    );
  },
  weak_safe() {
    const d = (n) => Math.min(...snaps(n).map((s) => dxz(s.shades[0].pos, [0, 0, 25])));
    return fails(
      [d("weak_unsafe") < 5.5, "with fuel 29 the shade must be able to come inside 6 m"],
      [d("strong_safe") >= 5.999, "with fuel 31 the shade must stay out of 6 m"],
      [snapAt("refuel_pushout", 1).shades[0].state !== "drain" && events("refuel_pushout", "player_hit").length === 0 && dxz(snapAt("refuel_pushout", 31).shades[0].pos, [0, 0, 25]) >= 5.999, "refuelling to 30+ pushes the draining shade out without hurting"],
      [dxz(snapAt("wander_to_weak", 60).shades[0].pos, [23.8, 0, 7.7]) < dxz(snapAt("wander_to_weak", 0).shades[0].pos, [23.8, 0, 7.7]) && snapAt("wander_to_weak", 120).shades[0].state === "drain", "a wandering shade must walk to the weak lit lantern and drain it"],
    );
  },
  capacity() {
    return fails(
      [snapAt("capacity_growth", 0).player.capacity === 16 && snapAt("capacity_growth", 5).player.carried === 16, "10 + 2 x 3 lightings = 16 and pickup stops there"],
      [snapAt("capacity_cap", 0).player.capacity === 20, "capacity never goes above 20"],
      [snapAt("light_grows_capacity", 0).player.capacity === 10 && snapAt("light_grows_capacity", 2).player.capacity === 12, "lighting a lantern raises capacity by 2"],
    );
  },
  dawn() {
    return fails(
      [eq(endOf("dawn_win"), { type: "end", ticks: 60, state: "won", score: 3 * (50 + 49) + 150 }) && eq(first("dawn_win", "game_over")?.data, { result: "won", reason: "dawn_survived" }), `dawn_win end ${JSON.stringify(endOf("dawn_win"))}`],
      [eq(first("dawn_lose_threshold", "game_over")?.data, { result: "lost", reason: "dawn" }) && endOf("dawn_lose_threshold").score === 0, "2 of 5 lit is below ceil(0.6 x 5) = 3"],
      [events("all_lit_no_early_win", "game_over").length === 0 && endOf("all_lit_no_early_win").state === "playing", "lighting every lantern must not end the night early"],
      [eq(events("lose_dawn", "game_over")[0], { type: "event", tick: 120, name: "game_over", data: { result: "lost", reason: "dawn" } }), "dawn loss wrong"],
    );
  },
  // ---- Ticket-04 (phase 4) -----------------------------------------------------------------
  bench() {
    const f = [];
    let b;
    try {
      b = JSON.parse(readFileSync(path.join(root, "bench.json"), "utf8"));
    } catch {
      return ["bench.json is missing or not JSON (run `npm run bench` and commit it)"];
    }
    for (const k of ["contract_version", "avg_fps", "p1_low_fps", "frame_ms_p95", "frames", "load_ms", "peak_mem_mb", "vsync_off", "renderer", "os"]) if (!(k in b)) f.push(`bench.json lacks ${k}`);
    if (b.contract_version !== "1.3") f.push(`bench.json contract_version ${b.contract_version}`);
    if (!(b.avg_fps > 60)) f.push(`avg_fps ${b.avg_fps} is not above 60`);
    if (!(b.p1_low_fps > 30)) f.push(`p1_low_fps ${b.p1_low_fps} is not above 30`);
    if (!(b.load_ms < 10000)) f.push(`load_ms ${b.load_ms} is not below 10000`);
    if (!(b.frames > 0)) f.push("no frames measured");
    if (b.duration_s !== 30 || b.seed !== 42) f.push(`bench.json is not from the standard run (seed ${b.seed}, duration ${b.duration_s}); use \`npm run bench\``);
    if (b.peak_mem_mb === null && !(b.notes ?? []).some((n) => /peak_mem_mb/.test(n))) f.push("peak_mem_mb is null without an explanation");
    return f;
  },
  soak() {
    const f = [];
    let committed;
    try {
      committed = JSON.parse(readFileSync(path.join(root, "soak.json"), "utf8"));
    } catch {
      return ["soak.json is missing or not JSON (run `npm run soak` and commit it)"];
    }
    // the evidence run itself: the contract's soak_cmd, executed now
    const contract = JSON.parse(readFileSync(path.join(root, "game.contract.json"), "utf8"));
    const outFile = path.join(outDir, "soak-run.json");
    const parts = contract.soak_cmd.split(" ").slice(1);
    const r = spawnSync(process.execPath, [...parts, "--seed", "7", "--nights", "10", "--out", outFile], { cwd: root, encoding: "utf8" });
    let live = null;
    try {
      live = JSON.parse(readFileSync(outFile, "utf8"));
    } catch {
      f.push(`soak_cmd failed (exit ${r.status})`);
    }
    for (const [name, x] of [["soak.json", committed], ["soak run now", live]]) {
      if (!x) continue;
      if (x.nights !== 10 || x.results?.length !== 10) f.push(`${name}: not 10 nights`);
      if (x.crashes !== 0) f.push(`${name}: ${x.crashes} crashes`);
      if (!(x.mem_end_mb < 1.2 * x.mem_start_mb)) f.push(`${name}: mem_end ${x.mem_end_mb} is not below 1.2 x ${x.mem_start_mb}`);
      for (const k of ["nights", "crashes", "results", "mem_start_mb", "mem_end_mb", "duration_s"]) if (!(k in x)) f.push(`${name} lacks ${k}`);
    }
    return f;
  },
  leaderboard() {
    const f = [];
    const dir = mkdtempSync(path.join(os.tmpdir(), "ddl-lb-"));
    const data = path.join(dir, "board.json");
    const mk = (name, score, at) => ({ name, score, nights_won: 1, achieved_at: at, seed: 1 });
    // 12 entries, including a tie (the earlier one must stay on top), written as a store file
    const rows = [mk("Aaa", 50, "2026-01-01T10:00:00+07:00"), mk("Bbb", 500, "2026-01-02T10:00:00+07:00"), mk("Ccc", 500, "2026-01-01T10:00:00+07:00")];
    for (let i = 0; i < 9; i++) rows.push(mk(`Fill_${i}`, 100 + i, "2026-01-03T10:00:00+07:00"));
    writeFileSync(data, JSON.stringify({ entries: rows }));
    const out = path.join(dir, "out.json");
    const r = spawnSync(process.execPath, [path.join(root, "dist/headless/launcher.js"), "--export-leaderboard", out], { cwd: root, encoding: "utf8", env: { ...process.env, LEADERBOARD_FILE: data } });
    let got = null;
    try {
      got = JSON.parse(readFileSync(out, "utf8"));
    } catch {
      f.push(`--export-leaderboard failed (exit ${r.status}): ${r.stderr.trim().slice(0, 100)}`);
    }
    if (got) {
      const names = got.entries.map((e) => e.name);
      if (!eq(Object.keys(got), ["entries"])) f.push("export must be {\"entries\": [...]}");
      if (got.entries.length !== 10) f.push(`${got.entries.length} entries exported, expected the top 10`);
      if (!eq(names.slice(0, 2), ["Ccc", "Bbb"])) f.push(`tie order wrong: ${names.slice(0, 2)} (the earlier 500 must be first)`);
      if (names.includes("Aaa")) f.push("the lowest score must fall off the top 10");
      for (const k of ["name", "score", "nights_won", "achieved_at", "seed"]) if (!(k in got.entries[0])) f.push(`entry lacks ${k}`);
    }
    const bad = spawnSync(process.execPath, [path.join(root, "dist/headless/launcher.js"), "--export-leaderboard"], { cwd: root, encoding: "utf8" });
    if (bad.status !== 1) f.push("--export-leaderboard without a file must exit 1");
    const lt = testFiles.find((x) => x.file === "tests/leaderboard.test.ts");
    if (!lt || lt.tests.length < 20 || lt.tests.some((t) => t.status !== "passed")) f.push("leaderboard tests missing or failing");
    rmSync(dir, { recursive: true, force: true });
    return f;
  },
  accessibility() {
    const f = [];
    const html = readFileSync(path.join(root, "index.html"), "utf8");
    for (const id of ["set-rm", "set-big", "set-sub", "keys", "keys-reset", "key-warn", "cues"]) if (!html.includes(`id="${id}"`)) f.push(`index.html lacks #${id}`);
    if (!/--fs:\s*18px/.test(html) || !/body\.big\s*\{\s*--fs:\s*22\.5px/.test(html)) f.push("base font must be 18 px and large text 22.5 px (x1.25)");
    const st = testFiles.find((x) => x.file === "tests/settings.test.ts");
    if (!st || st.tests.length < 7 || st.tests.some((t) => t.status !== "passed")) f.push("settings tests missing or failing");
    const p4 = testFiles.find((x) => x.file === "tests/phase4.test.ts");
    if (!p4 || p4.tests.some((t) => t.status !== "passed")) f.push("phase4 tests missing or failing");
    return f;
  },
  packaging() {
    const f = [];
    const read = (p) => {
      try {
        return readFileSync(path.join(root, p), "utf8");
      } catch {
        f.push(`${p} is missing`);
        return "";
      }
    };
    const readme = read("README.md");
    const cl = read("CHANGELOG.md");
    const block = readme.match(/## Run it \(3 commands\)[\s\S]*?```\n([\s\S]*?)```/);
    const cmds = block ? block[1].trim().split("\n").filter(Boolean) : [];
    if (cmds.length < 1 || cmds.length > 3) f.push(`README run block has ${cmds.length} commands (must be 1 to 3)`);
    for (const w of ["Settings and accessibility", "Leaderboard", "System requirements", "bench", "soak", "Controls", "npm test"]) if (!new RegExp(w, "i").test(readme)) f.push(`README lacks "${w}"`);
    if (!/!\[[^\]]*\]\(docs\/img\/[^)]+\)/.test(readme)) f.push("README has no screenshot (docs/img/*.png)");
    for (const w of ["phase-1", "phase-2", "phase-3", "phase-4"]) if (!cl.includes(`## ${w}`)) f.push(`CHANGELOG lacks ## ${w}`);
    const cr = read("CREDITS.md");
    if (!/Claude/i.test(cr) || !/Three\.js/i.test(cr)) f.push("CREDITS must name the AI tool and Three.js");
    if (!/MIT License/.test(read("LICENSE"))) f.push("LICENSE is not the MIT text");
    return f;
  },
  retro() {
    const f = [];
    let r = "";
    try {
      r = readFileSync(path.join(root, "docs/notes/retro.md"), "utf8");
    } catch {
      return ["docs/notes/retro.md is missing"];
    }
    const words = r.split(/\s+/).filter(Boolean).length;
    if (words < 350 || words > 1100) f.push(`retro has ${words} words (about 1 to 2 pages is 350 to 1100)`);
    for (const w of ["Evaluation", "mistakes", "harness", "tokens", "change"]) if (!new RegExp(w, "i").test(r)) f.push(`retro does not mention "${w}"`);
    if (/TODO|fill in|\.\.\.$/m.test(r)) f.push("retro still has a placeholder");
    return f;
  },
  demo_video() {
    const readme = readFileSync(path.join(root, "README.md"), "utf8");
    const link = readme.match(/\*\*Demo video:\*\*\s*(\S.*)/);
    const hasFile = existsSync(path.join(root, "docs/demo/demo.mp4"));
    if (hasFile) return [];
    if (link && /https?:\/\//.test(link[1])) return [];
    return ["no demo video yet: the README line `**Demo video:**` has no link and docs/demo/demo.mp4 does not exist (recorded by the student)"];
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
      for (const k of ["vel", "grounded", "invuln", "dash_cd_s", "pulse_cd_s", "charm_s", ...(P3 ? ["capacity"] : [])]) if (!(k in s0.player)) f.push(`${name}: player lacks ${k}`);
      if (P3) for (const k of ["fuel", "ever_lit", "relit_count"]) if (!(k in s0.lanterns[0])) f.push(`${name}: lantern lacks ${k}`);
    }
    return f.slice(0, 5);
  },
  exit_codes() {
    return cliCases.filter((c) => c.got.status !== c.expect || (c.expect !== 0 && !c.got.stderr.includes("error:"))).map((c) => `${c.name}: exit ${c.got.status}, expected ${c.expect}`);
  },
  speed() {
    const f = [];
    for (const [n, ticks] of (P3 ? [["full_night1", 14400], ["full_night2", 16200], ["full_night3", 18000]] : [["full_night1", 18000], ["full_night2", 19800], ["full_night3", 21600]])) {
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
    if (c.contract_version !== (PHASE === "phase-2" ? "1.1" : PHASE === "phase-3" ? "1.2" : "1.3") || c.team !== "2A202603622-NgoHuyHoang") f.push("contract header wrong");
    return f;
  },
  extras_off() {
    // headless output with the extras in the repo must equal the files recorded in docs/evidence/<REF_PHASE>
    const f = [];
    if (/CardKit|CubKit|WeaverKit|KitBase/.test(readFileSync(path.join(root, "dist/headless/cli.js"), "utf8"))) f.push("built CLI contains extras code");
    for (const [name, o] of outputs) {
      let ref;
      try {
        ref = readFileSync(path.join(root, "docs/evidence", REF_PHASE, `${name}.jsonl`), "utf8");
      } catch {
        f.push(`${name}: no docs/evidence/${REF_PHASE} file to compare with`);
        continue;
      }
      if (ref !== o.raw) f.push(`${name}: output differs from docs/evidence/${REF_PHASE}`);
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
  if (r.check === "bench") paths.push("bench.json");
  if (r.check === "soak") paths.push("soak.json", `docs/evidence/${PHASE}/soak-run.json`);
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
