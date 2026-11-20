import { r3 } from "./output";
import { Rng } from "./rng";
import { CONSTANTS as C, DT, TUNING as T } from "./tuning";
import type { FrameInput, InputFrame, Lantern, Mote, Scenario, Shade, SimEvent, SimState, Vec3 } from "./types";

const EPS = C.eps;
const dist2d = (a: Vec3, b: Vec3): number => Math.hypot(a[0] - b[0], a[2] - b[2]);
// +1 because the pulse step itself also runs updateShades, which burns one stun tick
const stunTicks = Math.round(T.pulse_stun_s * C.tick_rate) + 1;
const invulnTicks = Math.round(T.invuln_s * C.tick_rate);
const cooldownTicks = Math.round(T.pulse_cooldown_s * C.tick_rate);

export interface SimOptions {
  seed: number;
  scenario?: Scenario;
}

/**
 * Fixed-step game logic. One call to step() is one 1/60 s tick.
 * Step order: input -> move/jump -> interact -> pulse -> shades spawn+move -> pickup -> hit -> end checks.
 * No Date, no Math.random, no DOM: same seed + scenario + inputs gives the same run.
 */
export class Sim {
  steps = 0;
  state: SimState = "playing";
  score = 0;
  readonly player: { pos: Vec3; vy: number; flames: number; carried: number } = {
    pos: [0, 0, 0],
    vy: 0,
    flames: T.flames,
    carried: 0,
  };
  lanterns: Lantern[] = [];
  motes: Mote[] = [];
  shades: Shade[] = [];
  events: SimEvent[] = []; // events of the most recent step()
  readonly timeLeftStart: number;

  private rngMotes: Rng;
  private rngShades: Rng;
  private nextMote = 1;
  private nextShade = 1;
  private randomShades: boolean;
  private input: FrameInput = { move: [0, 0], camYawDeg: 0, jump: false, interact: false, pulse: false };
  private prev = { jump: false, interact: false, pulse: false };
  private invuln = 0;
  private cooldown = 0;
  private spawnTimer: number; // ticks until next random shade

  constructor(opts: SimOptions) {
    const sc = opts.scenario ?? {};
    this.rngMotes = new Rng(opts.seed);
    this.rngShades = new Rng((opts.seed ^ 0x9e3779b9) >>> 0);
    this.randomShades = sc.random_shades ?? true;
    this.timeLeftStart = sc.time_left_s ?? T.night1_duration_s;
    this.spawnTimer = Math.round(C.shade_first_spawn_s * C.tick_rate);

    // default lanterns L1..L5 on a ring, L1 straight ahead (+Z)
    for (let i = 0; i < T.lantern_count_night1; i++) {
      const a = (i / T.lantern_count_night1) * Math.PI * 2;
      this.lanterns.push({
        id: `L${i + 1}`,
        pos: [r3(C.lantern_ring_radius * Math.sin(a)), 0, r3(C.lantern_ring_radius * Math.cos(a))],
        lit: false,
        deposited: 0,
      });
    }

    const p = sc.player ?? {};
    if (p.pos) this.player.pos = [...p.pos];
    if (p.carried !== undefined) this.player.carried = p.carried;
    if (p.flames !== undefined) this.player.flames = p.flames;

    for (const sl of sc.lanterns ?? []) {
      const l = this.lanterns.find((x) => x.id === sl.id);
      if (!l) continue; // unknown id: ignored, the island always has exactly L1..L5
      if (sl.pos) l.pos = [...sl.pos];
      if (sl.deposited !== undefined) l.deposited = sl.deposited;
      if (sl.lit !== undefined) {
        l.lit = sl.lit;
        if (sl.lit && sl.deposited === undefined) l.deposited = T.lantern_cost;
      }
    }

    if (sc.motes) {
      for (const m of sc.motes) this.motes.push({ id: `M${this.nextMote++}`, pos: [...m] });
    } else if (sc.random_motes ?? true) {
      this.randomMotes();
    }
    for (const s of sc.shades ?? []) {
      const id = s.id ?? this.freshShadeId();
      this.shades.push({ id, pos: [...s.pos], stunTicks: 0 });
    }
  }

  get timeLeft(): number {
    return Math.max(0, this.timeLeftStart - this.steps / C.tick_rate);
  }
  get litCount(): number {
    return this.lanterns.filter((l) => l.lit).length;
  }
  shadeState(s: Shade): "chase" | "stunned" {
    return s.stunTicks > 0 ? "stunned" : "chase";
  }
  /** Ticks left on the pulse cooldown (for the HUD). */
  get cooldownLeft(): number {
    return this.cooldown;
  }
  get invulnerable(): boolean {
    return this.invuln > 0;
  }

  private randomMotes(): void {
    for (let n = 0; n < C.random_mote_count; n++) {
      let pos: Vec3 = [0, 0, 0];
      for (let attempt = 0; attempt < 50; attempt++) {
        const a = this.rngMotes.next() * Math.PI * 2;
        const r = Math.sqrt(this.rngMotes.next()) * (C.island_radius - 5);
        pos = [r3(r * Math.sin(a)), 0, r3(r * Math.cos(a))];
        const farFromLanterns = this.lanterns.every((l) => dist2d(l.pos, pos) > T.safe_radius + 1);
        if (dist2d(pos, [0, 0, 0]) >= C.mote_min_player_dist && farFromLanterns) break;
      }
      this.motes.push({ id: `M${this.nextMote++}`, pos });
    }
  }

  private freshShadeId(): string {
    for (;;) {
      const id = `S${this.nextShade++}`;
      if (!this.shades.some((s) => s.id === id)) return id;
    }
  }

  private emit(name: string, data: Record<string, unknown>): void {
    this.events.push({ tick: this.steps, name, data });
  }

  /** Apply one input frame: only fields present in the frame change. */
  applyFrame(f: InputFrame): void {
    if (f.move) this.input.move = [f.move[0], f.move[1]];
    if (f.cam_yaw_deg !== undefined) this.input.camYawDeg = f.cam_yaw_deg;
    if (f.jump !== undefined) this.input.jump = f.jump;
    if (f.interact !== undefined) this.input.interact = f.interact;
    if (f.pulse !== undefined) this.input.pulse = f.pulse;
  }

  /** Live (render) mode: replace the whole input state. */
  setInput(i: FrameInput): void {
    this.input = { ...i, move: [i.move[0], i.move[1]] };
  }

  /** Advance one tick (reads the current input state). Returns false if the game was already over. */
  step(): boolean {
    this.events = [];
    if (this.state !== "playing") return false;
    const k = this.steps; // this step reads input of tick k and produces state k+1
    this.steps = k + 1;
    const inp = this.input;
    const jumpEdge = inp.jump && !this.prev.jump;
    const interactEdge = inp.interact && !this.prev.interact;
    const pulseEdge = inp.pulse && !this.prev.pulse;
    this.prev = { jump: inp.jump, interact: inp.interact, pulse: inp.pulse };

    this.movePlayer(jumpEdge);
    if (interactEdge) this.interact();
    if (this.lanterns.every((l) => l.lit)) {
      this.finish("won", "all_lit");
      return true;
    }
    if (this.cooldown > 0) this.cooldown--;
    if (pulseEdge) this.pulse(); // acts on the shade positions of the previous snapshot, then shades move
    this.updateShades();
    this.pickup();
    this.hitCheck();

    if (this.player.flames <= 0) this.finish("lost", "no_flames");
    else if (this.timeLeft <= EPS) this.finish("lost", "dawn");
    return true;
  }

  private finish(result: "won" | "lost", reason: "all_lit" | "dawn" | "no_flames"): void {
    this.state = result;
    if (result === "won") {
      this.score += T.score.per_second_left * Math.floor(this.timeLeft + EPS);
      this.score += T.score.per_flame_left * this.player.flames;
    }
    this.emit("game_over", { result, reason });
  }

  private movePlayer(jumpEdge: boolean): void {
    const p = this.player;
    let [x, z] = this.input.move;
    const len = Math.hypot(x, z);
    if (len > 1) {
      x /= len;
      z /= len;
    }
    const th = (this.input.camYawDeg * Math.PI) / 180;
    const wx = x * Math.cos(th) + z * Math.sin(th);
    const wz = -x * Math.sin(th) + z * Math.cos(th);
    p.pos[0] += wx * T.player_speed * DT;
    p.pos[2] += wz * T.player_speed * DT;
    // island edge is a wall (fall_enabled is false)
    const d = Math.hypot(p.pos[0], p.pos[2]);
    if (d > C.island_radius) {
      p.pos[0] *= C.island_radius / d;
      p.pos[2] *= C.island_radius / d;
    }
    if (jumpEdge && p.pos[1] <= 0) p.vy = C.jump_speed;
    if (p.pos[1] > 0 || p.vy > 0) {
      p.vy -= C.gravity * DT;
      p.pos[1] += p.vy * DT;
      if (p.pos[1] <= 0) {
        p.pos[1] = 0;
        p.vy = 0;
      }
    }
  }

  private interact(): void {
    const p = this.player;
    if (p.carried <= 0) return;
    let best: Lantern | undefined;
    let bestD = Infinity;
    for (const l of this.lanterns) {
      if (l.lit) continue;
      const d = dist2d(l.pos, p.pos);
      if (d <= T.interact_radius + EPS && d < bestD) {
        best = l;
        bestD = d;
      }
    }
    if (!best) return;
    const amount = Math.min(p.carried, T.lantern_cost - best.deposited);
    if (amount <= 0) return;
    p.carried -= amount;
    best.deposited += amount;
    this.emit("deposit", { lantern_id: best.id, amount, deposited: best.deposited });
    if (best.deposited >= T.lantern_cost) {
      best.lit = true;
      this.score += T.score.per_lantern;
      this.emit("lantern_lit", { lantern_id: best.id });
    }
  }

  private updateShades(): void {
    if (this.randomShades) {
      if (this.spawnTimer > 0) this.spawnTimer--;
      if (this.spawnTimer <= 0 && this.shades.length < C.shade_max) {
        const a = this.rngShades.next() * Math.PI * 2;
        const id = this.freshShadeId();
        this.shades.push({
          id,
          pos: [r3(C.shade_spawn_radius * Math.sin(a)), C.shade_y, r3(C.shade_spawn_radius * Math.cos(a))],
          stunTicks: 0,
        });
        this.emit("shade_spawned", { id });
        this.spawnTimer = Math.round(C.shade_spawn_interval_s * C.tick_rate);
      }
    }
    const pp = this.player.pos;
    for (const s of this.shades) {
      if (s.stunTicks > 0) {
        s.stunTicks--;
        continue;
      }
      const dx = pp[0] - s.pos[0];
      const dz = pp[2] - s.pos[2];
      const d = Math.hypot(dx, dz);
      if (d > EPS) {
        const m = Math.min(T.shade_speed * DT, d);
        s.pos[0] += (dx / d) * m;
        s.pos[2] += (dz / d) * m;
      }
      this.keepOutOfLanterns(s);
    }
  }

  /** Shades cannot enter safe_radius around any lantern: push them back to the rim. */
  private keepOutOfLanterns(s: Shade): void {
    for (const l of this.lanterns) {
      const dx = s.pos[0] - l.pos[0];
      const dz = s.pos[2] - l.pos[2];
      const d = Math.hypot(dx, dz);
      if (d < T.safe_radius) {
        const nx = d > EPS ? dx / d : 1;
        const nz = d > EPS ? dz / d : 0;
        s.pos[0] = l.pos[0] + nx * T.safe_radius;
        s.pos[2] = l.pos[2] + nz * T.safe_radius;
      }
    }
  }

  private pulse(): void {
    const p = this.player;
    if (this.cooldown > 0 || p.carried < T.pulse_cost) return;
    p.carried -= T.pulse_cost;
    this.cooldown = cooldownTicks;
    const ids: string[] = [];
    for (const s of this.shades) {
      const dx = s.pos[0] - p.pos[0];
      const dz = s.pos[2] - p.pos[2];
      const d = Math.hypot(dx, dz);
      if (d > T.pulse_radius + EPS) continue;
      const nx = d > EPS ? dx / d : 1;
      const nz = d > EPS ? dz / d : 0;
      s.pos[0] += nx * T.pulse_push_m;
      s.pos[2] += nz * T.pulse_push_m;
      this.keepOutOfLanterns(s);
      s.stunTicks = stunTicks;
      ids.push(s.id);
      this.score += T.score.per_stun;
    }
    this.emit("pulse", { stunned_ids: ids });
  }

  private pickup(): void {
    const p = this.player;
    const keep: Mote[] = [];
    for (const m of this.motes) {
      if (p.carried < T.carry_capacity && dist2d(m.pos, p.pos) <= T.pickup_radius + EPS) {
        p.carried += 1;
        this.score += T.score.per_mote;
        this.emit("mote_picked", { carried: p.carried });
      } else {
        keep.push(m);
      }
    }
    this.motes = keep;
  }

  private hitCheck(): void {
    if (this.invuln > 0) {
      this.invuln--;
      return;
    }
    const p = this.player;
    const hitter = this.shades.find((s) => s.stunTicks <= 0 && dist2d(s.pos, p.pos) <= T.shade_hit_radius + EPS);
    if (!hitter) return;
    p.flames -= 1;
    const dropped = Math.floor(p.carried * T.hit_drop_ratio);
    p.carried -= dropped;
    for (let i = 0; i < dropped; i++) {
      const a = (i / dropped) * Math.PI * 2;
      const r = T.pickup_radius + C.drop_ring_extra;
      let x = p.pos[0] + r * Math.sin(a);
      let z = p.pos[2] + r * Math.cos(a);
      const d = Math.hypot(x, z);
      if (d > C.island_radius) {
        x *= C.island_radius / d;
        z *= C.island_radius / d;
      }
      this.motes.push({ id: `M${this.nextMote++}`, pos: [r3(x), 0, r3(z)] });
    }
    this.invuln = invulnTicks;
    this.emit("player_hit", { by: "shade", flames: p.flames, dropped });
  }
}
