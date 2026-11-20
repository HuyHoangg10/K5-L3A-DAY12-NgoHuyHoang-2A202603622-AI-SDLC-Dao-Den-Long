import type { Sim } from "../sim/sim";
import { CONSTANTS as C, TUNING as T } from "../sim/tuning";
import type { Settings } from "./settings";

const $ = <E extends HTMLElement>(id: string): E => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el as E;
};

export const NIGHTS = [
  { name: "Harbour Island (Đảo Bến)", text: "A round island with five big lanterns. The mist is thick, but the fireflies are close.", quote: "\"Easy does it, little keeper. A lamp lit slowly burns longest.\" - Ông Đăng" },
  { name: "Areca Island (Đảo Cau)", text: "Two islands joined by a bamboo bridge. Step on the glowing pads to be thrown across. Grey Drifters steal fireflies from anyone who carries many.", quote: "\"Do not carry all your light in one hand. The drifters love a full hand.\" - Ông Đăng" },
  { name: "Bell Island (Đảo Chuông)", text: "Three floors, a bell tower, a gusting wind. Use the ramps and the pad in the middle to reach the top.", quote: "\"When the wind leans on you, lean back. Dawn is not far.\" - Ông Đăng" },
];

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s) % 60).padStart(2, "0")}`;

/** DOM overlay: HUD numbers, toasts, hit flash and every menu screen. All text is English. */
export class Hud {
  private toastTimer = 0;
  private flashTimer = 0;
  private cells = $("hud-cells");
  private lastCapacity = -1;

  constructor() {
    this.setCapacity(T.carry_capacity);
  }

  private setCapacity(n: number): void {
    if (n === this.lastCapacity) return;
    this.lastCapacity = n;
    this.cells.innerHTML = Array.from({ length: n }, () => "<i></i>").join("");
  }

  /** `project` turns a world point into screen pixels (and says if it is in front of the camera). */
  update(sim: Sim, nightNo: number, total: number, defaultMode: boolean, project: (x: number, y: number, z: number) => { x: number; y: number; ok: boolean }): void {
    const P = sim.player;
    $("hud-flames").innerHTML = Array.from({ length: T.flames }, (_, i) => `<span class="${i < P.flames ? "" : "out"}">&#9679;</span>`).join("");
    $("hud-night").textContent = `${nightNo} / 3`;
    const top = $("hud-top");
    top.textContent = mmss(Math.ceil(sim.timeLeft));
    top.classList.toggle("low", sim.timeLeft <= 30);
    $("hud-lit").textContent = `${sim.litCount} / ${sim.lanterns.length}`;
    $("hud-score").textContent = String(total + sim.score);
    this.setCapacity(sim.capacity);
    [...this.cells.children].forEach((c, i) => c.classList.toggle("on", i < P.carried));
    $("hud-carried").textContent = `${P.carried} / ${sim.capacity}`;
    this.cooldown("cd-dash", P.dashCd, C.dash_cooldown_ticks, false);
    this.cooldown("cd-pulse", P.pulseCd, Math.round(T.pulse_cooldown_s * C.tick_rate), P.carried < T.pulse_cost);
    $("cd-pulse-key").innerHTML = defaultMode ? "<kbd>Q</kbd>" : "<kbd>D</kbd>";
    $("help").textContent = defaultMode
      ? "Right-click walk · Space jump · Shift dash · Q glow (3 fireflies) · E put fireflies in a lantern · drag to turn camera · Esc pause"
      : "Right-click walk · Space jump · Shift dash · D glow · F lantern · Q W E R champion skills · drag to turn camera · Esc pause";

    // "E - Put light in the lantern (x/10)" near an unlit lantern, arrow to the nearest unlit one when it is off screen
    let nearest: { id: string; d: number; pos: number[]; dep: number } | null = null;
    for (const l of sim.lanterns) {
      if (l.lit) continue;
      const d = Math.hypot(l.pos[0] - P.pos[0], l.pos[2] - P.pos[2]);
      if (!nearest || d < nearest.d) nearest = { id: l.id, d, pos: l.pos, dep: l.deposited };
    }
    const hint = $("hint");
    if (nearest && nearest.d <= T.interact_radius && P.carried > 0) {
      hint.style.display = "block";
      hint.innerHTML = `<kbd>${defaultMode ? "E" : "F"}</kbd> Put light in the lantern (${nearest.dep}/${T.lantern_cost})`;
    } else hint.style.display = "none";
    const arrow = $("arrow");
    if (nearest) {
      const [nx0, ny0, nz0] = nearest.pos as [number, number, number];
      const s = project(nx0, ny0 + 3, nz0);
      const off = !s.ok || s.x < 0 || s.x > window.innerWidth || s.y < 0 || s.y > window.innerHeight;
      if (off) {
        const cx = window.innerWidth / 2;
        const cy = window.innerHeight / 2;
        let dx = s.x - cx;
        let dy = s.y - cy;
        if (!s.ok) {
          dx = -dx;
          dy = -dy;
        }
        const k = Math.min((cx - 50) / Math.abs(dx || 1), (cy - 50) / Math.abs(dy || 1));
        arrow.style.display = "block";
        arrow.style.left = `${cx + dx * k}px`;
        arrow.style.top = `${cy + dy * k}px`;
        arrow.style.transform = `rotate(${Math.atan2(dy, dx)}rad)`;
      } else arrow.style.display = "none";
    } else arrow.style.display = "none";

    const wind = $("wind");
    if (sim.windActive || sim.windWarning) {
      wind.style.display = "block";
      wind.textContent = sim.windActive ? "Strong wind!" : "Wind is coming...";
    } else wind.style.display = "none";
  }

  private cooldown(id: string, left: number, total: number, off: boolean): void {
    const el = $(id);
    (el.querySelector(".f") as HTMLElement).style.height = `${Math.round(Math.min(1, left / total) * 100)}%`;
    el.classList.toggle("ready", left === 0 && !off);
    el.classList.toggle("off", off);
  }

  showHud(v: boolean): void {
    for (const id of ["hud-left", "hud-top", "hud-right", "hud-bottom", "hud-cd", "help"]) $(id).style.display = v ? "" : "none";
    if (!v) {
      $("hint").style.display = "none";
      $("arrow").style.display = "none";
      $("wind").style.display = "none";
    }
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

  // ---- overlays -------------------------------------------------------------------------------------
  show(id: "start" | "intro" | "pause" | "settings" | "end", v: boolean): void {
    $(id).classList.toggle("show", v);
  }
  isShown(id: string): boolean {
    return $(id).classList.contains("show");
  }

  showIntro(night: number): void {
    const n = NIGHTS[night - 1] ?? NIGHTS[0]!;
    $("intro-night").textContent = `Night ${night} of 3`;
    $("intro-title").textContent = n.name;
    $("intro-text").textContent = n.text;
    $("intro-quote").textContent = n.quote;
    this.show("intro", true);
  }

  /** Result of a night: `total` is the score of the nights won before this one. */
  showResult(sim: Sim, reason: string, nightNo: number, total: number): void {
    const won = sim.state === "won";
    const last = nightNo === 3;
    const s = Math.floor(sim.timeLeft);
    $("end-title").textContent = won ? (last ? "Dawn has come!" : `Night ${nightNo} is lit!`) : "The night won this time";
    $("end-text").textContent = won
      ? last
        ? "All three nights are lit and the mist runs away over the clouds. Well done, lamp keeper."
        : "The island glows again. Ông Đăng is waiting with the next lantern list."
      : reason === "dawn"
        ? "Dawn came before the last lantern was lit."
        : "Your flames went out. Shake it off and try this night again.";
    $("end-score").textContent = String(won ? total + sim.score : total + sim.score);
    const rows: [string, string][] = [
      ["Lanterns lit", `${sim.litCount} / ${sim.lanterns.length}`],
      ["Flames left", String(P(sim).flames)],
      ["Time left", mmss(s)],
    ];
    if (won) rows.push(["Time bonus", String(T.score.per_second_left * s)], ["Flame bonus", String(T.score.per_flame_left * P(sim).flames)], ["This night", String(sim.score)]);
    if (won && last) rows.push(["Total", String(total + sim.score)]);
    $("end-table").innerHTML = rows.map(([a, b]) => `<tr><td>${a}</td><td>${b}</td></tr>`).join("");
    $("end-btn").textContent = won ? (last ? "Back to menu (Enter)" : "Next night (Enter)") : "Try the night again (Enter)";
    this.show("end", true);
  }

  // ---- wiring ---------------------------------------------------------------------------------------
  on(id: string, fn: () => void): void {
    $(id).addEventListener("click", fn);
  }

  settingsUI(s: Settings, onChange: (s: Settings) => void): void {
    const vol = $<HTMLInputElement>("set-volume");
    const sens = $<HTMLInputElement>("set-sens");
    const cb = $<HTMLInputElement>("set-cb");
    vol.value = String(s.volume);
    sens.value = String(s.sensitivity);
    cb.checked = s.colorBlind;
    const push = () => onChange({ volume: Number(vol.value), sensitivity: Number(sens.value), colorBlind: cb.checked });
    vol.addEventListener("input", push);
    sens.addEventListener("input", push);
    cb.addEventListener("change", push);
  }
}

const P = (sim: Sim) => sim.player;
