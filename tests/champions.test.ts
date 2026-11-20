import { describe, expect, it } from "vitest";
import { CUB, CubKit } from "../src/extras/cub";
import { SHADE_INK } from "../src/extras/kit";
import { WEAVER, WeaverKit } from "../src/extras/weaver";
import { DT, TUNING as T } from "../src/sim/tuning";
import type { Scenario } from "../src/sim/types";
import { freeze, moveInput, names, poke, run, setup } from "./kithelpers";

const cub = (scn: Scenario = {}) => setup((s) => new CubKit(s), scn);
const weaver = (scn: Scenario = {}) => setup((s) => new WeaverKit(s), scn);
const dist = (a: number[], b: number[]) => Math.hypot((a[0] as number) - (b[0] as number), (a[2] as number) - (b[2] as number));

describe("Rowdy Cub: rage and the big form", () => {
  it("each skill hit gives hitRage; a hit on Mây gives hurtRage; rage shows on the bar", () => {
    const { sim, kit } = cub({ shades: [{ id: "S1", pos: [30, 1, 0] }] });
    const out: any[] = [];
    poke(kit).hit(sim.shades[0], 0.1, out);
    expect(kit.rage).toBe(CUB.hitRage);
    poke(kit).onPlayerHit(out);
    expect(kit.rage).toBe(CUB.hitRage + CUB.hurtRage);
    run(sim, kit, 1);
    expect(kit.bar?.label).toBe("Rage");
  });
  it("full rage turns the cub big for megaTicks, then it shrinks back and rage resets", () => {
    const { sim, kit } = cub();
    const out: any[] = [];
    poke(kit).addRage(CUB.rageMax, out);
    expect(kit.mega).toBe(true);
    expect(out.map((e) => e.name)).toEqual(["mega_on"]);
    run(sim, kit, 1);
    expect(kit.style.scale).toBe(1.55);
    expect(kit.speedMult).toBe(CUB.megaSpeed);
    const ev = run(sim, kit, CUB.megaTicks);
    expect(names(ev)).toContain("mega_off");
    expect(kit.mega).toBe(false);
    expect(kit.rage).toBe(0);
    expect(kit.style.scale).toBe(1);
    expect(kit.speedMult).toBe(CUB.miniSpeed);
  });
  it("rage drains while big, so it is the timer of the big form", () => {
    const { sim, kit } = cub();
    poke(kit).addRage(CUB.rageMax, []);
    run(sim, kit, CUB.megaTicks / 2);
    expect(kit.rage).toBeCloseTo(CUB.rageMax / 2, 6);
  });
  it("a shade near Mây slowly builds rage (passiveRage per second)", () => {
    const { sim, kit } = cub({ shades: [{ id: "S1", pos: [10, 1, 0] }] });
    freeze(sim);
    run(sim, kit, 120);
    expect(kit.rage).toBe(2 * CUB.passiveRage);
  });
  it("the small form is quicker than Mây: speed x miniSpeed", () => {
    const { sim, kit } = cub();
    sim.setInput(moveInput([0, 1]));
    run(sim, kit, 60);
    expect(sim.player.pos[2]).toBeCloseTo(6 * CUB.miniSpeed, 2);
  });
});

describe("Rowdy Cub: small form", () => {
  it("Q flies out, hits a shade on the way out and again on the way back, then is caught and refunds cooldown", () => {
    const { sim, kit } = cub({ shades: [{ id: "S1", pos: [0, 1, 8] }] });
    freeze(sim);
    const ev = run(sim, kit, 120, { 0: ["q"] }, [0, 30]);
    expect(ev.filter((e) => e.name === "stone_hit")).toHaveLength(2);
    expect(poke(kit).inkOf(sim.shades[0])).toBe(SHADE_INK - 2 * CUB.q.damage);
    expect(names(ev)).toContain("caught");
    expect(kit.shots).toHaveLength(0);
  });
  it("catching the stone takes exactly refund x cooldown off what was left", () => {
    const { sim, kit } = cub({ shades: [{ id: "S1", pos: [40, 1, 0] }] });
    freeze(sim);
    let t = 0;
    let caughtAt = -1;
    for (; t < 200 && caughtAt < 0; t++) {
      const ev = run(sim, kit, 1, t === 0 ? { 0: ["q"] } : {}, [0, 30]);
      if (names(ev).includes("caught")) caughtAt = t;
    }
    expect(caughtAt).toBeGreaterThan(30);
    expect(kit.cd.q).toBe(CUB.q.cd - caughtAt - Math.round(CUB.q.cd * CUB.q.refund));
  });
  it("the stone slows what it hits: the shade moves at slow x speed afterwards", () => {
    const { sim, kit } = cub({ shades: [{ id: "S1", pos: [0, 1, 6] }] });
    run(sim, kit, 14, { 0: ["q"] }, [0, 30]);
    const s = sim.shades[0]!;
    s.stunTicks = 0;
    expect(poke(kit).slows.get("S1").mult).toBe(CUB.q.slow);
    const z0 = s.pos[2];
    run(sim, kit, 1);
    expect(z0 - s.pos[2]).toBeCloseTo(4 * DT * CUB.q.slow, 9);
  });
  it("Q range: the stone turns around after q.range metres", () => {
    const { sim, kit } = cub();
    run(sim, kit, 1, { 0: ["q"] }, [0, 30]);
    const turn = Math.ceil(CUB.q.range / (CUB.q.speed * DT));
    run(sim, kit, turn + 1);
    expect(kit.shots[0]?.back).toBe(true);
    expect(kit.shots[0]?.fx.pos[1]).toBeGreaterThan(CUB.q.range - 1);
  });
  it("W is passive in the small form (just a hint); R needs the big form", () => {
    const { sim, kit } = cub();
    expect(names(run(sim, kit, 2, { 0: ["w"] }))).toEqual(["passive"]);
    expect(names(run(sim, kit, 2, { 0: ["r"] }))).toEqual(["need_mega"]);
    expect(kit.cd.w).toBe(0);
    expect(kit.cd.r).toBe(0);
  });
  it("Zippy Streak: every 3rd hit within the window gives a sprint", () => {
    const { sim, kit } = cub({ shades: [{ id: "S1", pos: [30, 1, 0] }] });
    const out: any[] = [];
    poke(kit).hit(sim.shades[0], 0.1, out);
    poke(kit).hit(sim.shades[0], 0.1, out);
    expect(kit.boosted).toBe(false);
    poke(kit).hit(sim.shades[0], 0.1, out);
    expect(out.map((e) => e.name)).toContain("hyper");
    expect(kit.speedMult).toBeCloseTo(CUB.miniSpeed * CUB.hyper.boost, 9);
  });
  it("Zippy Streak: hits older than the window are forgotten", () => {
    const { sim, kit } = cub({ shades: [{ id: "S1", pos: [30, 1, 0] }] });
    freeze(sim);
    const out: any[] = [];
    poke(kit).hit(sim.shades[0], 0.1, out);
    poke(kit).hit(sim.shades[0], 0.1, out);
    run(sim, kit, CUB.hyper.window + 2);
    poke(kit).hit(sim.shades[0], 0.1, out);
    expect(kit.boosted).toBe(false);
  });
  it("E Bounce: leaps toward the mouse but at most e.range metres, and slows shades where it lands", () => {
    const { sim, kit } = cub({ shades: [{ id: "S1", pos: [0, 1, 7] }] });
    freeze(sim);
    run(sim, kit, 1, { 0: ["e"] }, [0, 40]);
    expect(sim.player.pos[2]).toBeCloseTo(CUB.e.range, 3);
    expect(poke(kit).slows.get("S1").mult).toBe(CUB.e.slow);
    expect(kit.cd.e).toBe(CUB.e.cd);
  });
  it("E Bounce does not take Mây off the island", () => {
    const { sim, kit } = cub({ player: { pos: [0, 0, 48] } });
    run(sim, kit, 1, { 0: ["e"] }, [0, 90]);
    expect(Math.hypot(sim.player.pos[0], sim.player.pos[2])).toBeLessThanOrEqual(50.0001);
  });
});

describe("Rowdy Cub: big form", () => {
  const big = (scn: Scenario = {}) => {
    const t = cub(scn);
    poke(t.kit).addRage(CUB.rageMax, []);
    return t;
  };
  it("Q is a boulder: no return, 2 damage, thicker hit radius", () => {
    const { sim, kit } = big({ shades: [{ id: "S1", pos: [1.5, 1, 8] }] });
    freeze(sim);
    const ev = run(sim, kit, 60, { 0: ["q"] }, [0, 30]);
    expect(ev.filter((e) => e.name === "stone_hit")).toEqual([{ name: "stone_hit", shade: "S1", mega: true }]);
    expect(poke(kit).inkOf(sim.shades[0])).toBe(SHADE_INK - CUB.q.megaDamage);
    expect(kit.shots).toHaveLength(0);
  });
  it("W Wallop: the area is hit after a short delay, not before", () => {
    const { sim, kit } = big({ shades: [{ id: "S1", pos: [0, 1, 4] }] });
    freeze(sim);
    sim.shades[0]!.stunTicks = 0;
    poke(kit).stun = (s: any, t: number) => (s.stunTicks = Math.max(s.stunTicks, t));
    const ev = run(sim, kit, CUB.w.delay - 2, { 0: ["w"] }, [0, 30]);
    expect(names(ev)).toEqual(["cast_w"]);
    expect(poke(kit).inkOf(sim.shades[0])).toBe(SHADE_INK);
    const later = run(sim, kit, 4);
    expect(later.find((e) => e.name === "wallop")).toMatchObject({ count: 1 });
    expect(sim.shades[0]?.stunTicks).toBeGreaterThan(CUB.w.stun - 10);
    expect(poke(kit).inkOf(sim.shades[0])).toBe(SHADE_INK - CUB.w.damage);
  });
  it("W Wallop misses a shade behind Mây", () => {
    const { sim, kit } = big({ shades: [{ id: "S1", pos: [0, 1, -4] }] });
    freeze(sim);
    run(sim, kit, CUB.w.delay + 2, { 0: ["w"] }, [0, 30]);
    expect(poke(kit).inkOf(sim.shades[0])).toBe(SHADE_INK);
  });
  it("E Crunch also thins shades where it lands, with a bigger radius and stronger slow", () => {
    const { sim, kit } = big({ shades: [{ id: "S1", pos: [0, 1, 9.5] }] });
    freeze(sim);
    run(sim, kit, 1, { 0: ["e"] }, [0, 6]);
    expect(poke(kit).inkOf(sim.shades[0])).toBe(SHADE_INK - CUB.e.megaDamage);
    expect(poke(kit).slows.get("S1").mult).toBe(CUB.e.megaSlow);
  });
  it("R Rampage: shades within radius are thrown r.push metres away and stunned; farther ones are not", () => {
    const { sim, kit } = big({ shades: [{ id: "S1", pos: [3, 1, 0] }, { id: "S2", pos: [9, 1, 0] }] });
    const ev = run(sim, kit, 1, { 0: ["r"] });
    expect(ev.find((e) => e.name === "rampage")).toMatchObject({ count: 1 });
    expect(sim.shades[0]?.pos[0]).toBeGreaterThan(3 + CUB.r.push - 0.2);
    expect(sim.shades[0]?.stunTicks).toBeGreaterThan(CUB.r.stun - 10);
    expect(sim.shades[1]?.stunTicks).toBe(0);
    expect(kit.cd.r).toBe(CUB.r.cd);
  });
});

describe("Serpent Weaver", () => {
  it("light is her mana: Q 1, W 1, R 2 fireflies; E is free; no light means no cast and no cooldown", () => {
    const { sim, kit } = weaver({ player: { carried: 0 } });
    const ev = run(sim, kit, 6, { 0: ["q"], 1: ["w"], 2: ["r"], 3: ["e"] });
    expect(names(ev)).toEqual(["no_light", "no_light", "no_light", "no_target"]);
    expect(kit.cd).toEqual({ q: 0, w: 0, e: 0, r: 0 });
    const b = weaver({ player: { carried: 9 } });
    run(b.sim, b.kit, 1, { 0: ["q"] }, [5, 0]);
    expect(b.sim.player.carried).toBe(9 - WEAVER.q.cost);
    run(b.sim, b.kit, 1, { 0: ["w"] }, [5, 0]);
    expect(b.sim.player.carried).toBe(9 - WEAVER.q.cost - WEAVER.w.cost);
    run(b.sim, b.kit, 1, { 0: ["r"] }, [5, 0]);
    expect(b.sim.player.carried).toBe(9 - WEAVER.q.cost - WEAVER.w.cost - WEAVER.r.cost);
  });
  it("the speed bonus scales both axes: walking diagonally covers speed x mult on x and on z", () => {
    const { sim, kit } = weaver();
    sim.setInput(moveInput([1, 1]));
    run(sim, kit, 60);
    const each = (6 * WEAVER.speed) / Math.SQRT2;
    expect(sim.player.pos[0]).toBeCloseTo(each, 3);
    expect(sim.player.pos[2]).toBeCloseTo(each, 3);
  });
  it("passive: always runs x speed", () => {
    const { sim, kit } = weaver();
    sim.setInput(moveInput([0, 1]));
    run(sim, kit, 60);
    expect(sim.player.pos[2]).toBeCloseTo(6 * WEAVER.speed, 2);
  });
  it("Q Venom Burst: telegraphed circle at the mouse; after the delay shades inside are poisoned, others are not; hit = speed boost", () => {
    const { sim, kit } = weaver({ player: { carried: 3 }, shades: [{ id: "S1", pos: [0, 1, 8] }, { id: "S2", pos: [0, 1, 14] }] });
    freeze(sim);
    run(sim, kit, WEAVER.q.delay - 2, { 0: ["q"] }, [0, 8]);
    expect(poke(kit).isPoisoned(sim.shades[0])).toBe(false);
    const ev = run(sim, kit, 4, {}, [0, 8]);
    expect(ev.find((e) => e.name === "burst")).toMatchObject({ count: 1 });
    expect(poke(kit).isPoisoned(sim.shades[0])).toBe(true);
    expect(poke(kit).isPoisoned(sim.shades[1])).toBe(false);
    expect(kit.speedMult).toBeCloseTo(WEAVER.speed * WEAVER.q.boost, 9);
  });
  it("Q Venom Burst that hits nothing gives no speed boost", () => {
    const { sim, kit } = weaver({ player: { carried: 3 } });
    run(sim, kit, WEAVER.q.delay + 3, { 0: ["q"] }, [0, 8]);
    expect(kit.speedMult).toBe(WEAVER.speed);
  });
  it("Q range: the circle is placed at most q.range metres away", () => {
    const { sim, kit } = weaver({ player: { carried: 3 } });
    run(sim, kit, 1, { 0: ["q"] }, [0, 60]);
    expect(kit.fx.find((f) => f.kind === "ring")?.pos).toEqual([0, WEAVER.q.range]);
  });
  it("W Haze Ring: after its delay it slows shades inside to w.slow and keeps them poisoned, for zoneTicks, then ends", () => {
    const { sim, kit } = weaver({ player: { carried: 3 }, shades: [{ id: "S1", pos: [0, 1, 10] }] });
    run(sim, kit, WEAVER.w.delay + 2, { 0: ["w"] }, [0, 10]);
    const s = sim.shades[0]!;
    expect(Math.hypot(s.pos[0], s.pos[2] - 10)).toBeLessThan(WEAVER.w.radius); // still inside the haze
    const z0 = s.pos[2];
    run(sim, kit, 1, {}, [0, 10]);
    expect(z0 - s.pos[2]).toBeCloseTo(4 * DT * WEAVER.w.slow, 6);
    expect(poke(kit).isPoisoned(s)).toBe(true);
    run(sim, kit, WEAVER.w.zoneTicks + 5);
    expect(poke(kit).zones).toHaveLength(0);
  });
  it("E Twin Sting: hits the shade nearest to the mouse, within range; free; 1 damage", () => {
    const { sim, kit } = weaver({ shades: [{ id: "S1", pos: [0, 1, 6] }, { id: "S2", pos: [6, 1, 0] }] });
    freeze(sim);
    const ev = run(sim, kit, 1, { 0: ["e"] }, [6, 0]);
    expect(ev.find((e) => e.name === "sting")).toMatchObject({ shade: "S2", killed: false, bonus: false });
    expect(poke(kit).inkOf(sim.shades[1])).toBe(SHADE_INK - WEAVER.e.damage);
    expect(poke(kit).inkOf(sim.shades[0])).toBe(SHADE_INK);
    expect(kit.cd.e).toBe(WEAVER.e.cd);
  });
  it("E Twin Sting: out of range = no target, no cooldown", () => {
    const { sim, kit } = weaver({ shades: [{ id: "S1", pos: [0, 1, 20] }] });
    freeze(sim);
    expect(names(run(sim, kit, 1, { 0: ["e"] }, [0, 20]))).toEqual(["no_target"]);
    expect(kit.cd.e).toBe(0);
  });
  it("E Twin Sting: poisoned shades take extra damage, and a kill gives refund light", () => {
    const { sim, kit } = weaver({ player: { carried: 0 }, shades: [{ id: "S1", pos: [0, 1, 6] }] });
    freeze(sim);
    poke(kit).poisonShade(sim.shades[0], 600);
    poke(kit).ink.set("S1", 1.5);
    const ev = run(sim, kit, 1, { 0: ["e"] }, [0, 6]);
    expect(ev.find((e) => e.name === "sting")).toMatchObject({ bonus: true, killed: true });
    expect(sim.shades).toHaveLength(0);
    expect(sim.player.carried).toBe(WEAVER.e.refund);
    expect(sim.motes).toHaveLength(1);
  });
  it("R Stone Stare: shades inside the cone are frozen and thinned; one outside the cone angle is untouched", () => {
    const { sim, kit } = weaver({ player: { carried: 3 }, shades: [{ id: "S1", pos: [0, 1, 7] }, { id: "S2", pos: [5, 1, 5] }, { id: "S3", pos: [0, 1, 12] }] });
    freeze(sim);
    sim.shades.forEach((s) => (s.stunTicks = 0));
    const ev = run(sim, kit, 1, { 0: ["r"] }, [0, 9]);
    expect(ev.find((e) => e.name === "stare")).toMatchObject({ count: 1 });
    expect(sim.shades[0]?.stunTicks).toBeGreaterThan(WEAVER.r.stun - 10);
    expect(sim.shades[1]?.stunTicks).toBe(0); // 45 degrees off: outside the 80 degree cone (half angle 40)
    expect(sim.shades[2]?.stunTicks).toBe(0); // beyond range
    expect(poke(kit).inkOf(sim.shades[0])).toBe(SHADE_INK - WEAVER.r.damage);
  });
  it("R Stone Stare: a shade just inside the half-angle is caught", () => {
    const { sim, kit } = weaver({ player: { carried: 3 }, shades: [{ id: "S1", pos: [4.1, 1, 5] }] }); // about 39.4 degrees off the aim, half-angle is 40
    sim.shades[0]!.stunTicks = 0;
    const ev = run(sim, kit, 1, { 0: ["r"] }, [0, 9]);
    expect(ev.find((e) => e.name === "stare")).toMatchObject({ count: 1 });
  });
  it("skills are shown with their light cost and grey out without light", () => {
    const { kit } = weaver({ player: { carried: 1 } });
    const s = kit.slots();
    expect(s.map((x) => x.disabled)).toEqual([false, false, false, true]);
    expect(s[0]?.sub).toBe("1 light");
  });
});

describe("shared base", () => {
  it("poison and slow are bookkept per shade and forgotten when the shade is gone", () => {
    const { sim, kit } = weaver({ shades: [{ id: "S1", pos: [30, 1, 0] }] });
    poke(kit).slow(sim.shades[0], 0.5, 600);
    poke(kit).poisonShade(sim.shades[0], 600);
    sim.shades.length = 0;
    run(sim, kit, 3);
    expect(poke(kit).ink.size).toBe(0);
  });
  it("a slow of mult 0.5 halves a chasing shade's step", () => {
    const { sim, kit } = weaver({ shades: [{ id: "S1", pos: [20, 1, 0] }] });
    run(sim, kit, 1);
    poke(kit).slow(sim.shades[0], 0.5, 600);
    const x0 = sim.shades[0]!.pos[0];
    run(sim, kit, 1);
    expect(x0 - sim.shades[0]!.pos[0]).toBeCloseTo(T.shade_speed * DT * 0.5, 9);
  });
  it("the speed bonus never pushes Mây past the island wall", () => {
    const { sim, kit } = weaver({ player: { pos: [0, 0, 49] } });
    sim.setInput(moveInput([0, 1]));
    run(sim, kit, 120);
    expect(Math.hypot(sim.player.pos[0], sim.player.pos[2])).toBeLessThanOrEqual(50.0001);
  });
  it("kits do nothing once the game is over", () => {
    const { sim, kit } = weaver({ player: { carried: 3, flames: 1 }, shades: [{ id: "S1", pos: [0.5, 1, 0] }] });
    run(sim, kit, 3);
    expect(sim.state).toBe("lost");
    expect(kit.tick({ pressed: { q: true, w: true, e: true, r: true }, camYawDeg: 0, aim: [0, 5] })).toEqual([]);
    expect(dist(sim.player.pos, [0, 0, 0])).toBeLessThan(1);
  });
});
