import { describe, expect, it } from "vitest";
import { runInline } from "./helpers";

const bare = { random_motes: false, random_shades: false, random_drifters: false, wind_enabled: false };

describe("review of phase 2: findings fixed", () => {
  it("a shade hit has no `lost` field; only a fall adds it (spec part 4)", () => {
    const r = runInline({ ticks: 1, scenario: { ...bare, player: { carried: 4 }, shades: [{ id: "S1", pos: [0.6, 1, 0], state: "chase" }] } });
    expect(r.eventsNamed("player_hit")[0]?.data).toEqual({ by: "shade", flames: 2, dropped: 2 });
  });

  it("with the charm the dash has no cooldown, even if a cooldown was already running", () => {
    const r = runInline({
      ticks: 3,
      scenario: { ...bare, player: { charm_ticks: 600, dash_cd_ticks: 60 } },
      frames: [{ tick: 0, dash: true }],
    });
    expect(r.eventsNamed("dash")).toHaveLength(1);
    const without = runInline({ ticks: 3, scenario: { ...bare, player: { dash_cd_ticks: 60 } }, frames: [{ tick: 0, dash: true }] });
    expect(without.eventsNamed("dash")).toHaveLength(0);
  });

  it("on the respawn tick Mây stands still at the start point with velocity 0, even with a move key held", () => {
    const r = runInline({
      ticks: 90,
      every: 1,
      scenario: { ...bare, player: { pos: [0, -11, 0] } },
      frames: [{ tick: 0, move: [0, 1] }],
    });
    const fall = r.eventsNamed("player_hit").find((e) => e.data?.by === "fall");
    expect(fall).toBeDefined();
    const respawnTick = (fall as any).tick + 60;
    const s = r.snapAt(respawnTick);
    expect(s.player.pos).toEqual([0, 0, 0]);
    expect(s.player.vel).toEqual([0, 0, 0]);
    expect(s.player.invuln).toBe(true);
  });

  it("the `end` line never says paused: a run stopped while paused ends as playing", () => {
    const r = runInline({ ticks: 10, scenario: { ...bare }, frames: [{ tick: 2, pause: true }, { tick: 3, pause: false }] });
    expect(r.snapAt(10).state).toBe("paused");
    expect(r.end.state).toBe("playing");
  });
});

describe("review of phase 2: exact boundaries", () => {
  const mote = (pos: [number, number, number]) => runInline({ ticks: 1, scenario: { ...bare, player: { pos: [0, 0, 0] }, motes: [pos] } }).snapAt(1).player.carried;
  it("pickup: horizontal distance 1.0 m picks, 1.01 m does not", () => {
    expect(mote([1, 0, 0])).toBe(1);
    expect(mote([1.01, 0, 0])).toBe(0);
  });
  it("pickup: height difference 1.5 m picks, 1.51 m does not", () => {
    expect(mote([0, 1.5, 0])).toBe(1);
    expect(mote([0, 1.51, 0])).toBe(0);
  });
  const stateAfter = (x: number, state: "wander" | "chase") =>
    runInline({ ticks: 1, scenario: { ...bare, player: { pos: [0, 0, 0] }, shades: [{ id: "S1", pos: [x, 1, 0], state }] } }).snapAt(1).shades[0].state;
  it("detection: a wandering shade exactly 12.0 m away starts to chase, 12.01 m does not", () => {
    expect(stateAfter(12, "wander")).toBe("chase");
    expect(stateAfter(12.01, "wander")).toBe("wander");
  });
  it("giving up: a chasing shade exactly 18.0 m away keeps chasing, 18.01 m gives up", () => {
    expect(stateAfter(18, "chase")).toBe("chase");
    expect(stateAfter(18.01, "chase")).toBe("wander");
  });
  it("new shades appear at least 15 m from Mây", () => {
    const r = runInline({ ticks: 301, every: 301, scenario: { random_motes: false, random_drifters: false, wind_enabled: false, player: { pos: [20, 0, 0] } } });
    expect(r.eventsNamed("shade_spawned").length).toBeGreaterThan(0);
    const shades = r.snapAt(301).shades;
    expect(shades.length).toBeGreaterThan(0);
    for (const sh of shades) expect(Math.hypot(sh.pos[0] - 20, sh.pos[2])).toBeGreaterThanOrEqual(15);
  });
});
