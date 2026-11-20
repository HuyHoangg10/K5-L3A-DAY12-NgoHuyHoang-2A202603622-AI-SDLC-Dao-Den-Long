import type { Sim } from "./sim";
import type { Vec3 } from "./types";

/** Round to 3 decimals (and avoid "-0"). */
export function r3(n: number): number {
  const v = Math.round(n * 1000) / 1000;
  return v === 0 ? 0 : v;
}
const vec = (p: Vec3): Vec3 => [r3(p[0]), r3(p[1]), r3(p[2])];

export function snapshotLine(sim: Sim): string {
  return JSON.stringify({
    type: "snapshot",
    tick: sim.steps,
    sim_tick: sim.steps,
    state: sim.state,
    time_left_s: r3(sim.timeLeft),
    score: sim.score,
    player: { pos: vec(sim.player.pos), flames: sim.player.flames, carried: sim.player.carried },
    lanterns: sim.lanterns.map((l) => ({ id: l.id, pos: vec(l.pos), lit: l.lit, deposited: l.deposited })),
    shades: sim.shades.map((s) => ({ id: s.id, pos: vec(s.pos), state: sim.shadeState(s) })),
    motes_active: sim.motes.length,
    motes: sim.motes.map((m) => ({ id: m.id, pos: vec(m.pos) })),
  });
}

export function eventLine(e: { tick: number; name: string; data: Record<string, unknown> }): string {
  return JSON.stringify({ type: "event", tick: e.tick, name: e.name, data: e.data });
}

export function endLine(sim: Sim): string {
  return JSON.stringify({ type: "end", ticks: sim.steps, state: sim.state, score: sim.score });
}
