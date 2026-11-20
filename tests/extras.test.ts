import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CardKit, KIT, type KitEvent, type SkillKey } from "../src/extras/cards";
import { snapshotLine } from "../src/sim/output";
import { Sim } from "../src/sim/sim";
import { TUNING as T } from "../src/sim/tuning";
import type { Scenario } from "../src/sim/types";
import { root } from "./helpers";

function setup(scn: Scenario = {}, seed = 1) {
  const sim = new Sim({ seed, scenario: { random_motes: false, random_shades: false, ...scn } });
  return { sim, kit: new CardKit(sim) };
}
/** Step the sim and the kit together; `press[t]` lists the skill keys pressed at tick t. */
function run(sim: Sim, kit: CardKit, ticks: number, press: Record<number, SkillKey[]> = {}, cam = 0): KitEvent[] {
  const out: KitEvent[] = [];
  for (let t = 0; t < ticks; t++) {
    sim.step();
    const pressed = { q: false, w: false, e: false, r: false };
    for (const k of press[t] ?? []) pressed[k] = true;
    out.push(...kit.tick({ pressed, camYawDeg: cam }));
  }
  return out;
}
const names = (ev: KitEvent[]) => ev.map((e) => e.name);

describe("Q Card Fan", () => {
  it("needs a firefly: with none carried nothing is thrown and nothing is paid", () => {
    const { sim, kit } = setup({ player: { carried: 0 } });
    expect(names(run(sim, kit, 3, { 0: ["q"] }))).toEqual(["no_light"]);
    expect(kit.shots).toHaveLength(0);
    expect(kit.cd.q).toBe(0);
  });
  it("costs one firefly, throws 3 cards, and starts the cooldown", () => {
    const { sim, kit } = setup({ player: { carried: 3 } });
    run(sim, kit, 1, { 0: ["q"] });
    expect(sim.player.carried).toBe(3 - KIT.q.cost);
    expect(kit.shots).toHaveLength(3);
    expect(kit.cd.q).toBe(KIT.q.cd);
  });
  it("is blocked during its cooldown and ready again exactly after it", () => {
    const { sim, kit } = setup({ player: { carried: 9 } });
    const ev = run(sim, kit, KIT.q.cd + 2, { 0: ["q"], 100: ["q"], [KIT.q.cd]: ["q"] });
    expect(names(ev).filter((n) => n === "cast_q")).toHaveLength(2);
    expect(ev.filter((e) => e.name === "on_cooldown")).toHaveLength(1);
  });
  it("stuns a shade in front of Mây (+Z), scores per_stun once, and the card is used up", () => {
    const { sim, kit } = setup({ player: { carried: 3 }, shades: [{ id: "S1", pos: [0, 1, 8] }] });
    const ev = run(sim, kit, 40, { 0: ["q"] });
    expect(ev.filter((e) => e.name === "card_hit")).toEqual([{ name: "card_hit", shade: "S1", card: null }]);
    expect(sim.shades[0]?.stunTicks).toBeGreaterThan(0);
    expect(sim.shades[0]?.stunTicks).toBeLessThanOrEqual(KIT.q.stun);
    expect(sim.score).toBe(T.score.per_stun);
  });
  it("the 3 cards fly 0 and +-spreadDeg from the aim direction, and the side cards can hit a shade there", () => {
    const { sim, kit } = setup({ player: { carried: 3 } });
    run(sim, kit, 1, { 0: ["q"] });
    const angles = kit.shots.map((s) => Math.round((Math.atan2(s.dir[0], s.dir[1]) * 180) / Math.PI)).sort((x, y) => x - y);
    expect(angles).toEqual([-KIT.q.spreadDeg, 0, KIT.q.spreadDeg]);
    const a = (KIT.q.spreadDeg * Math.PI) / 180;
    const side = setup({ player: { carried: 3 }, shades: [{ id: "S1", pos: [9 * Math.sin(a), 1, 9 * Math.cos(a)] }] });
    expect(names(run(side.sim, side.kit, 40, { 0: ["q"] }))).toContain("card_hit");
  });
  it("misses a shade that is 90 degrees off to the side", () => {
    const { sim, kit } = setup({ player: { carried: 3 }, shades: [{ id: "S1", pos: [8, 1, 0] }] });
    expect(names(run(sim, kit, 60, { 0: ["q"] }))).toEqual(["cast_q"]);
    expect(sim.shades[0]?.stunTicks).toBe(0);
  });
  it("cards stop after KIT.q.range metres", () => {
    const { sim, kit } = setup({ player: { carried: 3 } });
    run(sim, kit, Math.ceil(KIT.q.range / (KIT.q.speed / 60)) + 2, { 0: ["q"] });
    expect(kit.shots).toHaveLength(0);
  });
  it("aims where Mây last walked: after walking -X the cards fly -X", () => {
    const { sim, kit } = setup({ player: { carried: 3 }, shades: [{ id: "S1", pos: [-10, 1, 0] }] });
    sim.setInput({ move: [-1, 0], camYawDeg: 0, jump: false, interact: false, pulse: false });
    run(sim, kit, 5);
    sim.setInput({ move: [0, 0], camYawDeg: 0, jump: false, interact: false, pulse: false });
    const ev = run(sim, kit, 40, { 0: ["q"] });
    expect(names(ev)).toContain("card_hit");
  });
});

describe("W Roll the Card + card effects", () => {
  it("rolls gold -> blue -> red every 6 ticks and locks the card showing at the second press", () => {
    for (const [pressAt, card] of [[8, "blue"], [14, "red"], [19, "gold"]] as const) {
      const { sim, kit } = setup();
      const ev = run(sim, kit, 25, { 0: ["w"], [pressAt]: ["w"] });
      expect(ev.find((e) => e.name === "card_locked")).toEqual({ name: "card_locked", card, auto: false });
      expect(kit.locked).toBe(card);
      expect(kit.cd.w).toBeGreaterThan(KIT.w.cd - 20);
    }
  });
  it("locks by itself after rollMax ticks", () => {
    const { sim, kit } = setup();
    const ev = run(sim, kit, KIT.w.rollMax + 2, { 0: ["w"] });
    expect(ev.find((e) => e.name === "card_locked")).toMatchObject({ auto: true });
  });
  it("cannot be used again while a card is held or on cooldown", () => {
    const { sim, kit } = setup();
    run(sim, kit, 10, { 0: ["w"], 8: ["w"] });
    const locked = kit.locked;
    expect(names(run(sim, kit, 5, { 0: ["w"] }))).toEqual([]); // holding a card: ignored
    expect(kit.rolling).toBe(false);
    expect(kit.locked).toBe(locked);
  });
  it("a held card expires after holdMax ticks", () => {
    const { sim, kit } = setup();
    run(sim, kit, 10, { 0: ["w"], 8: ["w"] });
    const ev = run(sim, kit, KIT.w.holdMax + 5);
    expect(names(ev)).toContain("card_expired");
    expect(kit.locked).toBeNull();
  });
  const withCard = (idx: 8 | 14 | 19, shadePos: [number, number, number], carried = 3) => {
    const { sim, kit } = setup({ player: { carried }, shades: [{ id: "S1", pos: shadePos }] });
    // cast Q on the tick after locking
    const ev = run(sim, kit, 60, { 0: ["w"], [idx]: ["w"], [idx + 1]: ["q"] });
    return { sim, kit, ev };
  };
  it("gold card: stun lasts goldStun ticks instead of the normal stun", () => {
    const { sim, ev } = withCard(19, [0, 1, 9]);
    expect(ev.find((e) => e.name === "card_hit")).toMatchObject({ card: "gold" });
    expect(sim.shades[0]?.stunTicks).toBeGreaterThan(KIT.q.stun);
    expect(sim.shades[0]?.stunTicks).toBeLessThanOrEqual(KIT.goldStun);
  });
  it("blue card: the hit gives one firefly back", () => {
    const { sim, ev } = withCard(8, [0, 1, 9]);
    expect(ev.find((e) => e.name === "card_hit")).toMatchObject({ card: "blue" });
    expect(sim.player.carried).toBe(3 - KIT.q.cost + 1);
  });
  it("red card: the hit shade ends exactly redPush metres further along the card direction than with a plain card", () => {
    const endZ = (card: "red" | null) => {
      const { sim, kit } = setup({ player: { carried: 3 }, shades: [{ id: "S1", pos: [0, 1, 9] }] });
      kit.locked = card;
      kit.lockedLeft = KIT.w.holdMax;
      const ev = run(sim, kit, 40, { 0: ["q"] });
      expect(ev.find((e) => e.name === "card_hit")).toMatchObject({ card });
      return sim.shades[0]!.pos[2];
    };
    expect(endZ("red") - endZ(null)).toBeCloseTo(KIT.redPush, 6);
  });
  it("the card is used by that Q only: the next Q throws plain cards", () => {
    const { sim, kit } = setup({ player: { carried: 9 } });
    run(sim, kit, KIT.q.cd + 30, { 0: ["w"], 19: ["w"], 20: ["q"], [20 + KIT.q.cd + 1]: ["q"] });
    expect(kit.locked).toBeNull();
    const plain = kit.shots.filter((s) => s.card === null);
    expect(plain).toHaveLength(3);
  });
});

describe("E Lucky Deck", () => {
  const pick = (press: Record<number, SkillKey[]>) => {
    const { sim, kit } = setup({ motes: [[0, 0, 1], [0, 0, 1]], player: { carried: 0 } });
    run(sim, kit, 3, press);
    return sim;
  };
  it("without the deck two motes in range give 2 fireflies", () => {
    expect(pick({}).player.carried).toBe(2);
  });
  it("with the deck every pickup is worth two, and the score counts the bonus", () => {
    // press E on tick 0 of this run; the motes are picked on the first sim step, before the kit sees the key,
    // so start the deck first with the motes further away
    const { sim, kit } = setup({ motes: [[0, 0, 3]], player: { carried: 0 } });
    sim.setInput({ move: [0, 1], camYawDeg: 0, jump: false, interact: false, pulse: false });
    run(sim, kit, 30, { 0: ["e"] });
    expect(sim.player.carried).toBe(2);
    expect(sim.score).toBe(T.score.per_mote * 2);
  });
  it("never goes above carry_capacity", () => {
    const { sim, kit } = setup({ motes: [[0, 0, 3]], player: { carried: T.carry_capacity - 1 } });
    sim.setInput({ move: [0, 1], camYawDeg: 0, jump: false, interact: false, pulse: false });
    run(sim, kit, 30, { 0: ["e"] });
    expect(sim.player.carried).toBe(T.carry_capacity);
  });
  it("lasts KIT.e.duration ticks, then has a cooldown", () => {
    const { sim, kit } = setup();
    run(sim, kit, 1, { 0: ["e"] });
    expect(kit.deckLeft).toBe(KIT.e.duration);
    run(sim, kit, KIT.e.duration);
    expect(kit.deckLeft).toBe(0);
    expect(names(run(sim, kit, 2, { 0: ["e"] }))).toEqual(["on_cooldown"]);
  });
});

describe("R Lantern Gate", () => {
  it("channels channel ticks, then moves Mây 2 m from the lantern most in front of the camera", () => {
    const { sim, kit } = setup({ player: { pos: [0, 0, 0] } });
    const ev = run(sim, kit, KIT.r.channel + 1, { 0: ["r"] }, 0); // camera yaw 0 looks along +Z: L1 at (0,0,25)
    expect(ev.find((e) => e.name === "gate_start")).toEqual({ name: "gate_start", lantern: "L1" });
    expect(ev.find((e) => e.name === "gate_done")).toEqual({ name: "gate_done", lantern: "L1" });
    const p = sim.player.pos;
    expect(Math.hypot(p[0] - 0, p[2] - 25)).toBeCloseTo(KIT.r.arrive, 3);
    expect(p[1]).toBe(0);
  });
  it("picks the lantern by camera direction: yaw 90 looks along +X, which is L2", () => {
    const { sim, kit } = setup();
    const ev = run(sim, kit, 2, { 0: ["r"] }, 90);
    expect(ev.find((e) => e.name === "gate_start")).toEqual({ name: "gate_start", lantern: "L2" });
  });
  it("does not move Mây before the channel ends", () => {
    const { sim, kit } = setup();
    run(sim, kit, KIT.r.channel - 5, { 0: ["r"] });
    expect(sim.player.pos).toEqual([0, 0, 0]);
  });
  it("a hit cancels the channel and starts the short cooldown", () => {
    const { sim, kit } = setup({ shades: [{ id: "S1", pos: [20, 1, 0] }] });
    run(sim, kit, 2, { 0: ["r"] });
    sim.shades[0]!.pos = [0.5, 1, 0]; // a shade touches Mây
    const ev = run(sim, kit, 3);
    expect(names(ev)).toContain("gate_cancel");
    expect(kit.channelLeft).toBe(0);
    expect(sim.player.pos[2]).toBeLessThan(1);
    expect(kit.cd.r).toBeGreaterThan(KIT.r.cancelCd - 5);
    expect(kit.cd.r).toBeLessThanOrEqual(KIT.r.cancelCd);
  });
  it("full cooldown after a successful gate", () => {
    const { sim, kit } = setup();
    run(sim, kit, KIT.r.channel + 1, { 0: ["r"] });
    expect(kit.cd.r).toBeGreaterThan(KIT.r.cd - 5);
  });
});

describe("the kit stays out of the Test Contract", () => {
  it("an idle kit (no keys pressed) never changes the sim: byte-identical snapshots for 900 ticks", () => {
    const scn: Scenario = { random_motes: true, random_shades: true };
    const a = new Sim({ seed: 11, scenario: scn });
    const b = new Sim({ seed: 11, scenario: scn });
    const kit = new CardKit(b);
    for (let t = 0; t < 900; t++) {
      a.step();
      b.step();
      kit.tick({ pressed: { q: false, w: false, e: false, r: false }, camYawDeg: 0 });
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
    expect(built).not.toContain("CardKit");
    expect(built).not.toContain("Lantern Gate");
  });
});
