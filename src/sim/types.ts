export type Vec3 = [number, number, number];
export type SimState = "playing" | "paused" | "won" | "lost";
export type ShadeState = "spawning" | "wander" | "chase" | "recoil" | "stunned";
export type DrifterState = "idle" | "chase" | "flee";

export interface FrameInput {
  move: [number, number];
  camYawDeg: number;
  jump: boolean;
  interact: boolean;
  pulse: boolean;
  dash: boolean;
  pause: boolean;
}

export interface InputFrame {
  tick: number;
  move?: [number, number];
  cam_yaw_deg?: number;
  jump?: boolean;
  interact?: boolean;
  pulse?: boolean;
  dash?: boolean;
  pause?: boolean;
}

export interface ScenarioLantern {
  id: string;
  pos?: Vec3;
  deposited?: number;
  lit?: boolean;
}

export interface ScenarioShade {
  id?: string;
  pos: Vec3;
  state?: ShadeState;
  state_ticks_left?: number;
}

export interface ScenarioDrifter {
  id?: string;
  pos: Vec3;
  state?: DrifterState;
  stolen?: number;
}

export interface ScenarioCharm {
  id: string;
  pos?: Vec3;
  available?: boolean;
  respawn_ticks?: number;
}

export interface Scenario {
  player?: {
    pos?: Vec3;
    carried?: number;
    flames?: number;
    invuln_ticks?: number;
    dash_cd_ticks?: number;
    pulse_cd_ticks?: number;
    charm_ticks?: number;
  };
  random_motes?: boolean;
  random_shades?: boolean;
  random_drifters?: boolean;
  wind_enabled?: boolean;
  motes?: Vec3[];
  shades?: ScenarioShade[];
  drifters?: ScenarioDrifter[];
  charms?: ScenarioCharm[];
  lanterns?: ScenarioLantern[];
  time_left_s?: number;
}

export interface SimEvent {
  tick: number;
  name: string;
  data: Record<string, unknown>;
}

export interface Mote {
  id: string;
  pos: Vec3;
  kind: "random" | "dropped";
  ttl: number | null; // ticks left for dropped motes
}
export interface Lantern {
  id: string;
  pos: Vec3;
  lit: boolean;
  deposited: number;
}
export interface Shade {
  id: string;
  pos: Vec3;
  /** base behaviour; the visible state is derived from the counters below (see Sim.shadeState) */
  mode: "wander" | "chase";
  stunTicks: number; // > 0 means "stunned"
  recoilTicks: number;
  spawnTicks: number; // > 0 means "spawning"
  push: { dir: [number, number]; ticksLeft: number } | null; // pulse push-back
  recoilDir: [number, number] | null;
  pushOut: number; // ticks left of being pushed out of a freshly lit lantern's safe zone (no damage meanwhile)
}
export interface Drifter {
  id: string;
  pos: Vec3;
  state: DrifterState;
  stolen: number;
  fleeTicks: number;
  dir: [number, number]; // idle drift direction
  driftTicks: number;
  fleeDir: [number, number] | null;
}
export interface Charm {
  id: string;
  pos: Vec3;
  available: boolean;
  respawn: number; // ticks until it is back
}
