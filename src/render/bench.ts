import { Rng } from "../sim/rng";
import { Sim } from "../sim/sim";
import { DT } from "../sim/tuning";
import type { Scenario } from "../sim/types";
import { benchStats } from "./benchstats";
import { View } from "./view";

/**
 * Benchmark scene of Ticket-04 (`?bench=1&seed=42&duration=30`, started by `scripts/bench.mjs`).
 * Night 1, 1280x720, 200 shades in `wander`, 100 fireflies, L1-L3 lit with 100 fuel; no spawns, damage, pickups, fuel decay
 * or end of night (Sim option `bench`). Mây stands at (0,0,0) with no input. Camera: circle of radius 30 at height 15,
 * counter-clockwise seen from above, one lap per 15 s, 3 s warm-up, then exactly `duration` s measured.
 * My extras (champions, kit effects) are not created here, so only the standard scene is measured.
 */
export class Bench {
  private view: View;
  private sim: Sim;
  private info = document.getElementById("benchinfo") as HTMLElement;
  private t0 = 0;
  private last = 0;
  private acc = 0;
  private dts: number[] = [];
  private peakHeap: number | null = null;
  private loadMs = 0;
  private done = false;

  constructor(
    host: HTMLElement,
    private seed: number,
    private duration: number,
  ) {
    for (const id of ["start", "intro", "pause", "settings", "end", "board"]) document.getElementById(id)?.classList.remove("show");
    for (const id of ["hud-left", "hud-top", "hud-right", "hud-lanterns", "hud-bottom", "hud-cd", "help", "hint", "arrow", "wind", "toast", "cues"]) {
      const el = document.getElementById(id);
      if (el) el.style.display = "none";
    }
    this.view = new View(host);
    if (new URLSearchParams(window.location.search).get("aura") === "0") this.view.setShadeAura(false); // diagnostics: not used by the official run
    this.view.fixedSize = [1280, 720];
    this.view.resize();
    const rng = new Rng(seed);
    const shades: NonNullable<Scenario["shades"]> = [];
    for (let i = 1; i <= 200; i++) {
      const a = rng.next() * Math.PI * 2;
      const r = Math.sqrt(rng.next()) * 36; // spread over the island (radius 40)
      shades.push({ id: `S${i}`, pos: [Math.cos(a) * r, 1, Math.sin(a) * r], state: "wander" });
    }
    const motes: [number, number, number][] = [];
    for (let i = 0; i < 100; i++) {
      const a = rng.next() * Math.PI * 2;
      const r = Math.sqrt(rng.next()) * 38;
      motes.push([Math.cos(a) * r, 0, Math.sin(a) * r]);
    }
    const scenario: Scenario = {
      random_motes: false,
      random_shades: false,
      random_drifters: false,
      wind_enabled: false,
      player: { pos: [0, 0, 0] },
      lanterns: [1, 2, 3].map((n) => ({ id: `L${n}`, lit: true, fuel: 100 })),
      shades,
      motes,
    };
    this.sim = new Sim({ seed, night: 1, scenario, bench: true });
    this.view.setNight(this.sim);
    this.view.orbit = { radius: 30, height: 15, angle: 0, cx: 0, cz: 0 };
    this.info.style.display = "block";
    requestAnimationFrame((now) => this.frame(now));
  }

  private frame(now: number): void {
    if (this.done) return;
    if (this.t0 === 0) {
      this.t0 = now;
      this.last = now;
      this.loadMs = Math.round(performance.now()); // time since navigation start, up to the first frame of the scene
    }
    const dtMs = now - this.last;
    this.last = now;
    const elapsed = (now - this.t0) / 1000;
    this.acc += Math.min(0.1, dtMs / 1000);
    while (this.acc >= DT) {
      this.sim.step();
      this.acc -= DT;
    }
    this.view.orbit!.angle = (2 * Math.PI * elapsed) / 15;
    this.view.update(this.sim, dtMs / 1000, 0);
    this.view.render();
    const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
    if (mem) this.peakHeap = Math.max(this.peakHeap ?? 0, mem.usedJSHeapSize);
    if (elapsed >= 3 && dtMs > 0 && this.t0 !== now) this.dts.push(dtMs);
    this.info.textContent = elapsed < 3 ? `warm-up ${elapsed.toFixed(1)} / 3 s` : `measuring ${Math.min(this.duration, elapsed - 3).toFixed(1)} / ${this.duration} s`;
    if (elapsed >= 3 + this.duration) {
      this.finish();
      return;
    }
    requestAnimationFrame((t) => this.frame(t));
  }

  private finish(): void {
    this.done = true;
    const gl = this.view.renderer.getContext();
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    const gpu = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : "unknown GPU";
    const result = {
      ...benchStats(this.dts),
      load_ms: this.loadMs,
      peak_mem_mb: this.peakHeap === null ? null : Math.round(this.peakHeap / 1048576),
      renderer: `three.js r187 (WebGL2) on ${gpu}`,
      seed: this.seed,
      duration_s: this.duration,
      viewport: [this.view.renderer.domElement.width, this.view.renderer.domElement.height],
      heap_note: "peak_mem_mb is the JavaScript heap of the page (performance.memory), not the whole browser process",
      user_agent: navigator.userAgent,
    };
    this.info.textContent = `done: ${result.avg_fps} fps avg, ${result.p1_low_fps} fps 1% low`;
    (window as unknown as { __bench: unknown }).__bench = result;
    void fetch("/api/bench", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(result) }).catch(() => {});
  }
}
