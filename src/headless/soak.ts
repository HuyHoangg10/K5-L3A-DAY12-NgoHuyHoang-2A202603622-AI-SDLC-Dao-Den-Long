// Soak test: `node dist/headless/soak.js --seed 7 --nights 10 --out soak.json`
// Runs N nights in a row in this one process (night 1 -> 2 -> 3, cycling), with random inputs from the seed,
// and reports crashes and memory (RSS) growth. Exit code 0 even when a night crashed (the file says so).
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Night } from "../sim/maps";
import { Rng } from "../sim/rng";
import { Sim } from "../sim/sim";
import type { FrameInput } from "../sim/types";

export interface SoakResult {
  nights: number;
  crashes: number;
  results: string[];
  mem_start_mb: number;
  mem_end_mb: number;
  duration_s: number;
}

const mb = () => Math.round((process.memoryUsage().rss / 1048576) * 10) / 10;

/** Play one night with random inputs. Returns "won" / "lost" / "crash". */
export function playNight(night: Night, seed: number, sim?: Sim): string {
  const rng = new Rng(seed ^ 0x5bd1e995);
  const s = sim ?? new Sim({ seed, night });
  const input: FrameInput = { move: [0, 0], camYawDeg: 0, jump: false, interact: false, pulse: false, dash: false, pause: false };
  let guard = 0;
  while (s.status === "playing" && guard++ < 40000) {
    if (s.simTick % 30 === 0) {
      // every 30 ticks pick a new direction
      const a = rng.next() * Math.PI * 2;
      input.move = [Math.cos(a), Math.sin(a)];
    }
    input.jump = rng.next() < 0.05;
    input.dash = rng.next() < 0.03;
    input.pulse = rng.next() < 0.02;
    input.interact = rng.next() < 0.1;
    s.setInput(input);
    s.step();
  }
  return s.status === "playing" ? "lost" : s.status;
}

export function soak(seed: number, nights: number): SoakResult {
  const t0 = Date.now();
  const results: string[] = [];
  let crashes = 0;
  let memStart = 0;
  // Warm-up: a short run on a throw-away sim so that the engine's own start-up cost (JIT, heap pages) is not counted as
  // a "leak" between the first and the last night. It uses no seed of the soak and its result is not reported.
  playNight(1, 0, new Sim({ seed: 0, night: 1, scenario: { time_left_s: 20 } }));
  for (let i = 1; i <= nights; i++) {
    const night = ((((i - 1) % 3) + 1) as Night);
    try {
      const sim = new Sim({ seed: seed + i, night });
      if (i === 1) {
        (globalThis as { gc?: () => void }).gc?.(); // only when started with --expose-gc: measure live memory, not garbage
        memStart = mb();
      }
      results.push(playNight(night, seed + i, sim));
    } catch (e) {
      crashes++;
      results.push("crash");
      process.stderr.write(`night ${i} crashed: ${(e as Error).stack}\n`);
    }
  }
  (globalThis as { gc?: () => void }).gc?.(); // only when started with --expose-gc
  return { nights, crashes, results, mem_start_mb: memStart, mem_end_mb: mb(), duration_s: Math.round(((Date.now() - t0) / 1000) * 10) / 10 };
}

function main(): number {
  const a = process.argv.slice(2);
  const get = (k: string) => {
    const i = a.indexOf(`--${k}`);
    return i >= 0 ? a[i + 1] : undefined;
  };
  const seed = Number(get("seed"));
  const nights = Number(get("nights"));
  const out = get("out");
  if (!Number.isInteger(seed) || !Number.isInteger(nights) || nights < 1 || !out) {
    process.stderr.write("usage: soak --seed <int> --nights <int> --out <file.json>\n");
    return 1;
  }
  const r = soak(seed, nights);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(r) + "\n");
  return 0;
}

if (process.argv[1] && /soak\.(js|ts)$/.test(process.argv[1].replace(/\\/g, "/"))) process.exitCode = main();
