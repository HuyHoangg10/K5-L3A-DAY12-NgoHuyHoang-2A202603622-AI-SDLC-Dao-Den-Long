import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { Rng } from "../src/sim/rng";
import { CONSTANTS, TUNING } from "../src/sim/tuning";
import { FormatError, parseInputs, parseScenario } from "../src/sim/validate";
import { manifestEntry, root, runInline, runNamed } from "./helpers";

const cli = path.join(root, "dist/headless/cli.js");
const tmp = mkdtempSync(path.join(os.tmpdir(), "ddl-test-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

function runCli(args: string[]) {
  return spawnSync(process.execPath, [cli, ...args], { encoding: "utf8" });
}
function file(name: string, content: string) {
  const p = path.join(tmp, name);
  writeFileSync(p, content);
  return p;
}

describe("tick model", () => {
  const r = runNamed("accel");
  it("snapshot at tick 0 is the state after the scenario and before any input", () => {
    expect(r.snapAt(0).player.pos).toEqual([0, 0, 0]);
    expect(r.snapAt(0).tick).toBe(0);
    expect(r.snapAt(0).sim_tick).toBe(0);
  });
  it("--ticks N runs exactly N steps; the end line says N", () => {
    expect(r.end).toEqual({ type: "end", ticks: 60, state: "playing", score: 0 });
  });
  it("time_left_s = night duration - sim steps / 60", () => {
    expect(r.snapAt(0).time_left_s).toBe(TUNING.night1_duration_s);
    expect(r.snapAt(60).time_left_s).toBe(TUNING.night1_duration_s - 1);
  });
  it("events of step k carry tick k+1", () => {
    const m = runNamed("pickup_height");
    expect(m.eventsNamed("mote_picked").map((e) => e.tick)).toEqual([1, 1]);
  });
  it("yaw: move [0,1] with cam_yaw_deg 90 goes along +X", () => {
    const x = runInline({ ticks: 60, every: 60, scenario: { random_motes: false, random_shades: false }, frames: [{ tick: 0, move: [0, 1], cam_yaw_deg: 90 }] });
    expect(x.snapAt(60).player.pos[0]).toBeCloseTo(5.75, 3);
    expect(x.snapAt(60).player.pos[2]).toBeCloseTo(0, 3);
  });
  it("a move longer than 1 is normalised; a frame without move keeps the old one", () => {
    const x = runInline({ ticks: 60, every: 60, scenario: { random_motes: false, random_shades: false }, frames: [{ tick: 0, move: [1, 1] }, { tick: 5, interact: false }] });
    expect(x.snapAt(60).player.vel[0]).toBeCloseTo(6 / Math.SQRT2, 2); // vel is rounded to 3 decimals
    expect(x.snapAt(60).player.vel[2]).toBeCloseTo(6 / Math.SQRT2, 2);
  });
  it("standing still after the input stops: velocity falls to 0 within 0.1 s", () => {
    const x = runInline({ ticks: 30, every: 1, scenario: { random_motes: false, random_shades: false }, frames: [{ tick: 0, move: [0, 1] }, { tick: 20, move: [0, 0] }] });
    expect(x.snapAt(20).player.vel[2]).toBe(6);
    expect(x.snapAt(26).player.vel[2]).toBe(0);
  });
});

describe("output format", () => {
  const r = runNamed("random_default");
  it("three line types; the first line is the snapshot of tick 0 and exactly one end line is last", () => {
    expect(new Set(r.lines.map((l) => l.type))).toEqual(new Set(["snapshot", "event", "end"]));
    expect(r.lines[0]?.tick).toBe(0);
    expect(r.lines.filter((l) => l.type === "end")).toHaveLength(1);
    expect(r.lines[r.lines.length - 1]?.type).toBe("end");
  });
  it("snapshot fields of contract v1.2", () => {
    const s = r.snapAt(600);
    expect(Object.keys(s).sort()).toEqual(
      ["charms", "drifters", "lanterns", "motes", "motes_active", "night", "player", "score", "shades", "sim_tick", "state", "tick", "time_left_s", "type", "wind"].sort(),
    );
    expect(Object.keys(s.player).sort()).toEqual(["capacity", "carried", "charm_s", "dash_cd_s", "flames", "grounded", "invuln", "pos", "pulse_cd_s", "vel"]);
    expect(Object.keys(s.wind).sort()).toEqual(["active", "dir_deg"]);
    expect(Object.keys(s.motes[0]).sort()).toEqual(["id", "kind", "pos", "ttl_s"]);
    expect(Object.keys(s.lanterns[0]).sort()).toEqual(["deposited", "ever_lit", "fuel", "id", "lit", "pos", "relit_count"]);
    expect(s.motes_active).toBe(s.motes.length);
    expect(typeof s.player.grounded).toBe("boolean");
    expect(typeof s.player.invuln).toBe("boolean");
  });
  it("drifters and charms are objects of the contract", () => {
    const n = runNamed("drifter_steal").snapAt(1);
    expect(Object.keys(n.drifters[0]).sort()).toEqual(["id", "pos", "state", "stolen"]);
    const c = runNamed("night2_charm").snapAt(1);
    expect(Object.keys(c.charms[0]).sort()).toEqual(["available", "id", "respawn_s"]);
  });
  it("numbers are rounded to at most 3 decimals", () => {
    for (const line of r.raw) expect(line).not.toMatch(/\d\.\d{4,}/);
  });
  it("tick never goes backwards", () => {
    let last = -1;
    for (const l of r.lines) {
      if (l.type === "end") continue;
      expect(l.tick as number).toBeGreaterThanOrEqual(last);
      last = l.tick as number;
    }
  });
  it("the new events have the contract's data", () => {
    expect(runNamed("dash").eventsNamed("dash")[0]?.data).toEqual({});
    expect(runNamed("pause").eventsNamed("paused")[0]?.data).toEqual({});
    expect(runNamed("pause").eventsNamed("resumed")[0]?.data).toEqual({});
    expect(runNamed("drifter_steal").eventsNamed("drifter_steal")[0]?.data).toHaveProperty("carried");
  });
  it("--snapshot-every controls the spacing, from tick 0", () => {
    const x = runInline({ ticks: 20, every: 5, scenario: { random_motes: false, random_shades: false } });
    expect(x.snaps.map((s) => s.tick)).toEqual([0, 5, 10, 15, 20]);
  });
  it("shade states use the contract names", () => {
    const states = new Set<string>();
    for (const n of ["shade_random", "shade_hit", "pulse", "shade_detect"]) {
      for (const s of runNamed(n).snaps) for (const sh of s.shades) states.add(sh.state);
    }
    for (const st of states) expect(["spawning", "wander", "chase", "recoil", "stunned"]).toContain(st);
    expect(states).toEqual(new Set(["spawning", "wander", "chase", "recoil", "stunned"]));
  });
});

describe("determinism", () => {
  it("same seed + scenario + inputs: identical bytes, in every night", () => {
    for (const n of ["random_default", "random_night2", "random_night3"]) {
      expect(runNamed(n).raw.join("\n")).toBe(runNamed(n).raw.join("\n"));
    }
    expect(runNamed("random_night3").raw.join("\n").length).toBeGreaterThan(10000);
  });
  it("auto-generated ids (shades, drifters, dropped fireflies) repeat across runs", () => {
    const run = () =>
      runInline({ ticks: 3000, every: 1000, seed: 9, night: 2, scenario: { random_motes: false, player: { carried: 9, flames: 99 } } }).raw.join("\n");
    expect(run()).toBe(run());
  });
  it("a different seed gives a different island", () => {
    expect(runInline({ ticks: 0, seed: 1 }).snapAt(0).motes).not.toEqual(runInline({ ticks: 0, seed: 2 }).snapAt(0).motes);
  });
  it("PRNG: same seed same sequence, values in [0,1)", () => {
    const a = new Rng(123);
    const b = new Rng(123);
    const seqA = Array.from({ length: 50 }, () => a.next());
    expect(seqA).toEqual(Array.from({ length: 50 }, () => b.next()));
    expect(seqA.every((v) => v >= 0 && v < 1)).toBe(true);
  });
});

describe("input / scenario validation", () => {
  it("accepts frames with only some fields, including dash and pause", () => {
    expect(parseInputs({ frames: [{ tick: 0, move: [0, 1] }, { tick: 5, dash: true }, { tick: 6, pause: true }] })).toHaveLength(3);
  });
  it.each([
    ["not an object", []],
    ["frames missing", {}],
    ["duplicate tick", { frames: [{ tick: 1 }, { tick: 1 }] }],
    ["decreasing tick", { frames: [{ tick: 4 }, { tick: 2 }] }],
    ["negative tick", { frames: [{ tick: -1 }] }],
    ["fractional tick", { frames: [{ tick: 1.5 }] }],
    ["move not a pair", { frames: [{ tick: 0, move: [1] }] }],
    ["button not boolean", { frames: [{ tick: 0, pulse: 1 }] }],
    ["dash not boolean", { frames: [{ tick: 0, dash: "yes" }] }],
    ["pause not boolean", { frames: [{ tick: 0, pause: 1 }] }],
  ])("rejects inputs: %s", (_n, raw) => {
    expect(() => parseInputs(raw)).toThrow(FormatError);
  });
  it.each([
    ["array", []],
    ["pos with 2 numbers", { player: { pos: [1, 2] } }],
    ["lantern without id", { lanterns: [{ pos: [0, 0, 0] }] }],
    ["motes not array", { motes: 3 }],
    ["random flag not boolean", { random_shades: "no" }],
    ["wind flag not boolean", { wind_enabled: 1 }],
    ["unknown shade state", { shades: [{ pos: [0, 0, 0], state: "dead" }] }],
    ["unknown drifter state", { drifters: [{ pos: [0, 0, 0], state: "sleep" }] }],
    ["charm without id", { charms: [{ available: true }] }],
    ["negative ticks", { player: { dash_cd_ticks: -1 } }],
  ])("rejects scenario: %s", (_n, raw) => {
    expect(() => parseScenario(raw)).toThrow(FormatError);
  });
  it("accepts the new scenario fields", () => {
    const s = parseScenario({
      player: { invuln_ticks: 10, dash_cd_ticks: 5, pulse_cd_ticks: 7, charm_ticks: 3 },
      shades: [{ pos: [1, 1, 1], state: "stunned", state_ticks_left: 30 }],
      drifters: [{ id: "D9", pos: [0, 2, 0], state: "flee", stolen: 2 }],
      charms: [{ id: "C1", available: false, respawn_ticks: 100 }],
      random_drifters: false,
      wind_enabled: true,
    });
    expect(s.player?.dash_cd_ticks).toBe(5);
  });
  it("scenario state fields are used: a shade given as stunned with 30 ticks left is stunned for exactly 30 snapshots", () => {
    const x = runInline({ ticks: 40, every: 1, scenario: { random_motes: false, random_shades: false, shades: [{ id: "S1", pos: [30, 1, 0], state: "stunned", state_ticks_left: 30 }] } });
    expect(x.snapAt(0).shades[0].state).toBe("stunned");
    expect(x.snapAt(29).shades[0].state).toBe("stunned");
    expect(x.snapAt(30).shades[0].state).not.toBe("stunned");
  });
  it("player scenario counters: invuln_ticks, dash_cd_ticks, pulse_cd_ticks, charm_ticks", () => {
    const x = runInline({ ticks: 2, scenario: { random_motes: false, random_shades: false, player: { invuln_ticks: 90, dash_cd_ticks: 60, pulse_cd_ticks: 120, charm_ticks: 30 } } });
    const p = x.snapAt(0).player;
    expect(p).toMatchObject({ invuln: true, dash_cd_s: 1, pulse_cd_s: 2, charm_s: 0.5 });
    expect(x.snapAt(2).player.dash_cd_s).toBeCloseTo(58 / 60, 3);
  });
  it("drifters and charms in a scenario replace the defaults", () => {
    const n2 = runInline({ ticks: 0, night: 2, scenario: { random_drifters: false, charms: [] } }).snapAt(0);
    expect(n2.charms).toEqual([]);
  });
  it("an unknown lantern id is ignored", () => {
    expect(runInline({ ticks: 0, scenario: { lanterns: [{ id: "L9", pos: [1, 0, 1] }] } }).snapAt(0).lanterns).toHaveLength(5);
  });
});

describe("CLI (built dist/headless/cli.js)", () => {
  const base = (out: string, night = "1") => ["--seed", "1", "--night", night, "--ticks", "30", "--out", out];
  it("exits 0 and writes the file, for nights 1, 2 and 3", () => {
    for (const n of ["1", "2", "3"]) {
      const out = path.join(tmp, `ok${n}`, "out.jsonl");
      expect(runCli(base(out, n)).status).toBe(0);
      const lines = readFileSync(out, "utf8").trim().split("\n");
      expect(JSON.parse(lines[0] as string)).toMatchObject({ type: "snapshot", night: Number(n) });
      expect(JSON.parse(lines[lines.length - 1] as string)).toMatchObject({ type: "end", ticks: 30 });
    }
  });
  it("--night 4 or 0 is an error (exit 1)", () => {
    for (const n of ["4", "0"]) {
      const r = runCli(base(path.join(tmp, "n.jsonl"), n));
      expect(r.status).toBe(1);
      expect(r.stderr).toContain("error:");
    }
  });
  it("CLI output equals in-process output for the same scenario, inputs and night", () => {
    const e = manifestEntry("night2_charm");
    const out = path.join(tmp, "charm.jsonl");
    const r = runCli([
      "--seed", String(e.seed), "--night", String(e.night), "--ticks", String(e.ticks), "--out", out, "--snapshot-every", String(e.snapshot_every),
      "--scenario", path.join(root, "scenarios/night2_charm/scenario.json"),
      "--inputs", path.join(root, "scenarios/night2_charm/inputs.json"),
    ]);
    expect(r.status).toBe(0);
    expect(readFileSync(out, "utf8")).toBe(runNamed("night2_charm").raw.join("\n") + "\n");
  });
  it("stops early when the game ends and still exits 0", () => {
    const out = path.join(tmp, "lf.jsonl");
    const r = runCli(["--seed", "1", "--night", "1", "--ticks", "5000", "--out", out, "--scenario", path.join(root, "scenarios/lose_flames/scenario.json")]);
    expect(r.status).toBe(0);
    const lines = readFileSync(out, "utf8").trim().split("\n");
    expect(JSON.parse(lines[lines.length - 1] as string)).toEqual({ type: "end", ticks: 1, state: "lost", score: 0 });
  });
  it("malformed JSON in inputs: exit 2 and a message on stderr", () => {
    const r = runCli([...base(path.join(tmp, "x.jsonl")), "--inputs", file("bad.json", "{ nope")]);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("not valid JSON");
  });
  it("non-increasing frame ticks, bad scenario, missing file: exit 2", () => {
    expect(runCli([...base(path.join(tmp, "x.jsonl")), "--inputs", file("dup.json", '{"frames":[{"tick":3},{"tick":3}]}')]).status).toBe(2);
    expect(runCli([...base(path.join(tmp, "x.jsonl")), "--scenario", file("sc.json", '{"player":{"pos":[1,2]}}')]).status).toBe(2);
    expect(runCli([...base(path.join(tmp, "x.jsonl")), "--inputs", path.join(tmp, "nope.json")]).status).toBe(2);
  });
  it("usage errors (missing --out, unknown option, bad --ticks): exit 1 with a message on stderr", () => {
    for (const args of [["--seed", "1", "--ticks", "5"], [...base("a"), "--wat", "1"], ["--seed", "1", "--ticks", "x", "--out", "a"]]) {
      const r = runCli(args);
      expect(r.status).toBe(1);
      expect(r.stderr).toContain("error:");
    }
  });
  it("does not create the output file on error", () => {
    const out = path.join(tmp, "never.jsonl");
    runCli([...base(out), "--inputs", file("bad2.json", "[]")]);
    expect(existsSync(out)).toBe(false);
  });
  it("a full night of 21,600 ticks finishes in 30 s or less", () => {
    const out = path.join(tmp, "full.jsonl");
    const t0 = Date.now();
    const r = runCli(["--seed", "2", "--night", "3", "--ticks", "21600", "--out", out, "--scenario", path.join(root, "scenarios/full_night3/scenario.json")]);
    expect(r.status).toBe(0);
    expect(Date.now() - t0).toBeLessThan(30000);
  });
});

describe("contract", () => {
  const contract = JSON.parse(readFileSync(path.join(root, "game.contract.json"), "utf8"));
  it("tuning in game.contract.json is exactly src/sim/tuning.ts", () => {
    expect(contract.tuning).toEqual(TUNING);
  });
  it("header fields", () => {
    expect(contract.contract_version).toBe("1.3");
    expect(contract.team).toBe("2A202603622-NgoHuyHoang");
    expect(contract.headless_cmd).toBe("node dist/headless/cli.js");
    expect(contract.run_cmd).toBe("node dist/headless/launcher.js"); // takes --export-leaderboard
    expect(contract.bench_cmd).toBe("node scripts/bench.mjs"); // takes --seed --duration --out
    expect(contract.soak_cmd).toBe("node --expose-gc dist/headless/soak.js"); // takes --seed --nights --out
    expect(contract.build_cmd).toContain("npm run build");
  });
  it("has every tuning key of contracts v1.0 to v1.2 (v1.3 adds commands, not numbers)", () => {
    expect(Object.keys(contract.tuning).sort()).toEqual(
      [
        "player_speed", "carry_capacity", "lantern_cost", "lantern_count_night1", "pickup_radius", "interact_radius",
        "pulse_cost", "pulse_radius", "night1_duration_s", "flames", "invuln_s", "hit_drop_ratio", "pulse_stun_s",
        "pulse_push_m", "pulse_cooldown_s", "safe_radius", "shade_speed", "shade_hit_radius", "fall_enabled", "score",
        "dash_speed", "dash_duration_s", "dash_cooldown_s", "night2_duration_s", "night3_duration_s",
        "fuel_max", "fuel_decay_per_s", "fuel_per_mote", "relight_cost", "win_ratio", "drain_per_s", "low_fuel_threshold", "capacity_max",
      ].sort(),
    );
  });
  it("the standard numbers of Ticket-02 and Ticket-03", () => {
    expect(contract.tuning).toMatchObject({
      player_speed: 6, carry_capacity: 10, lantern_cost: 10, pickup_radius: 1, interact_radius: 2, pulse_cost: 3, pulse_radius: 5,
      pulse_cooldown_s: 3, pulse_stun_s: 2, pulse_push_m: 4, safe_radius: 6, shade_speed: 4, flames: 3, invuln_s: 1.5,
      dash_speed: 14, dash_duration_s: 0.2, dash_cooldown_s: 1.5, night1_duration_s: 240, night2_duration_s: 270, night3_duration_s: 300,
      fuel_max: 100, fuel_decay_per_s: 1, fuel_per_mote: 10, relight_cost: 5, win_ratio: 0.6, drain_per_s: 5, low_fuel_threshold: 30, capacity_max: 20,
    });
    expect(contract.tuning.score).toEqual({ per_mote: 5, per_lantern: 100, per_stun: 5, per_second_left: 0, per_flame_left: 50 });
  });
  it("the game really uses the declared numbers (night lengths, flames, lanterns, speed, dash)", () => {
    const s = runNamed("dash");
    expect(runInline({ ticks: 0, night: 2 }).snapAt(0).time_left_s).toBe(contract.tuning.night2_duration_s);
    expect(s.snapAt(0).player.flames).toBe(contract.tuning.flames);
    expect(s.snapAt(1).player.vel[2]).toBe(contract.tuning.dash_speed);
    expect(runNamed("accel").snapAt(6).player.vel[2]).toBe(contract.tuning.player_speed);
    expect(CONSTANTS.dash_ticks / 60).toBeCloseTo(contract.tuning.dash_duration_s, 9);
    expect(CONSTANTS.dash_cooldown_ticks / 60).toBeCloseTo(contract.tuning.dash_cooldown_s, 9);
  });
});
