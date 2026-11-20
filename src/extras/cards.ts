// Champion 1: the card reader ("Lantern Cards" kit). Live mode only.
// Q/W/E/R structure inspired by card-throwing mage kits in MOBA games; names, art and numbers are my own.
import { KitBase, dist2, xz, type Fx, type KitEvent, type KitFrame, type SkillInfo, type SlotHud, type Style } from "./kit";
import { DT } from "../sim/tuning";

export type CardColor = "gold" | "blue" | "red";
export const CARD_ORDER: CardColor[] = ["gold", "blue", "red"];
export const CARD_HEX: Record<CardColor | "plain", number> = { gold: 0xffc83a, blue: 0x55a8ff, red: 0xff6fb5, plain: 0xffefb8 };

/** All numbers of the kit (ticks are 1/60 s). */
export const KIT = {
  q: { name: "Card Fan", cost: 1, cd: 150, speed: 24, range: 14, spreadDeg: 16, hitRadius: 1.1, damage: 1 },
  w: { name: "Roll the Card", rollStep: 6, rollMax: 180, cd: 480, goldRadius: 7, goldStun: 150, blueMana: 3, redBoost: 1.5, redTicks: 240 },
  e: { name: "Lure Lantern", cost: 1, cd: 840, range: 10, lureTicks: 240, lureRadius: 16, burstRadius: 4.5, burstStun: 120, burstDamage: 1 },
  r: { name: "Lantern Gate", channel: 90, cd: 1500, cancelCd: 300, arrive: 2 },
} as const;

interface Shot {
  fx: Fx;
  dir: [number, number];
  travelled: number;
  hitIds: Set<string>; // shared by the 3 cards of one cast: a shade is hit once per cast, cards pass through
}

export class CardKit extends KitBase {
  readonly id = "cards";
  readonly name = "Mây the Card Reader";
  readonly skills: SkillInfo[] = [
    { key: "q", name: KIT.q.name, desc: "Throw 3 cards in a fan toward the mouse. They pass through Ink Shades, stunning and thinning them." },
    { key: "w", name: KIT.w.name, desc: "Cards flip gold, blue, pink. Press again to stop. Gold: shades around you freeze. Blue: +3 fireflies. Pink: run fast." },
    { key: "e", name: KIT.e.name, desc: "Toss a bright lure lantern. Shades chase it for 4 s, then it bursts and stuns them." },
    { key: "r", name: KIT.r.name, desc: "Aim the mouse near a lantern and press R. After 1.5 s you appear next to it, safe." },
  ];
  style: Style = { dress: 0xd9622b, hat: 0xe3c27d, scale: 1 };

  shots: Shot[] = [];
  rolling = false;
  rollIdx = 0;
  rollTicks = 0;
  channelLeft = 0;
  gateTarget: string | null = null;
  private lureFx: { fx: Fx; pos: [number, number] } | null = null;
  private lureLeft = 0;

  get rollCard(): CardColor {
    return CARD_ORDER[this.rollIdx] as CardColor;
  }

  slots(): SlotHud[] {
    const mk = (key: "q" | "w" | "e" | "r", name: string, active = false, sub?: string): SlotHud => ({ key, name, cd: this.cd[key], total: this.cdTotal[key], active, sub });
    return [
      mk("q", KIT.q.name),
      mk("w", KIT.w.name, this.rolling, this.rolling ? this.rollCard : undefined),
      mk("e", KIT.e.name, this.lureLeft > 0),
      mk("r", KIT.r.name, this.channelLeft > 0),
    ];
  }

  protected override onPlayerHit(out: KitEvent[]): void {
    if (this.channelLeft > 0) {
      this.channelLeft = 0;
      this.gateTarget = null;
      this.cd.r = this.cdTotal.r = KIT.r.cancelCd;
      out.push({ name: "gate_cancel", msg: "The gate fizzled out" });
    }
  }

  protected update(f: KitFrame, out: KitEvent[]): void {
    this.updateShots(out);
    this.updateRoll(out);
    this.updateLure(out);
    if (this.channelLeft > 0 && --this.channelLeft === 0) this.finishGate(out);

    if (f.pressed.q) this.castQ(f, out);
    if (f.pressed.w) this.pressW(out);
    if (f.pressed.e) this.castE(f, out);
    if (f.pressed.r) this.pressR(f, out);
    this.badge = this.rolling ? { color: CARD_HEX[this.rollCard] } : null;
  }

  // ---- Q -------------------------------------------------------------------------------------------
  private castQ(f: KitFrame, out: KitEvent[]): void {
    if (this.cd.q > 0) return void out.push({ name: "on_cooldown", key: "q", msg: "Card Fan is recharging" });
    if (!this.spend(KIT.q.cost)) return void out.push({ name: "no_light", msg: "Card Fan needs a firefly" });
    this.cd.q = this.cdTotal.q = KIT.q.cd;
    const [ax, az] = this.aimDir(f);
    const hitIds = new Set<string>();
    for (const deg of [-KIT.q.spreadDeg, 0, KIT.q.spreadDeg]) {
      const a = (deg * Math.PI) / 180;
      const dir: [number, number] = [ax * Math.cos(a) + az * Math.sin(a), -ax * Math.sin(a) + az * Math.cos(a)];
      const fx = this.addFx({ kind: "card", pos: this.pos(), dir, r: 0.5, color: CARD_HEX.plain, ttl: 9999 });
      this.shots.push({ fx, dir, travelled: 0, hitIds });
    }
    out.push({ name: "cast_q" });
  }

  private updateShots(out: KitEvent[]): void {
    const keep: Shot[] = [];
    for (const s of this.shots) {
      const step = KIT.q.speed * DT;
      s.fx.pos[0] += s.dir[0] * step;
      s.fx.pos[1] += s.dir[1] * step;
      s.travelled += step;
      for (const sh of [...this.sim.shades]) {
        if (s.hitIds.has(sh.id) || dist2(xz(sh), s.fx.pos) > KIT.q.hitRadius) continue;
        s.hitIds.add(sh.id);
        this.stun(sh, 60);
        out.push({ name: "card_hit", shade: sh.id });
        this.hit(sh, KIT.q.damage, out);
      }
      if (s.travelled < KIT.q.range) keep.push(s);
      else s.fx.ttl = 0;
    }
    this.shots = keep;
  }

  // ---- W -------------------------------------------------------------------------------------------
  private updateRoll(out: KitEvent[]): void {
    if (!this.rolling) return;
    this.rollTicks++;
    if (this.rollTicks % KIT.w.rollStep === 0) this.rollIdx = (this.rollIdx + 1) % CARD_ORDER.length;
    if (this.rollTicks >= KIT.w.rollMax) this.pick(out, true);
  }

  private pressW(out: KitEvent[]): void {
    if (this.rolling) return this.pick(out, false);
    if (this.cd.w > 0) return void out.push({ name: "on_cooldown", key: "w", msg: "Roll the Card is recharging" });
    this.rolling = true;
    this.rollTicks = 0;
    this.rollIdx = 0;
    out.push({ name: "roll_start", msg: "Press W again to stop on a card" });
  }

  /** The card is chosen and acts at once. */
  private pick(out: KitEvent[], auto: boolean): void {
    const card = this.rollCard;
    this.rolling = false;
    this.cd.w = this.cdTotal.w = KIT.w.cd;
    const p = this.pos();
    if (card === "gold") {
      const hit = this.shadesNear(p, KIT.w.goldRadius);
      for (const s of hit) this.stun(s, KIT.w.goldStun);
      this.addFx({ kind: "disc", pos: p, r: KIT.w.goldRadius, color: CARD_HEX.gold, ttl: 40 });
      out.push({ name: "card_picked", card, frozen: hit.map((s) => s.id), auto, msg: hit.length ? `Gold card: ${hit.length} shade(s) frozen` : "Gold card: nothing near you" });
    } else if (card === "blue") {
      const before = this.carried();
      this.gain(KIT.w.blueMana);
      this.addFx({ kind: "ring", pos: p, r: 2.5, color: CARD_HEX.blue, ttl: 30 });
      out.push({ name: "card_picked", card, gained: this.carried() - before, auto, msg: `Blue card: +${this.carried() - before} fireflies` });
    } else {
      this.boost(KIT.w.redBoost, KIT.w.redTicks);
      this.addFx({ kind: "ring", pos: p, r: 2.5, color: CARD_HEX.red, ttl: 30 });
      out.push({ name: "card_picked", card, auto, msg: "Pink card: run fast for 4 s" });
    }
  }

  // ---- E (new): Lure Lantern -------------------------------------------------------------------------
  private castE(f: KitFrame, out: KitEvent[]): void {
    if (this.cd.e > 0) return void out.push({ name: "on_cooldown", key: "e", msg: "Lure Lantern is recharging" });
    if (!this.spend(KIT.e.cost)) return void out.push({ name: "no_light", msg: "Lure Lantern needs a firefly" });
    this.cd.e = this.cdTotal.e = KIT.e.cd;
    const pos = this.aimPoint(f, KIT.e.range);
    this.lureLeft = KIT.e.lureTicks;
    this.lure(pos, KIT.e.lureTicks, KIT.e.lureRadius);
    const fx = this.addFx({ kind: "pillar", pos, r: 0.7, color: 0xffd27a, ttl: KIT.e.lureTicks });
    this.addFx({ kind: "ring", pos, r: KIT.e.burstRadius, color: 0xffd27a, ttl: KIT.e.lureTicks });
    this.lureFx = { fx, pos };
    out.push({ name: "lure_on", msg: "Shades are drawn to the lure lantern" });
  }

  private updateLure(out: KitEvent[]): void {
    if (this.lureLeft <= 0 || !this.lureFx) return;
    if (--this.lureLeft > 0) return;
    const pos = this.lureFx.pos;
    this.lureFx = null;
    this.addFx({ kind: "disc", pos, r: KIT.e.burstRadius, color: 0xfff0b0, ttl: 30 });
    for (const s of this.shadesNear(pos, KIT.e.burstRadius)) {
      this.stun(s, KIT.e.burstStun);
      this.hit(s, KIT.e.burstDamage, out);
    }
    out.push({ name: "lure_burst" });
  }

  // ---- R -------------------------------------------------------------------------------------------
  private pressR(f: KitFrame, out: KitEvent[]): void {
    if (this.channelLeft > 0) return;
    if (this.cd.r > 0) return void out.push({ name: "on_cooldown", key: "r", msg: "Lantern Gate is recharging" });
    // the lantern nearest to the mouse; without a mouse position, the one most in front of the camera
    const p = this.pos();
    let best: string | null = null;
    let bestScore = Infinity;
    const th = (f.camYawDeg * Math.PI) / 180;
    for (const l of this.sim.lanterns) {
      let score: number;
      if (f.aim) score = dist2(xz(l), f.aim);
      else {
        const v: [number, number] = [l.pos[0] - p[0], l.pos[2] - p[1]];
        score = -(v[0] * Math.sin(th) + v[1] * Math.cos(th)) / (Math.hypot(v[0], v[1]) || 1);
      }
      if (score < bestScore) {
        bestScore = score;
        best = l.id;
      }
    }
    if (!best) return;
    this.gateTarget = best;
    this.channelLeft = KIT.r.channel;
    this.cdTotal.r = KIT.r.cd;
    const l = this.sim.lanterns.find((x) => x.id === best)!;
    this.addFx({ kind: "pillar", pos: xz(l), r: 1, color: 0xffd27a, ttl: KIT.r.channel });
    this.addFx({ kind: "ring", pos: p, r: 3, color: 0xffd27a, ttl: KIT.r.channel });
    out.push({ name: "gate_start", lantern: best, msg: `Lantern Gate opening toward ${best}... stay safe` });
  }

  private finishGate(out: KitEvent[]): void {
    const l = this.sim.lanterns.find((x) => x.id === this.gateTarget);
    this.gateTarget = null;
    if (!l) return;
    const p = this.sim.player.pos;
    const vx = p[0] - l.pos[0];
    const vz = p[2] - l.pos[2];
    const d = Math.hypot(vx, vz);
    p[0] = l.pos[0] + (d > 1e-9 ? vx / d : 0) * KIT.r.arrive;
    p[2] = l.pos[2] + (d > 1e-9 ? vz / d : -1) * KIT.r.arrive;
    p[1] = 0;
    this.sim.player.vy = 0;
    this.cd.r = this.cdTotal.r = KIT.r.cd;
    this.addFx({ kind: "disc", pos: [p[0], p[2]], r: 3, color: 0xfff0b0, ttl: 30 });
    out.push({ name: "gate_done", lantern: l.id });
  }
}
