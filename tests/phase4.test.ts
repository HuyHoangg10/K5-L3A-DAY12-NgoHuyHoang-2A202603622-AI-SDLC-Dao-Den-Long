import { describe, expect, it } from "vitest";
import { Rng } from "../src/sim/rng";
import { Sim } from "../src/sim/sim";
import type { Scenario } from "../src/sim/types";
import { benchStats } from "../src/render/benchstats";
import { directionWord } from "../src/render/cues";

describe("benchmark numbers (Ticket-04 definitions)", () => {
  it("avg_fps = 1000 * N / sum(dt)", () => {
    // 4 frames of 10, 10, 10 and 20 ms: 4000 / 50 = 80 fps
    expect(benchStats([10, 10, 10, 20]).avg_fps).toBe(80);
  });
  it("p1_low_fps uses the k = max(1, ceil(0.01 N)) largest frame times", () => {
    // N = 4: k = 1, the worst frame is 20 ms -> 50 fps
    expect(benchStats([10, 10, 10, 20]).p1_low_fps).toBe(50);
    // N = 200: k = 2, the two worst are 100 and 50 ms -> mean 75 ms -> 13.3 fps
    const dt = Array.from({ length: 200 }, () => 10);
    dt[3] = 100;
    dt[77] = 50;
    expect(benchStats(dt).p1_low_fps).toBe(13.3);
    // N = 101: ceil(1.01) = 2 frames, not 1
    const d101 = Array.from({ length: 101 }, () => 10);
    d101[0] = 40;
    expect(benchStats(d101).p1_low_fps).toBe(40); // mean of 40 and 10 = 25 ms -> 40 fps
  });
  it("frame_ms_p95 is the 95th percentile (nearest rank)", () => {
    const dt = Array.from({ length: 100 }, (_, i) => i + 1); // 1..100 ms
    expect(benchStats(dt).frame_ms_p95).toBe(95);
    expect(benchStats([5, 5, 5, 5, 50]).frame_ms_p95).toBe(50); // ceil(0.95 * 5) = 5th of 5
  });
  it("counts the frames and survives an empty list", () => {
    expect(benchStats([16, 17]).frames).toBe(2);
    expect(benchStats([])).toEqual({ frames: 0, avg_fps: 0, p1_low_fps: 0, frame_ms_p95: 0 });
  });
});

describe("benchmark scene in the sim (option bench)", () => {
  const scene = (bench: boolean): Sim => {
    const rng = new Rng(42);
    const shades = Array.from({ length: 200 }, (_, i) => {
      const a = rng.next() * Math.PI * 2;
      const r = Math.sqrt(rng.next()) * 36;
      return { id: `S${i + 1}`, pos: [Math.cos(a) * r, 1, Math.sin(a) * r] as [number, number, number], state: "wander" as const };
    });
    const sc: Scenario = {
      random_motes: false, random_shades: false, random_drifters: false, wind_enabled: false,
      player: { pos: [0, 0, 0] },
      lanterns: [1, 2, 3].map((n) => ({ id: `L${n}`, lit: true, fuel: 100 })),
      shades,
      motes: Array.from({ length: 100 }, (_, i) => (i === 0 ? [0.3, 0, 0] : [Math.cos(i) * 10, 0, Math.sin(i) * 10]) as [number, number, number]), // the first one is within reach of Mây
    };
    return new Sim({ seed: 42, night: 1, scenario: sc, bench });
  };
  it("has exactly 200 shades, 100 fireflies and lanterns L1-L3 lit with 100 fuel", () => {
    const s = scene(true);
    expect(s.shades).toHaveLength(200);
    expect(s.motes).toHaveLength(100);
    expect(s.lanterns.filter((l) => l.lit).map((l) => [l.id, l.fuel60 / 60])).toEqual([["L1", 100], ["L2", 100], ["L3", 100]]);
  });
  it("after 40 s: nothing spawned, nobody hurt, nothing picked up, fuel unchanged, the night has not ended", () => {
    const s = scene(true);
    for (let i = 0; i < 2400; i++) s.step();
    expect(s.shades).toHaveLength(200);
    expect(s.motes).toHaveLength(100);
    expect(s.player.flames).toBe(3);
    expect(s.player.carried).toBe(0); // the mote at 0.3 m was not picked up
    expect(s.lanterns.slice(0, 3).map((l) => l.fuel60)).toEqual([6000, 6000, 6000]);
    expect(s.status).toBe("playing");
    expect(s.score).toBe(0);
  });
  it("without the option the same scene does hurt Mây and picks fireflies up (so the option is what turns them off)", () => {
    const s = scene(false);
    for (let i = 0; i < 2400; i++) s.step();
    expect(s.lanterns[0]!.fuel60).toBeLessThan(6000);
    expect(s.player.carried).toBeGreaterThan(0);
    expect(s.player.flames).toBeLessThan(3);
  });
  it("shades keep walking (wander) in the bench scene", () => {
    const s = scene(true);
    const before = s.shades.map((x) => [...x.pos]);
    for (let i = 0; i < 300; i++) s.step();
    const moved = s.shades.filter((x, i) => Math.hypot(x.pos[0] - before[i]![0]!, x.pos[2] - before[i]![2]!) > 1).length;
    expect(moved).toBeGreaterThan(150);
  });
});

describe("subtitle directions", () => {
  it("camera yaw 0 looks along +Z: +Z is ahead, -X is right, +X is left, -Z is behind", () => {
    expect(directionWord(0, 0, 0, 10, 0)).toBe("ahead");
    expect(directionWord(0, 0, -10, 0, 0)).toBe("on your right");
    expect(directionWord(0, 0, 10, 0, 0)).toBe("on your left");
    expect(directionWord(0, 0, 0, -10, 0)).toBe("behind you");
  });
  it("turning the camera 90 degrees changes what is ahead", () => {
    // yaw 90: forward is +X
    expect(directionWord(0, 0, 10, 0, 90)).toBe("ahead");
    expect(directionWord(0, 0, 0, 10, 90)).toBe("on your right"); // yaw 90: the right hand points to +Z
  });
});
