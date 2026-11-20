import { describe, expect, it } from "vitest";
import { TUNING as T } from "../src/sim/tuning";
import { runInline } from "./helpers";

describe("hit_drop_ratio rounding", () => {
  const hit = (carried: number) =>
    runInline({
      ticks: 1,
      scenario: { random_motes: false, random_shades: false, player: { carried }, shades: [{ id: "S1", pos: [0.5, 1, 0] }] },
    });
  it("odd carried rounds the drop down: 5 * 0.5 -> 2 dropped, 3 kept", () => {
    expect(T.hit_drop_ratio).toBe(0.5);
    const r = hit(5);
    expect(r.eventsNamed("player_hit")[0]?.data).toEqual({ by: "shade", flames: 2, dropped: 2 });
    expect(r.snapAt(1).player.carried).toBe(3);
    expect(r.snapAt(1).motes_active).toBe(2);
  });
  it("carrying 1 drops 0", () => {
    expect(hit(1).eventsNamed("player_hit")[0]?.data).toEqual({ by: "shade", flames: 2, dropped: 0 });
  });
  it("carrying 0 still loses a flame", () => {
    expect(hit(0).eventsNamed("player_hit")[0]?.data).toEqual({ by: "shade", flames: 2, dropped: 0 });
  });
});
