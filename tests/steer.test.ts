import { describe, expect, it } from "vitest";
import { steer } from "../src/render/steer";
import { Sim } from "../src/sim/sim";
import { DT, TUNING as T } from "../src/sim/tuning";

/** Drive the real sim with steer() every tick until it says "arrived". */
function walkTo(start: [number, number], target: [number, number], yaw: number, maxTicks = 2000) {
  const sim = new Sim({ seed: 1, scenario: { random_motes: false, random_shades: false, player: { pos: [start[0], 0, start[1]] } } });
  let ticks = 0;
  for (; ticks < maxTicks; ticks++) {
    const s = steer([sim.player.pos[0], sim.player.pos[2]], target, yaw, T.player_speed, DT);
    if (s.arrived) break;
    sim.setInput({ move: s.move, camYawDeg: yaw, jump: false, interact: false, pulse: false, dash: false, pause: false });
    sim.step();
  }
  return { sim, ticks };
}

describe("click-to-move steering", () => {
  it.each([0, 37, 90, 135, 180, 250, -60])("with camera yaw %i degrees Mây ends within 0.05 m of the clicked point", (yaw) => {
    const { sim, ticks } = walkTo([0, 0], [12, -9], yaw);
    expect(Math.hypot(sim.player.pos[0] - 12, sim.player.pos[2] + 9)).toBeLessThanOrEqual(0.05);
    expect(ticks).toBeLessThan(15 / (T.player_speed * DT) + 5); // about 15 m at 6 m/s
    expect(ticks).toBeGreaterThan(15 / (T.player_speed * DT) - 5);
  });
  it("walks in a straight line (no wiggle): after the 0.1 s start-up every tick moves exactly speed*dt", () => {
    const sim = new Sim({ seed: 1, scenario: { random_motes: false, random_shades: false } });
    let last: [number, number] = [0, 0];
    for (let i = 0; i < 40; i++) {
      const s = steer([sim.player.pos[0], sim.player.pos[2]], [20, 5], 123, T.player_speed, DT);
      sim.setInput({ move: s.move, camYawDeg: 123, jump: false, interact: false, pulse: false, dash: false, pause: false });
      sim.step();
      const step = Math.hypot(sim.player.pos[0] - last[0], sim.player.pos[2] - last[1]);
      if (i >= 6) expect(step).toBeCloseTo(T.player_speed * DT, 9);
      else expect(step).toBeLessThanOrEqual(T.player_speed * DT + 1e-9);
      last = [sim.player.pos[0], sim.player.pos[2]];
    }
    // all on the line from (0,0) to (20,5)
    expect(sim.player.pos[2] / sim.player.pos[0]).toBeCloseTo(5 / 20, 9);
  });
  it("does not overshoot: the last step is shorter", () => {
    const s = steer([0, 0], [0, 0.06], 0, T.player_speed, DT);
    expect(s.arrived).toBe(false);
    expect(Math.hypot(s.move[0], s.move[1])).toBeCloseTo(0.06 / (T.player_speed * DT), 9);
  });
  it("standing on the point = arrived, no move", () => {
    expect(steer([3, 3], [3.04, 3], 40, T.player_speed, DT)).toEqual({ move: [0, 0], arrived: true });
  });
});
