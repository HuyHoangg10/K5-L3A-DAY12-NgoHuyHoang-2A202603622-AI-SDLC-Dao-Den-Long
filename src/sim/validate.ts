import type { DrifterState, InputFrame, Scenario, ScenarioCharm, ScenarioDrifter, ScenarioLantern, ScenarioShade, ShadeState, Vec3 } from "./types";

// Thrown for malformed inputs/scenario files. The CLI maps it to exit code 2.
export class FormatError extends Error {}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function vec3(v: unknown, where: string): Vec3 {
  if (!Array.isArray(v) || v.length !== 3 || !v.every(isNum)) {
    throw new FormatError(`${where} must be an array of 3 numbers`);
  }
  return [v[0] as number, v[1] as number, v[2] as number];
}

function num(v: unknown, where: string, min = -Infinity): number {
  if (!isNum(v) || v < min) throw new FormatError(`${where} must be a number >= ${min}`);
  return v;
}

export function parseInputs(raw: unknown): InputFrame[] {
  if (!isObj(raw) || !Array.isArray(raw.frames)) {
    throw new FormatError('inputs must be an object with a "frames" array');
  }
  const out: InputFrame[] = [];
  let last = -1;
  raw.frames.forEach((f: unknown, i: number) => {
    const w = `frames[${i}]`;
    if (!isObj(f)) throw new FormatError(`${w} must be an object`);
    if (!Number.isInteger(f.tick) || (f.tick as number) < 0) {
      throw new FormatError(`${w}.tick must be an integer >= 0`);
    }
    const tick = f.tick as number;
    if (tick <= last) throw new FormatError(`${w}.tick must be strictly greater than the previous frame`);
    last = tick;
    const fr: InputFrame = { tick };
    if (f.move !== undefined) {
      if (!Array.isArray(f.move) || f.move.length !== 2 || !f.move.every(isNum)) {
        throw new FormatError(`${w}.move must be [x, z]`);
      }
      fr.move = [f.move[0] as number, f.move[1] as number];
    }
    if (f.cam_yaw_deg !== undefined) fr.cam_yaw_deg = num(f.cam_yaw_deg, `${w}.cam_yaw_deg`);
    for (const k of ["jump", "interact", "pulse", "dash", "pause"] as const) {
      if (f[k] !== undefined) {
        if (typeof f[k] !== "boolean") throw new FormatError(`${w}.${k} must be a boolean`);
        fr[k] = f[k] as boolean;
      }
    }
    out.push(fr);
  });
  return out;
}

export function parseScenario(raw: unknown): Scenario {
  if (!isObj(raw)) throw new FormatError("scenario must be a JSON object");
  const s: Scenario = {};
  if (raw.player !== undefined) {
    if (!isObj(raw.player)) throw new FormatError("player must be an object");
    const p = raw.player;
    s.player = {};
    if (p.pos !== undefined) s.player.pos = vec3(p.pos, "player.pos");
    if (p.carried !== undefined) s.player.carried = num(p.carried, "player.carried", 0);
    if (p.flames !== undefined) s.player.flames = num(p.flames, "player.flames", 0);
    for (const k of ["invuln_ticks", "dash_cd_ticks", "pulse_cd_ticks", "charm_ticks"] as const) {
      if (p[k] !== undefined) s.player[k] = num(p[k], `player.${k}`, 0);
    }
  }
  for (const k of ["random_motes", "random_shades", "random_drifters", "wind_enabled"] as const) {
    if (raw[k] !== undefined) {
      if (typeof raw[k] !== "boolean") throw new FormatError(`${k} must be a boolean`);
      s[k] = raw[k] as boolean;
    }
  }
  if (raw.motes !== undefined) {
    if (!Array.isArray(raw.motes)) throw new FormatError("motes must be an array");
    s.motes = raw.motes.map((m, i) => vec3(m, `motes[${i}]`));
  }
  if (raw.shades !== undefined) {
    if (!Array.isArray(raw.shades)) throw new FormatError("shades must be an array");
    s.shades = raw.shades.map((sh: unknown, i: number) => {
      if (!isObj(sh)) throw new FormatError(`shades[${i}] must be an object`);
      const out: ScenarioShade = { pos: vec3(sh.pos, `shades[${i}].pos`) };
      if (sh.id !== undefined) {
        if (typeof sh.id !== "string") throw new FormatError(`shades[${i}].id must be a string`);
        out.id = sh.id;
      }
      if (sh.state !== undefined) {
        if (!["spawning", "wander", "chase", "recoil", "stunned"].includes(sh.state as string)) throw new FormatError(`shades[${i}].state is not a known state`);
        out.state = sh.state as ShadeState;
      }
      if (sh.state_ticks_left !== undefined) out.state_ticks_left = num(sh.state_ticks_left, `shades[${i}].state_ticks_left`, 0);
      return out;
    });
  }
  if (raw.drifters !== undefined) {
    if (!Array.isArray(raw.drifters)) throw new FormatError("drifters must be an array");
    s.drifters = raw.drifters.map((d: unknown, i: number) => {
      if (!isObj(d)) throw new FormatError(`drifters[${i}] must be an object`);
      const out: ScenarioDrifter = { pos: vec3(d.pos, `drifters[${i}].pos`) };
      if (d.id !== undefined) {
        if (typeof d.id !== "string") throw new FormatError(`drifters[${i}].id must be a string`);
        out.id = d.id;
      }
      if (d.state !== undefined) {
        if (!["idle", "chase", "flee"].includes(d.state as string)) throw new FormatError(`drifters[${i}].state is not a known state`);
        out.state = d.state as DrifterState;
      }
      if (d.stolen !== undefined) out.stolen = num(d.stolen, `drifters[${i}].stolen`, 0);
      return out;
    });
  }
  if (raw.charms !== undefined) {
    if (!Array.isArray(raw.charms)) throw new FormatError("charms must be an array");
    s.charms = raw.charms.map((c: unknown, i: number) => {
      if (!isObj(c) || typeof c.id !== "string") throw new FormatError(`charms[${i}] needs a string id`);
      const out: ScenarioCharm = { id: c.id };
      if (c.pos !== undefined) out.pos = vec3(c.pos, `charms[${i}].pos`);
      if (c.available !== undefined) {
        if (typeof c.available !== "boolean") throw new FormatError(`charms[${i}].available must be a boolean`);
        out.available = c.available;
      }
      if (c.respawn_ticks !== undefined) out.respawn_ticks = num(c.respawn_ticks, `charms[${i}].respawn_ticks`, 0);
      return out;
    });
  }
  if (raw.lanterns !== undefined) {
    if (!Array.isArray(raw.lanterns)) throw new FormatError("lanterns must be an array");
    s.lanterns = raw.lanterns.map((l: unknown, i: number) => {
      if (!isObj(l) || typeof l.id !== "string") throw new FormatError(`lanterns[${i}] needs a string id`);
      const out: ScenarioLantern = { id: l.id };
      if (l.pos !== undefined) out.pos = vec3(l.pos, `lanterns[${i}].pos`);
      if (l.deposited !== undefined) out.deposited = num(l.deposited, `lanterns[${i}].deposited`, 0);
      if (l.lit !== undefined) {
        if (typeof l.lit !== "boolean") throw new FormatError(`lanterns[${i}].lit must be a boolean`);
        out.lit = l.lit;
      }
      return out;
    });
  }
  if (raw.time_left_s !== undefined) s.time_left_s = num(raw.time_left_s, "time_left_s", 0);
  return s;
}
