import { describe, expect, it } from "vitest";
import { TUNING as T } from "../src/sim/tuning";
import type { Scenario } from "../src/sim/types";
import { runInline } from "./helpers";

const bare: Scenario = { random_motes: false, random_shades: false };

describe("radius boundaries (distance <= r counts, measured on the XZ plane)", () => {
  const hitAt = (dist: number) =>
    // the shade walks shade_speed/60 toward the player before the hit test, so start that much further out
    runInline({ ticks: 1, scenario: { ...bare, player: { carried: 2 }, shades: [{ id: "S1", pos: [dist + T.shade_speed / 60, 1, 0] }] } }).eventsNamed("player_hit").length;
  it("shade_hit_radius: exactly at the radius hits, a bit outside does not", () => {
    expect(hitAt(T.shade_hit_radius)).toBe(1);
    expect(hitAt(T.shade_hit_radius + 0.02)).toBe(0);
  });
  it("a shade directly above the player (different Y, same XZ) still hits", () => {
    const r = runInline({ ticks: 1, scenario: { ...bare, shades: [{ id: "S1", pos: [0, 5, 0] }] } });
    expect(r.eventsNamed("player_hit")).toHaveLength(1);
  });
  const pulseAt = (dist: number) =>
    runInline({ ticks: 1, scenario: { ...bare, player: { carried: 4 }, shades: [{ id: "S1", pos: [dist, 1, 0] }] }, frames: [{ tick: 0, pulse: true }] }).eventsNamed("pulse")[0]?.data
      ?.stunned_ids;
  it("pulse_radius: exactly at the radius is stunned, 1 cm outside is not (positions of the previous snapshot)", () => {
    expect(pulseAt(T.pulse_radius)).toEqual(["S1"]);
    expect(pulseAt(T.pulse_radius + 0.01)).toEqual([]);
  });
  it("pickup ignores height: a mote 3 m up but within radius on XZ is picked", () => {
    const r = runInline({ ticks: 1, scenario: { ...bare, motes: [[0, 3, 1]] } });
    expect(r.eventsNamed("mote_picked")).toHaveLength(1);
  });
  it("every mote in range is taken in the same tick, up to capacity", () => {
    const r = runInline({ ticks: 1, scenario: { ...bare, motes: [[0, 0, 1], [0, 0, 1], [0, 0, 1]] } });
    expect(r.eventsNamed("mote_picked").map((e) => [e.tick, e.data?.carried])).toEqual([[1, 1], [1, 2], [1, 3]]);
  });
});

describe("pulse details", () => {
  it("a shade pushed into the safe circle of a lantern is put back on its rim", () => {
    const r = runInline({
      ticks: 1,
      scenario: { ...bare, player: { pos: [0, 0, 16], carried: 4 }, shades: [{ id: "S1", pos: [0, 1, 20] }] },
      frames: [{ tick: 0, pulse: true }],
    });
    // L1 is at (0,0,25): pushed to z=24 would be inside the circle, so it ends on the rim at z = 25 - safe_radius
    expect(r.snapAt(1).shades[0].pos).toEqual([0, 1, 25 - T.safe_radius]);
  });
  it("cooldown is exactly pulse_cooldown_s: a press 1 tick early is blocked, the exact tick works", () => {
    const early = runInline({ ticks: 130, scenario: { ...bare, player: { carried: 10 } }, frames: [{ tick: 0, pulse: true }, { tick: 1, pulse: false }, { tick: 119, pulse: true }] });
    expect(early.eventsNamed("pulse").map((e) => e.tick)).toEqual([1]);
    const exact = runInline({
      ticks: 130,
      scenario: { ...bare, player: { carried: 10 } },
      frames: [{ tick: 0, pulse: true }, { tick: 1, pulse: false }, { tick: 118, pulse: true }, { tick: 119, pulse: false }, { tick: 120, pulse: true }],
    });
    expect(exact.eventsNamed("pulse").map((e) => e.tick)).toEqual([1, 121]);
  });
});

describe("end-of-game priority", () => {
  const lastLantern = (extra: Scenario): Scenario => ({
    ...bare,
    player: { pos: [0, 0, 8], carried: 5 },
    lanterns: [{ id: "L1", lit: true }, { id: "L2", lit: true }, { id: "L3", lit: true }, { id: "L4", lit: true }, { id: "L5", pos: [0, 0, 10] }],
    ...extra,
  });
  it("lighting the last lantern in the very last tick is a win, not dawn", () => {
    const r = runInline({ ticks: 5, scenario: lastLantern({ time_left_s: 1 / 60 }), frames: [{ tick: 0, interact: true }] });
    expect(r.eventsNamed("game_over")[0]?.data).toEqual({ result: "won", reason: "all_lit" });
  });
  it("losing the last flame in the very last tick is no_flames, not dawn", () => {
    const r = runInline({ ticks: 5, scenario: { ...bare, time_left_s: 1 / 60, player: { flames: 1 }, shades: [{ id: "S1", pos: [0.5, 1, 0] }] } });
    expect(r.eventsNamed("game_over")[0]?.data).toEqual({ result: "lost", reason: "no_flames" });
  });
  it("the win bonus uses the time left after the final tick and the flames left", () => {
    const r = runInline({ ticks: 5, scenario: lastLantern({ time_left_s: 10, player: { pos: [0, 0, 8], carried: 5, flames: 2 } }), frames: [{ tick: 0, interact: true }] });
    expect(r.end.score).toBe(T.score.per_lantern + T.score.per_second_left * 9 + T.score.per_flame_left * 2);
  });
});

describe("movement details", () => {
  const walk = (move: [number, number], yaw: number) =>
    runInline({ ticks: 60, every: 60, scenario: bare, frames: [{ tick: 0, move, cam_yaw_deg: yaw }] }).snapAt(60).player.pos;
  it("yaw 90 with move [1,0] goes to -Z (x' = x cos, z' = -x sin)", () => {
    const p = walk([1, 0], 90);
    expect(p[0]).toBeCloseTo(0, 3);
    expect(p[2]).toBeCloseTo(-6, 3);
  });
  it("yaw 180 with move [0,1] goes to -Z", () => {
    const p = walk([0, 1], 180);
    expect(p[0]).toBeCloseTo(0, 3);
    expect(p[2]).toBeCloseTo(-6, 3);
  });
  it("yaw 30 with move [0,1] goes to (sin30, cos30) * speed", () => {
    expect(walk([0, 1], 30)).toEqual([3, 0, 5.196]);
  });
  it("the island wall holds: after reaching the edge the player stays on the circle at every later tick", () => {
    const r = runInline({ ticks: 800, every: 50, scenario: bare, frames: [{ tick: 0, move: [0, 1] }] });
    for (const t of [500, 550, 600, 650, 700, 750, 800]) expect(r.snapAt(t).player.pos).toEqual([0, 0, 50]);
    expect(r.snapAt(400).player.pos[2]).toBeCloseTo(40, 3);
  });
  it("a jump pressed in mid-air does nothing extra", () => {
    const once = runInline({ ticks: 40, every: 1, scenario: bare, frames: [{ tick: 0, jump: true }, { tick: 1, jump: false }] });
    const twice = runInline({ ticks: 40, every: 1, scenario: bare, frames: [{ tick: 0, jump: true }, { tick: 1, jump: false }, { tick: 10, jump: true }, { tick: 11, jump: false }] });
    expect(twice.snaps.map((s) => s.player.pos[1])).toEqual(once.snaps.map((s) => s.player.pos[1]));
    expect(Math.max(...once.snaps.map((s) => s.player.pos[1]))).toBeGreaterThan(1.2);
  });
});

describe("random generation", () => {
  it("random motes stay out of every safe circle and away from the start", () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const s = runInline({ ticks: 0, seed }).snapAt(0);
      for (const m of s.motes) {
        expect(Math.hypot(m.pos[0], m.pos[2])).toBeGreaterThanOrEqual(4);
        for (const l of s.lanterns) expect(Math.hypot(m.pos[0] - l.pos[0], m.pos[2] - l.pos[2])).toBeGreaterThan(T.safe_radius + 1 - 0.001);
      }
    }
  });
  it("never more than 6 shades, and 6 are reached", () => {
    const r = runInline({ ticks: 3000, every: 60, seed: 4, scenario: { random_motes: false, player: { pos: [0, 0, 25] } } });
    const counts = r.snaps.map((s) => s.shades.length);
    expect(Math.max(...counts)).toBe(6);
  });
});
