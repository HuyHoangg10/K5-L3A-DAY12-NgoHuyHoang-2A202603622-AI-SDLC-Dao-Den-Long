import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { runHeadless } from "../src/headless/run";
import { parseInputs, parseScenario } from "../src/sim/validate";
import type { InputFrame, Scenario } from "../src/sim/types";

export const root = path.resolve(import.meta.dirname, "..");

export interface Line {
  type: "snapshot" | "event" | "end";
  tick?: number;
  name?: string;
  data?: any;
  [k: string]: any;
}

export interface Run {
  raw: string[];
  lines: Line[];
  snaps: Line[];
  events: Line[];
  end: Line;
  snapAt(tick: number): Line;
  eventsNamed(name: string): Line[];
}

export function wrap(raw: string[]): Run {
  const lines = raw.map((l) => JSON.parse(l) as Line);
  const snaps = lines.filter((l) => l.type === "snapshot");
  const events = lines.filter((l) => l.type === "event");
  return {
    raw,
    lines,
    snaps,
    events,
    end: lines[lines.length - 1] as Line,
    snapAt(tick) {
      const s = snaps.find((x) => x.tick === tick);
      if (!s) throw new Error(`no snapshot at tick ${tick}`);
      return s;
    },
    eventsNamed: (name) => events.filter((e) => e.name === name),
  };
}

interface Manifest {
  scenarios: { name: string; night: number; seed: number; ticks: number; snapshot_every: number }[];
}

export function manifestEntry(name: string) {
  const m = JSON.parse(readFileSync(path.join(root, "scenarios/manifest.json"), "utf8")) as Manifest;
  const e = m.scenarios.find((s) => s.name === name);
  if (!e) throw new Error(`scenario ${name} not in manifest`);
  return e;
}

/** Run a scenario folder from scenarios/ in-process (same code path as the CLI). */
export function runNamed(name: string): Run {
  const e = manifestEntry(name);
  const dir = path.join(root, "scenarios", name);
  const sp = path.join(dir, "scenario.json");
  const ip = path.join(dir, "inputs.json");
  return wrap(
    runHeadless({
      seed: e.seed,
      night: e.night as 1 | 2 | 3,
      ticks: e.ticks,
      snapshotEvery: e.snapshot_every,
      scenario: existsSync(sp) ? parseScenario(JSON.parse(readFileSync(sp, "utf8"))) : undefined,
      frames: existsSync(ip) ? parseInputs(JSON.parse(readFileSync(ip, "utf8"))) : undefined,
    }),
  );
}

/** Run an inline scenario (for small variations inside a test). */
export function runInline(o: { seed?: number; night?: 1 | 2 | 3; ticks: number; every?: number; scenario?: Scenario; frames?: InputFrame[] }): Run {
  return wrap(runHeadless({ seed: o.seed ?? 1, night: o.night ?? 1, ticks: o.ticks, snapshotEvery: o.every ?? 1, scenario: o.scenario, frames: o.frames }));
}
