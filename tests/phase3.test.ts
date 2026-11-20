import { describe, expect, it } from "vitest";
import { TUNING as T } from "../src/sim/tuning";
import { runInline, runNamed } from "./helpers";

const lantern = (s: any, id = "L1") => s.lanterns.find((l: any) => l.id === id);
const bare = { random_motes: false, random_shades: false, random_drifters: false, wind_enabled: false };
const dist2 = (a: number[], b: number[]) => Math.hypot((a[0] as number) - (b[0] as number), (a[2] as number) - (b[2] as number));

describe("1. lantern fuel", () => {
  it("a lit lantern starts with 100 fuel and loses 1 per second (1/60 per tick)", () => {
    const r = runNamed("fuel_decay");
    expect(lantern(r.snapAt(0)).fuel).toBe(100);
    expect(lantern(r.snapAt(60)).fuel).toBe(99);
    expect(lantern(r.snapAt(600)).fuel).toBe(90);
  });
  it("fuel is exact over a long run: 100 fuel last exactly 6000 ticks, the lantern goes out on the 6000th (no float drift)", () => {
    const r = runInline({ ticks: 6000, every: 6000, scenario: { ...bare, lanterns: [{ id: "L1", lit: true }] } });
    expect(lantern(r.snapAt(6000)).lit).toBe(false); // 100 s of fuel = 6000 ticks: out on the 6000th tick
    expect(r.eventsNamed("lantern_out")[0]?.tick).toBe(6000);
  });
  it("lit:true without fuel means 100; a scenario can set fuel, and lit:false wins over fuel", () => {
    const s = runInline({ ticks: 0, scenario: { ...bare, lanterns: [{ id: "L1", lit: true }, { id: "L2", fuel: 40 }, { id: "L3", lit: false, fuel: 40 }, { id: "L4", lit: true, fuel: 12.5 }] } }).snapAt(0);
    expect(lantern(s, "L1")).toMatchObject({ lit: true, fuel: 100, ever_lit: true, deposited: 10 });
    expect(lantern(s, "L2")).toMatchObject({ lit: true, fuel: 40 });
    expect(lantern(s, "L3")).toMatchObject({ lit: false, fuel: 0 });
    expect(lantern(s, "L4").fuel).toBe(12.5);
    expect(lantern(s, "L5")).toMatchObject({ lit: false, fuel: 0, ever_lit: false, relit_count: 0 });
  });
  it("refuel: used = min(carried, ceil((100 - fuel)/10)), +10 fuel each, event refuel, +5 points per firefly", () => {
    const r = runNamed("refuel");
    expect(r.eventsNamed("refuel")[0]).toEqual({ type: "event", tick: 1, name: "refuel", data: { lantern_id: "L1", amount: 6, fuel: 100 } });
    expect(r.snapAt(1).player.carried).toBe(4);
    expect(r.snapAt(1).score).toBe(6 * T.score.per_mote);
    const s = runNamed("refuel_small");
    expect(s.eventsNamed("refuel")[0]?.data).toEqual({ lantern_id: "L1", amount: 2, fuel: 100 });
  });
  it("refuel is limited by what Mây carries", () => {
    const r = runInline({ ticks: 2, scenario: { ...bare, player: { pos: [0, 0, 23], carried: 3 }, lanterns: [{ id: "L1", lit: true, fuel: 10 }] }, frames: [{ tick: 0, interact: true }] });
    const d = r.eventsNamed("refuel")[0]!.data as any;
    expect(d.amount).toBe(3);
    expect(d.fuel).toBeCloseTo(10 - 1 / 60 + 30, 1);
    expect(r.snapAt(2).player.carried).toBe(0);
  });
  it("with nothing carried the press does nothing: no event, no score", () => {
    const r = runNamed("refuel_no_light");
    expect(r.eventsNamed("refuel")).toHaveLength(0);
    expect(r.end.score).toBe(0);
  });
  it("out of fuel: the lantern goes off, deposited resets to 0, event lantern_out, ever_lit stays true", () => {
    const r = runNamed("lantern_out");
    expect(r.eventsNamed("lantern_out")).toEqual([{ type: "event", tick: 120, name: "lantern_out", data: { lantern_id: "L1" } }]);
    expect(lantern(r.snapAt(100))).toMatchObject({ lit: true, deposited: 10 });
    expect(lantern(r.snapAt(120))).toMatchObject({ lit: false, fuel: 0, deposited: 0, ever_lit: true });
  });
  it("relight: a lantern that was lit before needs 5 fireflies, +5 each and +40; relight:true, relit_count 1, fuel 100", () => {
    const r = runNamed("relight");
    expect(r.eventsNamed("deposit")[0]?.data).toEqual({ lantern_id: "L1", amount: 5, deposited: 5 });
    expect(r.eventsNamed("lantern_lit")[0]?.data).toEqual({ lantern_id: "L1", relight: true });
    expect(lantern(r.snapAt(1))).toMatchObject({ lit: true, fuel: 100, relit_count: 1, ever_lit: true });
    expect(r.snapAt(1).score).toBe(5 * T.score.per_mote + 40);
  });
  it("a partly paid relight stays unlit and remembers the fireflies", () => {
    const r = runNamed("relight_partial");
    expect(lantern(r.snapAt(1))).toMatchObject({ lit: false, deposited: 3, ever_lit: true });
    expect(r.eventsNamed("lantern_lit")).toHaveLength(0);
  });
  it("a lantern never lit still needs 10 and scores +100 (relight:false)", () => {
    const r = runNamed("deposit_full");
    expect(r.eventsNamed("lantern_lit")[0]?.data).toEqual({ lantern_id: "L1", relight: false });
    expect(r.snapAt(1).score).toBe(10 * T.score.per_mote + 100);
    const half = runNamed("deposit_partial");
    expect(half.eventsNamed("lantern_lit")).toHaveLength(0);
  });
});

describe("2. shades drain fuel", () => {
  it("a wandering shade walks to a weak (< 30) lit lantern, stops within 2 m and drains: state drain, 5 + 1 fuel per second", () => {
    const r = runNamed("drain");
    expect(r.snapAt(10).shades[0].state).toBe("drain");
    expect(lantern(r.snapAt(60)).fuel).toBeCloseTo(25 - 60 * (6 / 60), 0); // 6 fuel per second (1 own decay + 5 drain): about 19 after 60 ticks
    const ev = r.eventsNamed("fuel_drain");
    expect(ev[0]?.data).toEqual({ lantern_id: "L1", shade_id: "S1", fuel: 19 });
    expect(ev.slice(0, 3).map((e) => e.tick)).toEqual([61, 121, 181]);
  });
  it("fuel_drain is written every 60 ticks of draining, per shade; two shades drain 11 per second together", () => {
    const r = runNamed("drain_two_shades");
    const ev = r.eventsNamed("fuel_drain");
    expect(ev.filter((e) => e.tick === 61).map((e) => e.data?.shade_id)).toEqual(["S1", "S2"]);
    expect(ev[0]?.data?.fuel).toBeCloseTo(25 - 60 * (11 / 60), 0);
  });
  it("the lantern goes out when the drain takes the last fuel; the shades go back to wander", () => {
    const r = runNamed("drain");
    expect(r.eventsNamed("lantern_out")).toHaveLength(1);
    expect(r.snapAt(260).shades[0].state).toBe("wander");
    expect(lantern(r.snapAt(260)).lit).toBe(false);
  });
  it("Mây within 6 m: the draining shade turns to chase at once", () => {
    const r = runNamed("drain_chase");
    expect(r.snapAt(0).shades[0].state).toBe("drain");
    expect(r.snapAt(1).shades[0].state).toBe("chase");
  });
  it("a pulse on a draining shade stuns it and scores +15 instead of +5", () => {
    const r = runNamed("drain_pulse");
    expect(r.eventsNamed("pulse")[0]?.data).toEqual({ stunned_ids: ["S1"] });
    expect(r.snapAt(1).shades[0].state).toBe("stunned");
    expect(r.snapAt(1).score).toBe(15);
    // a normal shade gives 5
    const n = runInline({ ticks: 2, scenario: { ...bare, player: { carried: 3 }, shades: [{ id: "S1", pos: [3, 1, 0] }] }, frames: [{ tick: 0, pulse: true }] });
    expect(n.snapAt(1).score).toBe(5);
  });
  it("after the stun a shade goes to wander, not back to drain by itself", () => {
    const r = runInline({
      ticks: 140, every: 1,
      scenario: { ...bare, player: { pos: [-30, 0, 25], carried: 3 }, lanterns: [{ id: "L1", lit: true, fuel: 80 }], shades: [{ id: "S1", pos: [-27, 1, 25], state: "drain", target_lantern_id: "L1" }] },
      frames: [{ tick: 0, pulse: true }],
    });
    expect(r.snapAt(121).shades[0].state).not.toBe("stunned");
    expect(["wander", "chase"]).toContain(r.snapAt(121).shades[0].state);
  });
  it("a lantern refuelled to 30 or more: the shades stop draining and are pushed out of 6 m within 30 ticks without hurting", () => {
    const r = runNamed("refuel_pushout");
    expect(r.snapAt(1).shades[0].state).not.toBe("drain");
    expect(r.eventsNamed("player_hit")).toHaveLength(0);
    expect(dist2(r.snapAt(31).shades[0].pos, [0, 0, 25])).toBeGreaterThanOrEqual(6 - 0.001);
    expect(dist2(r.snapAt(31).shades[0].pos, [0, 0, 25])).toBeLessThanOrEqual(6 + 0.05);
  });
  it("below 30 fuel the safe zone is gone: a chasing shade walks in; at 31 it stays out", () => {
    const weak = runNamed("weak_unsafe");
    expect(Math.min(...weak.snaps.map((s) => dist2(s.shades[0].pos, [0, 0, 25])))).toBeLessThan(5.5);
    const strong = runNamed("strong_safe");
    expect(Math.min(...strong.snaps.map((s) => dist2(s.shades[0].pos, [0, 0, 25])))).toBeGreaterThanOrEqual(6 - 0.001);
  });
  it("exactly 30 fuel still has its safe zone, 29.98 does not", () => {
    // Mây stands at the lantern, a chasing shade starts 4 m from it. After one tick of decay the lantern has
    // 30.0 (safe: the shade is pushed out to 6 m) or 29.98 (not safe: the shade walks in).
    const after = (fuel: number) =>
      dist2(runInline({ ticks: 1, scenario: { ...bare, player: { pos: [0, 0, 26], flames: 99 }, lanterns: [{ id: "L1", lit: true, fuel }], shades: [{ id: "S1", pos: [0, 1, 21], state: "chase" }] } }).snapAt(1).shades[0].pos, [0, 0, 25]);
    expect(after(30 + 1 / 60)).toBeGreaterThanOrEqual(4); // safe: not allowed closer
    expect(after(30)).toBeLessThan(4); // weak: walks in towards Mây
  });
  it("only wandering shades pick a weak lantern: a shade that is chasing keeps chasing Mây", () => {
    const r = runInline({ ticks: 30, every: 10, scenario: { ...bare, player: { pos: [0, 0, 0] }, lanterns: [{ id: "L1", lit: true, fuel: 20 }], shades: [{ id: "S1", pos: [8, 1, 12], state: "chase" }] } });
    expect(r.snapAt(30).shades[0].pos[2]).toBeLessThan(12); // towards Mây at z = 0; the weak lantern is at z = 25, the other way
  });
  it("a wandering shade heads for the nearest weak lit lantern before any unlit one", () => {
    const r = runNamed("wander_to_weak");
    const first = r.snapAt(0).shades[0].pos;
    const later = r.snapAt(60).shades[0].pos;
    expect(dist2(later, [23.8, 0, 7.7])).toBeLessThan(dist2(first, [23.8, 0, 7.7])); // L2 is weak and lit
    expect(r.snapAt(120).shades[0].state).toBe("drain");
  });
  it("with no weak lantern it goes to the nearest unlit one as before", () => {
    const r = runInline({ ticks: 60, every: 60, scenario: { ...bare, player: { pos: [0, 0, -39] }, lanterns: [{ id: "L1", lit: true }], shades: [{ id: "S1", pos: [-20, 1, 0] }] } });
    expect(dist2(r.snapAt(60).shades[0].pos, [-23.8, 0, 7.7])).toBeLessThan(dist2(r.snapAt(0).shades[0].pos, [-23.8, 0, 7.7]));
  });
  it("scenario target_lantern_id sends a wandering shade to that lantern", () => {
    const r = runNamed("target_lantern");
    // L2 is at +X, the shade starts at x = -20 and must walk towards it
    expect(r.snapAt(120).shades[0].pos[0]).toBeGreaterThan(-20 + 3);
  });
  it("a draining shade can still touch Mây if she walks into it (no special protection)", () => {
    const r = runInline({ ticks: 5, scenario: { ...bare, player: { pos: [1.5, 0, 25.4], carried: 0 }, lanterns: [{ id: "L1", lit: true, fuel: 20 }], shades: [{ id: "S1", pos: [1.5, 1, 25], state: "drain" }] } });
    expect(r.eventsNamed("player_hit")).toHaveLength(1);
  });
});

describe("3. new win rule and 4. capacity", () => {
  it("capacity = 10 + 2 x successful lightings, at most 20", () => {
    expect(runNamed("capacity_growth").snapAt(0).player.capacity).toBe(16);
    expect(runNamed("capacity_cap").snapAt(0).player.capacity).toBe(20);
    expect(runInline({ ticks: 0 }).snapAt(0).player.capacity).toBe(10);
  });
  it("pickup stops at the current capacity (16 with 3 lightings)", () => {
    const r = runNamed("capacity_growth");
    expect(r.eventsNamed("mote_picked").map((e) => e.data?.carried)).toEqual([16]);
    expect(r.snapAt(5).player.carried).toBe(16);
  });
  it("lighting a lantern raises the capacity by 2 (10 -> 12); a relight counts too", () => {
    expect(runNamed("light_grows_capacity").snapAt(2).player.capacity).toBe(12);
    expect(runNamed("relight").snapAt(2).player.capacity).toBe(12);
  });
  it("lanterns preset by the scenario do not count as successful lightings", () => {
    expect(runInline({ ticks: 1, scenario: { ...bare, lanterns: [{ id: "L1", lit: true }, { id: "L2", lit: true }] } }).snapAt(1).player.capacity).toBe(10);
  });
  it("a refuel is not a lighting: capacity stays", () => {
    expect(runNamed("refuel").snapAt(2).player.capacity).toBe(10);
  });
  it("capacity starts again from 10 in every night (a new Sim)", () => {
    expect(runInline({ ticks: 0, night: 2 }).snapAt(0).player.capacity).toBe(10);
  });
  it("dropping on a hit uses floor(carried / 2) of what is carried now (not of the capacity)", () => {
    const r = runInline({ ticks: 1, scenario: { ...bare, player: { carried: 15, successful_lights: 3 }, shades: [{ id: "S1", pos: [0.5, 1, 0], state: "chase" }] } });
    expect(r.eventsNamed("player_hit")[0]?.data).toMatchObject({ dropped: 7 });
  });
});

describe("5. score", () => {
  it("+5 per firefly put in (light, relight, refuel), +100 first light, +40 relight", () => {
    expect(T.score).toMatchObject({ per_mote: 5, per_lantern: 100 });
    expect(runNamed("deposit_full").end.score).toBe(150);
    expect(runNamed("relight").end.score).toBe(65);
    expect(runNamed("refuel").end.score).toBe(30);
  });
  it("dawn: +50 + floor(fuel) per lit lantern and +50 per flame left; nothing for the time", () => {
    expect(runNamed("dawn_win").end.score).toBe(3 * 99 + 150);
    const lowFlames = runInline({ ticks: 100, scenario: { ...bare, time_left_s: 1, player: { flames: 1 }, lanterns: [{ id: "L1", lit: true, fuel: 10.9 }, { id: "L2", lit: true }, { id: "L3", lit: true }] } });
    expect(lowFlames.end.score).toBe(50 + 9 + 2 * (50 + 99) + 50); // fuel 10.9 - 1 = 9.9 -> floor 9
  });
  it("a lost night scores no dawn bonus", () => {
    expect(runNamed("dawn_lose_threshold").end.score).toBe(0);
  });
});
