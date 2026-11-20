import type { Sim } from "../sim/sim";
import { CONSTANTS as C, TUNING as T } from "../sim/tuning";

const $ = <E extends HTMLElement>(id: string): E => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el as E;
};

/** DOM overlay: HUD numbers, toasts, hit flash, start and end screens. All text is English. */
export class Hud {
  private toastTimer = 0;
  private flashTimer = 0;
  private flames = $("hud-flames");
  private carried = $("hud-carried");
  private lit = $("hud-lit");
  private score = $("hud-score");
  private time = $("hud-time");
  private glow = $("hud-glow");

  update(sim: Sim): void {
    const f = sim.player.flames;
    this.flames.innerHTML = Array.from({ length: T.flames }, (_, i) => `<span class="${i < f ? "" : "out"}">&#9679;</span>`).join("");
    this.carried.textContent = `${sim.player.carried} / ${T.carry_capacity}`;
    this.lit.textContent = `${sim.litCount} / ${T.lantern_count_night1}`;
    this.score.textContent = String(sim.score);
    const s = Math.ceil(sim.timeLeft);
    this.time.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
    const cd = Math.round(T.pulse_cooldown_s * C.tick_rate);
    const ready = 1 - sim.cooldownLeft / cd;
    this.glow.style.width = `${Math.round(ready * 100)}%`;
    this.glow.style.opacity = sim.player.carried >= T.pulse_cost ? "1" : "0.35";
  }

  toast(msg: string, ms = 1800): void {
    const el = $("toast");
    el.textContent = msg;
    el.classList.add("show");
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => el.classList.remove("show"), ms);
  }

  hitFlash(): void {
    const el = $("flash");
    el.classList.add("on");
    window.clearTimeout(this.flashTimer);
    this.flashTimer = window.setTimeout(() => el.classList.remove("on"), 120);
  }

  hideStart(): void {
    $("start").classList.remove("show");
  }
  startButton(onClick: () => void): void {
    $("start-btn").addEventListener("click", onClick);
    $("end-btn").addEventListener("click", () => this.onAgain());
  }
  onAgain: () => void = () => {};

  showEnd(sim: Sim, reason: string): void {
    const won = sim.state === "won";
    $("end-title").textContent = won ? "The island is bright again!" : "The night won this time";
    $("end-text").textContent = won
      ? "All five lanterns are lit and the mist runs away. Well done, Mây."
      : reason === "dawn"
        ? "Dawn came before the last lantern was lit."
        : "Your flames went out. Shake it off and try again.";
    $("end-score").textContent = String(sim.score);
    const s = Math.floor(sim.timeLeft);
    const rows: [string, string][] = [
      ["Lanterns lit", `${sim.litCount} / ${T.lantern_count_night1}`],
      ["Flames left", String(sim.player.flames)],
      ["Time left", `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`],
    ];
    if (won) {
      rows.push(["Time bonus", String(T.score.per_second_left * s)], ["Flame bonus", String(T.score.per_flame_left * sim.player.flames)]);
    }
    $("end-table").innerHTML = rows.map(([a, b]) => `<tr><td>${a}</td><td>${b}</td></tr>`).join("");
    $("end").classList.add("show");
  }
  hideEnd(): void {
    $("end").classList.remove("show");
  }
}
