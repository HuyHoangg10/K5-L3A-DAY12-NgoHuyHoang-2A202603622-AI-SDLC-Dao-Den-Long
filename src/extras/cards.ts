// Creative addition: the "Lantern Cards" skill kit (Q W E R) for Mây.
// Live mode only. Nothing in src/sim or src/headless imports this folder, so headless output cannot change.
// Inspired by card-throwing mage kits in MOBA games; names, art and numbers here are original.
import type { Sim } from "../sim/sim";
import { CONSTANTS as C, DT, TUNING as T } from "../sim/tuning";
import type { Shade } from "../sim/types";

export type CardColor = "gold" | "blue" | "red";
export const CARD_ORDER: CardColor[] = ["gold", "blue", "red"];

/** All kit numbers (ticks are 1/60 s). */
export const KIT = {
  q: { name: "Card Fan", cost: 1, cd: 180, speed: 24, range: 14, spreadDeg: 16, hitRadius: 1.1, stun: 60 },
  w: { name: "Roll the Card", rollStep: 6, rollMax: 180, cd: 480, holdMax: 720 },
  e: { name: "Lucky Deck", duration: 360, cd: 1080 },
  r: { name: "Lantern Gate", channel: 90, cd: 1500, cancelCd: 300, arrive: 2 },
  goldStun: 180,
  redPush: 5,
} as const;

export type SkillKey = "q" | "w" | "e" | "r";
export interface KitFrame {
  pressed: Record<SkillKey, boolean>;
  camYawDeg: number;
}

export type KitEvent =
  | { name: "cast_q"; card: CardColor | null }
  | { name: "no_light" }
  | { name: "on_cooldown"; key: SkillKey }
  | { name: "roll_start" }
  | { name: "card_locked"; card: CardColor; auto: boolean }
  | { name: "card_expired" }
  | { name: "card_hit"; shade: string; card: CardColor | null }
  | { name: "deck_on" }
  | { name: "bonus_firefly" }
  | { name: "gate_start"; lantern: string }
  | { name: "gate_done"; lantern: string }
  | { name: "gate_cancel" };

export interface Shot {
  id: number;
  pos: [number, number];
  dir: [number, number];
  travelled: number;
  card: CardColor | null;
  hitIds: Set<string>; // shared by the 3 cards of one cast: each shade is counted once per cast
}

const dist = (ax: number, az: number, bx: number, bz: number) => Math.hypot(ax - bx, az - bz);

export class CardKit {
  shots: Shot[] = [];
  cd: Record<SkillKey, number> = { q: 0, w: 0, e: 0, r: 0 };
  cdTotal: Record<SkillKey, number> = { q: KIT.q.cd, w: KIT.w.cd, e: KIT.e.cd, r: KIT.r.cd };
  rolling = false;
  rollIdx = 0;
  rollTicks = 0;
  locked: CardColor | null = null;
  lockedLeft = 0;
  deckLeft = 0;
  channelLeft = 0;
  gateTarget: string | null = null;
  facing: [number, number] | null = null;

  private nextShot = 1;
  private last: [number, number];

  constructor(private sim: Sim) {
    this.last = [sim.player.pos[0], sim.player.pos[2]];
  }

  get rollCard(): CardColor {
    return CARD_ORDER[this.rollIdx] as CardColor;
  }

  /** Call once after every sim.step(). Returns what happened (for toasts and effects). */
  tick(f: KitFrame): KitEvent[] {
    const out: KitEvent[] = [];
    const sim = this.sim;
    if (sim.state !== "playing") return out;
    const p = sim.player.pos;

    // facing = last movement direction; before any movement, the camera direction
    const dx = p[0] - this.last[0];
    const dz = p[2] - this.last[1];
    if (Math.hypot(dx, dz) > 1e-4) this.facing = [dx / Math.hypot(dx, dz), dz / Math.hypot(dx, dz)];
    this.last = [p[0], p[2]];

    for (const k of ["q", "w", "e", "r"] as const) if (this.cd[k] > 0) this.cd[k]--;

    // reactions to what the sim just did
    for (const e of sim.events) {
      if (e.name === "mote_picked" && this.deckLeft > 0 && sim.player.carried < T.carry_capacity) {
        sim.player.carried += 1;
        sim.score += T.score.per_mote;
        out.push({ name: "bonus_firefly" });
      }
      if (e.name === "player_hit" && this.channelLeft > 0) {
        this.channelLeft = 0;
        this.gateTarget = null;
        this.cd.r = this.cdTotal.r = KIT.r.cancelCd;
        out.push({ name: "gate_cancel" });
      }
    }

    this.updateShots(out);
    this.updateRoll(out);
    if (this.deckLeft > 0) this.deckLeft--;
    if (this.channelLeft > 0 && --this.channelLeft === 0) this.finishGate(out);

    if (f.pressed.q) this.castQ(f, out);
    if (f.pressed.w) this.pressW(out);
    if (f.pressed.e) this.pressE(out);
    if (f.pressed.r) this.pressR(f, out);
    return out;
  }

  private aim(f: KitFrame): [number, number] {
    if (this.facing) return this.facing;
    const th = (f.camYawDeg * Math.PI) / 180;
    return [Math.sin(th), Math.cos(th)];
  }

  private castQ(f: KitFrame, out: KitEvent[]): void {
    const sim = this.sim;
    if (this.cd.q > 0) return void out.push({ name: "on_cooldown", key: "q" });
    if (sim.player.carried < KIT.q.cost) return void out.push({ name: "no_light" });
    sim.player.carried -= KIT.q.cost;
    this.cd.q = this.cdTotal.q = KIT.q.cd;
    const card = this.locked;
    this.locked = null;
    this.lockedLeft = 0;
    const [ax, az] = this.aim(f);
    const hitIds = new Set<string>();
    for (const deg of [-KIT.q.spreadDeg, 0, KIT.q.spreadDeg]) {
      const a = (deg * Math.PI) / 180;
      this.shots.push({
        id: this.nextShot++,
        pos: [sim.player.pos[0], sim.player.pos[2]],
        dir: [ax * Math.cos(a) + az * Math.sin(a), -ax * Math.sin(a) + az * Math.cos(a)],
        travelled: 0,
        card,
        hitIds,
      });
    }
    out.push({ name: "cast_q", card });
  }

  private updateShots(out: KitEvent[]): void {
    const keep: Shot[] = [];
    for (const s of this.shots) {
      const step = KIT.q.speed * DT;
      s.pos[0] += s.dir[0] * step;
      s.pos[1] += s.dir[1] * step;
      s.travelled += step;
      const target = this.sim.shades.find((sh) => dist(sh.pos[0], sh.pos[2], s.pos[0], s.pos[1]) <= KIT.q.hitRadius);
      if (target) {
        this.applyHit(target, s, out);
        continue; // the card is used up
      }
      if (s.travelled < KIT.q.range) keep.push(s);
    }
    this.shots = keep;
  }

  private applyHit(sh: Shade, s: Shot, out: KitEvent[]): void {
    const sim = this.sim;
    sh.stunTicks = Math.max(sh.stunTicks, s.card === "gold" ? KIT.goldStun : KIT.q.stun);
    if (!s.hitIds.has(sh.id)) {
      s.hitIds.add(sh.id);
      sim.score += T.score.per_stun;
      if (s.card === "blue") sim.player.carried = Math.min(T.carry_capacity, sim.player.carried + 1);
      if (s.card === "red") {
        sh.pos[0] += s.dir[0] * KIT.redPush;
        sh.pos[2] += s.dir[1] * KIT.redPush;
        this.keepOutOfLanterns(sh);
      }
      out.push({ name: "card_hit", shade: sh.id, card: s.card });
    }
  }

  private keepOutOfLanterns(sh: Shade): void {
    for (const l of this.sim.lanterns) {
      const dx = sh.pos[0] - l.pos[0];
      const dz = sh.pos[2] - l.pos[2];
      const d = Math.hypot(dx, dz);
      if (d < T.safe_radius) {
        sh.pos[0] = l.pos[0] + (d > C.eps ? dx / d : 1) * T.safe_radius;
        sh.pos[2] = l.pos[2] + (d > C.eps ? dz / d : 0) * T.safe_radius;
      }
    }
  }

  private updateRoll(out: KitEvent[]): void {
    if (this.rolling) {
      this.rollTicks++;
      if (this.rollTicks % KIT.w.rollStep === 0) this.rollIdx = (this.rollIdx + 1) % CARD_ORDER.length;
      if (this.rollTicks >= KIT.w.rollMax) this.lock(true, out);
    } else if (this.locked && --this.lockedLeft <= 0) {
      this.locked = null;
      out.push({ name: "card_expired" });
    }
  }

  private lock(auto: boolean, out: KitEvent[]): void {
    this.rolling = false;
    this.locked = this.rollCard;
    this.lockedLeft = KIT.w.holdMax;
    this.cd.w = this.cdTotal.w = KIT.w.cd;
    out.push({ name: "card_locked", card: this.locked, auto });
  }

  private pressW(out: KitEvent[]): void {
    if (this.rolling) return this.lock(false, out);
    if (this.locked) return; // already holding a card
    if (this.cd.w > 0) return void out.push({ name: "on_cooldown", key: "w" });
    this.rolling = true;
    this.rollTicks = 0;
    this.rollIdx = 0;
    out.push({ name: "roll_start" });
  }

  private pressE(out: KitEvent[]): void {
    if (this.cd.e > 0) return void out.push({ name: "on_cooldown", key: "e" });
    this.deckLeft = KIT.e.duration;
    this.cd.e = this.cdTotal.e = KIT.e.cd;
    out.push({ name: "deck_on" });
  }

  private pressR(f: KitFrame, out: KitEvent[]): void {
    if (this.channelLeft > 0) return;
    if (this.cd.r > 0) return void out.push({ name: "on_cooldown", key: "r" });
    // the lantern most in front of the camera
    const th = (f.camYawDeg * Math.PI) / 180;
    const fx = Math.sin(th);
    const fz = Math.cos(th);
    const p = this.sim.player.pos;
    let best: string | null = null;
    let bestDot = -2;
    for (const l of this.sim.lanterns) {
      const vx = l.pos[0] - p[0];
      const vz = l.pos[2] - p[2];
      const d = Math.hypot(vx, vz) || 1;
      const dot = (vx * fx + vz * fz) / d;
      if (dot > bestDot) {
        bestDot = dot;
        best = l.id;
      }
    }
    if (!best) return;
    this.gateTarget = best;
    this.channelLeft = KIT.r.channel;
    this.cdTotal.r = KIT.r.cd;
    out.push({ name: "gate_start", lantern: best });
  }

  private finishGate(out: KitEvent[]): void {
    const l = this.sim.lanterns.find((x) => x.id === this.gateTarget);
    this.gateTarget = null;
    if (!l) return;
    const p = this.sim.player.pos;
    const vx = p[0] - l.pos[0];
    const vz = p[2] - l.pos[2];
    const d = Math.hypot(vx, vz);
    const nx = d > C.eps ? vx / d : 0;
    const nz = d > C.eps ? vz / d : -1;
    p[0] = l.pos[0] + nx * KIT.r.arrive;
    p[2] = l.pos[2] + nz * KIT.r.arrive;
    p[1] = 0;
    this.sim.player.vy = 0;
    this.last = [p[0], p[2]];
    this.cd.r = this.cdTotal.r = KIT.r.cd;
    out.push({ name: "gate_done", lantern: l.id });
  }
}
