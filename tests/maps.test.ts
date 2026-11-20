import { describe, expect, it } from "vitest";
import { nightDef, supportAt, topAt } from "../src/sim/maps";
import { CONSTANTS as C } from "../src/sim/tuning";
import { runInline, runNamed } from "./helpers";

const bare = { random_motes: false, random_shades: false, random_drifters: false, wind_enabled: false };

describe("standard maps: geometry", () => {
  it("night 1: round island of radius 40, the five standard lanterns", () => {
    const d = nightDef(1);
    expect(topAt(d, 40, 0)).toBe(0);
    expect(topAt(d, 40.01, 0)).toBeNull();
    expect(d.lanterns.map((l) => l.pos)).toEqual([[0, 0, 25], [23.8, 0, 7.7], [14.7, 0, -20.2], [-14.7, 0, -20.2], [-23.8, 0, 7.7]]);
  });
  it("night 1 mote points: 8 at r 12 (every 45 deg) and 16 at r 33 (every 22.5 deg)", () => {
    const pts = nightDef(1).motePoints;
    expect(pts).toHaveLength(24);
    expect(pts.slice(0, 8).every((p) => Math.abs(Math.hypot(p[0], p[2]) - 12) < 0.01)).toBe(true);
    expect(pts.slice(8).every((p) => Math.abs(Math.hypot(p[0], p[2]) - 33) < 0.01)).toBe(true);
    expect(pts[1]).toEqual([8.485, 0, 8.485]);
  });
  it("night 1 shade points: 12 on r 37 at 15, 45, 75 ... degrees", () => {
    const sp = nightDef(1).shadeSpawns;
    expect(sp).toHaveLength(12);
    expect(sp[0]).toEqual([35.739, 9.576]);
  });
  it("night 2: two islands of radius 28 at (0,0,0) and (70,0,0), a bridge x 26..44, z -2..2, six lanterns", () => {
    const d = nightDef(2);
    expect(topAt(d, 28, 0)).toBe(0);
    expect(topAt(d, 42, 0)).toBe(0);
    expect(topAt(d, 35, 1.99)).toBe(0);
    expect(topAt(d, 35, 2.01)).toBeNull();
    expect(topAt(d, 35, 5)).toBeNull();
    expect(d.lanterns.map((l) => l.pos)).toEqual([[0, 0, 20], [17, 0, -10], [-17, 0, -10], [70, 0, 20], [87, 0, -10], [53, 0, -10]]);
    expect(d.motePoints).toHaveLength(24);
    expect(d.shadeSpawns).toHaveLength(16);
    expect(d.charms).toEqual([{ id: "C1", pos: [35, 0, 0] }]);
  });
  it("night 3: three floors (Y 0, 3, 6), two ramps, a tower, seven lanterns, 30 mote points, 16 shade points", () => {
    const d = nightDef(3);
    expect(topAt(d, 30, 0)).toBe(0);
    expect(topAt(d, 18, 10)).toBe(3); // floor 1 is the half ring with z > 0
    expect(topAt(d, 18, -10)).toBe(0);
    expect(topAt(d, 6, 0.5)).toBe(6); // floor 2 disc of radius 8
    expect(topAt(d, 0, 1)).toBe(14); // the bell tower (r 2, 8 m high on floor 2)
    expect(supportAt(d, 0, 1, 6, 0.35)).toBe(6); // the tower is not a floor
    expect(d.lanterns.map((l) => l.id)).toHaveLength(7);
    expect(d.lanterns[0]?.pos).toEqual([0, 6, 6]);
    expect(d.motePoints).toHaveLength(30);
    expect(d.motePoints.filter((p) => p[1] === 3)).toHaveLength(8);
    expect(d.motePoints.filter((p) => p[1] === 6)).toHaveLength(4);
    expect(d.shadeSpawns).toHaveLength(16);
    expect(d.charms.map((c) => c.pos)).toEqual([[30, 0, 25], [-30, 0, 25]]);
    expect(d.shadeSpeed).toBe(4.5);
  });
  it("the ramps rise 3 m between r 30 and r 24 and are 3 m wide", () => {
    const d = nightDef(3);
    const at = (s: number, perp: number) => {
      const a = (30 * Math.PI) / 180;
      return topAt(d, s * Math.cos(a) - perp * Math.sin(a), s * Math.sin(a) + perp * Math.cos(a));
    };
    expect(at(30, 0)).toBe(0);
    expect(at(27, 0)).toBeCloseTo(1.5, 6);
    expect(at(24.01, 0)).toBeCloseTo(3, 1);
    expect(at(27, 1.4)).toBeCloseTo(1.5, 6);
    expect(at(27, 1.6)).toBe(0); // beside the ramp there is only floor 0
  });
});

describe("night 2: bridge, pads, charm", () => {
  it("Mây can walk over the bridge from island A to island B", () => {
    const r = runNamed("night2_bridge");
    expect(r.snapAt(300).player.pos[0]).toBeGreaterThan(26);
    expect(r.snapAt(600).player.pos).toEqual([expect.any(Number), 0, 0]);
    expect(r.snapAt(700).player.pos[0]).toBeGreaterThan(70);
    expect(r.eventsNamed("player_hit")).toHaveLength(0);
  });
  it("stepping off the bridge sideways drops Mây into the clouds: a fall after about 1 s", () => {
    const r = runNamed("night2_off_bridge");
    const e = r.eventsNamed("player_hit")[0]!;
    expect(e.data).toEqual({ by: "fall", flames: 2, dropped: 0, lost: 0 });
    expect(e.tick).toBeGreaterThan(55);
    expect(e.tick).toBeLessThan(75);
  });
  it("a bounce pad shoots Mây up at 14 m/s and 24 m/s toward the other island; she lands about 1.4 s later on island B", () => {
    const r = runNamed("night2_pad");
    const v = r.snapAt(1).player.vel;
    expect(v[1]).toBeCloseTo(14 - 20 / 60, 3);
    expect(Math.hypot(v[0], v[2])).toBeCloseTo(24, 2);
    expect(v[0]).toBeGreaterThan(0); // toward (70,0,0)
    expect(v[2]).toBeLessThan(0);
    expect(r.snapAt(40).player.grounded).toBe(false);
    expect(r.snapAt(80).player.grounded).toBe(false);
    expect(r.snapAt(86).player.grounded).toBe(true);
    const p = r.snapAt(86).player.pos;
    expect(Math.hypot(p[0] - 70, p[2])).toBeLessThan(28);
  });
  it("the launch velocity is kept in the air: move keys do not change it", () => {
    const r = runNamed("night2_pad"); // the input holds move [-1, 0] the whole time
    expect(r.snapAt(50).player.vel[0]).toBeCloseTo(r.snapAt(1).player.vel[0], 6);
    expect(r.snapAt(50).player.vel[2]).toBeCloseTo(r.snapAt(1).player.vel[2], 6);
  });
  it("the second pad (50,0,-18) sends Mây back toward island A", () => {
    const r = runInline({ ticks: 2, night: 2, scenario: { ...bare, player: { pos: [50, 0, -17.5] } } });
    expect(r.snapAt(1).player.vel[0]).toBeLessThan(0);
  });
  it("a dash is still possible while flying", () => {
    const r = runInline({ ticks: 30, night: 2, scenario: { ...bare, player: { pos: [20, 0, 17.5] } }, frames: [{ tick: 10, dash: true }] });
    expect(r.eventsNamed("dash")).toHaveLength(1);
  });
  it("Bùa Gió: picked like a firefly, 600 ticks, run 7.2 m/s, dash without cooldown (but a new press is needed), back after 2700 ticks", () => {
    const r = runNamed("night2_charm");
    expect(r.eventsNamed("charm_picked")[0]).toEqual({ type: "event", tick: 1, name: "charm_picked", data: { charm_id: "C1", charm_ticks: 600 } });
    expect(r.snapAt(1).player.charm_s).toBe(10);
    expect(r.snapAt(13).player.vel[0]).toBeCloseTo(7.2, 6);
    expect(r.snapAt(31).player.vel[0]).toBe(14);
    expect(r.snapAt(32).player.dash_cd_s).toBe(0);
    expect(r.snapAt(1).charms).toEqual([{ id: "C1", available: false, respawn_s: 45 }]);
  });
  it("the charm is back after 2700 ticks (45 s) and picking it again restarts the 600 ticks", () => {
    const r = runInline({
      ticks: 2800, every: 100, night: 2,
      scenario: { ...bare, player: { pos: [35, 0, 0], charm_ticks: 5 }, charms: [{ id: "C1", pos: [35, 0, 0], available: false, respawn_ticks: 2700 }] },
    });
    expect(r.snapAt(2600).charms[0].available).toBe(false);
    expect(r.eventsNamed("charm_picked").map((e) => e.tick)).toEqual([2700]);
  });
  it("charm without dash still: runs 7.2 m/s only while the charm lasts", () => {
    const r = runInline({ ticks: 700, every: 1, night: 2, scenario: { ...bare, player: { pos: [0, 0, 0], charm_ticks: 100 } }, frames: [{ tick: 0, move: [0, 1] }] });
    expect(r.snapAt(60).player.vel[2]).toBeCloseTo(7.2, 6);
    expect(r.snapAt(120).player.vel[2]).toBeCloseTo(6, 6);
  });
});

describe("night 3: floors, cliffs, ramps, pad, tower, wind", () => {
  it("floor 2 is a cliff: walking at it from floor 0 stops Mây at its edge (r = 8) and she stays on the ground", () => {
    const r = runNamed("night3_cliff");
    const min = Math.min(...r.snaps.map((s) => Math.hypot(s.player.pos[0], s.player.pos[2])));
    expect(min).toBeGreaterThan(8 - 0.1);
    expect(r.snaps[r.snaps.length - 1]!.player.pos[1]).toBe(0);
  });
  it("walking up a ramp reaches floor 1 (Y = 3); walking off the inner edge of floor 1 drops back to Y = 0", () => {
    const r = runNamed("night3_ramp");
    expect(r.snapAt(60).player.pos[1]).toBeGreaterThan(2);
    expect(r.snapAt(60).player.pos[1]).toBeLessThan(3);
    expect(r.snapAt(120).player.pos[1]).toBe(3);
    expect(r.snapAt(120).player.grounded).toBe(true);
    expect(r.snapAt(300).player.pos[1]).toBe(0);
  });
  it("floor 1 cannot be entered from the side (vertical wall)", () => {
    const r = runInline({ ticks: 120, every: 20, night: 3, scenario: { ...bare, player: { pos: [0, 0, 28] } }, frames: [{ tick: 0, move: [0, -1] }] });
    expect(Math.min(...r.snaps.map((s) => s.player.pos[2]))).toBeGreaterThan(24 - 0.1);
    expect(r.snapAt(120).player.pos[1]).toBe(0);
  });
  it("the pad at (0,3,13) throws Mây toward -Z (12 m/s up, 8 m/s along) and she lands on floor 2 (Y = 6)", () => {
    const r = runNamed("night3_pad");
    expect(r.snapAt(1).player.vel[1]).toBeCloseTo(12 - 20 / 60, 3);
    expect(r.snapAt(1).player.vel[2]).toBe(-8);
    expect(r.snapAt(20).player.grounded).toBe(false);
    expect(r.snapAt(60).player.pos[1]).toBe(6);
    expect(r.snapAt(60).player.grounded).toBe(true);
    expect(Math.hypot(r.snapAt(60).player.pos[0], r.snapAt(60).player.pos[2])).toBeLessThanOrEqual(8);
  });
  it("the bell tower (r = 2) cannot be walked through", () => {
    const r = runInline({ ticks: 200, every: 10, night: 3, scenario: { ...bare, player: { pos: [0, 6, 6] } }, frames: [{ tick: 0, move: [0, -1] }] });
    expect(Math.min(...r.snaps.map((s) => Math.hypot(s.player.pos[0], s.player.pos[2])))).toBeGreaterThan(2 - 0.1);
  });
  it("floor 2 shades: a shade on the ground below cannot touch Mây standing on floor 1 (height difference 3 m)", () => {
    const r = runInline({ ticks: 120, every: 20, night: 3, scenario: { ...bare, player: { pos: [18, 3, 10] }, shades: [{ id: "S1", pos: [18, 1, 4], state: "chase" }] } });
    expect(r.eventsNamed("player_hit")).toHaveLength(0);
  });
  it("wind: every 30 s a 5 s gust pushes Mây 2 m/s in one fixed direction; wind {active, dir_deg} in the snapshot", () => {
    const r = runNamed("night3_wind");
    expect(r.snapAt(1750).wind.active).toBe(false);
    expect(r.snapAt(1800).wind.active).toBe(true);
    expect(r.snapAt(2050).wind.active).toBe(true);
    expect(r.snapAt(2100).wind.active).toBe(false);
    const dir = r.snapAt(1800).wind.dir_deg;
    expect(r.snapAt(2100).wind.dir_deg).toBe(dir);
    const dx = r.snapAt(2100).player.pos[0] - r.snapAt(1800).player.pos[0];
    const dz = r.snapAt(2100).player.pos[2] - r.snapAt(1800).player.pos[2];
    expect(Math.hypot(dx, dz)).toBeCloseTo(10 - 2 / 60, 1); // 299 pushed ticks
    const deg = (((Math.atan2(dz, dx) * 180) / Math.PI) + 360) % 360;
    expect(Math.abs(deg - dir)).toBeLessThan(0.5);
  });
  it("wind is only on in night 3 by default and wind_enabled:false switches it off", () => {
    expect(runInline({ ticks: 1900, every: 100, night: 2, scenario: { ...bare } }).snaps.every((s) => s.wind.active === false)).toBe(true);
    const off = runInline({ ticks: 1900, every: 100, night: 3, scenario: { ...bare, wind_enabled: false, player: { pos: [-10, 0, -30] } } });
    expect(off.snaps.every((s) => s.wind.active === false)).toBe(true);
    const on = runInline({ ticks: 1900, every: 100, night: 3, scenario: { random_motes: false, random_shades: false, player: { pos: [-10, 0, -30] } } });
    expect(on.snapAt(1900).wind.active).toBe(true);
  });
});

describe("Gió Lạc (drifters)", () => {
  it("idle -> chase when Mây carries 5 or more fireflies within 15 m; touch within 1.2 m steals min(3, carried) and it flees", () => {
    const r = runNamed("drifter_steal");
    expect(r.snapAt(1).drifters[0].state).toBe("chase");
    const e = r.eventsNamed("drifter_steal")[0]!;
    expect(e.data).toEqual({ drifter_id: "D1", amount: 3, carried: 3 });
    expect(e.tick).toBeGreaterThan(50);
    expect(e.tick).toBeLessThan(70);
    expect(r.snapAt(e.tick as number).drifters[0]).toMatchObject({ state: "flee", stolen: 3 });
    expect(r.eventsNamed("player_hit")).toHaveLength(0); // no flame lost
  });
  it("it flees 7 m/s for 240 ticks and then disappears; each drifter steals only once", () => {
    const r = runInline({ ticks: 400, every: 1, night: 2, scenario: { ...bare, player: { pos: [0, 0, 0], carried: 9 }, drifters: [{ id: "D1", pos: [3, 2, 0] }] } });
    const t = r.eventsNamed("drifter_steal")[0]!.tick as number;
    expect(r.eventsNamed("drifter_steal")).toHaveLength(1);
    expect(r.snapAt(t + 239).drifters).toHaveLength(1);
    expect(r.snapAt(t + 240).drifters).toHaveLength(0);
  });
  it("a drifter does not chase when Mây carries fewer than 5, or is farther than 15 m", () => {
    const few = runInline({ ticks: 5, night: 2, scenario: { ...bare, player: { carried: 4 }, drifters: [{ id: "D1", pos: [8, 2, 0] }] } });
    expect(few.snapAt(5).drifters[0].state).toBe("idle");
    const far = runInline({ ticks: 5, night: 2, scenario: { ...bare, player: { carried: 9 }, drifters: [{ id: "D1", pos: [15.5, 2, 0] }] } });
    expect(far.snapAt(5).drifters[0].state).toBe("idle");
  });
  it("it drifts slowly (2 m/s) while idle", () => {
    const r = runInline({ ticks: 60, every: 60, night: 2, scenario: { ...bare, drifters: [{ id: "D1", pos: [30, 2, 0] }] } });
    const p = r.snapAt(60).drifters[0].pos;
    expect(Math.hypot(p[0] - 30, p[2])).toBeCloseTo(2, 1);
  });
  it("Pulse on a chasing drifter makes it flee without stealing; on a fleeing one with loot it drops everything as fireflies", () => {
    const r = runNamed("drifter_pulse");
    expect(r.eventsNamed("drifter_drop")[0]?.data).toEqual({ drifter_id: "D2", amount: 3 });
    const s = r.snapAt(1);
    expect(s.drifters.find((d: any) => d.id === "D1")).toMatchObject({ state: "flee", stolen: 0 });
    expect(s.drifters.find((d: any) => d.id === "D2")).toMatchObject({ state: "flee", stolen: 0 });
    expect(s.motes.filter((m: any) => m.kind === "dropped")).toHaveLength(3);
    expect(r.eventsNamed("drifter_steal")).toHaveLength(0);
  });
  it("drifters appear in nights 2 and 3 only, at tick 1200, 2400 ..., at most 2", () => {
    const n1 = runInline({ ticks: 1300, every: 100, night: 1, scenario: { random_motes: false, random_shades: false } });
    expect(n1.snaps.every((s) => s.drifters.length === 0)).toBe(true);
    const n2 = runInline({ ticks: 4900, every: 100, night: 2, scenario: { random_motes: false, random_shades: false, player: { pos: [0, 0, 0], carried: 0 } } });
    expect(n2.snapAt(1100).drifters).toHaveLength(0);
    expect(n2.snapAt(1200).drifters).toHaveLength(1);
    expect(n2.snapAt(1200).drifters[0].id).toBe("D1");
    expect(Math.max(...n2.snaps.map((s) => s.drifters.length))).toBeLessThanOrEqual(2);
    expect(n2.snapAt(2400).drifters).toHaveLength(2);
  });
  it("random_drifters:false keeps them away", () => {
    const r = runInline({ ticks: 2500, every: 500, night: 3, scenario: { ...bare } });
    expect(r.snaps.every((s) => s.drifters.length === 0)).toBe(true);
  });
});

describe("shades on the other maps", () => {
  it("night 3 shades are faster (4.5 m/s)", () => {
    const r = runInline({ ticks: 60, every: 60, night: 3, scenario: { ...bare, player: { pos: [0, 0, -30] }, shades: [{ id: "S1", pos: [0, 1, -15], state: "chase" }] } });
    expect(r.snapAt(60).shades[0].pos[2]).toBeCloseTo(-15 - 4.5, 2);
  });
  it("night 2 shades spawn on the 16 points of the two islands, 1 every 7 s, at most 8; night 3: every 6 s, at most 10", () => {
    const n2 = runInline({ ticks: 6000, every: 600, night: 2, seed: 5, scenario: { random_motes: false, random_drifters: false, player: { pos: [0, 0, 20], flames: 99 } } });
    const sp = n2.eventsNamed("shade_spawned").map((e) => e.tick);
    expect(sp.slice(0, 4)).toEqual([300, 300, 720, 1140]);
    expect(Math.max(...n2.snaps.map((s) => s.shades.length))).toBeLessThanOrEqual(8);
    const n3 = runInline({ ticks: 6000, every: 600, night: 3, seed: 5, scenario: { random_motes: false, random_drifters: false, player: { pos: [0, 6, 6], flames: 99 } } });
    expect(n3.eventsNamed("shade_spawned").map((e) => e.tick).slice(0, 4)).toEqual([300, 300, 660, 1020]);
    expect(Math.max(...n3.snaps.map((s) => s.shades.length))).toBe(10);
  });
  it("shades cannot cross open air: a shade across the gap beside the bridge stays on its island", () => {
    const r = runInline({ ticks: 300, every: 100, night: 2, scenario: { ...bare, player: { pos: [35, 0, 0] }, shades: [{ id: "S1", pos: [35, 1, 10], state: "chase" }] } });
    expect(r.snapAt(300).shades[0].pos[2]).toBeGreaterThan(9.9); // there is nothing to walk on between z = 2 and z = 10 at x = 35
  });
  it("every night of random play stays deterministic and valid: motes start at 20, spawn cadence holds", () => {
    for (const name of ["random_night2", "random_night3"]) {
      const r = runNamed(name);
      expect(r.snapAt(0).motes_active).toBe(20);
      expect(r.eventsNamed("shade_spawned")[0]?.tick).toBe(C.first_shade_tick);
    }
  });
});
