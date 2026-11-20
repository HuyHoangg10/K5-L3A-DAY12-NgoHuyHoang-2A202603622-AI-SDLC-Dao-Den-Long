import { Sim } from "../src/sim/sim";
import type { KitBase, KitEvent, SkillKey } from "../src/extras/kit";
import type { Scenario } from "../src/sim/types";

export function setup<K extends KitBase>(make: (s: Sim) => K, scn: Scenario = {}, seed = 1) {
  const sim = new Sim({ seed, scenario: { random_motes: false, random_shades: false, ...scn } });
  return { sim, kit: make(sim) };
}

/** Step sim and kit together. `press[t]` = skill keys pressed at tick t. `aim` is the mouse point on the ground. */
export function run(
  sim: Sim,
  kit: KitBase,
  ticks: number,
  press: Record<number, SkillKey[]> = {},
  aim: [number, number] | null = null,
  cam = 0,
  onTick?: (t: number) => void,
): KitEvent[] {
  const out: KitEvent[] = [];
  for (let t = 0; t < ticks; t++) {
    onTick?.(t);
    sim.step();
    const pressed = { q: false, w: false, e: false, r: false };
    for (const k of press[t] ?? []) pressed[k] = true;
    out.push(...kit.tick({ pressed, camYawDeg: cam, aim }));
  }
  return out;
}

export const names = (ev: KitEvent[]) => ev.map((e) => e.name);
export const moveInput = (move: [number, number]) => ({ move, camYawDeg: 0, jump: false, interact: false, pulse: false, dash: false, pause: false });
/** Freeze a shade in place so tests can aim at a fixed target. */
export const freeze = (sim: Sim) => sim.shades.forEach((s) => (s.stunTicks = 100000));
/** Reach a protected member of a kit (test hook only). */
export const poke = (k: KitBase): any => k as unknown as Record<string, unknown>;
