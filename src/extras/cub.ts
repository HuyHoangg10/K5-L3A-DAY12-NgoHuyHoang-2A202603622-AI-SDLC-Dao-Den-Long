// Champion 2: the rowdy cub. A small, fast shape-shifter with a rage meter: when rage is full it grows into a
// big stone-skinned form with a different Q/W/E and a ground-shaking R. Live mode only.
// Skill structure follows the shape-shifting brawler archetype of MOBA games; names, art and numbers are my own.
import { KitBase, dist2, xz, type Fx, type KitEvent, type KitFrame, type SkillInfo, type SlotHud, type Style } from "./kit";
import { DT } from "../sim/tuning";

export const CUB = {
  rageMax: 100,
  megaTicks: 600,
  hitRage: 8,
  hurtRage: 15,
  passiveRage: 2, // per second while a shade is within 14 m
  miniSpeed: 1.1,
  megaSpeed: 0.95,
  hyper: { hits: 3, window: 360, boost: 1.3, ticks: 120 },
  q: { cd: 240, range: 12, speed: 20, back: 22, hitRadius: 1.1, damage: 1, slow: 0.6, slowTicks: 120, refund: 0.4, megaRadius: 1.7, megaRange: 13, megaDamage: 2 },
  w: { cd: 360, range: 7, deg: 40, delay: 15, stun: 75, damage: 1 },
  e: { cd: 360, range: 6, landR: 3, megaLandR: 3.5, slow: 0.6, slowTicks: 120, megaSlow: 0.4, megaDamage: 1 },
  r: { cd: 1500, radius: 5, push: 6, stun: 90, damage: 1 },
} as const;

interface Shot {
  fx: Fx;
  dir: [number, number];
  travelled: number;
  back: boolean;
  mega: boolean;
  hitOut: Set<string>;
  hitBack: Set<string>;
}

export class CubKit extends KitBase {
  readonly id = "cub";
  readonly name = "Rowdy Cub";
  readonly skills: SkillInfo[] = [
    { key: "q", name: "Rebound Stone / Boulder Toss", desc: "Small: a stone that flies out and comes back, slowing what it touches; catch it to refund cooldown. Big: a heavy boulder, hits harder." },
    { key: "w", name: "Zippy Streak / Wallop", desc: "Small (passive): every 3 hits you sprint for 2 s. Big: slam the ground in front of you, shades there are stunned." },
    { key: "e", name: "Bounce / Crunch", desc: "Leap toward the mouse. Landing slows shades nearby (big form: thins them too)." },
    { key: "r", name: "Rampage", desc: "Big form only. Shake the ground: shades around you are thrown back and stunned." },
  ];
  style: Style = { dress: 0x9a6b3c, hat: 0x7a5a38, scale: 1 };

  rage = 0;
  megaLeft = 0;
  shots: Shot[] = [];
  private hyperHits = 0;
  private hyperTimer = 0;
  private tickCount = 0;

  get mega(): boolean {
    return this.megaLeft > 0;
  }
  protected override baseSpeed(): number {
    return this.mega ? CUB.megaSpeed : CUB.miniSpeed;
  }

  slots(): SlotHud[] {
    const m = this.mega;
    const mk = (key: "q" | "w" | "e" | "r", name: string, extra: Partial<SlotHud> = {}): SlotHud => ({ key, name, cd: this.cd[key], total: this.cdTotal[key], active: false, ...extra });
    return [
      mk("q", m ? "Boulder Toss" : "Rebound Stone"),
      mk("w", m ? "Wallop" : "Zippy Streak", m ? {} : { disabled: true, sub: this.hyperHits ? `${this.hyperHits}/${CUB.hyper.hits}` : "passive", active: this.boosted }),
      mk("e", m ? "Crunch" : "Bounce"),
      mk("r", "Rampage", m ? {} : { disabled: true, sub: "big form" }),
    ];
  }

  protected override onPlayerHit(out: KitEvent[]): void {
    this.addRage(CUB.hurtRage, out);
  }
  protected override onShadeHit(_s: unknown, out: KitEvent[]): void {
    this.addRage(CUB.hitRage, out);
    this.hyperHits++;
    this.hyperTimer = CUB.hyper.window;
    if (this.hyperHits >= CUB.hyper.hits && !this.mega) {
      this.hyperHits = 0;
      this.boost(CUB.hyper.boost, CUB.hyper.ticks);
      out.push({ name: "hyper", msg: "Zippy Streak! sprint for 2 s" });
    }
  }

  private addRage(n: number, out: KitEvent[]): void {
    if (this.mega) return;
    this.rage = Math.min(CUB.rageMax, this.rage + n);
    if (this.rage >= CUB.rageMax) this.transform(out);
  }

  private transform(out: KitEvent[]): void {
    this.megaLeft = CUB.megaTicks;
    this.style = { dress: 0x6b4a2a, hat: 0x59423a, scale: 1.55 };
    this.addFx({ kind: "disc", pos: this.pos(), r: 4, color: 0xd9a05b, ttl: 40 });
    out.push({ name: "mega_on", msg: "Rage! You grow big" });
  }

  protected update(f: KitFrame, out: KitEvent[]): void {
    this.tickCount++;
    if (this.hyperTimer > 0 && --this.hyperTimer === 0) this.hyperHits = 0;
    if (this.mega) {
      this.megaLeft--;
      this.rage = (CUB.rageMax * this.megaLeft) / CUB.megaTicks;
      if (this.megaLeft === 0) {
        this.rage = 0;
        this.style = { dress: 0x9a6b3c, hat: 0x7a5a38, scale: 1 };
        out.push({ name: "mega_off", msg: "You shrink back" });
      }
    } else if (this.tickCount % 60 === 0 && this.shadesNear(this.pos(), 14).length) {
      this.addRage(CUB.passiveRage, out);
    }
    this.updateShots(out);

    if (f.pressed.q) this.castQ(f, out);
    if (f.pressed.w) this.pressW(f, out);
    if (f.pressed.e) this.leap(f, out);
    if (f.pressed.r) this.rampage(out);
    this.bar = { label: this.mega ? "Big form" : "Rage", value: this.rage / CUB.rageMax };
  }

  // ---- Q ---------------------------------------------------------------------------------------------
  private castQ(f: KitFrame, out: KitEvent[]): void {
    if (this.cd.q > 0) return void out.push({ name: "on_cooldown", key: "q", msg: "Q is recharging" });
    this.cd.q = this.cdTotal.q = CUB.q.cd;
    const dir = this.aimDir(f);
    const mega = this.mega;
    const fx = this.addFx({ kind: "orb", pos: this.pos(), dir, r: mega ? CUB.q.megaRadius : 0.6, color: mega ? 0x8a8294 : 0xd9b27a, ttl: 9999 });
    this.shots.push({ fx, dir, travelled: 0, back: false, mega, hitOut: new Set(), hitBack: new Set() });
    out.push({ name: "cast_q", mega });
  }

  private updateShots(out: KitEvent[]): void {
    const keep: Shot[] = [];
    for (const s of this.shots) {
      const p = this.pos();
      const range = s.mega ? CUB.q.megaRange : CUB.q.range;
      if (!s.back) {
        const step = CUB.q.speed * DT;
        s.fx.pos[0] += s.dir[0] * step;
        s.fx.pos[1] += s.dir[1] * step;
        s.travelled += step;
        if (s.travelled >= range) {
          if (s.mega) {
            s.fx.ttl = 0;
            this.finishShot(s);
            continue;
          }
          s.back = true;
        }
      } else {
        const d = dist2(s.fx.pos, p);
        if (d < 1) {
          this.cd.q = Math.max(0, this.cd.q - Math.round(this.cdTotal.q * CUB.q.refund));
          s.fx.ttl = 0;
          out.push({ name: "caught", msg: "Caught the stone! cooldown refunded" });
          continue;
        }
        const step = Math.min(CUB.q.back * DT, d);
        s.fx.pos[0] += ((p[0] - s.fx.pos[0]) / d) * step;
        s.fx.pos[1] += ((p[1] - s.fx.pos[1]) / d) * step;
      }
      const set = s.back ? s.hitBack : s.hitOut;
      const radius = s.mega ? CUB.q.megaRadius : CUB.q.hitRadius;
      for (const sh of [...this.sim.shades]) {
        if (set.has(sh.id) || dist2(xz(sh), s.fx.pos) > radius) continue;
        set.add(sh.id);
        this.slow(sh, CUB.q.slow, CUB.q.slowTicks);
        out.push({ name: "stone_hit", shade: sh.id, mega: s.mega });
        this.hit(sh, s.mega ? CUB.q.megaDamage : CUB.q.damage, out);
      }
      keep.push(s);
    }
    this.shots = keep;
  }
  private finishShot(_s: Shot): void {}

  // ---- W -------------------------------------------------------------------------------------------
  private pressW(f: KitFrame, out: KitEvent[]): void {
    if (!this.mega) return void out.push({ name: "passive", msg: "Zippy Streak is passive: land 3 hits to sprint" });
    if (this.cd.w > 0) return void out.push({ name: "on_cooldown", key: "w", msg: "Wallop is recharging" });
    this.cd.w = this.cdTotal.w = CUB.w.cd;
    const from = this.pos();
    const dir = this.aimDir(f);
    this.addFx({ kind: "cone", pos: from, dir, r: CUB.w.range, angle: CUB.w.deg, color: 0xd9a05b, ttl: CUB.w.delay });
    this.later(CUB.w.delay, (o) => {
      const hit = this.sim.shades.filter((s) => this.inCone(s, from, dir, CUB.w.deg, CUB.w.range));
      for (const s of hit) {
        this.stun(s, CUB.w.stun);
        this.hit(s, CUB.w.damage, o);
      }
      this.addFx({ kind: "disc", pos: [from[0] + dir[0] * 3.5, from[1] + dir[1] * 3.5], r: 3, color: 0xd9a05b, ttl: 20 });
      o.push({ name: "wallop", count: hit.length });
    });
    out.push({ name: "cast_w" });
  }

  // ---- E ---------------------------------------------------------------------------------------------
  private leap(f: KitFrame, out: KitEvent[]): void {
    if (this.cd.e > 0) return void out.push({ name: "on_cooldown", key: "e", msg: "E is recharging" });
    this.cd.e = this.cdTotal.e = CUB.e.cd;
    const to = this.aimPoint(f, CUB.e.range);
    const p = this.sim.player.pos;
    if (this.standable(to[0], to[1], p[1])) {
      p[0] = to[0];
      p[2] = to[1];
    }
    this.sim.player.vel[1] = 6; // a little hop for the eye
    this.sim.player.grounded = false;
    p[1] += 0.01;
    const mega = this.mega;
    const r = mega ? CUB.e.megaLandR : CUB.e.landR;
    this.addFx({ kind: "disc", pos: [p[0], p[2]], r, color: mega ? 0xd9a05b : 0xf2d9a4, ttl: 25 });
    const hit = this.shadesNear([p[0], p[2]], r);
    for (const s of hit) {
      this.slow(s, mega ? CUB.e.megaSlow : CUB.e.slow, CUB.e.slowTicks);
      if (mega) this.hit(s, CUB.e.megaDamage, out);
    }
    out.push({ name: "leap", mega, count: hit.length });
  }

  // ---- R ---------------------------------------------------------------------------------------------
  private rampage(out: KitEvent[]): void {
    if (!this.mega) return void out.push({ name: "need_mega", msg: "Rampage needs the big form (fill the rage bar)" });
    if (this.cd.r > 0) return void out.push({ name: "on_cooldown", key: "r", msg: "Rampage is recharging" });
    this.cd.r = this.cdTotal.r = CUB.r.cd;
    const p = this.pos();
    this.addFx({ kind: "disc", pos: p, r: CUB.r.radius, color: 0xd9a05b, ttl: 35 });
    const hit = this.shadesNear(p, CUB.r.radius);
    for (const s of hit) {
      const d = dist2(xz(s), p) || 1;
      this.push(s, [(s.pos[0] - p[0]) / d || 1, (s.pos[2] - p[1]) / d || 0], CUB.r.push);
      this.stun(s, CUB.r.stun);
      this.hit(s, CUB.r.damage, out);
    }
    out.push({ name: "rampage", count: hit.length, msg: hit.length ? `${hit.length} shade(s) thrown back` : "The ground shakes" });
  }
}
