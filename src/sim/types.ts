export type Vec3 = [number, number, number];
export type SimState = "playing" | "won" | "lost";
export type ShadeState = "chase" | "stunned";

export interface FrameInput {
  move: [number, number];
  camYawDeg: number;
  jump: boolean;
  interact: boolean;
  pulse: boolean;
}

export interface InputFrame {
  tick: number;
  move?: [number, number];
  cam_yaw_deg?: number;
  jump?: boolean;
  interact?: boolean;
  pulse?: boolean;
}

export interface ScenarioLantern {
  id: string;
  pos?: Vec3;
  deposited?: number;
  lit?: boolean;
}

export interface Scenario {
  player?: { pos?: Vec3; carried?: number; flames?: number };
  random_motes?: boolean;
  random_shades?: boolean;
  motes?: Vec3[];
  shades?: { id?: string; pos: Vec3 }[];
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
  stunTicks: number;
}
