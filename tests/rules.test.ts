import { describe, expect, it } from "vitest";
import { TUNING as T } from "../src/sim/tuning";
import { runInline, runNamed } from "./helpers";

const dist2 = (a: number[], b: number[]) => Math.hypot((a[0] as number) - (b[0] as number), (a[2] as number) - (b[2] as number));

describe("tick model", () => {
  const r = runNamed("pickup");
  it("snapshot at tick 0 is taken before any input is applied", () => {
    expect(r.snapAt(0).player.pos).toEqual([0, 0, 0]);
    expect(r.snapAt(0).sim_tick).toBe(0);
  });
  it("--ticks N runs exactly N steps; end line reports N", () => {
    expect(r.end).toEqual({ type: "end", ticks: 60, state: "playing", score: 10 });
    expect(r.snapAt(60).sim_tick).toBe(60);
  });
  it("step k uses input of tick k: after 60 steps at 6 m/s the player is 6 m along +Z", () => {
    expect(r.snapAt(10).player.pos).toEqual([0, 0, 1]);
    expect(r.snapAt(60).player.pos).toEqual([0, 0, 6]);
  });
  it("time_left_s = duration - steps/60", () => {
    expect(r.snapAt(0).time_left_s).toBe(T.night1_duration_s);
    expect(r.snapAt(60).time_left_s).toBe(T.night1_duration_s - 1);
  });
  it("events of step k carry tick k+1 (mote at 5 m, radius 1.5: picked after 35 steps)", () => {
    const ev = r.eventsNamed("mote_picked");
    expect(ev).toHaveLength(1);
    expect(ev[0]).toEqual({ type: "event", tick: 35, name: "mote_picked", data: { carried: 1 } });
  });
  it("snapshots come every 10 ticks by default, starting at tick 0", () => {
    expect(r.snaps.map((s) => s.tick)).toEqual([0, 10, 20, 30, 40, 50, 60]);
  });
});

describe("movement", () => {
  it("cam_yaw_deg 90 turns the forward key into +X; a frame without move keeps the old move", () => {
    const r = runNamed("move_yaw90");
    const p = r.snapAt(60).player.pos;
    expect(p[0]).toBeCloseTo(6, 3);
    expect(p[1]).toBe(0);
    expect(p[2]).toBeCloseTo(0, 3);
  });
  it("move [1,1] is normalised to length 1 (not 1.414x faster)", () => {
    const r = runNamed("move_diag");
    expect(r.snapAt(60).player.pos).toEqual([4.243, 0, 4.243]);
  });
  it("move [3,4] has length 5 and is normalised to (0.6, 0.8)", () => {
    const r = runInline({ ticks: 60, scenario: { random_motes: false, random_shades: false }, frames: [{ tick: 0, move: [3, 4] }] });
    expect(r.snapAt(60).player.pos).toEqual([3.6, 0, 4.8]);
  });
  it("a move shorter than 1 is not scaled up", () => {
    const r = runInline({ ticks: 60, scenario: { random_motes: false, random_shades: false }, frames: [{ tick: 0, move: [0, 0.5] }] });
    expect(r.snapAt(60).player.pos).toEqual([0, 0, 3]);
  });
  it("jump fires on false->true only; holding the button does not jump again after landing", () => {
    const r = runNamed("jump");
    expect(r.snapAt(10).player.pos[1]).toBeGreaterThan(0.5);
    for (const t of [50, 60, 70, 80, 90, 100]) expect(r.snapAt(t).player.pos[1]).toBe(0);
  });
  it("the island edge is a wall because fall_enabled is false", () => {
    const r = runInline({ ticks: 1800, every: 600, scenario: { random_motes: false, random_shades: false }, frames: [{ tick: 0, move: [0, 1] }] });
    const p = r.snapAt(1800).player.pos;
    expect(Math.hypot(p[0], p[2])).toBeCloseTo(50, 2);
    expect(r.events.filter((e) => e.name === "player_hit")).toHaveLength(0);
  });
});

describe("motes", () => {
  it("pickup stops at carry_capacity: with carried 9 and two motes in range only one is taken", () => {
    const r = runNamed("capacity");
    expect(r.eventsNamed("mote_picked")).toHaveLength(1);
    expect(r.snapAt(10).player.carried).toBe(T.carry_capacity);
    expect(r.snapAt(10).motes_active).toBe(1);
  });
  it("a full player picks up nothing", () => {
    const r = runInline({ ticks: 5, scenario: { random_motes: false, random_shades: false, player: { carried: T.carry_capacity }, motes: [[0, 0, 1]] } });
    expect(r.eventsNamed("mote_picked")).toHaveLength(0);
    expect(r.snapAt(5).motes_active).toBe(1);
  });
  it("pickup uses distance <= pickup_radius (boundary counts) on the XZ plane", () => {
    const at = (z: number) =>
      runInline({ ticks: 1, scenario: { random_motes: false, random_shades: false, motes: [[0, 0, z]] } }).eventsNamed("mote_picked").length;
    expect(at(T.pickup_radius)).toBe(1);
    expect(at(T.pickup_radius + 0.01)).toBe(0);
  });
  it("picking a mote adds per_mote to the score", () => {
    expect(runNamed("pickup").end.score).toBe(T.score.per_mote);
  });
});

describe("lanterns", () => {
  it("the island has exactly L1..L5, all unlit at the start", () => {
    const s = runInline({ ticks: 0 }).snapAt(0);
    expect(s.lanterns.map((l: any) => l.id)).toEqual(["L1", "L2", "L3", "L4", "L5"]);
    expect(s.lanterns.every((l: any) => l.lit === false && l.deposited === 0)).toBe(true);
  });
  it("depositing lantern_cost lights the lantern and scores per_lantern", () => {
    const r = runNamed("deposit_full");
    expect(r.events).toEqual([
      { type: "event", tick: 1, name: "deposit", data: { lantern_id: "L1", amount: 5, deposited: 5 } },
      { type: "event", tick: 1, name: "lantern_lit", data: { lantern_id: "L1" } },
    ]);
    expect(r.snapAt(1).player.carried).toBe(0);
    expect(r.end.score).toBe(T.score.per_lantern);
  });
  it("a partial deposit keeps the rest in the lantern and does not light it", () => {
    const r = runNamed("deposit_partial");
    expect(r.events).toEqual([{ type: "event", tick: 1, name: "deposit", data: { lantern_id: "L1", amount: 3, deposited: 3 } }]);
    expect(r.snapAt(1).lanterns[0]).toMatchObject({ id: "L1", lit: false, deposited: 3 });
    expect(r.end.score).toBe(0);
  });
  it("a deposit only takes what is missing and keeps the leftover motes", () => {
    const r = runNamed("deposit_finish");
    expect(r.eventsNamed("deposit")[0]?.data).toEqual({ lantern_id: "L1", amount: 2, deposited: 5 });
    expect(r.eventsNamed("lantern_lit")).toHaveLength(1);
    expect(r.snapAt(1).player.carried).toBe(2);
  });
  it("interact outside interact_radius deposits nothing", () => {
    const r = runInline({
      ticks: 3,
      scenario: { random_motes: false, random_shades: false, player: { pos: [0, 0, 25 - T.interact_radius - 0.01], carried: 5 } },
      frames: [{ tick: 0, interact: true }],
    });
    expect(r.events).toHaveLength(0);
    expect(r.snapAt(3).player.carried).toBe(5);
  });
  it("interact exactly at interact_radius works", () => {
    const r = runInline({
      ticks: 3,
      scenario: { random_motes: false, random_shades: false, player: { pos: [0, 0, 25 - T.interact_radius], carried: 5 } },
      frames: [{ tick: 0, interact: true }],
    });
    expect(r.eventsNamed("lantern_lit")).toHaveLength(1);
  });
  it("interact without any carried motes does nothing", () => {
    const r = runInline({ ticks: 3, scenario: { random_motes: false, random_shades: false, player: { pos: [0, 0, 24] } }, frames: [{ tick: 0, interact: true }] });
    expect(r.events).toHaveLength(0);
  });
});

describe("shades", () => {
  it("a touching shade takes a flame, makes the player drop floor(carried*ratio), then invulnerability protects for invuln_s", () => {
    const r = runNamed("shade_hit");
    const hits = r.eventsNamed("player_hit");
    expect(hits.map((h) => h.tick)).toEqual([1, 92]);
    expect(hits[0]?.data).toEqual({ by: "shade", flames: 2, dropped: 2 });
    expect(hits[1]?.data).toEqual({ by: "shade", flames: 1, dropped: 1 });
    expect(r.snapAt(100).player.carried).toBe(1);
    expect(r.snapAt(100).motes_active).toBe(3);
  });
  it("dropped motes land outside pickup radius so they are not instantly re-collected", () => {
    const r = runNamed("shade_hit");
    for (const m of r.snapAt(2).motes) expect(dist2(m.pos, r.snapAt(2).player.pos)).toBeGreaterThan(T.pickup_radius);
  });
  it("last flame lost ends the game: player_hit, game_over(lost, no_flames) on the same tick, end line", () => {
    const r = runNamed("lose_flames");
    expect(r.events).toEqual([
      { type: "event", tick: 1, name: "player_hit", data: { by: "shade", flames: 0, dropped: 0 } },
      { type: "event", tick: 1, name: "game_over", data: { result: "lost", reason: "no_flames" } },
    ]);
    expect(r.end).toEqual({ type: "end", ticks: 1, state: "lost", score: 0 });
  });
  it("shades never enter safe_radius around a lantern, so a player standing on the lantern is not hit", () => {
    const r = runNamed("shade_safe");
    expect(r.eventsNamed("player_hit")).toHaveLength(0);
    for (const s of r.snaps) {
      const sh = s.shades[0];
      expect(dist2(sh.pos, [0, 0, 25])).toBeGreaterThanOrEqual(T.safe_radius - 0.001);
    }
    expect(dist2(r.snapAt(300).shades[0].pos, [0, 0, 25])).toBeCloseTo(T.safe_radius, 2);
  });
  it("random_shades spawns S1 after 5 s and S2 after 6 s more, each with a shade_spawned event", () => {
    const r = runNamed("random_default");
    const sp = r.eventsNamed("shade_spawned");
    expect(sp[0]).toEqual({ type: "event", tick: 300, name: "shade_spawned", data: { id: "S1" } });
    expect(sp[1]).toEqual({ type: "event", tick: 660, name: "shade_spawned", data: { id: "S2" } });
    expect(r.snapAt(300).shades.map((s: any) => s.id)).toEqual(["S1"]);
  });
  it("shades chase slower than the player", () => {
    const r = runInline({ ticks: 60, scenario: { random_motes: false, random_shades: false, shades: [{ id: "S1", pos: [30, 1, 0] }] } });
    expect(r.snapAt(60).shades[0].pos[0]).toBeCloseTo(30 - T.shade_speed, 3);
    expect(T.shade_speed).toBeLessThan(T.player_speed);
  });
});

describe("pulse", () => {
  const r = runNamed("pulse_stun");
  it("stuns shades in pulse_radius, pays pulse_cost, scores per_stun, ignores far shades", () => {
    expect(r.eventsNamed("pulse")).toEqual([{ type: "event", tick: 1, name: "pulse", data: { stunned_ids: ["S1"] } }]);
    expect(r.snapAt(1).player.carried).toBe(4 - T.pulse_cost);
    expect(r.snapAt(1).score).toBe(T.score.per_stun);
    expect(r.snapAt(1).shades[1].state).toBe("chase");
  });
  it("pushes the stunned shade exactly pulse_push_m away from where it was in the previous snapshot", () => {
    expect(r.snapAt(0).shades[0].pos).toEqual([5, 1, 0]);
    expect(r.snapAt(1).shades[0].pos).toEqual([5 + T.pulse_push_m, 1, 0]);
  });
  it("a stunned shade is reported as stunned and does not move for exactly pulse_stun_s", () => {
    const x1 = r.snapAt(1).shades[0].pos[0];
    expect(r.snapAt(179).shades[0]).toMatchObject({ state: "stunned", pos: [x1, 1, 0] });
    expect(r.snapAt(180).shades[0].state).toBe("stunned");
    expect(r.snapAt(181).shades[0].state).toBe("chase");
    expect(r.snapAt(181).shades[0].pos[0]).toBe(x1);
    expect(r.snapAt(182).shades[0].pos[0]).toBeLessThan(x1);
  });
  it("a stunned shade cannot hit the player, even when the player walks into it", () => {
    // pulse pushes S1 from x=0.5 to x=4.5; the player then walks +X and stands within hit radius of it while it is stunned
    const hit = runInline({
      ticks: 120,
      scenario: { random_motes: false, random_shades: false, player: { carried: 4 }, shades: [{ id: "S1", pos: [0.5, 1, 0] }] },
      frames: [{ tick: 0, pulse: true }, { tick: 1, pulse: false, move: [1, 0] }, { tick: 40, move: [0, 0] }],
    });
    expect(hit.eventsNamed("pulse")[0]?.data).toEqual({ stunned_ids: ["S1"] });
    expect(Math.hypot(hit.snapAt(120).player.pos[0] - hit.snapAt(120).shades[0].pos[0], hit.snapAt(120).player.pos[2])).toBeLessThan(T.shade_hit_radius);
    expect(hit.snapAt(120).shades[0].state).toBe("stunned");
    expect(hit.eventsNamed("player_hit")).toHaveLength(0);
  });
  it("needs pulse_cost motes: with fewer the pulse does nothing", () => {
    const n = runNamed("pulse_no_light");
    expect(n.eventsNamed("pulse")).toHaveLength(0);
    expect(n.snapAt(10).player.carried).toBe(1);
    expect(n.snapAt(10).shades[0].state).toBe("chase");
  });
  it("fires on false->true only: held button pulses once, a new press pulses again", () => {
    const e = runNamed("pulse_edge");
    expect(e.eventsNamed("pulse").map((x) => x.tick)).toEqual([1, 202]);
    expect(e.snapAt(300).player.carried).toBe(10 - 2 * T.pulse_cost);
  });
  it("is blocked during pulse_cooldown_s and costs nothing when blocked", () => {
    const c = runNamed("pulse_cooldown");
    expect(c.eventsNamed("pulse").map((x) => x.tick)).toEqual([1, 126]);
    expect(c.snapAt(100).player.carried).toBe(10 - T.pulse_cost);
    expect(c.snapAt(200).player.carried).toBe(10 - 2 * T.pulse_cost);
  });
  it("pulse with no shade in range still pays and emits an empty stunned_ids", () => {
    const e = runNamed("pulse_edge");
    expect(e.eventsNamed("pulse")[0]?.data).toEqual({ stunned_ids: [] });
  });
});

describe("end of game", () => {
  it("lighting the last lantern wins: game_over(won, all_lit), bonuses added, nothing after", () => {
    const r = runNamed("win");
    expect(r.events.map((e) => e.name)).toEqual(["deposit", "lantern_lit", "game_over"]);
    expect(r.eventsNamed("game_over")[0]).toEqual({ type: "event", tick: 1, name: "game_over", data: { result: "won", reason: "all_lit" } });
    // 100 for the lantern + 2*floor(100 - 1/60 = 99.98) + 50*3 flames
    const expected = T.score.per_lantern + T.score.per_second_left * 99 + T.score.per_flame_left * 3;
    expect(r.end).toEqual({ type: "end", ticks: 1, state: "won", score: expected });
  });
  it("lanterns pre-lit by the scenario give no event and no score at setup", () => {
    const r = runNamed("win");
    expect(r.snapAt(0).score).toBe(0);
    expect(r.snapAt(0).lanterns.filter((l: any) => l.lit)).toHaveLength(4);
    expect(r.eventsNamed("lantern_lit").map((e) => e.data?.lantern_id)).toEqual(["L5"]);
  });
  it("running out of time loses with reason dawn", () => {
    const r = runNamed("lose_dawn");
    expect(r.eventsNamed("game_over")).toEqual([{ type: "event", tick: 120, name: "game_over", data: { result: "lost", reason: "dawn" } }]);
    expect(r.end).toEqual({ type: "end", ticks: 120, state: "lost", score: 0 });
    expect(r.snapAt(120).time_left_s).toBe(0);
    expect(r.snapAt(110).time_left_s).toBeCloseTo(2 - 110 / 60, 3);
  });
  it("no more lines after the game ended", () => {
    const r = runNamed("lose_flames");
    expect(r.lines[r.lines.length - 1]?.type).toBe("end");
    expect(r.lines.filter((l) => l.type === "end")).toHaveLength(1);
  });
});

describe("scenario", () => {
  const r = runNamed("scenario_setup");
  it("lanterns update by id; untouched lanterns keep defaults; lit:true sets deposited to the cost", () => {
    const l = r.snapAt(0).lanterns;
    expect(l[2]).toMatchObject({ id: "L3", pos: [1, 0, 2], lit: false });
    expect(l[1]).toMatchObject({ id: "L2", lit: true, deposited: T.lantern_cost });
    expect(l[0]).toMatchObject({ id: "L1", pos: [0, 0, 25], lit: false });
  });
  it("motes:[] and shades:[] replace the lists with nothing even when random flags are true", () => {
    expect(r.snapAt(0).motes_active).toBe(0);
    expect(r.snapAt(0).shades).toEqual([]);
  });
  it("player pos, carried, flames and time_left_s are taken from the scenario; building it emits nothing", () => {
    expect(r.snapAt(0).player).toEqual({ pos: [3, 0, 3], flames: 2, carried: 7 });
    expect(r.snapAt(0).time_left_s).toBe(300);
    expect(r.snapAt(60).time_left_s).toBe(299);
    expect(r.snapAt(0).score).toBe(0);
    expect(r.events.filter((e) => e.tick === 0)).toHaveLength(0);
  });
  it("random_motes:false lists only the given motes with ids M1..; shades given get ids S1..", () => {
    const x = runInline({
      ticks: 0,
      scenario: { random_motes: false, random_shades: false, motes: [[1, 0, 2], [3, 0, 4]], shades: [{ pos: [20, 1, 0] }, { id: "S7", pos: [0, 1, 20] }] },
    }).snapAt(0);
    expect(x.motes).toEqual([{ id: "M1", pos: [1, 0, 2] }, { id: "M2", pos: [3, 0, 4] }]);
    expect(x.shades.map((s: any) => s.id)).toEqual(["S1", "S7"]);
  });
  it("an unknown lantern id is ignored: the island still has exactly 5 lanterns", () => {
    const x = runInline({ ticks: 0, scenario: { random_motes: false, random_shades: false, lanterns: [{ id: "L9", pos: [1, 0, 1] }] } }).snapAt(0);
    expect(x.lanterns).toHaveLength(5);
  });
  it("without a scenario the game fills the island with random motes (30) and no shades at tick 0", () => {
    const x = runInline({ ticks: 0, seed: 5 }).snapAt(0);
    expect(x.motes_active).toBe(30);
    expect(x.shades).toEqual([]);
  });
});
