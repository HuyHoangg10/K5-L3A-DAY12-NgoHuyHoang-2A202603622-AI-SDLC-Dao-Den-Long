// Base for every champion kit (live mode only; nothing in src/sim or src/headless imports src/extras).
// A kit reads and nudges public sim fields after each sim.step(): stun ticks, shade positions, carried, score.
// Shades get "ink" (hit points): when it is gone the shade dissolves into light and leaves a firefly. No violence.
import type { Sim } from "../sim/sim";
import { CONSTANTS as C, DT, TUNING as T } from "../sim/tuning";
import type { Shade } from "../sim/types";

export type SkillKey = "q" | "w" | "e" | "r";
export const SKILL_KEYS: SkillKey[] = ["q", "w", "e", "r"];

export interface KitFrame {
  pressed: Record<SkillKey, boolean>;
  camYawDeg: number;
  /** ground point under the mouse (world x, z), or null when unknown */
  aim: [number, number] | null;
}
export interface KitEvent {
  name: string;
  msg?: string; // short text for a toast
  [k: string]: unknown;
}
export interface SkillInfo {
  key: SkillKey;
  name: string;
  desc: string;
}
export interface SlotHud {
  key: SkillKey;
  name: string;
  cd: number;
  total: number;
  active: boolean;
  sub?: string;
  disabled?: boolean;
}
export interface Fx {
  id: number;
  kind: "orb" | "card" | "disc" | "ring" | "cone" | "beam" | "pillar";
  pos: [number, number];
  to?: [number, number];
  r: number;
  color: number;
  ttl: number;
  total: number;
  dir?: [number, number];
  angle?: number; // degrees, cones
}
export interface Style {
  dress: number;
  hat: number;
  scale: number;
}

export const SHADE_INK = 3;
export const dist2 = (a: [number, number], b: [number, number]) => Math.hypot(a[0] - b[0], a[1] - b[1]);
export const xz = (s: { pos: number[] }): [number, number] => [s.pos[0] as number, s.pos[2] as number];

export abstract class KitBase {
  abstract readonly id: string;
  abstract readonly name: string;
  abstract readonly skills: SkillInfo[];
  abstract style: Style;
  badge: { color: number } | null = null; // floating card over the hat
  bar: { label: string; value: number } | null = null; // extra meter (rage ...)
  fx: Fx[] = [];
  cd: Record<SkillKey, number> = { q: 0, w: 0, e: 0, r: 0 };
  cdTotal: Record<SkillKey, number> = { q: 1, w: 1, e: 1, r: 1 };

  protected ink = new Map<string, number>();
  protected slows = new Map<string, { mult: number; ticks: number }>();
  protected poison = new Map<string, number>();
  protected lures: { pos: [number, number]; ticks: number; r: number }[] = [];
  private pending: { ticks: number; fn: (out: KitEvent[]) => void }[] = [];
  protected facing: [number, number] | null = null;
  private boostMult = 1;
  private boostLeft = 0;
  private lastP: [number, number];
  private lastShades = new Map<string, [number, number]>();
  private fxId = 1;
  private extraMote = 1;

  constructor(protected sim: Sim) {
    this.lastP = [sim.player.pos[0], sim.player.pos[2]];
    for (const s of sim.shades) this.lastShades.set(s.id, xz(s));
  }

  /** passive speed multiplier of the champion (1 = none) */
  protected baseSpeed(): number {
    return 1;
  }
  get speedMult(): number {
    return this.baseSpeed() * (this.boostLeft > 0 ? this.boostMult : 1);
  }
  get boosted(): boolean {
    return this.boostLeft > 0;
  }
  protected abstract update(f: KitFrame, out: KitEvent[]): void;
  abstract slots(): SlotHud[];

  /** Call once after every sim.step(). */
  tick(f: KitFrame): KitEvent[] {
    const out: KitEvent[] = [];
    const sim = this.sim;
    if (sim.state !== "playing") return out;
    const p = sim.player.pos;

    // walking direction (for aiming without a mouse) and the speed bonus on top of the sim's own movement
    const dx = p[0] - this.lastP[0];
    const dz = p[2] - this.lastP[1];
    const len = Math.hypot(dx, dz);
    if (len > 1e-4) this.facing = [dx / len, dz / len];
    const mult = this.speedMult;
    if (mult !== 1 && len > 1e-4) {
      p[0] += dx * (mult - 1);
      p[2] += dz * (mult - 1);
      const d = Math.hypot(p[0], p[2]);
      if (d > C.island_radius) {
        p[0] *= C.island_radius / d;
        p[2] *= C.island_radius / d;
      }
    }
    if (this.boostLeft > 0) this.boostLeft--;

    this.shadeEffects();
    for (const k of SKILL_KEYS) if (this.cd[k] > 0) this.cd[k]--;
    this.tickStatus(out);
    for (const e of sim.events) if (e.name === "player_hit") this.onPlayerHit(out);

    const due = this.pending.filter((t) => --t.ticks <= 0);
    this.pending = this.pending.filter((t) => t.ticks > 0);
    for (const t of due) t.fn(out);

    this.update(f, out);

    this.fx = this.fx.filter((x) => --x.ttl > 0);
    this.lastP = [p[0], p[2]];
    this.lastShades.clear();
    for (const s of sim.shades) this.lastShades.set(s.id, xz(s));
    return out;
  }

  protected onPlayerHit(_out: KitEvent[]): void {}
  protected onShadeHit(_s: Shade, _out: KitEvent[]): void {}

  // ---- helpers for kits -------------------------------------------------------------------------
  protected addFx(f: Omit<Fx, "id" | "total"> & { total?: number }): Fx {
    const fx: Fx = { ...f, id: this.fxId++, total: f.total ?? f.ttl };
    this.fx.push(fx);
    return fx;
  }
  protected boost(mult: number, ticks: number): void {
    if (mult >= this.boostMult || this.boostLeft <= 0) this.boostMult = mult;
    this.boostLeft = Math.max(this.boostLeft, ticks);
  }
  protected carried(): number {
    return this.sim.player.carried;
  }
  protected spend(n: number): boolean {
    if (this.sim.player.carried < n) return false;
    this.sim.player.carried -= n;
    return true;
  }
  protected gain(n: number): void {
    this.sim.player.carried = Math.min(T.carry_capacity, this.sim.player.carried + n);
  }
  protected pos(): [number, number] {
    return [this.sim.player.pos[0], this.sim.player.pos[2]];
  }
  protected aimDir(f: KitFrame): [number, number] {
    const p = this.pos();
    if (f.aim && dist2(f.aim, p) > 0.05) {
      const d = dist2(f.aim, p);
      return [(f.aim[0] - p[0]) / d, (f.aim[1] - p[1]) / d];
    }
    if (this.facing) return this.facing;
    const th = (f.camYawDeg * Math.PI) / 180;
    return [Math.sin(th), Math.cos(th)];
  }
  /** aim point limited to `range` metres from Mây */
  protected aimPoint(f: KitFrame, range: number): [number, number] {
    const p = this.pos();
    const dir = this.aimDir(f);
    const want = f.aim ? Math.min(range, dist2(f.aim, p)) : range;
    return [p[0] + dir[0] * want, p[1] + dir[1] * want];
  }
  protected shadesNear(c: [number, number], r: number): Shade[] {
    return this.sim.shades.filter((s) => dist2(xz(s), c) <= r);
  }
  protected inCone(s: Shade, from: [number, number], dir: [number, number], deg: number, range: number): boolean {
    const v: [number, number] = [s.pos[0] - from[0], s.pos[2] - from[1]];
    const d = Math.hypot(v[0], v[1]);
    if (d > range) return false;
    if (d < 1e-6) return true;
    return (v[0] * dir[0] + v[1] * dir[1]) / d >= Math.cos(((deg / 2) * Math.PI) / 180);
  }
  protected stun(s: Shade, ticks: number): void {
    s.stunTicks = Math.max(s.stunTicks, ticks);
  }
  protected slow(s: Shade, mult: number, ticks: number): void {
    const cur = this.slows.get(s.id);
    if (!cur || mult <= cur.mult || cur.ticks < ticks) this.slows.set(s.id, { mult: Math.min(mult, cur?.mult ?? 1), ticks: Math.max(ticks, cur?.ticks ?? 0) });
  }
  protected isPoisoned(s: Shade): boolean {
    return (this.poison.get(s.id) ?? 0) > 0;
  }
  protected poisonShade(s: Shade, ticks: number): void {
    this.poison.set(s.id, Math.max(ticks, this.poison.get(s.id) ?? 0));
  }
  protected push(s: Shade, dir: [number, number], metres: number): void {
    s.pos[0] += dir[0] * metres;
    s.pos[2] += dir[1] * metres;
    this.keepOutOfLanterns(s);
  }
  /** Hit a shade: takes `amount` ink, may dissolve it. Returns true when it dissolved. */
  protected hit(s: Shade, amount: number, out: KitEvent[]): boolean {
    this.onShadeHit(s, out);
    const left = (this.ink.get(s.id) ?? SHADE_INK) - amount;
    this.ink.set(s.id, left);
    if (left > 1e-6) return false;
    this.dissolve(s, out);
    return true;
  }
  protected dissolve(s: Shade, out: KitEvent[]): void {
    const i = this.sim.shades.indexOf(s);
    if (i < 0) return;
    this.sim.shades.splice(i, 1);
    this.ink.delete(s.id);
    this.slows.delete(s.id);
    this.poison.delete(s.id);
    this.sim.motes.push({ id: `X${this.extraMote++}`, pos: [s.pos[0], 0, s.pos[2]] });
    this.sim.score += 30;
    out.push({ name: "dissolve", shade: s.id, msg: "An Ink Shade dissolved into a firefly" });
  }
  protected inkOf(s: Shade): number {
    return this.ink.get(s.id) ?? SHADE_INK;
  }
  protected keepOutOfLanterns(s: Shade): void {
    for (const l of this.sim.lanterns) {
      const dx = s.pos[0] - l.pos[0];
      const dz = s.pos[2] - l.pos[2];
      const d = Math.hypot(dx, dz);
      if (d < T.safe_radius) {
        s.pos[0] = l.pos[0] + (d > C.eps ? dx / d : 1) * T.safe_radius;
        s.pos[2] = l.pos[2] + (d > C.eps ? dz / d : 0) * T.safe_radius;
      }
    }
  }
  /** run `fn` after `ticks` ticks (telegraphed skills) */
  protected later(ticks: number, fn: (out: KitEvent[]) => void): void {
    this.pending.push({ ticks, fn });
  }
  protected lure(pos: [number, number], ticks: number, r: number): void {
    this.lures.push({ pos, ticks, r });
  }

  // ---- shade movement tweaks (slow, lure) -----------------------------------------------------
  private shadeEffects(): void {
    this.lures = this.lures.filter((l) => --l.ticks > 0);
    for (const s of this.sim.shades) {
      const last = this.lastShades.get(s.id);
      if (!last) continue;
      const moved = Math.hypot(s.pos[0] - last[0], s.pos[2] - last[1]) > 1e-9;
      if (!moved || s.stunTicks > 0) continue;
      const lure = this.lures.find((l) => dist2(xz(s), l.pos) <= l.r);
      if (lure) {
        const d = dist2(last, lure.pos);
        const step = Math.min(T.shade_speed * DT, d);
        s.pos[0] = last[0] + (d > 1e-9 ? ((lure.pos[0] - last[0]) / d) * step : 0);
        s.pos[2] = last[1] + (d > 1e-9 ? ((lure.pos[1] - last[1]) / d) * step : 0);
        this.keepOutOfLanterns(s);
      }
      const sl = this.slows.get(s.id);
      if (sl) {
        s.pos[0] = last[0] + (s.pos[0] - last[0]) * sl.mult;
        s.pos[2] = last[1] + (s.pos[2] - last[1]) * sl.mult;
      }
    }
  }

  private tickStatus(out: KitEvent[]): void {
    for (const [id, st] of this.slows) if (--st.ticks <= 0) this.slows.delete(id);
    for (const s of [...this.sim.shades]) {
      const t = this.poison.get(s.id);
      if (t === undefined) continue;
      if (t <= 1) this.poison.delete(s.id);
      else this.poison.set(s.id, t - 1);
      const left = (this.ink.get(s.id) ?? SHADE_INK) - 1 / 180; // 1 ink over 3 s
      this.ink.set(s.id, left);
      if (left <= 1e-6) this.dissolve(s, out);
    }
    // forget shades that left the sim
    for (const id of [...this.ink.keys()]) if (!this.sim.shades.some((s) => s.id === id)) this.ink.delete(id);
  }
}
