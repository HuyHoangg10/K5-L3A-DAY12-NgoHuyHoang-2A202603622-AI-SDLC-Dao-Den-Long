// The three standard maps of Ticket-02 (part 2). Angles are measured from +X, counter-clockwise seen from above:
// a point at radius r and angle a is (r cos a, y, r sin a).
import type { Vec3 } from "./types";

export type Night = 1 | 2 | 3;

const round3 = (n: number) => {
  const v = Math.round(n * 1000) / 1000;
  return v === 0 ? 0 : v;
};
const polar = (cx: number, cz: number, r: number, deg: number, y = 0): Vec3 => [
  round3(cx + r * Math.cos((deg * Math.PI) / 180)),
  y,
  round3(cz + r * Math.sin((deg * Math.PI) / 180)),
];
const ring = (cx: number, cz: number, r: number, n: number, start: number, y = 0): Vec3[] =>
  Array.from({ length: n }, (_, i) => polar(cx, cz, r, start + (360 / n) * i, y));

/** A walkable or solid shape. top(x, z) is the height of its top face at that point, or null when the point is outside. */
export type Shape =
  | { type: "disc"; cx: number; cz: number; r: number; y: number }
  | { type: "rect"; x0: number; x1: number; z0: number; z1: number; y: number }
  | { type: "halfring"; r0: number; r1: number; y: number }
  | { type: "ramp"; deg: number; s0: number; s1: number; width: number; y0: number; y1: number }
  | { type: "tower"; r: number; y0: number; y1: number };

export interface Surface {
  name: string;
  top(x: number, z: number): number | null;
  solidOnly?: boolean; // obstacle that cannot be stood on (the bell tower)
  shape: Shape; // for the renderer
}

const disc = (name: string, cx: number, cz: number, r: number, y: number): Surface => ({
  name,
  top: (x, z) => (Math.hypot(x - cx, z - cz) <= r ? y : null),
  shape: { type: "disc", cx, cz, r, y },
});

export interface Pad {
  pos: Vec3;
  radius: number;
  vy: number;
  speed: number; // horizontal m/s, kept until landing
  dir: [number, number]; // unit vector in XZ
}

export interface NightDef {
  night: Night;
  name: string;
  duration_key: "night1_duration_s" | "night2_duration_s" | "night3_duration_s";
  start: Vec3;
  surfaces: Surface[];
  lanterns: { id: string; pos: Vec3 }[];
  motePoints: Vec3[];
  shadeSpawns: [number, number][];
  shadeSpeed: number;
  shadeMax: number;
  shadeEveryTicks: number;
  pads: Pad[];
  charms: { id: string; pos: Vec3 }[];
  windEnabled: boolean;
  driftersEnabled: boolean;
  mist: [number, number][]; // where Gió Lạc can appear (assumption: a ring over the cloud sea)
}

const unit = (from: [number, number], to: [number, number]): [number, number] => {
  const d = Math.hypot(to[0] - from[0], to[1] - from[1]);
  return [(to[0] - from[0]) / d, (to[1] - from[1]) / d];
};

function night1(): NightDef {
  return {
    night: 1,
    name: "Đảo Bến",
    duration_key: "night1_duration_s",
    start: [0, 0, 0],
    surfaces: [disc("island", 0, 0, 40, 0)],
    lanterns: [
      { id: "L1", pos: [0, 0, 25] },
      { id: "L2", pos: [23.8, 0, 7.7] },
      { id: "L3", pos: [14.7, 0, -20.2] },
      { id: "L4", pos: [-14.7, 0, -20.2] },
      { id: "L5", pos: [-23.8, 0, 7.7] },
    ],
    motePoints: [...ring(0, 0, 12, 8, 0), ...ring(0, 0, 33, 16, 0)],
    shadeSpawns: ring(0, 0, 37, 12, 15).map((p) => [p[0], p[2]]),
    shadeSpeed: 4,
    shadeMax: 6,
    shadeEveryTicks: 480,
    pads: [],
    charms: [],
    windEnabled: false,
    driftersEnabled: false,
    mist: [],
  };
}

function night2(): NightDef {
  const A: [number, number] = [0, 0];
  const B: [number, number] = [70, 0];
  const bridge: Surface = { name: "bridge", top: (x, z) => (x >= 26 && x <= 44 && z >= -2 && z <= 2 ? 0 : null), shape: { type: "rect", x0: 26, x1: 44, z0: -2, z1: 2, y: 0 } };
  return {
    night: 2,
    name: "Đảo Cau",
    duration_key: "night2_duration_s",
    start: [0, 0, 0],
    surfaces: [disc("A", A[0], A[1], 28, 0), disc("B", B[0], B[1], 28, 0), bridge],
    lanterns: [
      { id: "L1", pos: [0, 0, 20] },
      { id: "L2", pos: [17, 0, -10] },
      { id: "L3", pos: [-17, 0, -10] },
      { id: "L4", pos: [70, 0, 20] },
      { id: "L5", pos: [87, 0, -10] },
      { id: "L6", pos: [53, 0, -10] },
    ],
    motePoints: [
      ...ring(A[0], A[1], 10, 4, 0),
      ...ring(A[0], A[1], 22, 8, 0),
      ...ring(B[0], B[1], 10, 4, 0),
      ...ring(B[0], B[1], 22, 8, 0),
    ],
    shadeSpawns: [...ring(A[0], A[1], 26, 8, 22.5), ...ring(B[0], B[1], 26, 8, 22.5)].map((p) => [p[0], p[2]]),
    shadeSpeed: 4,
    shadeMax: 8,
    shadeEveryTicks: 420,
    pads: [
      { pos: [20, 0, 18], radius: 1, vy: 14, speed: 24, dir: unit([20, 18], [70, 0]) },
      { pos: [50, 0, -18], radius: 1, vy: 14, speed: 24, dir: unit([50, -18], [0, 0]) },
    ],
    charms: [{ id: "C1", pos: [35, 0, 0] }],
    windEnabled: false,
    driftersEnabled: true,
    mist: ring(35, 0, 60, 12, 0).map((p) => [p[0], p[2]]),
  };
}

function ramp(name: string, deg: number): Surface {
  const a = (deg * Math.PI) / 180;
  const ux = Math.cos(a);
  const uz = Math.sin(a);
  return {
    name,
    top: (x, z) => {
      const s = x * ux + z * uz; // distance along the ramp
      const perp = Math.abs(-x * uz + z * ux);
      if (perp > 1.5 || s < 24 || s > 30) return null;
      return (3 * (30 - s)) / 6;
    },
    shape: { type: "ramp", deg, s0: 24, s1: 30, width: 3, y0: 3, y1: 0 },
  };
}

function night3(): NightDef {
  return {
    night: 3,
    name: "Đảo Chuông",
    duration_key: "night3_duration_s",
    start: [0, 0, -30], // assumption: the ticket gives no start for this night; (0,0,0) is inside the upper floor
    surfaces: [
      disc("floor0", 0, 0, 45, 0),
      { name: "floor1", top: (x, z) => (z > 0 && Math.hypot(x, z) >= 12 && Math.hypot(x, z) <= 24 ? 3 : null), shape: { type: "halfring", r0: 12, r1: 24, y: 3 } },
      disc("floor2", 0, 0, 8, 6),
      ramp("ramp30", 30),
      ramp("ramp150", 150),
      { name: "tower", solidOnly: true, top: (x, z) => (Math.hypot(x, z) <= 2 ? 14 : null), shape: { type: "tower", r: 2, y0: 6, y1: 14 } },
    ],
    lanterns: [
      { id: "L1", pos: [0, 6, 6] },
      { id: "L2", pos: [18, 3, 10] },
      { id: "L3", pos: [-18, 3, 10] },
      { id: "L4", pos: [35, 0, -10] },
      { id: "L5", pos: [-35, 0, -10] },
      { id: "L6", pos: [20, 0, -35] },
      { id: "L7", pos: [-20, 0, -35] },
    ],
    motePoints: [
      ...ring(0, 0, 34, 18, 0),
      ...Array.from({ length: 8 }, (_, i) => polar(0, 0, 18, 20 * (i + 1), 3)),
      ...[45, 135, 225, 315].map((a) => polar(0, 0, 5, a, 6)),
    ],
    shadeSpawns: ring(0, 0, 43, 16, 0).map((p) => [p[0], p[2]]),
    shadeSpeed: 4.5,
    shadeMax: 10,
    shadeEveryTicks: 360,
    pads: [{ pos: [0, 3, 13], radius: 1, vy: 12, speed: 8, dir: [0, -1] }],
    charms: [
      { id: "C1", pos: [30, 0, 25] },
      { id: "C2", pos: [-30, 0, 25] },
    ],
    windEnabled: true,
    driftersEnabled: true,
    mist: ring(0, 0, 52, 12, 0).map((p) => [p[0], p[2]]),
  };
}

export function nightDef(n: Night): NightDef {
  return n === 1 ? night1() : n === 2 ? night2() : night3();
}

/** Highest top face at (x, z) over all surfaces (cliffs and obstacles included), or null for open air. */
export function topAt(def: NightDef, x: number, z: number): number | null {
  let best: number | null = null;
  for (const s of def.surfaces) {
    const t = s.top(x, z);
    if (t !== null && (best === null || t > best)) best = t;
  }
  return best;
}

/** Highest standable surface at (x, z) whose top is not more than `reach` above `y`; null when there is none. */
export function supportAt(def: NightDef, x: number, z: number, y: number, reach: number): number | null {
  let best: number | null = null;
  for (const s of def.surfaces) {
    if (s.solidOnly) continue;
    const t = s.top(x, z);
    if (t !== null && t <= y + reach && (best === null || t > best)) best = t;
  }
  return best;
}
