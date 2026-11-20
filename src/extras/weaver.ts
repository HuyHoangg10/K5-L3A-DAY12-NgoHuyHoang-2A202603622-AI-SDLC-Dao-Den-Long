// Champion 3: the serpent weaver. A graceful caster that never stops moving: poison bursts, a slowing haze,
// a quick targeted sting that restores light when it finishes a shade, and a stare that freezes a whole cone.
// Skill structure follows the poison-mage archetype of MOBA games; names, art and numbers are my own.
// Light (fireflies) is her mana.
import { KitBase, dist2, xz, type KitEvent, type KitFrame, type SkillInfo, type SlotHud, type Style } from "./kit";

export const WEAVER = {
  speed: 1.1,
  q: { name: "Venom Burst", cost: 1, cd: 210, range: 9, radius: 3, delay: 24, poison: 180, damage: 0.5, boost: 1.4, boostTicks: 180 },
  w: { name: "Haze Ring", cost: 1, cd: 840, range: 10, radius: 4.5, delay: 30, zoneTicks: 300, slow: 0.5 },
  e: { name: "Twin Sting", cost: 0, cd: 120, range: 8, damage: 1, bonusPoisoned: 1, refund: 2 },
  r: { name: "Stone Stare", cost: 2, cd: 1500, range: 9, deg: 80, stun: 120, damage: 1 },
} as const;

export class WeaverKit extends KitBase {
  readonly id = "weaver";
  readonly name = "Serpent Weaver";
  readonly skills: SkillInfo[] = [
    { key: "q", name: WEAVER.q.name, desc: "Mark a circle at the mouse; a moment later it bursts, poisoning shades inside. If it hits, you glide faster. Costs 1 firefly." },
    { key: "w", name: WEAVER.w.name, desc: "Leave a haze at the mouse for 5 s: shades inside are slowed and kept poisoned. Costs 1 firefly." },
    { key: "e", name: WEAVER.e.name, desc: "Sting the shade nearest to the mouse. Poisoned shades take extra; dissolving one gives light back." },
    { key: "r", name: WEAVER.r.name, desc: "Stare in a wide cone toward the mouse: every shade in it freezes for 2 s. Costs 2 fireflies." },
  ];
  style: Style = { dress: 0x3f8f6a, hat: 0x2f6b4a, scale: 1 };

  private zones: { pos: [number, number]; ticks: number }[] = [];

  protected override baseSpeed(): number {
    return WEAVER.speed;
  }

  slots(): SlotHud[] {
    const mk = (key: "q" | "w" | "e" | "r", name: string, cost: number): SlotHud => ({
      key,
      name,
      cd: this.cd[key],
      total: this.cdTotal[key],
      active: key === "w" && this.zones.length > 0,
      sub: cost ? `${cost} light` : undefined,
      disabled: this.carried() < cost,
    });
    return [mk("q", WEAVER.q.name, WEAVER.q.cost), mk("w", WEAVER.w.name, WEAVER.w.cost), mk("e", WEAVER.e.name, WEAVER.e.cost), mk("r", WEAVER.r.name, WEAVER.r.cost)];
  }

  protected update(f: KitFrame, out: KitEvent[]): void {
    this.zones = this.zones.filter((z) => --z.ticks > 0);
    for (const z of this.zones) {
      for (const s of this.shadesNear(z.pos, WEAVER.w.radius)) {
        this.slow(s, WEAVER.w.slow, 5);
        this.poisonShade(s, 60);
      }
    }
    if (f.pressed.q) this.venomBurst(f, out);
    if (f.pressed.w) this.hazeRing(f, out);
    if (f.pressed.e) this.sting(f, out);
    if (f.pressed.r) this.stare(f, out);
  }

  private venomBurst(f: KitFrame, out: KitEvent[]): void {
    if (this.cd.q > 0) return void out.push({ name: "on_cooldown", key: "q", msg: "Venom Burst is recharging" });
    if (!this.spend(WEAVER.q.cost)) return void out.push({ name: "no_light", msg: "Venom Burst needs a firefly" });
    this.cd.q = this.cdTotal.q = WEAVER.q.cd;
    const at = this.aimPoint(f, WEAVER.q.range);
    this.addFx({ kind: "ring", pos: at, r: WEAVER.q.radius, color: 0x7be3a0, ttl: WEAVER.q.delay });
    this.later(WEAVER.q.delay, (o) => {
      const hit = this.shadesNear(at, WEAVER.q.radius);
      this.addFx({ kind: "disc", pos: at, r: WEAVER.q.radius, color: 0x7be3a0, ttl: 20 });
      for (const s of hit) {
        this.poisonShade(s, WEAVER.q.poison);
        this.hit(s, WEAVER.q.damage, o);
      }
      if (hit.length) this.boost(WEAVER.q.boost, WEAVER.q.boostTicks);
      o.push({ name: "burst", count: hit.length, msg: hit.length ? "Venom hit! you glide faster" : undefined });
    });
    out.push({ name: "cast_q" });
  }

  private hazeRing(f: KitFrame, out: KitEvent[]): void {
    if (this.cd.w > 0) return void out.push({ name: "on_cooldown", key: "w", msg: "Haze Ring is recharging" });
    if (!this.spend(WEAVER.w.cost)) return void out.push({ name: "no_light", msg: "Haze Ring needs a firefly" });
    this.cd.w = this.cdTotal.w = WEAVER.w.cd;
    const at = this.aimPoint(f, WEAVER.w.range);
    this.addFx({ kind: "ring", pos: at, r: WEAVER.w.radius, color: 0x5cc88a, ttl: WEAVER.w.delay });
    this.later(WEAVER.w.delay, () => {
      this.zones.push({ pos: at, ticks: WEAVER.w.zoneTicks });
      this.addFx({ kind: "disc", pos: at, r: WEAVER.w.radius, color: 0x3fae78, ttl: WEAVER.w.zoneTicks });
    });
    out.push({ name: "cast_w" });
  }

  private sting(f: KitFrame, out: KitEvent[]): void {
    if (this.cd.e > 0) return void out.push({ name: "on_cooldown", key: "e", msg: "Twin Sting is recharging" });
    const p = this.pos();
    const ref = f.aim ?? p;
    const target = this.shadesNear(p, WEAVER.e.range).sort((a, b) => dist2(xz(a), ref) - dist2(xz(b), ref))[0];
    if (!target) return void out.push({ name: "no_target", msg: "No shade in range" });
    this.cd.e = this.cdTotal.e = WEAVER.e.cd;
    const bonus = this.isPoisoned(target) ? WEAVER.e.bonusPoisoned : 0;
    this.addFx({ kind: "beam", pos: p, to: xz(target), r: 0.15, color: 0x7be3a0, ttl: 10 });
    const killed = this.hit(target, WEAVER.e.damage + bonus, out);
    if (killed) {
      this.gain(WEAVER.e.refund);
      out.push({ name: "refund", msg: `Twin Sting finished it: +${WEAVER.e.refund} light` });
    }
    out.push({ name: "sting", shade: target.id, bonus: bonus > 0, killed });
  }

  private stare(f: KitFrame, out: KitEvent[]): void {
    if (this.cd.r > 0) return void out.push({ name: "on_cooldown", key: "r", msg: "Stone Stare is recharging" });
    if (!this.spend(WEAVER.r.cost)) return void out.push({ name: "no_light", msg: "Stone Stare needs 2 fireflies" });
    this.cd.r = this.cdTotal.r = WEAVER.r.cd;
    const from = this.pos();
    const dir = this.aimDir(f);
    this.addFx({ kind: "cone", pos: from, dir, r: WEAVER.r.range, angle: WEAVER.r.deg, color: 0xc9d6a0, ttl: 30 });
    const hit = this.sim.shades.filter((s) => this.inCone(s, from, dir, WEAVER.r.deg, WEAVER.r.range));
    for (const s of hit) {
      this.stun(s, WEAVER.r.stun);
      this.hit(s, WEAVER.r.damage, out);
    }
    out.push({ name: "stare", count: hit.length, msg: hit.length ? `${hit.length} shade(s) frozen` : "Nothing in your gaze" });
  }
}
