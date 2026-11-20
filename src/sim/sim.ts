import { nightDef, supportAt, topAt, type Night, type NightDef } from "./maps";
import { r3 } from "./output";
import { Rng } from "./rng";
import { CONSTANTS as C, DT, TUNING as T } from "./tuning";
import type { Charm, Drifter, FrameInput, InputFrame, Lantern, Mote, Scenario, Shade, ShadeState, SimEvent, SimState, Vec3 } from "./types";

const EPS = C.eps;
const dist2d = (a: ArrayLike<number>, b: ArrayLike<number>): number => Math.hypot((a[0] as number) - (b[0] as number), (a[2] as number) - (b[2] as number));
const dist3d = (a: Vec3, b: Vec3): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const unit2 = (dx: number, dz: number): [number, number] => {
  const d = Math.hypot(dx, dz);
  return d > EPS ? [dx / d, dz / d] : [1, 0]; // same position: +X
};
const idNum = (id: string): number => Number(id.slice(1));

export interface SimOptions {
  seed: number;
  night?: Night;
  scenario?: Scenario;
  /** Ticket-04 benchmark: no spawns, no damage, no pickups, no fuel decay, no end. Only the live benchmark mode sets it. */
  bench?: boolean;
}

interface PlayerState {
  pos: Vec3;
  vel: Vec3;
  flames: number;
  carried: number;
  grounded: boolean;
  invuln: number; // ticks left
  dashCd: number;
  pulseCd: number;
  charm: number;
  dashTicks: number;
  dashDir: [number, number];
  facing: [number, number];
  launched: boolean; // flying from a bounce pad: horizontal velocity is locked until landing
  launchVel: [number, number];
  fallWait: number; // ticks left of the "fell off the island" wait; 0 = playing
  lights: number; // successful lightings this night (grows the carrying capacity)
}

/**
 * Fixed-step game logic (contract v1.1). One call to step() is one 1/60 s tick.
 * Order inside a tick (Ticket-02): pause/input -> counters -> move Mây -> pickups -> lantern -> safe zones -> pulse
 * -> shades and drifters move -> touches -> spawns -> win/lose.
 * No Date, no Math.random, no DOM: same seed + scenario + inputs gives the same run.
 */
export class Sim {
  tick = 0; // every step, also while paused
  simTick = 0; // gameplay steps (paused steps do not count)
  status: "playing" | "won" | "lost" = "playing";
  paused = false;
  score = 0;
  readonly night: Night;
  readonly def: NightDef;
  readonly player: PlayerState;
  lanterns: Lantern[] = [];
  motes: Mote[] = [];
  shades: Shade[] = [];
  drifters: Drifter[] = [];
  charms: Charm[] = [];
  events: SimEvent[] = []; // events of the most recent step()
  readonly timeLeftStart: number;
  windActive = false;
  windDirDeg = 0;

  private rngMotes: Rng;
  private rngShades: Rng;
  private rngDrop: Rng;
  private rngDrift: Rng;
  private rngWind: Rng;
  private nextMote = 1;
  private nextShade = 1;
  private nextDrifter = 1;
  private randomMotes: boolean;
  private randomShades: boolean;
  private randomDrifters: boolean;
  private windEnabled: boolean;
  private readonly bench: boolean;
  private input: FrameInput = { move: [0, 0], camYawDeg: 0, jump: false, interact: false, pulse: false, dash: false, pause: false };
  private prev = { jump: false, interact: false, pulse: false, dash: false, pause: false };
  private started = false;
  private usedDrifters = new Set<string>();
  private litNow: Lantern[] = [];
  private windDir: [number, number] = [1, 0];

  constructor(opts: SimOptions) {
    const sc = opts.scenario ?? {};
    this.night = opts.night ?? 1;
    this.def = nightDef(this.night);
    this.rngMotes = new Rng(opts.seed);
    this.rngShades = new Rng((opts.seed ^ 0x9e3779b9) >>> 0);
    this.rngDrop = new Rng((opts.seed ^ 0x85ebca6b) >>> 0);
    this.rngDrift = new Rng((opts.seed ^ 0xc2b2ae35) >>> 0);
    this.rngWind = new Rng((opts.seed ^ 0x27d4eb2f) >>> 0);
    this.bench = opts.bench === true;
    this.randomMotes = sc.random_motes ?? true;
    this.randomShades = sc.random_shades ?? true;
    this.randomDrifters = sc.random_drifters ?? true;
    this.windEnabled = sc.wind_enabled ?? this.def.windEnabled;
    this.timeLeftStart = sc.time_left_s ?? T[this.def.duration_key];

    const p = sc.player ?? {};
    const start: Vec3 = p.pos ? [...p.pos] : [...this.def.start];
    this.player = {
      pos: start,
      vel: [0, 0, 0],
      flames: p.flames ?? T.flames,
      carried: p.carried ?? 0,
      grounded: false,
      invuln: p.invuln_ticks ?? 0,
      dashCd: p.dash_cd_ticks ?? 0,
      pulseCd: p.pulse_cd_ticks ?? 0,
      charm: p.charm_ticks ?? 0,
      dashTicks: 0,
      dashDir: [0, 1],
      facing: [0, 1],
      launched: false,
      launchVel: [0, 0],
      fallWait: 0,
      lights: p.successful_lights ?? 0,
    };
    const sup = supportAt(this.def, start[0], start[2], start[1], C.step_height);
    this.player.grounded = sup !== null && Math.abs(start[1] - sup) < 1e-6;

    const U = C.fuel_units;
    for (const l of this.def.lanterns) this.lanterns.push({ id: l.id, pos: [...l.pos], lit: false, deposited: 0, fuel60: 0, everLit: false, relitCount: 0 });
    for (const sl of sc.lanterns ?? []) {
      const l = this.lanterns.find((x) => x.id === sl.id);
      if (!l) continue; // unknown id: ignored
      if (sl.pos) l.pos = [...sl.pos];
      if (sl.fuel !== undefined) {
        l.fuel60 = sl.lit === false ? 0 : Math.round(Math.min(T.fuel_max, sl.fuel) * U);
        l.lit = l.fuel60 > 0;
      } else if (sl.lit !== undefined) {
        l.lit = sl.lit;
        l.fuel60 = sl.lit ? T.fuel_max * U : 0; // lit: true without fuel means a full lantern
      }
      l.everLit = sl.ever_lit ?? l.lit;
      if (l.lit) l.everLit = true;
      if (sl.deposited !== undefined) l.deposited = sl.deposited;
      else if (l.lit) l.deposited = T.lantern_cost;
    }

    if (sc.motes) {
      for (const m of sc.motes) this.motes.push({ id: `M${this.nextMote++}`, pos: [...m], kind: "random", ttl: null });
    } else if (this.randomMotes) {
      const pts = [...this.def.motePoints];
      for (let i = 0; i < C.mote_initial && pts.length; i++) {
        const k = Math.floor(this.rngMotes.next() * pts.length);
        const pt = pts.splice(k, 1)[0] as Vec3;
        this.motes.push({ id: `M${this.nextMote++}`, pos: [...pt], kind: "random", ttl: null });
      }
    }

    for (const s of sc.shades ?? []) {
      const sh = this.newShade(s.id ?? this.freshShadeId(), [...s.pos]);
      sh.spawnTicks = 0;
      sh.targetLantern = s.target_lantern_id ?? null;
      const st = s.state ?? "wander";
      if (st === "chase" || st === "wander") sh.mode = st;
      else if (st === "stunned") sh.stunTicks = s.state_ticks_left ?? C.pulse_stun_ticks;
      else if (st === "recoil") {
        sh.recoilTicks = s.state_ticks_left ?? C.recoil_ticks;
        sh.recoilDir = [1, 0];
      } else if (st === "spawning") sh.spawnTicks = s.state_ticks_left ?? C.spawning_ticks;
      else if (st === "drain") {
        const weak = sh.targetLantern ?? this.weakTarget(sh)?.id ?? null;
        if (weak) sh.drain = { lantern: weak, ticks: 0 };
      }
      this.shades.push(sh);
    }

    for (const d of sc.drifters ?? []) {
      const dr = this.newDrifter(d.id ?? this.freshDrifterId(), [...d.pos]);
      dr.state = d.state ?? "idle";
      dr.stolen = d.stolen ?? 0;
      if (dr.state === "flee") dr.fleeTicks = C.drifter_flee_ticks;
      this.drifters.push(dr);
    }

    const defaults = this.def.charms.map((c) => ({ id: c.id, pos: [...c.pos] as Vec3 }));
    if (sc.charms) {
      this.charms = sc.charms.map((c) => ({
        id: c.id,
        pos: c.pos ? ([...c.pos] as Vec3) : ((defaults.find((x) => x.id === c.id)?.pos ?? [0, 0, 0]) as Vec3),
        available: c.available ?? true,
        respawn: c.respawn_ticks ?? 0,
      }));
    } else this.charms = defaults.map((c) => ({ id: c.id, pos: c.pos, available: true, respawn: 0 }));
  }

  // ---- read-only views used by output, the champion kits and the renderer ----------------------------------
  get state(): SimState {
    return this.status === "playing" && this.paused ? "paused" : this.status;
  }
  get timeLeft(): number {
    return Math.max(0, this.timeLeftStart - this.simTick / C.tick_rate);
  }
  get litCount(): number {
    return this.lanterns.filter((l) => l.lit).length;
  }
  /** true during the 2 s before a gust (for the leaves and the sound) */
  get windWarning(): boolean {
    if (!this.windEnabled) return false;
    const phase = this.simTick % C.wind_every_ticks;
    return phase >= C.wind_every_ticks - C.wind_warn_ticks;
  }
  get capacity(): number {
    return Math.min(T.capacity_max, T.carry_capacity + C.capacity_per_light * this.player.lights);
  }
  /** Ticks left on the pulse cooldown (for the HUD). */
  get cooldownLeft(): number {
    return this.player.pulseCd;
  }
  get invulnerable(): boolean {
    return this.player.invuln > 0;
  }
  shadeState(s: Shade): ShadeState {
    if (s.stunTicks > 0) return "stunned";
    if (s.recoilTicks > 0) return "recoil";
    if (s.spawnTicks > 0) return "spawning";
    if (s.drain) return "drain";
    return s.mode;
  }
  /** ticks left of the timed state (stunned / recoil / spawning), 0 otherwise */
  stateTicksLeft(s: Shade): number {
    return s.stunTicks > 0 ? s.stunTicks : s.recoilTicks > 0 ? s.recoilTicks : s.spawnTicks;
  }

  private newShade(id: string, pos: Vec3): Shade {
    return { id, pos, mode: "wander", stunTicks: 0, recoilTicks: 0, spawnTicks: C.spawning_ticks, push: null, recoilDir: null, pushOut: 0, drain: null, targetLantern: null };
  }
  private newDrifter(id: string, pos: Vec3): Drifter {
    return { id, pos, state: "idle", stolen: 0, fleeTicks: 0, dir: [1, 0], driftTicks: 0, fleeDir: null };
  }
  private freshShadeId(): string {
    for (;;) {
      const id = `S${this.nextShade++}`;
      if (!this.shades.some((s) => s.id === id)) return id;
    }
  }
  private freshDrifterId(): string {
    for (;;) {
      const id = `D${this.nextDrifter++}`;
      if (!this.drifters.some((s) => s.id === id)) return id;
    }
  }
  private emit(name: string, data: Record<string, unknown>): void {
    this.events.push({ tick: this.tick, name, data });
  }
  private groundAt(x: number, z: number, y: number, reach: number = C.step_height): number | null {
    return supportAt(this.def, x, z, y, reach);
  }

  /** Apply one input frame: only fields present in the frame change. */
  applyFrame(f: InputFrame): void {
    if (f.move) this.input.move = [f.move[0], f.move[1]];
    if (f.cam_yaw_deg !== undefined) this.input.camYawDeg = f.cam_yaw_deg;
    if (f.jump !== undefined) this.input.jump = f.jump;
    if (f.interact !== undefined) this.input.interact = f.interact;
    if (f.pulse !== undefined) this.input.pulse = f.pulse;
    if (f.dash !== undefined) this.input.dash = f.dash;
    if (f.pause !== undefined) this.input.pause = f.pause;
  }

  /** Live (render) mode: replace the whole input state. */
  setInput(i: FrameInput): void {
    this.input = { ...i, move: [i.move[0], i.move[1]] };
  }

  /** Advance one tick. Returns false if the game was already over. */
  step(): boolean {
    this.events = [];
    if (this.status !== "playing") return false;
    this.tick += 1;
    const inp = this.input;
    const edge = {
      jump: inp.jump && !this.prev.jump,
      interact: inp.interact && !this.prev.interact,
      pulse: inp.pulse && !this.prev.pulse,
      dash: inp.dash && !this.prev.dash,
      pause: inp.pause && !this.prev.pause,
    };
    this.prev = { jump: inp.jump, interact: inp.interact, pulse: inp.pulse, dash: inp.dash, pause: inp.pause };

    if (!this.started) {
      this.started = true;
      this.emit("night_start", { night: this.night });
    }
    if (edge.pause) {
      this.paused = !this.paused;
      this.emit(this.paused ? "paused" : "resumed", {});
      if (this.paused) return true;
    } else if (this.paused) {
      return true;
    }
    this.simTick += 1;

    const waiting = this.player.fallWait > 0; // the respawn tick itself does not act: Mây appears with velocity 0
    this.countdown();
    this.updateWind();
    this.litNow = [];
    if (!waiting) {
      this.movePlayer(edge.jump, edge.dash);
      this.pickups();
      if (edge.interact) this.interact();
      this.safeZones();
      if (edge.pulse) this.pulse();
    }
    this.moveShades();
    this.moveDrifters();
    if (!waiting && !this.bench) this.touches();
    if (!this.bench) this.spawns();

    if (this.bench) return true;
    if (this.player.flames <= 0) this.finish("lost", "no_flames");
    else if (this.timeLeft <= EPS) {
      // dawn: alive, and at least ceil(0.6 * lanterns) of them lit, is a win
      const need = Math.ceil(T.win_ratio * this.lanterns.length - 1e-9);
      if (this.litCount >= need) this.finish("won", "dawn_survived");
      else this.finish("lost", "dawn");
    }
    return true;
  }

  private finish(result: "won" | "lost", reason: "dawn_survived" | "dawn" | "no_flames"): void {
    this.status = result;
    if (result === "won") {
      for (const l of this.lanterns) if (l.lit) this.score += C.dawn_lantern_score + Math.floor(l.fuel60 / C.fuel_units);
      this.score += T.score.per_flame_left * this.player.flames;
    }
    this.emit("game_over", { result, reason });
  }

  // ---- 2. counters ---------------------------------------------------------------------------------
  private countdown(): void {
    const P = this.player;
    if (P.invuln > 0) P.invuln--;
    if (P.dashCd > 0) P.dashCd--;
    if (P.pulseCd > 0) P.pulseCd--;
    if (P.charm > 0) P.charm--;
    if (P.fallWait > 0 && --P.fallWait === 0 && P.flames > 0) this.respawn();
    for (const s of this.shades) {
      if (s.stunTicks > 0) s.stunTicks--;
      if (s.recoilTicks > 0) s.recoilTicks--;
      if (s.spawnTicks > 0) s.spawnTicks--;
    }
    for (const m of this.motes) if (m.ttl !== null) m.ttl--;
    this.motes = this.motes.filter((m) => m.ttl === null || m.ttl > 0);
    for (const c of this.charms) {
      if (!c.available && c.respawn > 0 && --c.respawn === 0) c.available = true;
    }
    this.updateFuel();
  }

  /** Step 2 (Ticket-03): every lit lantern loses 1 fuel/s on its own and 5 fuel/s per draining shade; at 0 it goes off. */
  private updateFuel(): void {
    if (this.bench) return;
    const U = C.fuel_units;
    const decay = (T.fuel_decay_per_s * U) / C.tick_rate;
    const drain = (T.drain_per_s * U) / C.tick_rate;
    for (const l of this.lanterns) {
      if (!l.lit) continue;
      l.fuel60 -= decay;
      const drainers = this.shades.filter((s) => s.drain?.lantern === l.id && this.shadeState(s) === "drain");
      for (const s of drainers) {
        l.fuel60 -= drain;
        (s.drain as { ticks: number }).ticks++;
      }
      if (l.fuel60 < 0) l.fuel60 = 0;
      for (const s of drainers) {
        if ((s.drain as { ticks: number }).ticks % C.tick_rate === 0) this.emit("fuel_drain", { lantern_id: l.id, shade_id: s.id, fuel: Math.round((l.fuel60 / U) * 10) / 10 });
      }
      if (l.fuel60 <= 0) {
        l.lit = false;
        l.fuel60 = 0;
        l.deposited = 0; // out: the lantern forgets what was put in, but remembers it was lit once
        for (const s of this.shades) if (s.drain?.lantern === l.id) s.drain = null;
        this.emit("lantern_out", { lantern_id: l.id });
      }
    }
  }

  /** Where a wandering shade goes: the scenario's target, else the nearest weak lit lantern (ties: smaller id). */
  private weakTarget(s: Shade): Lantern | undefined {
    if (s.targetLantern) return this.lanterns.find((l) => l.id === s.targetLantern);
    let best: Lantern | undefined;
    let bd = Infinity;
    for (const l of this.lanterns) {
      if (!l.lit || l.fuel60 >= T.low_fuel_threshold * C.fuel_units) continue;
      const d = dist2d(s.pos, l.pos);
      if (d < bd - 1e-12) {
        bd = d;
        best = l;
      }
    }
    return best;
  }

  private respawn(): void {
    const P = this.player;
    P.pos = [...this.def.start];
    P.vel = [0, 0, 0];
    P.grounded = true;
    P.launched = false;
    P.dashTicks = 0;
    P.invuln = C.respawn_invuln_ticks;
  }

  private updateWind(): void {
    if (!this.windEnabled) return;
    const t = this.simTick;
    const phase = t % C.wind_every_ticks;
    if (phase === C.wind_every_ticks - C.wind_warn_ticks) {
      // the direction of the next gust is chosen when the warning starts
      const a = Math.round(this.rngWind.next() * 360000) / 1000;
      this.windDirDeg = a;
      this.windDir = [Math.cos((a * Math.PI) / 180), Math.sin((a * Math.PI) / 180)];
    }
    this.windActive = t >= C.wind_every_ticks && phase < C.wind_ticks;
  }

  // ---- 3. move Mây ---------------------------------------------------------------------------------
  private blocked(x: number, z: number, y: number): boolean {
    const t = topAt(this.def, x, z);
    return t !== null && t > y + C.step_height;
  }

  private movePlayer(jumpEdge: boolean, dashEdge: boolean): void {
    const P = this.player;
    const inp = this.input;
    let [mx, mz] = inp.move;
    const len = Math.hypot(mx, mz);
    if (len > 1) {
      mx /= len;
      mz /= len;
    }
    const th = (inp.camYawDeg * Math.PI) / 180;
    const wx = mx * Math.cos(th) + mz * Math.sin(th);
    const wz = -mx * Math.sin(th) + mz * Math.cos(th);
    const moving = Math.hypot(wx, wz) > EPS;
    if (moving) P.facing = unit2(wx, wz);
    const speed = T.player_speed * (P.charm > 0 ? C.charm_speed_mult : 1);

    // dash: a false->true press when the cooldown is over; the charm removes the cooldown (a new press is still needed)
    if (dashEdge && P.dashTicks === 0 && (P.dashCd <= 0 || P.charm > 0)) {
      P.dashTicks = C.dash_ticks;
      P.dashDir = moving ? unit2(wx, wz) : [...P.facing];
      P.dashCd = P.charm > 0 ? 0 : C.dash_cooldown_ticks;
      this.emit("dash", {});
    }

    // bounce pads: feet on the pad
    if (!P.launched && P.dashTicks === 0 && P.vel[1] <= 0) {
      for (const pad of this.def.pads) {
        if (dist2d(P.pos, pad.pos) <= pad.radius + EPS && P.pos[1] - pad.pos[1] <= 0.2) {
          P.vel[1] = pad.vy;
          P.launchVel = [pad.dir[0] * pad.speed, pad.dir[1] * pad.speed];
          P.launched = true;
          P.grounded = false;
          break;
        }
      }
    }

    // horizontal velocity
    let vx = P.vel[0];
    let vz = P.vel[2];
    const dashing = P.dashTicks > 0;
    let afterDash: [number, number] | null = null;
    if (dashing) {
      vx = P.dashDir[0] * T.dash_speed;
      vz = P.dashDir[1] * T.dash_speed;
      P.dashTicks--;
      if (P.dashTicks === 0) afterDash = P.launched ? [P.launchVel[0], P.launchVel[1]] : [wx * speed, wz * speed];
    } else if (P.launched) {
      [vx, vz] = P.launchVel;
    } else {
      const tx = wx * speed;
      const tz = wz * speed;
      const maxStep = (T.player_speed / C.accel_s) * DT; // full speed (or standstill) in 0.1 s
      const dx = tx - vx;
      const dz = tz - vz;
      const d = Math.hypot(dx, dz);
      if (d <= maxStep) [vx, vz] = [tx, tz];
      else {
        vx += (dx / d) * maxStep;
        vz += (dz / d) * maxStep;
      }
    }

    const windX = this.windActive ? this.windDir[0] * C.wind_push : 0;
    const windZ = this.windActive ? this.windDir[1] * C.wind_push : 0;
    const y = P.pos[1];
    let nx = P.pos[0] + (vx + windX) * DT;
    let nz = P.pos[2] + (vz + windZ) * DT;
    if (this.blocked(nx, nz, y)) {
      // a wall: slide along it if one axis is free
      if (!this.blocked(nx, P.pos[2], y)) {
        nz = P.pos[2];
        vz = 0;
      } else if (!this.blocked(P.pos[0], nz, y)) {
        nx = P.pos[0];
        vx = 0;
      } else {
        nx = P.pos[0];
        nz = P.pos[2];
        vx = 0;
        vz = 0;
      }
    }
    P.pos[0] = nx;
    P.pos[2] = nz;
    if (afterDash) [vx, vz] = afterDash;
    P.vel[0] = vx;
    P.vel[2] = vz;

    // vertical
    const sup = this.groundAt(nx, nz, y);
    if (jumpEdge && P.grounded && !dashing) {
      P.vel[1] = C.jump_speed;
      P.grounded = false;
    }
    if (P.grounded && P.vel[1] <= 0 && sup !== null && y - sup <= C.step_height + 1e-9) {
      P.pos[1] = sup;
      P.vel[1] = 0;
    } else if (dashing && !P.grounded) {
      P.vel[1] = 0; // a dash in the air keeps its height
    } else {
      P.vel[1] -= C.gravity * DT;
      P.pos[1] = y + P.vel[1] * DT;
      if (P.vel[1] <= 0 && sup !== null && P.pos[1] <= sup) {
        P.pos[1] = sup;
        P.vel[1] = 0;
        P.grounded = true;
        P.launched = false;
      } else P.grounded = false;
    }

    // fell off the island
    if (P.pos[1] < C.fall_y && T.fall_enabled) {
      P.flames -= 1;
      const lost = P.carried;
      P.carried = 0;
      P.vel = [0, 0, 0];
      P.launched = false;
      P.dashTicks = 0;
      P.fallWait = C.fall_wait_ticks;
      this.emit("player_hit", { by: "fall", flames: P.flames, dropped: 0, lost });
    }
  }

  // ---- 4. pickups -----------------------------------------------------------------------------------
  private reachable(pos: Vec3): boolean {
    const P = this.player;
    return dist2d(pos, P.pos) <= T.pickup_radius + EPS && Math.abs(P.pos[1] - pos[1]) <= C.pickup_height + EPS;
  }

  private pickups(): void {
    if (this.bench) return;
    const P = this.player;
    const keep: Mote[] = [];
    for (const m of this.motes) {
      if (P.carried < this.capacity && this.reachable(m.pos)) {
        P.carried += 1;
        this.emit("mote_picked", { carried: P.carried });
      } else keep.push(m);
    }
    this.motes = keep;
    for (const c of this.charms) {
      if (c.available && this.reachable(c.pos)) {
        c.available = false;
        c.respawn = C.charm_respawn_ticks;
        P.charm = C.charm_ticks;
        this.emit("charm_picked", { charm_id: c.id, charm_ticks: C.charm_ticks });
      }
    }
  }

  // ---- 5. lantern -----------------------------------------------------------------------------------
  private interact(): void {
    const P = this.player;
    if (P.carried <= 0) return;
    const U = C.fuel_units;
    const full = T.fuel_max * U;
    // only "acceptable" lanterns: unlit, or lit but not full; the nearest, ties to the smaller id
    let best: Lantern | undefined;
    let bestD = Infinity;
    for (const l of this.lanterns) {
      if (l.lit && l.fuel60 >= full) continue;
      const d = dist2d(l.pos, P.pos);
      if (d <= T.interact_radius + EPS && d < bestD) {
        best = l;
        bestD = d;
      }
    }
    if (!best) return;
    if (!best.lit) {
      const required = best.everLit ? T.relight_cost : T.lantern_cost; // a lantern lit before needs only 5
      const amount = Math.min(P.carried, required - best.deposited);
      if (amount <= 0) return;
      P.carried -= amount;
      best.deposited += amount;
      this.score += T.score.per_mote * amount;
      this.emit("deposit", { lantern_id: best.id, amount, deposited: best.deposited });
      if (best.deposited >= required) {
        const relight = best.everLit;
        best.lit = true;
        best.fuel60 = full;
        best.everLit = true;
        P.lights += 1;
        if (relight) {
          best.relitCount += 1;
          this.score += C.relight_score;
        } else this.score += T.score.per_lantern;
        this.litNow.push(best);
        this.emit("lantern_lit", { lantern_id: best.id, relight });
      }
      return;
    }
    const used = Math.min(P.carried, Math.ceil((full - best.fuel60) / (T.fuel_per_mote * U)));
    if (used <= 0) return;
    const before = best.fuel60;
    P.carried -= used;
    best.fuel60 = Math.min(full, best.fuel60 + used * T.fuel_per_mote * U);
    this.score += T.score.per_mote * used;
    this.emit("refuel", { lantern_id: best.id, amount: used, fuel: Math.round((best.fuel60 / U) * 10) / 10 });
    const thr = T.low_fuel_threshold * U;
    if (before < thr && best.fuel60 >= thr) {
      // the safe zone is back: shades inside are pushed out, those draining stop
      this.litNow.push(best);
      for (const s of this.shades) if (s.drain?.lantern === best.id) s.drain = null;
    }
  }

  // ---- 6. safe zones --------------------------------------------------------------------------------
  private safeZones(): void {
    for (const l of this.litNow) {
      for (const s of this.shades) if (dist2d(s.pos, l.pos) < T.safe_radius) s.pushOut = C.safe_push_ticks;
    }
  }
  /** Lanterns that have a safe zone: lit, and with at least low_fuel_threshold fuel (exactly 30 still counts). */
  private litLanterns(): Lantern[] {
    if (this.litCache) return this.litCache; // moveShades does not change lanterns, so one list serves every shade
    return this.lanterns.filter((l) => l.lit && l.fuel60 >= T.low_fuel_threshold * C.fuel_units);
  }
  private keepOutOfLit(s: Shade): void {
    for (const l of this.litLanterns()) {
      const dx = s.pos[0] - l.pos[0];
      const dz = s.pos[2] - l.pos[2];
      if (Math.hypot(dx, dz) < T.safe_radius) {
        const [nx, nz] = unit2(dx, dz);
        s.pos[0] = l.pos[0] + nx * T.safe_radius;
        s.pos[2] = l.pos[2] + nz * T.safe_radius;
      }
    }
  }

  // ---- 7. pulse -------------------------------------------------------------------------------------
  private pulse(): void {
    const P = this.player;
    if (P.pulseCd > 0 || P.carried < T.pulse_cost) return;
    P.carried -= T.pulse_cost;
    P.pulseCd = Math.round(T.pulse_cooldown_s * C.tick_rate);
    const center: Vec3 = [P.pos[0], P.pos[1] + C.pulse_center_up, P.pos[2]];
    const ids: string[] = [];
    for (const s of this.shades) {
      if (dist3d(center, s.pos) > T.pulse_radius + EPS) continue; // the target is fixed now, at the trigger tick
      const wasDraining = s.drain !== null && s.stunTicks === 0;
      s.stunTicks = C.pulse_stun_ticks;
      s.recoilTicks = 0;
      s.drain = null;
      s.push = { dir: unit2(s.pos[0] - center[0], s.pos[2] - center[2]), ticksLeft: C.pulse_push_ticks };
      ids.push(s.id);
      this.score += wasDraining ? C.stun_drain_score : T.score.per_stun;
    }
    for (const d of this.drifters) {
      if (dist3d(center, d.pos) > T.pulse_radius + EPS) continue;
      if (d.state === "chase") {
        d.state = "flee";
        d.fleeTicks = C.drifter_flee_ticks;
        d.fleeDir = unit2(d.pos[0] - P.pos[0], d.pos[2] - P.pos[2]);
      } else if (d.state === "flee" && d.stolen > 0) {
        this.dropMotesAt(d.pos, d.stolen);
        this.emit("drifter_drop", { drifter_id: d.id, amount: d.stolen });
        d.stolen = 0;
        d.fleeTicks = Math.min(d.fleeTicks, C.drifter_flee_after_pulse_ticks);
      }
    }
    this.emit("pulse", { stunned_ids: ids });
  }

  private dropMotesAt(pos: Vec3, n: number): void {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const x = pos[0] + Math.cos(a) * 0.5;
      const z = pos[2] + Math.sin(a) * 0.5;
      const y = this.groundAt(x, z, this.player.pos[1], 4) ?? this.player.pos[1];
      this.motes.push({ id: `M${this.nextMote++}`, pos: [r3(x), y, r3(z)], kind: "dropped", ttl: C.mote_ttl_ticks });
    }
  }

  // ---- 8. shades and drifters -----------------------------------------------------------------------
  /** Move a shade by (dx, dz) unless the way is a wall, a missing floor or the end of the map. Returns true if it moved. */
  private shadeStep(s: Shade, dx: number, dz: number): boolean {
    const nx = s.pos[0] + dx;
    const nz = s.pos[2] + dz;
    const feet = s.pos[1] - C.shade_y;
    const reach = C.step_height + 1.5;
    const sup = this.groundAt(nx, nz, feet, reach);
    if (sup === null || this.blocked(nx, nz, feet)) return false;
    const oldSup = this.groundAt(s.pos[0], s.pos[2], feet, reach) ?? sup;
    s.pos[0] = nx;
    s.pos[2] = nz;
    s.pos[1] += sup - oldSup;
    return true;
  }

  private litCache: Lantern[] | null = null;
  private moveShades(): void {
    this.litCache = null;
    this.litCache = this.litLanterns();
    try {
      this.moveShadesInner();
    } finally {
      this.litCache = null;
    }
  }
  private moveShadesInner(): void {
    const P = this.player;
    const speed = this.def.shadeSpeed * DT;
    for (const s of this.shades) {
      if (s.spawnTicks > 0) continue;
      if (s.pushOut > 0) {
        // thrown out of a freshly lit lantern's safe zone within 30 ticks; harmless meanwhile
        const left = s.pushOut--;
        const near = this.litLanterns().filter((l) => dist2d(s.pos, l.pos) < T.safe_radius).sort((a, b) => dist2d(s.pos, a.pos) - dist2d(s.pos, b.pos))[0];
        if (near) {
          const d = dist2d(s.pos, near.pos);
          const [nx, nz] = unit2(s.pos[0] - near.pos[0], s.pos[2] - near.pos[2]);
          const step = (T.safe_radius - d) / Math.max(1, left);
          this.shadeStep(s, nx * step, nz * step);
        } else s.pushOut = 0;
        continue;
      }
      if (s.stunTicks > 0) {
        if (s.push && s.push.ticksLeft > 0) {
          const k = T.pulse_push_m / C.pulse_push_ticks;
          if (this.shadeStep(s, s.push.dir[0] * k, s.push.dir[1] * k)) s.push.ticksLeft--;
          else s.push.ticksLeft = 0; // stops at an obstacle
        }
        this.keepOutOfLit(s);
        continue;
      }
      s.push = null;
      if (s.recoilTicks > 0) {
        const dir = s.recoilDir ?? [1, 0];
        const k = C.recoil_m / (C.recoil_ticks - 1); // the hit tick itself does not move: 59 recoil steps make 2 m
        this.shadeStep(s, dir[0] * k, dir[1] * k);
        this.keepOutOfLit(s);
        continue;
      }
      const dPlayer = P.fallWait > 0 ? Infinity : dist2d(s.pos, P.pos);
      if (s.drain) {
        const l = this.lanterns.find((x) => x.id === s.drain?.lantern);
        const weak = !!l && l.lit && l.fuel60 < T.low_fuel_threshold * C.fuel_units;
        if (dPlayer <= T.safe_radius) {
          s.drain = null; // Mây came within 6 m: chase her
          s.mode = "chase";
        } else if (!l || !weak || dist2d(s.pos, l.pos) > C.drain_range + EPS) {
          s.drain = null; // lantern out, refuelled to 30 or more, or too far: back to wander
        } else continue; // stands still and drains
      }
      if (s.mode === "wander" && dPlayer <= C.detect_m) s.mode = "chase";
      else if (s.mode === "chase" && dPlayer > C.lose_m) s.mode = "wander";

      let target: Vec3 | null = null;
      if (s.mode === "chase") target = P.pos;
      else {
        const weak = this.weakTarget(s);
        if (weak) {
          target = weak.pos;
          if (weak.lit && weak.fuel60 < T.low_fuel_threshold * C.fuel_units && dist2d(s.pos, weak.pos) <= C.drain_range + EPS) {
            s.drain = { lantern: weak.id, ticks: 0 };
            continue;
          }
        } else {
          let bd = Infinity;
          for (const l of this.lanterns) {
            if (l.lit) continue;
            const d = dist2d(s.pos, l.pos);
            if (d < bd) {
              bd = d;
              target = l.pos;
            }
          }
        }
      }
      if (target) {
        const d = dist2d(s.pos, target);
        if (d > EPS && (s.mode === "chase" || d > 0.5)) {
          const [nx, nz] = unit2(target[0] - s.pos[0], target[2] - s.pos[2]);
          const m = Math.min(speed, d);
          this.shadeStep(s, nx * m, nz * m);
        }
      }
      this.keepOutOfLit(s);
    }
  }

  private moveDrifters(): void {
    const P = this.player;
    const fast = C.drifter_fast_speed * DT;
    const wantsPlayer = () => P.carried >= C.drifter_trigger_carry;
    for (const d of this.drifters) {
      const near = dist2d(d.pos, P.pos) <= C.drifter_trigger_m;
      if (d.state === "idle") {
        if (d.driftTicks-- <= 0) {
          const a = this.rngDrift.next() * Math.PI * 2;
          d.dir = [Math.cos(a), Math.sin(a)];
          d.driftTicks = 120;
        }
        d.pos[0] += d.dir[0] * C.drifter_idle_speed * DT;
        d.pos[2] += d.dir[1] * C.drifter_idle_speed * DT;
        if (wantsPlayer() && near) d.state = "chase";
      } else if (d.state === "chase") {
        if (!(wantsPlayer() && near)) d.state = "idle";
        else {
          const dd = dist2d(d.pos, P.pos);
          const [nx, nz] = unit2(P.pos[0] - d.pos[0], P.pos[2] - d.pos[2]);
          const m = Math.min(fast, dd);
          d.pos[0] += nx * m;
          d.pos[2] += nz * m;
        }
      } else {
        const dir = d.fleeDir ?? unit2(d.pos[0] - P.pos[0], d.pos[2] - P.pos[2]);
        d.fleeDir = dir;
        d.pos[0] += dir[0] * fast;
        d.pos[2] += dir[1] * fast;
        d.fleeTicks--;
      }
    }
    this.drifters = this.drifters.filter((d) => d.state !== "flee" || d.fleeTicks > 0);
  }

  // ---- 9. touches -----------------------------------------------------------------------------------
  private touches(): void {
    const P = this.player;
    for (const d of this.drifters) {
      // the drifter steals first (invulnerability does not protect against it)
      if (d.state !== "chase" || this.usedDrifters.has(d.id)) continue;
      if (dist2d(d.pos, P.pos) > C.drifter_touch_m + EPS) continue;
      this.usedDrifters.add(d.id);
      const amount = Math.min(C.drifter_steal_max, P.carried);
      P.carried -= amount;
      d.stolen = amount;
      d.state = "flee";
      d.fleeTicks = C.drifter_flee_ticks;
      d.fleeDir = unit2(d.pos[0] - P.pos[0], d.pos[2] - P.pos[2]);
      this.emit("drifter_steal", { drifter_id: d.id, amount, carried: P.carried });
    }
    if (P.invuln > 0) return;
    const hitter = [...this.shades]
      .sort((a, b) => idNum(a.id) - idNum(b.id))
      .find((s) => {
        const st = this.shadeState(s);
        return (
          st !== "stunned" && st !== "spawning" && st !== "recoil" && s.pushOut <= 0 &&
          dist2d(s.pos, P.pos) <= T.shade_hit_radius + EPS && Math.abs(P.pos[1] - s.pos[1]) <= C.hit_height + EPS
        );
      });
    if (!hitter) return;
    P.flames -= 1;
    const dropped = Math.floor(P.carried * T.hit_drop_ratio);
    P.carried -= dropped;
    for (let i = 0; i < dropped; i++) {
      const a = this.rngDrop.next() * Math.PI * 2;
      const r = C.drop_ring_min + this.rngDrop.next() * (C.drop_ring_max - C.drop_ring_min);
      let x = P.pos[0] + r * Math.cos(a);
      let z = P.pos[2] + r * Math.sin(a);
      let y = this.groundAt(x, z, P.pos[1], C.step_height);
      if (y === null || this.blocked(x, z, P.pos[1])) {
        x = P.pos[0];
        z = P.pos[2];
        y = P.pos[1];
      }
      this.motes.push({ id: `M${this.nextMote++}`, pos: [r3(x), y, r3(z)], kind: "dropped", ttl: C.mote_ttl_ticks });
    }
    P.invuln = Math.round(T.invuln_s * C.tick_rate);
    hitter.recoilTicks = C.recoil_ticks;
    hitter.recoilDir = unit2(hitter.pos[0] - P.pos[0], hitter.pos[2] - P.pos[2]);
    this.emit("player_hit", { by: "shade", flames: P.flames, dropped });
  }

  // ---- 10. spawns -----------------------------------------------------------------------------------
  private spawns(): void {
    const t = this.simTick;
    if (this.randomMotes && t % C.mote_spawn_every_ticks === 0 && this.motes.length < C.mote_cap) {
      const free = this.def.motePoints.filter((p) => !this.motes.some((m) => dist2d(m.pos, p) < 0.5));
      if (free.length) {
        const pt = free[Math.floor(this.rngMotes.next() * free.length)] as Vec3;
        this.motes.push({ id: `M${this.nextMote++}`, pos: [...pt], kind: "random", ttl: null });
      }
    }
    if (this.randomShades) {
      const first = t === C.first_shade_tick;
      const later = t > C.first_shade_tick && (t - C.first_shade_tick) % this.def.shadeEveryTicks === 0;
      const n = first ? 2 : later ? 1 : 0;
      for (let i = 0; i < n; i++) this.spawnShade();
    }
    if (this.randomDrifters && this.def.driftersEnabled && t >= C.drifter_first_tick && t % C.drifter_every_ticks === 0 && this.drifters.length < C.drifter_max) {
      const pt = this.def.mist[Math.floor(this.rngDrift.next() * this.def.mist.length)] as [number, number];
      this.drifters.push(this.newDrifter(this.freshDrifterId(), [pt[0], C.drifter_y, pt[1]]));
    }
  }

  private spawnShade(): void {
    if (this.shades.length >= this.def.shadeMax) return;
    const P = this.player;
    const lit = this.litLanterns();
    const valid = this.def.shadeSpawns.filter(
      (p) =>
        Math.hypot(p[0] - P.pos[0], p[1] - P.pos[2]) >= 15 &&
        !this.shades.some((s) => Math.hypot(s.pos[0] - p[0], s.pos[2] - p[1]) < 0.5) &&
        !lit.some((l) => Math.hypot(l.pos[0] - p[0], l.pos[2] - p[1]) < T.safe_radius),
    );
    if (!valid.length) return; // no valid point: skip this spawn
    const p = valid[Math.floor(this.rngShades.next() * valid.length)] as [number, number];
    const sup = this.groundAt(p[0], p[1], 0, 0.5) ?? 0;
    const id = this.freshShadeId();
    this.shades.push(this.newShade(id, [p[0], sup + C.shade_y, p[1]]));
    this.emit("shade_spawned", { id });
  }
}
