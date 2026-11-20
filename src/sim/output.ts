import type { Sim } from "./sim";
import type { Vec3 } from "./types";

/** Round to 3 decimals (and avoid "-0"). */
export function r3(n: number): number {
  const v = Math.round(n * 1000) / 1000;
  return v === 0 ? 0 : v;
}
const vec = (p: Vec3): Vec3 => [r3(p[0]), r3(p[1]), r3(p[2])];

export function snapshotLine(sim: Sim): string {
  const P = sim.player;
  return JSON.stringify({
    type: "snapshot",
    tick: sim.tick,
    sim_tick: sim.simTick,
    state: sim.state,
    night: sim.night,
    time_left_s: r3(sim.timeLeft),
    score: sim.score,
    wind: { active: sim.windActive, dir_deg: r3(sim.windDirDeg) },
    player: {
      pos: vec(P.pos),
      flames: P.flames,
      carried: P.carried,
      vel: vec(P.vel),
      grounded: P.grounded,
      invuln: P.invuln > 0,
      dash_cd_s: r3(P.dashCd / 60),
      pulse_cd_s: r3(P.pulseCd / 60),
      charm_s: r3(P.charm / 60),
    },
    lanterns: sim.lanterns.map((l) => ({ id: l.id, pos: vec(l.pos), lit: l.lit, deposited: l.deposited })),
    shades: sim.shades.map((s) => ({ id: s.id, pos: vec(s.pos), state: sim.shadeState(s) })),
    motes_active: sim.motes.length,
    motes: sim.motes.map((m) => ({ id: m.id, pos: vec(m.pos), kind: m.kind, ttl_s: m.ttl === null ? null : r3(m.ttl / 60) })),
    drifters: sim.drifters.map((d) => ({ id: d.id, pos: vec(d.pos), state: d.state, stolen: d.stolen })),
    charms: sim.charms.map((c) => ({ id: c.id, available: c.available, respawn_s: r3(c.respawn / 60) })),
  });
}

export function eventLine(e: { tick: number; name: string; data: Record<string, unknown> }): string {
  return JSON.stringify({ type: "event", tick: e.tick, name: e.name, data: e.data });
}

export function endLine(sim: Sim): string {
  return JSON.stringify({ type: "end", ticks: sim.tick, state: sim.state, score: sim.score });
}
