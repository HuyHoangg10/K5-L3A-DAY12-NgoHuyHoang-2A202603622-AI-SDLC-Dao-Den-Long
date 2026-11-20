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

describe("output format", () => {
  const r = runNamed("random_default");
  it("has three line types, starts with snapshot tick 0, ends with exactly one end line", () => {
    expect(new Set(r.lines.map((l) => l.type))).toEqual(new Set(["snapshot", "event", "end"]));
    expect(r.lines[0]?.type).toBe("snapshot");
    expect(r.lines[0]?.tick).toBe(0);
    expect(r.lines.filter((l) => l.type === "end")).toHaveLength(1);
    expect(r.lines[r.lines.length - 1]?.type).toBe("end");
  });
  it("snapshot has the contract fields", () => {
    const s = r.snapAt(600);
    expect(Object.keys(s).sort()).toEqual(
      ["lanterns", "motes", "motes_active", "player", "score", "shades", "sim_tick", "state", "tick", "time_left_s", "type"].sort(),
    );
    expect(Object.keys(s.player).sort()).toEqual(["carried", "flames", "pos"]);
    expect(Object.keys(s.lanterns[0]).sort()).toEqual(["deposited", "id", "lit", "pos"]);
    expect(Object.keys(s.shades[0]).sort()).toEqual(["id", "pos", "state"]);
    expect(s.motes_active).toBe(s.motes.length);
  });
  it("numbers are rounded to at most 3 decimals", () => {
    for (const line of r.raw) expect(line).not.toMatch(/\d\.\d{4,}/);
  });
  it("tick never goes backwards and events sit between the right snapshots", () => {
    let last = -1;
    for (const l of r.lines) {
      if (l.type === "end") continue;
      expect(l.tick as number).toBeGreaterThanOrEqual(last);
      last = l.tick as number;
    }
  });
  it("snapshot tick and sim_tick agree in phase 1", () => {
    for (const s of r.snaps) expect(s.sim_tick).toBe(s.tick);
  });
  it("--snapshot-every controls the spacing", () => {
    const x = runInline({ ticks: 20, every: 5, scenario: { random_motes: false, random_shades: false } });
    expect(x.snaps.map((s) => s.tick)).toEqual([0, 5, 10, 15, 20]);
  });
});

describe("determinism", () => {
  it("same seed + scenario + inputs: identical output, byte for byte", () => {
    const a = runNamed("random_default").raw.join("\n");
    const b = runNamed("random_default").raw.join("\n");
    expect(a).toBe(b);
    expect(a.length).toBeGreaterThan(10000);
  });
  it("auto-generated ids (shades, dropped motes) repeat across runs", () => {
    const run = () =>
      runInline({
        ticks: 1000,
        every: 1000,
        seed: 9,
        scenario: { random_motes: false, random_shades: true, player: { carried: 8 } },
      }).raw.join("\n");
    expect(run()).toBe(run());
  });
  it("a different seed gives a different island", () => {
    const a = runInline({ ticks: 0, seed: 1 }).snapAt(0).motes;
    const b = runInline({ ticks: 0, seed: 2 }).snapAt(0).motes;
    expect(a).not.toEqual(b);
  });
  it("PRNG: same seed same sequence, values in [0,1)", () => {
    const a = new Rng(123);
    const b = new Rng(123);
    const seqA = Array.from({ length: 50 }, () => a.next());
    expect(seqA).toEqual(Array.from({ length: 50 }, () => b.next()));
    expect(seqA.every((v) => v >= 0 && v < 1)).toBe(true);
    expect(new Set(seqA).size).toBe(50);
  });
});

describe("input / scenario validation", () => {
  it("accepts frames that only carry some fields", () => {
    expect(parseInputs({ frames: [{ tick: 0, move: [0, 1] }, { tick: 5, interact: true }] })).toHaveLength(2);
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
  ])("rejects inputs: %s", (_n, raw) => {
    expect(() => parseInputs(raw)).toThrow(FormatError);
  });
  it.each([
    ["array", []],
    ["pos with 2 numbers", { player: { pos: [1, 2] } }],
    ["lantern without id", { lanterns: [{ pos: [0, 0, 0] }] }],
    ["motes not array", { motes: 3 }],
    ["random flag not boolean", { random_shades: "no" }],
  ])("rejects scenario: %s", (_n, raw) => {
    expect(() => parseScenario(raw)).toThrow(FormatError);
  });
});

describe("CLI (built dist/headless/cli.js)", () => {
  const base = (out: string) => ["--seed", "1", "--night", "1", "--ticks", "30", "--out", out];
  it("exits 0 and writes the file", () => {
    const out = path.join(tmp, "ok", "out.jsonl");
    const r = runCli(base(out));
    expect(r.status).toBe(0);
    const lines = readFileSync(out, "utf8").trim().split("\n");
    expect(JSON.parse(lines[lines.length - 1] as string)).toMatchObject({ type: "end", ticks: 30 });
  });
  it("CLI output equals in-process output for the same scenario and inputs", () => {
    const e = manifestEntry("pickup");
    const out = path.join(tmp, "pickup.jsonl");
    const r = runCli([
      "--seed", String(e.seed), "--night", "1", "--ticks", String(e.ticks), "--out", out,
      "--scenario", path.join(root, "scenarios/pickup/scenario.json"),
      "--inputs", path.join(root, "scenarios/pickup/inputs.json"),
    ]);
    expect(r.status).toBe(0);
    expect(readFileSync(out, "utf8")).toBe(runNamed("pickup").raw.join("\n") + "\n");
  });
  it("stops early when the game ends and still exits 0", () => {
    const e = manifestEntry("lose_flames");
    const out = path.join(tmp, "lf.jsonl");
    const r = runCli([
      "--seed", "1", "--night", "1", "--ticks", "5000", "--out", out,
      "--scenario", path.join(root, `scenarios/${e.name}/scenario.json`),
    ]);
    expect(r.status).toBe(0);
    const lines = readFileSync(out, "utf8").trim().split("\n");
    expect(JSON.parse(lines[lines.length - 1] as string)).toEqual({ type: "end", ticks: 1, state: "lost", score: 0 });
  });
  it("malformed JSON in inputs: exit 2 and a message on stderr", () => {
    const r = runCli([...base(path.join(tmp, "x.jsonl")), "--inputs", file("bad.json", "{ nope")]);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("not valid JSON");
  });
  it("non-increasing frame ticks in inputs: exit 2", () => {
    const r = runCli([...base(path.join(tmp, "x.jsonl")), "--inputs", file("dup.json", '{"frames":[{"tick":3},{"tick":3}]}')]);
    expect(r.status).toBe(2);
  });
  it("malformed scenario: exit 2", () => {
    const r = runCli([...base(path.join(tmp, "x.jsonl")), "--scenario", file("sc.json", '{"player":{"pos":[1,2]}}')]);
    expect(r.status).toBe(2);
  });
  it("missing inputs file: exit 2", () => {
    const r = runCli([...base(path.join(tmp, "x.jsonl")), "--inputs", path.join(tmp, "nope.json")]);
    expect(r.status).toBe(2);
  });
  it("usage errors (missing --out, unknown option, bad --ticks): exit 1, not 0 or 2, message on stderr", () => {
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
});

describe("contract", () => {
  const contract = JSON.parse(readFileSync(path.join(root, "game.contract.json"), "utf8"));
  it("tuning in game.contract.json is exactly src/sim/tuning.ts", () => {
    expect(contract.tuning).toEqual(TUNING);
  });
  it("header fields", () => {
    expect(contract.contract_version).toBe("1.0");
    expect(contract.team).toBe("2A202603622-NgoHuyHoang");
    expect(contract.headless_cmd).toBe("node dist/headless/cli.js");
    expect(contract.build_cmd).toContain("npm run build");
  });
  it("has every key the lab contract lists", () => {
    expect(Object.keys(contract.tuning).sort()).toEqual(
      [
        "player_speed", "carry_capacity", "lantern_cost", "lantern_count_night1", "pickup_radius", "interact_radius",
        "pulse_cost", "pulse_radius", "night1_duration_s", "flames", "invuln_s", "hit_drop_ratio", "pulse_stun_s",
        "pulse_push_m", "pulse_cooldown_s", "safe_radius", "shade_speed", "shade_hit_radius", "fall_enabled", "score",
      ].sort(),
    );
    expect(Object.keys(contract.tuning.score).sort()).toEqual(
      ["per_flame_left", "per_lantern", "per_mote", "per_second_left", "per_stun"],
    );
  });
  it("the game really uses the declared numbers (lantern count, night length, flames, speed)", () => {
    const s = runInline({ ticks: 60, every: 60, scenario: { random_motes: false, random_shades: false }, frames: [{ tick: 0, move: [0, 1] }] });
    expect(s.snapAt(0).lanterns).toHaveLength(contract.tuning.lantern_count_night1);
    expect(s.snapAt(0).time_left_s).toBe(contract.tuning.night1_duration_s);
    expect(s.snapAt(0).player.flames).toBe(contract.tuning.flames);
    expect(s.snapAt(60).player.pos[2]).toBe(contract.tuning.player_speed);
  });
  it("island is big enough for the default lantern ring and the example scenario in the lab", () => {
    expect(CONSTANTS.island_radius).toBeGreaterThan(CONSTANTS.lantern_ring_radius + TUNING.safe_radius);
  });
});
