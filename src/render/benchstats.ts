// Benchmark numbers exactly as Ticket-04 defines them (pure, tested in tests/bench.test.ts).

export interface BenchStats {
  frames: number;
  avg_fps: number;
  p1_low_fps: number;
  frame_ms_p95: number;
}

const r1 = (x: number): number => Math.round(x * 10) / 10;

/** `dt` is the time of every measured frame in milliseconds. */
export function benchStats(dt: number[]): BenchStats {
  const n = dt.length;
  if (n === 0) return { frames: 0, avg_fps: 0, p1_low_fps: 0, frame_ms_p95: 0 };
  const sum = dt.reduce((a, b) => a + b, 0);
  const sorted = [...dt].sort((a, b) => b - a); // largest first
  const k = Math.max(1, Math.ceil(0.01 * n));
  const worst = sorted.slice(0, k).reduce((a, b) => a + b, 0) / k;
  // 95th percentile (nearest rank): the smallest value with at least 95% of the frames at or below it
  const asc = [...dt].sort((a, b) => a - b);
  const p95 = asc[Math.max(0, Math.ceil(0.95 * n) - 1)] as number;
  return { frames: n, avg_fps: r1((1000 * n) / sum), p1_low_fps: r1(1000 / worst), frame_ms_p95: r1(p95) };
}
