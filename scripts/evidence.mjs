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

const PHASE = process.env.EVIDENCE_PHASE || "phase-1";
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
const checks = {
  tick_model() {
    const f = [];
    if (!eq(snapAt("pickup", 0).player.pos, [0, 0, 0])) f.push("tick 0 snapshot is not the pre-input state");
    if (!eq(endOf("pickup"), { type: "end", ticks: 60, state: "playing", score: 10 })) f.push(`end line ${JSON.stringify(endOf("pickup"))}`);
    if (snapAt("pickup", 60).time_left_s !== 239) f.push("time_left_s at tick 60 is not 239");
    if (!near(snapAt("pickup", 60).player.pos[2], 6, 1e-9)) f.push("player z at tick 60 is not 6");
    if (snapAt("pickup", 60).sim_tick !== 60) f.push("sim_tick != tick");
    return f;
  },
  event_tick() {
    const ev = events("pickup", "mote_picked");
    return ev.length === 1 && ev[0].tick === 35 && ev[0].data.carried === 1 ? [] : [`mote_picked events: ${JSON.stringify(ev)}`];
  },
  yaw() {
    const p = snapAt("move_yaw90", 60).player.pos;
    return near(p[0], 6) && near(p[2], 0) && p[1] === 0 ? [] : [`pos at 60 = ${JSON.stringify(p)}, expected [6,0,0]`];
  },
  normalize() {
    const p = snapAt("move_diag", 60).player.pos;
    return eq(p, [4.243, 0, 4.243]) ? [] : [`pos at 60 = ${JSON.stringify(p)}, expected [4.243,0,4.243]`];
  },
  edge() {
    const f = [];
    const t = events("pulse_edge", "pulse").map((e) => e.tick);
    if (!eq(t, [1, 202])) f.push(`pulse ticks ${JSON.stringify(t)}, expected [1,202]`);
    const ys = [50, 60, 70, 80, 90, 100].map((k) => snapAt("jump", k).player.pos[1]);
    if (ys.some((y) => y !== 0)) f.push(`jump held: y after landing ${JSON.stringify(ys)}`);
    if (!(snapAt("jump", 10).player.pos[1] > 0.5)) f.push("jump did not leave the ground");
    return f;
  },
  partial_frame() {
    const a = snapAt("move_yaw90", 30).player.pos[0];
    const b = snapAt("move_yaw90", 60).player.pos[0];
    return near(a, 3) && near(b, 6) ? [] : [`x at 30/60 = ${a}/${b}, expected 3/6 (move kept after a frame with only interact)`];
  },
  frames_strict() {
    return cliCases.filter((c) => /duplicate|decreasing/.test(c.name) && c.got.status !== 2).map((c) => `${c.name}: exit ${c.got.status}`);
  },
  exit_codes() {
    return cliCases.filter((c) => c.got.status !== c.expect || (c.expect !== 0 && !c.got.stderr.includes("error:"))).map((c) => `${c.name}: exit ${c.got.status}, expected ${c.expect}`);
  },
  scenario_rules() {
    const f = [];
    const s = snapAt("scenario_setup", 0);
    if (!eq(s.lanterns[2].pos, [1, 0, 2])) f.push("L3 pos not updated by id");
    if (!eq(s.lanterns[0].pos, [0, 0, 25])) f.push("L1 not left at default");
    if (!(s.lanterns[1].lit === true && s.lanterns[1].deposited === 5)) f.push("L2 lit:true not applied");
    if (s.motes_active !== 0 || s.shades.length !== 0) f.push("motes/shades [] did not replace the lists");
    if (!eq(s.player, { pos: [3, 0, 3], flames: 2, carried: 7 })) f.push("player not taken from scenario");
    if (s.score !== 0) f.push("building the scenario changed the score");
    if (snapAt("scenario_setup", 60).time_left_s !== 299) f.push("time_left_s 300 not honoured");
    if (events("scenario_setup").some((e) => e.tick === 0)) f.push("scenario emitted an event at tick 0");
    if (snapAt("win", 0).score !== 0) f.push("pre-lit lanterns gave score");
    if (!eq(events("win", "lantern_lit").map((e) => e.data.lantern_id), ["L5"])) f.push("pre-lit lanterns emitted lantern_lit");
    if (!eq(snapAt("pickup", 0).motes, [{ id: "M1", pos: [0, 0, 5] }])) f.push("random_motes:false motes list wrong");
    return f;
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
      if (L.some((l) => !["snapshot", "event", "end"].includes(l.type))) f.push(`${name}: unknown line type`);
      if (/\d\.\d{4,}/.test(o.raw)) f.push(`${name}: a number has more than 3 decimals`);
      let last = -1;
      for (const l of L) if (l.type !== "end") (l.tick < last ? f.push(`${name}: tick went backwards`) : (last = l.tick));
      const end = L[L.length - 1];
      if (!["playing", "won", "lost"].includes(end.state)) f.push(`${name}: bad end state`);
    }
    if (snapAt("pulse_stun", 10).shades[0].state !== "stunned") f.push("stunned state not reported");
    return f;
  },
  determinism() {
    return detRows.filter((r) => !r.same).map((r) => `${r.name}: second run differs`);
  },
  five_lanterns() {
    const ids = snapAt("random_default", 0).lanterns.map((l) => l.id);
    return eq(ids, ["L1", "L2", "L3", "L4", "L5"]) ? [] : [`lantern ids ${JSON.stringify(ids)}`];
  },
  pickup_rules() {
    const f = [];
    if (events("capacity", "mote_picked").length !== 1) f.push("carried 9 with two motes in range should pick up exactly one");
    if (snapAt("capacity", 10).player.carried !== 10 || snapAt("capacity", 10).motes_active !== 1) f.push("capacity not enforced");
    if (endOf("pickup").score !== 10) f.push("per_mote score wrong");
    return f;
  },
  deposit_rules() {
    const f = [];
    if (!eq(events("deposit_full").map((e) => [e.name, e.tick, e.data]), [["deposit", 1, { lantern_id: "L1", amount: 5, deposited: 5 }], ["lantern_lit", 1, { lantern_id: "L1" }]])) f.push("full deposit events wrong");
    if (endOf("deposit_full").score !== 100) f.push("per_lantern score wrong");
    if (!eq(events("deposit_partial").map((e) => e.data), [{ lantern_id: "L1", amount: 3, deposited: 3 }])) f.push("partial deposit wrong");
    if (snapAt("deposit_partial", 1).lanterns[0].lit) f.push("partial deposit lit the lantern");
    if (!eq(events("deposit_finish", "deposit")[0]?.data, { lantern_id: "L1", amount: 2, deposited: 5 })) f.push("top-up deposit wrong");
    if (snapAt("deposit_finish", 1).player.carried !== 2) f.push("leftover motes not kept");
    return f;
  },
  hit_rules() {
    const f = [];
    const h = events("shade_hit", "player_hit");
    if (!eq(h.map((e) => e.tick), [1, 92])) f.push(`hit ticks ${JSON.stringify(h.map((e) => e.tick))}, expected [1,92]`);
    if (!eq(h[0]?.data, { by: "shade", flames: 2, dropped: 2 })) f.push("first hit data wrong");
    if (!eq(h[1]?.data, { by: "shade", flames: 1, dropped: 1 })) f.push("second hit data wrong");
    if (snapAt("shade_hit", 100).motes_active !== 3) f.push("dropped motes not placed on the ground");
    return f;
  },
  pulse_rules() {
    const f = [];
    const p = events("pulse_stun", "pulse");
    if (!eq(p.map((e) => [e.tick, e.data]), [[1, { stunned_ids: ["S1"] }]])) f.push("pulse event wrong");
    if (snapAt("pulse_stun", 1).player.carried !== 2 || snapAt("pulse_stun", 1).score !== 20) f.push("pulse cost or per_stun wrong");
    if (!near(snapAt("pulse_stun", 1).shades[0].pos[0], 5 - 4 / 60 + 4)) f.push("push distance wrong");
    if (snapAt("pulse_stun", 180).shades[0].state !== "stunned" || snapAt("pulse_stun", 181).shades[0].state !== "chase") f.push("stun length is not pulse_stun_s");
    if (!eq(events("pulse_cooldown", "pulse").map((e) => e.tick), [1, 126])) f.push("cooldown not enforced");
    if (events("pulse_no_light", "pulse").length !== 0) f.push("pulse worked without enough light");
    return f;
  },
  safe_radius() {
    const f = [];
    for (const s of snaps("shade_safe")) {
      const d = Math.hypot(s.shades[0].pos[0] - 0, s.shades[0].pos[2] - 25);
      if (d < 3.999) f.push(`tick ${s.tick}: shade ${d.toFixed(3)} m from L1`);
    }
    if (events("shade_safe", "player_hit").length) f.push("player standing on a lantern was hit");
    return f.slice(0, 3);
  },
  win() {
    const e = endOf("win");
    const ok = eq(e, { type: "end", ticks: 1, state: "won", score: 100 + 2 * 99 + 50 * 3 });
    const go = events("win", "game_over")[0];
    return ok && eq(go?.data, { result: "won", reason: "all_lit" }) && go.tick === 1 ? [] : [`end ${JSON.stringify(e)}, game_over ${JSON.stringify(go)}`];
  },
  lose_flames() {
    const go = events("lose_flames", "game_over")[0];
    return eq(go?.data, { result: "lost", reason: "no_flames" }) && eq(endOf("lose_flames"), { type: "end", ticks: 1, state: "lost", score: 0 }) ? [] : [`game_over ${JSON.stringify(go)}`];
  },
  lose_dawn() {
    const go = events("lose_dawn", "game_over")[0];
    return eq(go?.data, { result: "lost", reason: "dawn" }) && go.tick === 120 && endOf("lose_dawn").ticks === 120 && snapAt("lose_dawn", 120).time_left_s === 0 ? [] : [`game_over ${JSON.stringify(go)}`];
  },
  random_spawn() {
    const f = [];
    if (snapAt("random_default", 0).motes_active !== 30) f.push("not 30 random motes");
    const sp = events("random_default", "shade_spawned").map((e) => [e.tick, e.data.id]);
    if (!eq(sp.slice(0, 2), [[300, "S1"], [660, "S2"]])) f.push(`shade_spawned ${JSON.stringify(sp.slice(0, 3))}`);
    return f;
  },
  speed() {
    const o = out("full_night");
    return endOf("full_night").ticks === 14400 && o.ms < 10000 ? [] : [`full_night ran ${endOf("full_night").ticks} ticks in ${o.ms} ms`];
  },
  unit_tests() {
    return vitest && vitest.numFailedTests === 0 && vitest.numTotalTests > 0 ? [] : [`vitest failed: ${vitest ? vitest.numFailedTests + " failing" : "no report"}`];
  },
  contract() {
    const f = [];
    const file = testFiles.find((x) => x.file === "tests/io.test.ts");
    const rows = (file?.tests ?? []).filter((t) => t.name.startsWith("contract "));
    if (rows.length < 4 || rows.some((t) => t.status !== "passed")) f.push("contract tests missing or failing");
    const c = JSON.parse(readFileSync(path.join(root, "game.contract.json"), "utf8"));
    if (c.contract_version !== "1.0" || c.team !== "2A202603622-NgoHuyHoang") f.push("contract header wrong");
    return f;
  },
};

// ---- 6. requirements table ------------------------------------------------------------------
const reqs = JSON.parse(readFileSync(path.join(root, "docs/evidence/requirements.json"), "utf8")).requirements;
const rows = reqs.map((r) => {
  let fails;
  try {
    fails = checks[r.check] ? checks[r.check]() : [`no check named "${r.check}"`];
  } catch (e) {
    fails = [`check crashed: ${e.message}`];
  }
  const paths = (r.scenarios ?? []).map((n) => `docs/evidence/${PHASE}/${n}.jsonl`);
  if (r.check === "unit_tests" || r.check === "contract") paths.push(`docs/evidence/${PHASE}/tests.json`);
  if (r.check === "exit_codes" || r.check === "frames_strict") paths.push("(CLI exit codes, see section below)");
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
