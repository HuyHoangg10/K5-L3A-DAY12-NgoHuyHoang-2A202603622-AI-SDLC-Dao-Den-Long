import { describe, expect, it } from "vitest";
import { runInline } from "./helpers";

// Added after the independent review of phase 3: each test kills a mutant that survived the first test set.
const bare = { random_motes: false, random_shades: false, random_drifters: false, wind_enabled: false };
const dist2 = (a: number[], b: number[]) => Math.hypot((a[0] as number) - (b[0] as number), (a[2] as number) - (b[2] as number));
const FAR: [number, number, number] = [0, 0, -39];

describe("which lantern a wandering shade drains", () => {
  it("the nearest weak lit lantern", () => {
    const r = runInline({ ticks: 400, scenario: { ...bare, player: { pos: FAR }, lanterns: [{ id: "L1", lit: true, fuel: 25 }, { id: "L2", lit: true, fuel: 25 }], shades: [{ id: "S1", pos: [20, 1, 10] }] } });
    expect(r.eventsNamed("fuel_drain")[0]?.data?.lantern_id).toBe("L2"); // L2 (23.8, 7.7) is about 4 m away, L1 (0, 25) about 27 m
  });
  it("equal distances: the smaller id", () => {
    const r = runInline({
      ticks: 900,
      scenario: { ...bare, player: { pos: FAR }, lanterns: [{ id: "L1", lit: true, fuel: 25, pos: [10, 0, 0] }, { id: "L2", lit: true, fuel: 25, pos: [-10, 0, 0] }], shades: [{ id: "S1", pos: [0, 1, 30] }] },
    });
    expect(r.eventsNamed("fuel_drain")[0]?.data?.lantern_id).toBe("L1");
  });
  it("a weak lit lantern comes before an unlit one that is nearer", () => {
    const r = runInline({ ticks: 120, every: 120, scenario: { ...bare, player: { pos: FAR }, lanterns: [{ id: "L2", lit: true, fuel: 25 }], shades: [{ id: "S1", pos: [1.5, 1, 22] }] } });
    // L1 (unlit) is 3.5 m away; L2 (weak) is about 23 m away: the shade must leave L1 and walk towards L2
    expect(dist2(r.snapAt(120).shades[0].pos, [23.8, 0, 7.7])).toBeLessThan(dist2(r.snapAt(0).shades[0].pos, [23.8, 0, 7.7]) - 3);
  });
});

describe("boundaries of the drain", () => {
  const stateAt = (shadePos: [number, number, number], fuel: number, player: [number, number, number] = FAR, state: "wander" | "drain" = "wander") =>
    runInline({ ticks: 1, scenario: { ...bare, player: { pos: player }, lanterns: [{ id: "L1", lit: true, fuel }], shades: [{ id: "S1", pos: shadePos, state }] } }).snapAt(1).shades[0].state;
  it("the shade starts to drain within 2 m of the lantern, not at 2.1 m", () => {
    expect(stateAt([1.99, 1, 25], 20)).toBe("drain");
    expect(stateAt([2.1, 1, 25], 20)).toBe("wander");
  });
  it("a lantern with exactly 30 fuel (after the tick's decay) is not weak, 29.98 is", () => {
    expect(stateAt([1.5, 1, 25], 30 + 1 / 60)).toBe("wander");
    expect(stateAt([1.5, 1, 25], 30)).toBe("drain");
  });
  it("Mây exactly 6 m from the draining shade: it turns to chase; 6.01 m: it keeps draining", () => {
    expect(stateAt([1.5, 1, 25], 20, [1.5, 0, 19], "drain")).toBe("chase");
    expect(stateAt([1.5, 1, 25], 20, [1.5, 0, 18.99], "drain")).toBe("drain");
  });
});

describe("fuel in the snapshot and ever_lit", () => {
  it("fuel is rounded to one decimal, not cut: 99.98 prints 100, 99.93 prints 99.9", () => {
    const r = runInline({ ticks: 4, every: 1, scenario: { ...bare, lanterns: [{ id: "L1", lit: true }] } });
    expect(r.snapAt(1).lanterns[0].fuel).toBe(100);
    expect(r.snapAt(4).lanterns[0].fuel).toBe(99.9);
  });
  it("a lantern lit by Mây, burnt out, then needs only 5 fireflies again (ever_lit is set by a natural lighting)", () => {
    const r = runInline({
      ticks: 6110,
      every: 10,
      scenario: { ...bare, player: { pos: [0, 0, 23], carried: 15, successful_lights: 3 } },
      frames: [{ tick: 0, interact: true }, { tick: 1, interact: false }, { tick: 6100, interact: true }],
    });
    expect(r.eventsNamed("lantern_lit").map((e) => e.data?.relight)).toEqual([false, true]);
    expect(r.eventsNamed("lantern_out")).toHaveLength(1);
    expect(r.snapAt(6110).lanterns[0]).toMatchObject({ lit: true, ever_lit: true, relit_count: 1 });
  });
});
