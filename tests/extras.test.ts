import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CardKit, KIT } from "../src/extras/cards";
import { CHAMPIONS } from "../src/extras/champions";
import { SHADE_INK } from "../src/extras/kit";
import { snapshotLine } from "../src/sim/output";
import { Sim } from "../src/sim/sim";
import { TUNING as T } from "../src/sim/tuning";
import type { Scenario } from "../src/sim/types";
import { root } from "./helpers";
import { freeze, moveInput, names, poke, run, setup } from "./kithelpers";

const mk = (scn: Scenario = {}) => setup((s) => new CardKit(s), scn);

describe("Card Reader: Q Card Fan", () => {
  it("needs a firefly: with none carried nothing is thrown, nothing is paid, no cooldown", () => {
    const { sim, kit } = mk({ player: { carried: 0 } });
    expect(names(run(sim, kit, 3, { 0: ["q"] }))).toEqual(["no_light"]);
    expect(kit.shots).toHaveLength(0);
    expect(kit.cd.q).toBe(0);
  });
  it("costs one firefly, throws 3 cards, starts the cooldown", () => {
    const { sim, kit } = mk({ player: { carried: 3 } });
    run(sim, kit, 1, { 0: ["q"] });
    expect(sim.player.carried).toBe(3 - KIT.q.cost);
    expect(kit.shots).toHaveLength(3);
    expect(kit.cd.q).toBe(KIT.q.cd);
  });
  it("cooldown is exact: a press one tick early is blocked, the exact tick works", () => {
    const early = mk({ player: { carried: 9 } });
    expect(names(run(early.sim, early.kit, KIT.q.cd, { 0: ["q"], [KIT.q.cd - 1]: ["q"] })).filter((n) => n === "cast_q")).toHaveLength(1);
    const exact = mk({ player: { carried: 9 } });
    expect(names(run(exact.sim, exact.kit, KIT.q.cd + 1, { 0: ["q"], [KIT.q.cd]: ["q"] })).filter((n) => n === "cast_q")).toHaveLength(2);
  });
  it("flies toward the mouse: a shade at -X is hit when the mouse is at -X, missed when there is no mouse (camera looks +Z)", () => {
    const a = mk({ player: { carried: 3 }, shades: [{ id: "S1", pos: [-10, 1, 0] }] });
    freeze(a.sim);
    expect(names(run(a.sim, a.kit, 40, { 0: ["q"] }, [-10, 0]))).toContain("card_hit");
    const b = mk({ player: { carried: 3 }, shades: [{ id: "S1", pos: [-10, 1, 0] }] });
    freeze(b.sim);
    expect(names(run(b.sim, b.kit, 40, { 0: ["q"] }, null))).not.toContain("card_hit");
  });
  it("cards pass through: two shades in a line are both hit by one cast, each thinned by 1 ink", () => {
    const { sim, kit } = mk({ player: { carried: 3 }, shades: [{ id: "S1", pos: [0, 1, 6] }, { id: "S2", pos: [0, 1, 10] }] });
    freeze(sim);
    const ev = run(sim, kit, 50, { 0: ["q"] }, [0, 20]);
    expect(ev.filter((e) => e.name === "card_hit").map((e) => e.shade)).toEqual(["S1", "S2"]);
    expect(poke(kit).inkOf(sim.shades[0])).toBe(SHADE_INK - KIT.q.damage);
  });
  it("a hit shade is stunned for 1 s", () => {
    const { sim, kit } = mk({ player: { carried: 3 }, shades: [{ id: "S1", pos: [0, 1, 6] }] });
    run(sim, kit, 30, { 0: ["q"] }, [0, 20]);
    expect(sim.shades[0]?.stunTicks).toBeGreaterThan(0);
  });
  it("cards stop after KIT.q.range metres", () => {
    const { sim, kit } = mk({ player: { carried: 3 } });
    run(sim, kit, Math.ceil(KIT.q.range / (KIT.q.speed / 60)) + 2, { 0: ["q"] });
    expect(kit.shots).toHaveLength(0);
  });
  it("the 3 cards leave at 0 and +-spreadDeg", () => {
    const { sim, kit } = mk({ player: { carried: 3 } });
    run(sim, kit, 1, { 0: ["q"] }, [0, 20]);
    const angles = kit.shots.map((s) => Math.round((Math.atan2(s.dir[0], s.dir[1]) * 180) / Math.PI)).sort((x, y) => x - y);
    expect(angles).toEqual([-KIT.q.spreadDeg, 0, KIT.q.spreadDeg]);
  });
});

describe("Card Reader: W Roll the Card (the card acts at once)", () => {
  const pickAt = (tick: number, scn: Scenario = {}) => {
    const t = mk(scn);
    const ev = run(t.sim, t.kit, tick + 2, { 0: ["w"], [tick]: ["w"] });
    return { ...t, ev, picked: ev.find((e) => e.name === "card_picked") };
  };
  it("cards flip gold -> blue -> pink every 6 ticks and the second press stops on the one showing", () => {
    expect(pickAt(3).picked?.card).toBe("gold");
    expect(pickAt(8).picked?.card).toBe("blue");
    expect(pickAt(14).picked?.card).toBe("red");
    expect(pickAt(19).picked?.card).toBe("gold");
  });
  it("stops by itself after rollMax ticks", () => {
    const { sim, kit } = mk();
    const ev = run(sim, kit, KIT.w.rollMax + 2, { 0: ["w"] });
    expect(ev.find((e) => e.name === "card_picked")).toMatchObject({ auto: true });
  });
  it("gold: every shade within goldRadius freezes for goldStun ticks; shades farther away are untouched", () => {
    const { sim, picked } = pickAt(3, { shades: [{ id: "S1", pos: [0, 1, 5] }, { id: "S2", pos: [0, 1, 9] }] });
    expect(picked?.frozen).toEqual(["S1"]);
    expect(sim.shades[0]?.stunTicks).toBeGreaterThan(KIT.w.goldStun - 10);
    expect(sim.shades[0]?.stunTicks).toBeLessThanOrEqual(KIT.w.goldStun);
    expect(sim.shades[1]?.stunTicks).toBe(0);
  });
  it("blue: adds blueMana fireflies, never above capacity", () => {
    expect(pickAt(8, { player: { carried: 2 } }).sim.player.carried).toBe(2 + KIT.w.blueMana);
    expect(pickAt(8, { player: { carried: T.carry_capacity - 1 } }).sim.player.carried).toBe(T.carry_capacity);
  });
  it("pink: run speed x redBoost for redTicks, then back to normal", () => {
    const { sim, kit } = mk();
    sim.setInput(moveInput([0, 1]));
    run(sim, kit, 15, { 0: ["w"], 14: ["w"] });
    expect(kit.speedMult).toBe(KIT.w.redBoost);
    const z0 = sim.player.pos[2];
    run(sim, kit, 60);
    expect(sim.player.pos[2] - z0).toBeCloseTo(6 * KIT.w.redBoost, 1);
    run(sim, kit, KIT.w.redTicks);
    expect(kit.speedMult).toBe(1);
  });
  it("cooldown starts at the pick; rolling again before it ends is refused", () => {
    const { sim, kit } = mk();
    run(sim, kit, 10, { 0: ["w"], 8: ["w"] });
    expect(kit.cd.w).toBeGreaterThan(KIT.w.cd - 5);
    expect(names(run(sim, kit, 3, { 0: ["w"] }))).toEqual(["on_cooldown"]);
    expect(kit.rolling).toBe(false);
  });
  it("shows the rolling card above the hat, and clears it after the pick", () => {
    const { sim, kit } = mk();
    run(sim, kit, 8, { 0: ["w"] });
    expect(kit.badge).not.toBeNull();
    run(sim, kit, 2, { 0: ["w"] });
    expect(kit.badge).toBeNull();
  });
});

describe("Card Reader: E Lure Lantern (new)", () => {
  it("costs a firefly and needs light", () => {
    const { sim, kit } = mk({ player: { carried: 0 } });
    expect(names(run(sim, kit, 2, { 0: ["e"] }))).toEqual(["no_light"]);
    const b = mk({ player: { carried: 2 } });
    run(b.sim, b.kit, 1, { 0: ["e"] }, [8, 0]);
    expect(b.sim.player.carried).toBe(2 - KIT.e.cost);
  });
  it("shades chase the lure instead of Mây while it lasts", () => {
    // lure at (10,0); the shade at (10,12) walks straight down x=10 toward it; without the lure it drifts toward Mây
    const withLure = mk({ player: { carried: 2 }, shades: [{ id: "S1", pos: [10, 1, 12] }] });
    run(withLure.sim, withLure.kit, 61, { 0: ["e"] }, [10, 0]);
    expect(withLure.sim.shades[0]?.pos[0]).toBeCloseTo(10, 1); // the first tick moved it toward Mây before the lure existed
    expect(withLure.sim.shades[0]?.pos[2]).toBeLessThan(12 - 3);
    const without = mk({ player: { carried: 2 }, shades: [{ id: "S1", pos: [10, 1, 12] }] });
    run(without.sim, without.kit, 61);
    expect(without.sim.shades[0]?.pos[0]).toBeLessThan(9.5);
  });
  it("when it ends it bursts: shades next to it are stunned and thinned by 1 ink", () => {
    const { sim, kit } = mk({ player: { carried: 2 }, shades: [{ id: "S1", pos: [10, 1, 3] }] });
    const ev = run(sim, kit, KIT.e.lureTicks + 2, { 0: ["e"] }, [10, 0]);
    expect(names(ev)).toContain("lure_burst");
    expect(sim.shades[0]?.stunTicks).toBeGreaterThan(KIT.e.burstStun - 10);
    expect(poke(kit).inkOf(sim.shades[0])).toBe(SHADE_INK - KIT.e.burstDamage);
  });
  it("the lure can be thrown at most `range` metres away", () => {
    const { sim, kit } = mk({ player: { carried: 2 } });
    run(sim, kit, 1, { 0: ["e"] }, [50, 0]);
    expect(kit.fx.find((f) => f.kind === "pillar")?.pos).toEqual([KIT.e.range, 0]);
  });
  it("cooldown KIT.e.cd", () => {
    const { sim, kit } = mk({ player: { carried: 2 } });
    run(sim, kit, 1, { 0: ["e"] });
    expect(kit.cd.e).toBe(KIT.e.cd);
  });
});

describe("Card Reader: R Lantern Gate", () => {
  it("channels, then puts Mây 2 m from the lantern nearest to the mouse", () => {
    const { sim, kit } = mk();
    const l2 = sim.lanterns[1]!;
    const ev = run(sim, kit, KIT.r.channel + 1, { 0: ["r"] }, [l2.pos[0] + 1, l2.pos[2]]);
    expect(ev.find((e) => e.name === "gate_start")).toMatchObject({ lantern: "L2" });
    const p = sim.player.pos;
    expect(Math.hypot(p[0] - l2.pos[0], p[2] - l2.pos[2])).toBeCloseTo(KIT.r.arrive, 3);
  });
  it("without a mouse it uses the camera: yaw 90 looks along +X, which is L2", () => {
    const { sim, kit } = mk();
    expect(run(sim, kit, 2, { 0: ["r"] }, null, 90).find((e) => e.name === "gate_start")).toMatchObject({ lantern: "L2" });
  });
  it("does not move Mây before the channel ends", () => {
    const { sim, kit } = mk();
    run(sim, kit, KIT.r.channel - 5, { 0: ["r"] });
    expect(sim.player.pos).toEqual([0, 0, 0]);
  });
  it("a hit cancels the channel and starts the short cooldown", () => {
    const { sim, kit } = mk({ shades: [{ id: "S1", pos: [20, 1, 0] }] });
    run(sim, kit, 2, { 0: ["r"] });
    sim.shades[0]!.pos = [0.5, 1, 0];
    expect(names(run(sim, kit, 3))).toContain("gate_cancel");
    expect(kit.channelLeft).toBe(0);
    expect(kit.cd.r).toBeLessThanOrEqual(KIT.r.cancelCd);
    expect(kit.cd.r).toBeGreaterThan(KIT.r.cancelCd - 6);
  });
  it("full cooldown after a successful gate", () => {
    const { sim, kit } = mk();
    run(sim, kit, KIT.r.channel + 1, { 0: ["r"] });
    expect(kit.cd.r).toBeGreaterThan(KIT.r.cd - 5);
  });
});

describe("ink: shades dissolve into light, no violence", () => {
  it("a shade whose ink runs out is removed, leaves a firefly on the ground and gives 30 points", () => {
    const { sim, kit } = mk({ shades: [{ id: "S1", pos: [20, 1, 0] }] });
    const s = sim.shades[0]!;
    const out: any[] = [];
    expect(poke(kit).hit(s, 2, out)).toBe(false);
    expect(poke(kit).hit(s, 1, out)).toBe(true);
    expect(sim.shades).toHaveLength(0);
    expect(sim.motes.map((m) => m.pos)).toEqual([[20, 0, 0]]);
    expect(sim.score).toBe(30);
    expect(out.map((e) => e.name)).toEqual(["dissolve"]);
  });
  it("poison takes exactly 1 ink over 3 seconds", () => {
    const { sim, kit } = mk({ shades: [{ id: "S1", pos: [30, 1, 0] }] });
    freeze(sim);
    poke(kit).poisonShade(sim.shades[0], 180);
    run(sim, kit, 179);
    expect(poke(kit).inkOf(sim.shades[0])).toBeCloseTo(SHADE_INK - 179 / 180, 9);
    run(sim, kit, 5);
    expect(poke(kit).inkOf(sim.shades[0])).toBeCloseTo(SHADE_INK - 1, 9);
  });
});

describe("every champion stays out of the Test Contract", () => {
  it.each(CHAMPIONS.map((c) => [c.id, c] as const))("%s: an idle kit never changes the sim (byte-identical snapshots for 900 ticks)", (_id, champ) => {
    const scn: Scenario = { random_motes: true, random_shades: true };
    const a = new Sim({ seed: 11, scenario: scn });
    const b = new Sim({ seed: 11, scenario: scn });
    const kit = champ.create(b);
    for (let t = 0; t < 900; t++) {
      a.step();
      b.step();
      kit.tick({ pressed: { q: false, w: false, e: false, r: false }, camYawDeg: 0, aim: null });
      if (kit.speedMult !== 1) continue; // champions with a passive speed bonus move faster on purpose
      expect(snapshotLine(b)).toBe(snapshotLine(a));
    }
  });
  it("src/sim, src/headless and the built CLI do not reference src/extras", () => {
    const walk = (d: string): string[] =>
      readdirSync(d).flatMap((f) => {
        const p = path.join(d, f);
        return statSync(p).isDirectory() ? walk(p) : [p];
      });
    for (const f of [...walk(path.join(root, "src/sim")), ...walk(path.join(root, "src/headless"))]) {
      expect(readFileSync(f, "utf8"), f).not.toMatch(/extras/);
    }
    const built = readFileSync(path.join(root, "dist/headless/cli.js"), "utf8");
    for (const word of ["CardKit", "CubKit", "WeaverKit", "KitBase", "Lantern Gate", "Venom Burst"]) expect(built).not.toContain(word);
  });
  it("there are exactly three champions to pick from", () => {
    expect(CHAMPIONS.map((c) => c.id)).toEqual(["cards", "cub", "weaver"]);
  });
});
