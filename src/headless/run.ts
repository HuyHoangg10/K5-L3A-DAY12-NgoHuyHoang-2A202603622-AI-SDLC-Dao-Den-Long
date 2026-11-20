import { endLine, eventLine, snapshotLine } from "../sim/output";
import { Sim } from "../sim/sim";
import type { InputFrame, Scenario } from "../sim/types";

export interface RunOptions {
  seed: number;
  ticks: number;
  snapshotEvery?: number;
  scenario?: Scenario;
  frames?: InputFrame[];
}

/** Run the sim headless and return the JSONL lines (no file or process access here). */
export function runHeadless(o: RunOptions): string[] {
  const every = o.snapshotEvery ?? 10;
  const frames = o.frames ?? [];
  const sim = new Sim({ seed: o.seed, scenario: o.scenario });
  const lines: string[] = [snapshotLine(sim)]; // tick 0: after scenario setup, before any input
  let fi = 0;
  for (let k = 0; k < o.ticks; k++) {
    while (fi < frames.length && (frames[fi] as InputFrame).tick <= k) {
      sim.applyFrame(frames[fi] as InputFrame);
      fi++;
    }
    if (!sim.step()) break;
    for (const e of sim.events) lines.push(eventLine(e));
    if (sim.steps % every === 0) lines.push(snapshotLine(sim));
    if (sim.state !== "playing") break;
  }
  lines.push(endLine(sim));
  return lines;
}
