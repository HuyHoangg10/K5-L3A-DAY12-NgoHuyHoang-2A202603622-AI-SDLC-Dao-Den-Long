import { describe, expect, it } from "vitest";
import { TUNING as T } from "../src/sim/tuning";
import { runInline, runNamed } from "./helpers";

const dist2 = (a: number[], b: number[]) => Math.hypot((a[0] as number) - (b[0] as number), (a[2] as number) - (b[2] as number));

describe("movement (Ticket-02 part 1)", () => {
  it("full speed in 0.1 s: 1 m/s more every tick, then 6 m/s; 345/60 = 5.75 m after 60 ticks", () => {
    const r = runNamed("accel");
    expect(r.snapAt(6).player.vel).toEqual([0, 0, 6]);
    expect(r.snapAt(6).player.pos[2]).toBeCloseTo(0.35, 6);
    expect(r.snapAt(60).player.pos[2]).toBeCloseTo(5.75, 6);
  });
  it("jump: 7 m/s up, gravity 20, only from the ground; peak about 1.167 m, lands after 41 ticks", () => {
    const r = runNamed("jump");
    expect(r.snapAt(1).player.pos[1]).toBeCloseTo(0.111, 3);
    expect(r.snapAt(1).player.vel[1]).toBeCloseTo(7 - 20 / 60, 3);
    expect(Math.max(...r.snaps.map((s) => s.player.pos[1]))).toBeCloseTo(1.167, 3);
    expect(r.snapAt(10).player.grounded).toBe(false);
    expect(r.snapAt(60).player.grounded).toBe(true);
    expect(r.snapAt(60).player.pos[1]).toBe(0);
  });
  it("jump only fires on false->true: holding the button does not jump again", () => {
    const r = runInline({ ticks: 120, every: 1, scenario: { random_motes: false, random_shades: false }, frames: [{ tick: 0, jump: true }] });
    expect(r.snapAt(100).player.pos[1]).toBe(0);
  });
  it("dash: 14 m/s for 12 ticks (2.8 m), event dash, cooldown 1.5 s from the start of the dash", () => {
    const r = runNamed("dash");
    expect(r.eventsNamed("dash").map((e) => e.tick)).toEqual([1, 92]); // press at 89 is refused, 91 works
    expect(r.snapAt(1).player.dash_cd_s).toBe(1.5);
    expect(r.snapAt(12).player.pos[2]).toBeCloseTo(2.8, 3);
    expect(r.snapAt(1).player.vel[2]).toBe(14);
    expect(r.snapAt(91).player.dash_cd_s).toBe(0);
  });
  it("dash direction: the move direction, or the way Mây faces (+Z at the start) when standing still", () => {
    const r = runNamed("dash_facing");
    expect(r.snapAt(12).player.pos).toEqual([0, 0, 2.8]);
  });
  it("dash is not invulnerable", () => {
    const r = runInline({
      ticks: 12,
      scenario: { random_motes: false, random_shades: false, player: { carried: 0 }, shades: [{ id: "S1", pos: [0, 1, 1.5], state: "chase" }] },
      frames: [{ tick: 0, dash: true, move: [0, 1] }],
    });
    expect(r.eventsNamed("player_hit")).toHaveLength(1);
  });
  it("an in-air dash keeps its height", () => {
    const r = runInline({ ticks: 20, every: 1, scenario: { random_motes: false, random_shades: false }, frames: [{ tick: 0, jump: true }, { tick: 1, jump: false }, { tick: 5, dash: true, move: [0, 1] }] });
    const y5 = r.snapAt(5).player.pos[1];
    for (let t = 6; t <= 16; t++) expect(r.snapAt(t).player.pos[1]).toBeCloseTo(y5, 6);
    expect(r.snapAt(20).player.pos[1]).toBeLessThan(y5); // gravity again afterwards
  });
});

describe("motes and lanterns", () => {
  it("pickup needs XZ <= 1.0 m and a height difference <= 1.5 m", () => {
    const r = runNamed("pickup_height");
    // [0,2,.5] too high, [0,1.4,.5] ok, [.7,0,.7] is 0.99 away ok, [1.01,0,0] too far
    expect(r.eventsNamed("mote_picked").map((e) => e.data?.carried)).toEqual([1, 2]);
    expect(r.snapAt(10).motes.map((m: any) => m.id)).toEqual(["M1", "M4"]);
  });
  it("capacity is 10: with 9 carried only one of two motes in range is taken", () => {
    const r = runNamed("capacity");
    expect(r.eventsNamed("mote_picked")).toHaveLength(1);
    expect(r.snapAt(10).player.carried).toBe(10);
    expect(r.snapAt(10).motes_active).toBe(1);
  });
  it("picking up gives no points; depositing gives 10 per firefly", () => {
    expect(runNamed("capacity").end.score).toBe(0);
    expect(runNamed("deposit_full").end.score).toBe(10 * T.score.per_mote + T.score.per_lantern);
  });
  it("10 fireflies light a lantern: deposit + lantern_lit, +100 for the lantern", () => {
    const r = runNamed("deposit_full");
    expect(r.events).toEqual([
      { type: "event", tick: 1, name: "night_start", data: { night: 1 } },
      { type: "event", tick: 1, name: "deposit", data: { lantern_id: "L1", amount: 10, deposited: 10 } },
      { type: "event", tick: 1, name: "lantern_lit", data: { lantern_id: "L1" } },
    ]);
    expect(r.snapAt(1).score).toBe(10 * T.score.per_mote + T.score.per_lantern);
  });
  it("partial deposits: min(carried, missing) into the nearest unlit lantern", () => {
    expect(runNamed("deposit_partial").eventsNamed("deposit")[0]?.data).toEqual({ lantern_id: "L1", amount: 6, deposited: 6 });
    const t = runNamed("deposit_topup");
    expect(t.eventsNamed("deposit")[0]?.data).toEqual({ lantern_id: "L1", amount: 4, deposited: 10 });
    expect(t.snapAt(1).player.carried).toBe(3);
    expect(t.eventsNamed("lantern_lit")).toHaveLength(1);
  });
  it("interact radius is 2.0 m: 2.0 works, 2.1 does not", () => {
    expect(runNamed("deposit_full").eventsNamed("deposit")).toHaveLength(1); // z=23 is exactly 2.0 from L1
    expect(runNamed("deposit_far").eventsNamed("deposit")).toHaveLength(0); // z=22.9
  });
  it("a lit lantern takes nothing more; the nearest unlit one is chosen, ties go to the smaller id", () => {
    const r = runInline({
      ticks: 2,
      scenario: {
        random_motes: false, random_shades: false,
        player: { pos: [0, 0, 24], carried: 10 },
        lanterns: [{ id: "L1", lit: true }, { id: "L2", pos: [1, 0, 24] }, { id: "L3", pos: [-1, 0, 24] }],
      },
      frames: [{ tick: 0, interact: true }],
    });
    expect(r.eventsNamed("deposit")[0]?.data).toMatchObject({ lantern_id: "L2" });
  });
});

describe("falling off the island", () => {
  const r = runNamed("fall");
  const hit = r.eventsNamed("player_hit")[0]!;
  it("below Y = -10: -1 flame, all fireflies lost, event with by:fall and lost", () => {
    expect(hit.data).toEqual({ by: "fall", flames: 2, dropped: 0, lost: 4 });
    expect(r.snapAt(hit.tick as number).player.pos[1]).toBeLessThan(-10);
    expect(r.snapAt(hit.tick as number).player.carried).toBe(0);
  });
  it("waits 60 ticks, then respawns at the start with zero velocity and 90 ticks of invulnerability", () => {
    const t = hit.tick as number;
    expect(r.snapAt(t + 59).player.pos[1]).toBeLessThan(-10);
    const back = r.snapAt(t + 60);
    expect(back.player.pos).toEqual([0, 0, 0]);
    expect(back.player.vel).toEqual([0, 0, 0]);
    expect(back.player.invuln).toBe(true);
    expect(r.snapAt(t + 60 + 88).player.invuln).toBe(true);
    expect(r.snapAt(t + 60 + 90).player.invuln).toBe(false);
  });
  it("happens once per fall, even when invulnerable", () => {
    const x = runInline({ ticks: 300, every: 1, scenario: { random_motes: false, random_shades: false, player: { pos: [0, 0, 41], invuln_ticks: 500 } } });
    expect(x.eventsNamed("player_hit")).toHaveLength(1);
  });
  it("the last flame lost in a fall ends the night at once, no respawn", () => {
    const x = runInline({ ticks: 300, every: 1, scenario: { random_motes: false, random_shades: false, player: { pos: [0, 0, 41], flames: 1 } } });
    expect(x.eventsNamed("game_over")[0]?.data).toEqual({ result: "lost", reason: "no_flames" });
    expect(x.end.state).toBe("lost");
  });
  it("while waiting, shades cannot hurt and fireflies are not picked up", () => {
    const x = runInline({
      ticks: 120, every: 1,
      scenario: { random_motes: false, random_shades: false, player: { pos: [0, 0, 41] }, motes: [[0, 0, 0.2]], shades: [{ id: "S1", pos: [0, 1, 0], state: "chase" }] },
    });
    expect(x.eventsNamed("mote_picked").filter((e) => (e.tick as number) < 60)).toHaveLength(0);
    expect(x.eventsNamed("player_hit").map((e) => e.data?.by)).toEqual(["fall"]);
  });
});

describe("Ink Shades", () => {
  it("a touch costs a flame, drops floor(carried/2) fireflies on a ring 1.5-2.5 m away, starts 90 ticks of invulnerability and a 60-tick recoil", () => {
    const r = runNamed("shade_hit");
    const hits = r.eventsNamed("player_hit");
    expect(hits[0]).toEqual({ type: "event", tick: 1, name: "player_hit", data: { by: "shade", flames: 2, dropped: 2 } });
    const s1 = r.snapAt(1);
    expect(s1.player.carried).toBe(3);
    expect(s1.player.invuln).toBe(true);
    expect(s1.shades[0].state).toBe("recoil");
    expect(r.snapAt(60).shades[0].state).toBe("recoil");
    expect(r.snapAt(61).shades[0].state).toBe("chase");
    for (const m of s1.motes) {
      expect(m.kind).toBe("dropped");
      expect(m.ttl_s).toBe(8);
      const d = dist2(m.pos, s1.player.pos);
      expect(d).toBeGreaterThanOrEqual(1.5 - 0.001);
      expect(d).toBeLessThanOrEqual(2.5 + 0.001);
    }
  });
  it("recoil moves the shade 2 m away in 60 ticks and invulnerability lasts exactly 90 ticks (hits at ticks 1, 91, 181)", () => {
    const r = runNamed("shade_hit");
    expect(dist2(r.snapAt(1).shades[0].pos, r.snapAt(1).player.pos)).toBeLessThan(1.0 + 0.05);
    // 0.5 m apart at the hit, minus the step the shade made toward her on that tick, plus 2 m of recoil
    expect(dist2(r.snapAt(60).shades[0].pos, r.snapAt(60).player.pos)).toBeCloseTo(0.5 - 4 / 60 + 2, 3);
    expect(r.eventsNamed("player_hit").map((e) => e.tick)).toEqual([1, 91, 181]);
  });
  it("dropped fireflies vanish after 480 ticks", () => {
    const r = runInline({
      ticks: 520, every: 1,
      scenario: { random_motes: false, random_shades: false, player: { carried: 6, flames: 99, pos: [0, 0, 0] }, shades: [{ id: "S1", pos: [0.5, 1, 0], state: "chase" }] },
    });
    // frozen target: the shade keeps hitting later, so only look at the motes dropped by the first hit
    const dropped1 = r.snapAt(1).motes.map((m: any) => m.id);
    expect(dropped1).toHaveLength(3);
    expect(r.snapAt(480).motes.some((m: any) => dropped1.includes(m.id))).toBe(true);
    expect(r.snapAt(481).motes.some((m: any) => dropped1.includes(m.id))).toBe(false);
  });
  it("hit while invulnerable does nothing; losing the last flame loses at once", () => {
    const r = runNamed("lose_flames");
    expect(r.eventsNamed("game_over")[0]).toEqual({ type: "event", tick: 1, name: "game_over", data: { result: "lost", reason: "no_flames" } });
    expect(r.end).toEqual({ type: "end", ticks: 1, state: "lost", score: 0 });
  });
  it("a shade that is 1.5+ m above or below Mây's feet cannot touch her", () => {
    const high = runInline({ ticks: 3, scenario: { random_motes: false, random_shades: false, shades: [{ id: "S1", pos: [0, 2.6, 0], state: "chase" }] } });
    expect(high.eventsNamed("player_hit")).toHaveLength(0);
    const ok = runInline({ ticks: 3, scenario: { random_motes: false, random_shades: false, shades: [{ id: "S1", pos: [0, 1.5, 0], state: "chase" }] } });
    expect(ok.eventsNamed("player_hit")).toHaveLength(1);
  });
  it("a shade at 12 m (XZ) starts to chase at once, at 12.1 m it keeps wandering; it gives up beyond 18 m", () => {
    const r = runNamed("shade_detect");
    expect(r.snapAt(1).shades[0].state).toBe("chase");
    expect(r.snapAt(1).shades[1].state).toBe("wander");
    const far = runInline({ ticks: 1, scenario: { random_motes: false, random_shades: false, player: { pos: [0, 0, 0] }, shades: [{ id: "S1", pos: [18.5, 1, 0], state: "chase" }] } });
    expect(far.snapAt(1).shades[0].state).toBe("wander");
  });
  it("spawns: 2 at tick 300 (state spawning for 60 ticks), then 1 every 480 ticks, on the ring of radius 37, at least 15 m from Mây", () => {
    const r = runNamed("shade_random");
    const sp = r.eventsNamed("shade_spawned");
    expect(sp.map((e) => [e.tick, e.data?.id])).toEqual([[300, "S1"], [300, "S2"], [780, "S3"], [1260, "S4"]]);
    for (const s of r.snapAt(300).shades) {
      expect(s.state).toBe("spawning");
      expect(Math.hypot(s.pos[0], s.pos[2])).toBeCloseTo(37, 2);
      expect(Math.hypot(s.pos[0] - 0, s.pos[2] - 0)).toBeGreaterThanOrEqual(15);
    }
    expect(r.snapAt(350).shades[0].state).toBe("spawning");
    expect(r.snapAt(360).shades[0].state).not.toBe("spawning");
  });
  it("new shades start at one of the 12 points (15, 45, 75... degrees)", () => {
    const r = runNamed("shade_random");
    for (const s of r.snapAt(300).shades) {
      const deg = (((Math.atan2(s.pos[2], s.pos[0]) * 180) / Math.PI) + 360) % 360;
      expect((deg - 15) % 30 < 0.01 || 30 - ((deg - 15) % 30) < 0.01).toBe(true);
    }
  });
});

describe("Pulse (Tỏa Sáng)", () => {
  const r = runNamed("pulse");
  it("costs 3 fireflies; hits shades within 5 m (3D, from feet + 0.8 m); +5 points for each", () => {
    expect(r.eventsNamed("pulse")[0]?.data).toEqual({ stunned_ids: ["S1", "S3"] });
    expect(r.snapAt(1).player.carried).toBe(1);
    expect(r.snapAt(1).score).toBe(2 * T.score.per_stun);
    expect(r.snapAt(1).shades.map((s: any) => s.state)).toEqual(["stunned", "chase", "stunned"]) // S2 is 6 m away: inside the 12 m detection range, so it chases;
  });
  it("the 3D distance counts: a shade exactly 5.0 m away is in, one just beyond is out", () => {
    const at = (x: number, y: number) => runInline({ ticks: 1, scenario: { random_motes: false, random_shades: false, player: { carried: 3 }, shades: [{ id: "S1", pos: [x, y, 0] }] }, frames: [{ tick: 0, pulse: true }] }).eventsNamed("pulse")[0]?.data?.stunned_ids;
    expect(at(5, 0.8)).toEqual(["S1"]);
    expect(at(5.01, 0.8)).toEqual([]);
    expect(at(4.8, 1.8)).toEqual(["S1"]); // sqrt(4.8^2 + 1^2) = 4.90
    expect(at(4.9, 1.8)).toEqual([]); // sqrt(4.9^2 + 1^2) = 5.001
  });
  it("stun lasts 120 ticks (snapshots 1..120 show stunned)", () => {
    expect(r.snapAt(120).shades[0].state).toBe("stunned");
    expect(r.snapAt(121).shades[0].state).not.toBe("stunned");
  });
  it("pushes the shade 4 m away horizontally within 15 ticks (4/15 m per tick)", () => {
    expect(r.snapAt(1).shades[0].pos[0]).toBeCloseTo(3 + 4 / 15, 3);
    expect(r.snapAt(15).shades[0].pos[0]).toBeCloseTo(7, 3);
    expect(r.snapAt(60).shades[0].pos[0]).toBeCloseTo(7, 3);
  });
  it("a shade on top of Mây is pushed toward +X", () => {
    const x = runInline({ ticks: 15, every: 15, scenario: { random_motes: false, random_shades: false, player: { carried: 3 }, shades: [{ id: "S1", pos: [0, 1, 0] }] }, frames: [{ tick: 0, pulse: true }] });
    expect(x.snapAt(15).shades[0].pos[0]).toBeCloseTo(4, 3);
  });
  it("cooldown is 3 s from the press; a second pulse refreshes stun and push; fewer than 3 fireflies do nothing", () => {
    const c = runNamed("pulse_cooldown");
    expect(c.eventsNamed("pulse").map((e) => e.tick)).toEqual([1, 182]); // 100 and 179 are refused (cooldown), 181 works
    expect(c.snapAt(400).player.carried).toBe(12 - 2 * 3);
    const n = runNamed("pulse_no_light");
    expect(n.eventsNamed("pulse")).toHaveLength(0);
    expect(n.snapAt(10).player.carried).toBe(2);
  });
  it("it kills nothing and does not stun shades that are only 'spawning'... they stay shades", () => {
    expect(r.snapAt(200).shades).toHaveLength(3);
  });
  it("pulse cooldown is shown in seconds", () => {
    expect(r.snapAt(1).player.pulse_cd_s).toBe(3);
    expect(r.snapAt(100).player.pulse_cd_s).toBeCloseTo(3 - 99 / 60, 2);
  });
});

describe("safe zone", () => {
  it("a lit lantern keeps shades out of 6 m; one that is waiting at the rim never gets in", () => {
    const r = runNamed("safe_zone");
    for (const s of r.snaps) {
      for (const sh of s.shades) expect(dist2(sh.pos, [0, 0, 25])).toBeGreaterThanOrEqual(6 - 0.001);
    }
    expect(r.eventsNamed("player_hit")).toHaveLength(0); // Mây stands 3 m from the lantern, the shade waits 6 m from it
  });
  it("an unlit lantern gives no protection", () => {
    const r = runInline({ ticks: 600, every: 100, scenario: { random_motes: false, random_shades: false, player: { pos: [0, 0, 24] }, shades: [{ id: "S1", pos: [15, 1, 24], state: "chase" }] } });
    expect(r.eventsNamed("player_hit").length).toBeGreaterThan(0);
  });
  it("lighting a lantern pushes shades inside 6 m out to the rim within 30 ticks, harmlessly", () => {
    const r = runNamed("lit_pushout");
    expect(r.eventsNamed("lantern_lit")).toHaveLength(1);
    expect(r.eventsNamed("player_hit")).toHaveLength(0);
    const d = (t: number) => dist2(r.snapAt(t).shades[0].pos, [0, 0, 25]);
    expect(d(1)).toBeLessThan(6);
    expect(d(31)).toBeGreaterThanOrEqual(6 - 0.001);
    expect(d(31)).toBeLessThanOrEqual(6 + 0.05);
  });
});

describe("win, lose, score", () => {
  it("lighting the last lantern wins at the end of that tick; score = 10/firefly + 100/lantern + 2*floor(seconds left) + 50*flames", () => {
    const r = runNamed("win");
    expect(r.events.map((e) => e.name)).toEqual(["night_start", "deposit", "lantern_lit", "game_over"]);
    expect(r.eventsNamed("game_over")[0]?.data).toEqual({ result: "won", reason: "all_lit" });
    expect(r.end).toEqual({ type: "end", ticks: 1, state: "won", score: 10 * 10 + 100 + 2 * 99 + 50 * 3 });
  });
  it("winning on the very tick the time runs out is still a win", () => {
    const r = runNamed("win_last_tick");
    expect(r.eventsNamed("game_over")[0]?.data).toEqual({ result: "won", reason: "all_lit" });
  });
  it("time out with unlit lanterns loses with reason dawn at tick 120", () => {
    const r = runNamed("lose_dawn");
    expect(r.eventsNamed("game_over")[0]).toEqual({ type: "event", tick: 120, name: "game_over", data: { result: "lost", reason: "dawn" } });
    expect(r.snapAt(120).time_left_s).toBe(0);
  });
  it("no flames beats a win or a dawn on the same tick", () => {
    const r = runInline({
      ticks: 5,
      scenario: {
        random_motes: false, random_shades: false, time_left_s: 1 / 60,
        player: { carried: 0, flames: 1 }, shades: [{ id: "S1", pos: [0.5, 1, 0], state: "chase" }],
        lanterns: [{ id: "L1", lit: true }, { id: "L2", lit: true }, { id: "L3", lit: true }, { id: "L4", lit: true }, { id: "L5", lit: true }],
      },
    });
    expect(r.eventsNamed("game_over")[0]?.data).toEqual({ result: "lost", reason: "no_flames" });
  });
  it("all lanterns pre-lit by the scenario wins on the first tick without scoring for them", () => {
    const r = runInline({ ticks: 3, scenario: { random_motes: false, random_shades: false, lanterns: [1, 2, 3, 4, 5].map((i) => ({ id: `L${i}`, lit: true })) } });
    expect(r.snapAt(0).score).toBe(0);
    expect(r.eventsNamed("game_over")).toHaveLength(1);
  });
  it("starts with 3 flames; night 1 lasts 300 s", () => {
    const s = runInline({ ticks: 0 }).snapAt(0);
    expect(s.player.flames).toBe(3);
    expect(s.time_left_s).toBe(300);
  });
});

describe("motes", () => {
  it("20 fireflies at 20 different points at the start; cap 30; one more at ticks 240, 480...", () => {
    const r = runNamed("mote_spawn");
    expect(r.snapAt(0).motes_active).toBe(20);
    expect(new Set(r.snapAt(0).motes.map((m: any) => m.pos.join(","))).size).toBe(20);
    expect(r.snapAt(230).motes_active).toBe(20);
    expect(r.snapAt(240).motes_active).toBe(21);
    expect(r.snapAt(480).motes_active).toBe(22);
  });
  it("start points are on the 8 + 16 standard points (r 12 every 45 degrees, r 33 every 22.5 degrees)", () => {
    for (const m of runInline({ ticks: 0, seed: 11 }).snapAt(0).motes) {
      const r = Math.hypot(m.pos[0], m.pos[2]);
      expect(Math.abs(r - 12) < 0.01 || Math.abs(r - 33) < 0.01).toBe(true);
      const step = Math.abs(r - 12) < 0.01 ? 45 : 22.5;
      const deg = (((Math.atan2(m.pos[2], m.pos[0]) * 180) / Math.PI) + 360) % 360;
      const k = deg / step;
      expect(Math.abs(k - Math.round(k))).toBeLessThan(0.01);
    }
  });
});

describe("pause", () => {
  const r = runNamed("pause");
  it("events paused/resumed; the resume tick already runs normally", () => {
    expect(r.eventsNamed("paused").map((e) => e.tick)).toEqual([11, 31]);
    expect(r.eventsNamed("resumed").map((e) => e.tick)).toEqual([21, 41]);
  });
  it("while paused: state 'paused', tick keeps counting, sim_tick, time and positions stand still", () => {
    expect(r.snapAt(11).state).toBe("paused");
    expect(r.snapAt(11).tick).toBe(11);
    expect(r.snapAt(11).sim_tick).toBe(10);
    expect(r.snapAt(20).sim_tick).toBe(10);
    expect(r.snapAt(20).time_left_s).toBeCloseTo(300 - 10 / 60, 3);
    expect(r.snapAt(20).player.pos).toEqual(r.snapAt(11).player.pos);
    expect(r.snapAt(21).state).toBe("playing");
    expect(r.snapAt(21).sim_tick).toBe(11);
    expect(r.snapAt(21).player.pos[2]).toBeGreaterThan(r.snapAt(20).player.pos[2]);
  });
  it("cooldowns do not tick while paused", () => {
    const x = runInline({ ticks: 40, every: 1, scenario: { random_motes: false, random_shades: false, player: { pulse_cd_ticks: 100 } }, frames: [{ tick: 4, pause: true }, { tick: 5, pause: false }, { tick: 30, pause: true }] });
    expect(x.snapAt(5).player.pulse_cd_s).toBeCloseTo(4 / 60 * 0 + (100 - 4) / 60, 3);
    expect(x.snapAt(30).player.pulse_cd_s).toBeCloseTo((100 - 4) / 60, 3);
  });
  it("input edges still count: the pause button needs a false->true change", () => {
    const x = runInline({ ticks: 10, every: 1, scenario: { random_motes: false, random_shades: false }, frames: [{ tick: 0, pause: true }] });
    expect(x.eventsNamed("paused")).toHaveLength(1);
    expect(x.eventsNamed("resumed")).toHaveLength(0);
  });
});

describe("night chain", () => {
  it("night_start {night} is the first event of a run", () => {
    for (const n of [1, 2, 3] as const) {
      const r = runInline({ ticks: 2, night: n, scenario: { random_motes: false, random_shades: false, random_drifters: false } });
      expect(r.events[0]).toEqual({ type: "event", tick: 1, name: "night_start", data: { night: n } });
      expect(r.snapAt(0).night).toBe(n);
    }
  });
  it("durations 300 / 330 / 360 s and lantern counts 5 / 6 / 7", () => {
    const s = [1, 2, 3].map((n) => runInline({ ticks: 0, night: n as 1 | 2 | 3 }).snapAt(0));
    expect(s.map((x) => x.time_left_s)).toEqual([300, 330, 360]);
    expect(s.map((x) => x.lanterns.length)).toEqual([5, 6, 7]);
  });
});
