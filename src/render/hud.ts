import type { Sim } from "../sim/sim";
import { CONSTANTS as C, TUNING as T } from "../sim/tuning";
import type { InputState } from "./input";
import { ACTIONS, ACTION_LABEL, DEFAULT_BINDINGS, conflictFor, keyLabel, type Action, type Settings } from "./settings";

const $ = <E extends HTMLElement>(id: string): E => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el as E;
};

export const NIGHTS = [
  { name: "Harbour Island (Đảo Bến)", text: "A round island with five big lanterns. The mist is thick, but the fireflies are close. Lanterns burn down: feed them, and keep at least 3 of 5 lit until dawn.", quote: "\"Easy does it, little keeper. A lamp lit slowly burns longest.\" - Ông Đăng" },
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
  update(sim: Sim, nightNo: number, total: number, defaultMode: boolean, project: (x: number, y: number, z: number) => { x: number; y: number; ok: boolean }, keys: Record<Action, string>): void {
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
    const kp = defaultMode ? keyLabel(keys.pulse) : "D";
    const ki = defaultMode ? keyLabel(keys.interact) : "F";
    $("cd-pulse-key").innerHTML = `<kbd>${kp}</kbd>`;
    $("cd-dash-key").innerHTML = `<kbd>${keyLabel(keys.dash)}</kbd>`;
    $("help").textContent = defaultMode
      ? `Right-click walk · ${keyLabel(keys.jump)} jump · ${keyLabel(keys.dash)} dash · ${kp} glow (3 fireflies) · ${ki} feed a lantern · Esc pause`
      : `Right-click walk · ${keyLabel(keys.jump)} jump · ${keyLabel(keys.dash)} dash · D glow · F feed a lantern · Q W E R skills · Esc pause`;

    // one line per lantern: fuel bar, number; below 30 it turns red, blinks and shows a warning sign (not only a colour)
    const lan = $("hud-lanterns");
    lan.innerHTML = sim.lanterns
      .map((l) => {
        const fuel = l.fuel60 / C.fuel_units;
        const low = l.lit && fuel < T.low_fuel_threshold;
        const need = l.everLit ? T.relight_cost : T.lantern_cost;
        if (!l.lit) return `<div class="lan off"><span>${l.id}</span><span class="bar"><i style="width:${Math.round((l.deposited / need) * 100)}%"></i></span><b>${l.deposited}/${need}</b></div>`;
        return `<div class="lan${low ? " low" : ""}"><span>${l.id}</span><span class="bar"><i style="width:${Math.round(Math.min(1, fuel / T.fuel_max) * 100)}%"></i></span><b>${low ? "&#9888; " : ""}${Math.floor(fuel)}</b></div>`;
      })
      .join("");

    // hint near a lantern that takes fireflies: unlit (put light in) or lit but not full (refuel)
    let near: { l: (typeof sim.lanterns)[number]; d: number } | null = null;
    let needy: { pos: number[]; d: number } | null = null; // nearest lantern that is out or weak: the arrow points at it
    for (const l of sim.lanterns) {
      const d = Math.hypot(l.pos[0] - P.pos[0], l.pos[2] - P.pos[2]);
      const full = l.lit && l.fuel60 >= T.fuel_max * C.fuel_units;
      if (!full && d < (near?.d ?? Infinity)) near = { l, d };
      const weak = !l.lit || l.fuel60 < T.low_fuel_threshold * C.fuel_units;
      if (weak && d < (needy?.d ?? Infinity)) needy = { pos: l.pos, d };
    }
    const hint = $("hint");
    if (near && near.d <= T.interact_radius && P.carried > 0) {
      hint.style.display = "block";
      const l = near.l;
      hint.innerHTML = l.lit
        ? `<kbd>${ki}</kbd> Refuel the lantern (${Math.floor(l.fuel60 / C.fuel_units)} / ${T.fuel_max})`
        : `<kbd>${ki}</kbd> Put light in the lantern (${l.deposited}/${l.everLit ? T.relight_cost : T.lantern_cost})`;
    } else hint.style.display = "none";
    const arrow = $("arrow");
    if (needy) {
      const [nx0, ny0, nz0] = needy.pos as [number, number, number];
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
    for (const id of ["hud-left", "hud-top", "hud-right", "hud-lanterns", "hud-bottom", "hud-cd", "help"]) $(id).style.display = v ? "" : "none";
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
  show(id: "start" | "intro" | "pause" | "settings" | "end" | "board", v: boolean): void {
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
    const need = Math.ceil(T.win_ratio * sim.lanterns.length - 1e-9);
    $("end-title").textContent = won ? (last ? "Dawn has come!" : `Night ${nightNo} is lit!`) : "The night won this time";
    $("end-text").textContent = won
      ? last
        ? "All three nights are lit and the mist runs away over the clouds. Well done, lamp keeper."
        : "The island glows again. Ông Đăng is waiting with the next lantern list."
      : reason === "dawn"
        ? `Dawn came with fewer than ${need} lanterns lit.`
        : "Your flames went out. Shake it off and try this night again.";
    $("end-score").textContent = String(total + sim.score);
    const lanternBonus = sim.lanterns.filter((l) => l.lit).reduce((a, l) => a + C.dawn_lantern_score + Math.floor(l.fuel60 / C.fuel_units), 0);
    const rows: [string, string][] = [
      ["Lanterns lit", `${sim.litCount} / ${sim.lanterns.length} (need ${need})`],
      ["Flames left", String(sim.player.flames)],
    ];
    if (won) rows.push(["Lantern bonus", String(lanternBonus)], ["Flame bonus", String(T.score.per_flame_left * sim.player.flames)], ["This night", String(sim.score)]);
    $("end-table").innerHTML = rows.map(([a, b]) => `<tr><td>${a}</td><td>${b}</td></tr>`).join("");
    $("end-btn").textContent = won ? (last ? "Back to menu (Enter)" : "Next night (Enter)") : "Try the night again (Enter)";
    this.show("end", true);
  }

  /** Show the name form of the end card (only when the whole run is over). */
  showNameForm(v: boolean, name: string): void {
    $("nameform").style.display = v ? "" : "none";
    $<HTMLInputElement>("name-input").value = name;
    $("name-msg").textContent = "";
    $<HTMLButtonElement>("name-save").disabled = false;
  }
  nameValue(): string {
    return $<HTMLInputElement>("name-input").value.trim();
  }
  nameMessage(msg: string, saved = false): void {
    $("name-msg").textContent = msg;
    $<HTMLButtonElement>("name-save").disabled = saved;
  }
  nameFocused(): boolean {
    return document.activeElement === $("name-input");
  }

  /** Fill the leaderboard table. */
  showBoard(rows: { name: string; score: number; nights_won: number; achieved_at: string }[], note: string): void {
    const head = "<tr><th>#</th><th>Name</th><th>Score</th><th>Nights</th><th>Date</th></tr>";
    $("board-table").innerHTML = rows.length
      ? head + rows.map((r, i) => `<tr><td>${i + 1}</td><td>${r.name}</td><td>${r.score}</td><td>${r.nights_won}/3</td><td style="color:inherit">${r.achieved_at.slice(0, 10)}</td></tr>`).join("")
      : "<tr><td style=\"text-align:center\">No scores yet. Light some lanterns!</td></tr>";
    $("board-note").textContent = note;
    this.show("board", true);
  }

  // ---- wiring ---------------------------------------------------------------------------------------
  on(id: string, fn: () => void): void {
    $(id).addEventListener("click", fn);
  }

  settingsUI(s: Settings, input: InputState, onChange: (s: Settings) => void): void {
    let cur = s;
    const vol = $<HTMLInputElement>("set-volume");
    const sens = $<HTMLInputElement>("set-sens");
    const cb = $<HTMLInputElement>("set-cb");
    const rm = $<HTMLInputElement>("set-rm");
    const big = $<HTMLInputElement>("set-big");
    const sub = $<HTMLInputElement>("set-sub");
    vol.value = String(s.volume);
    sens.value = String(s.sensitivity);
    cb.checked = s.colorBlind;
    rm.checked = s.reduceMotion;
    big.checked = s.largeText;
    sub.checked = s.subtitles;
    const commit = (n: Settings) => {
      cur = n;
      onChange(n);
    };
    const push = () => commit({ ...cur, volume: Number(vol.value), sensitivity: Number(sens.value), colorBlind: cb.checked, reduceMotion: rm.checked, largeText: big.checked, subtitles: sub.checked });
    for (const el of [vol, sens]) el.addEventListener("input", push);
    for (const el of [cb, rm, big, sub]) el.addEventListener("change", push);

    const warn = $("key-warn");
    const draw = () => {
      $("keys").innerHTML = ACTIONS.map((a) => `<div class="krow"><span>${ACTION_LABEL[a]}</span><button class="ghost" data-a="${a}">${keyLabel(cur.bindings[a])}</button></div>`).join("");
      $("keys").querySelectorAll("button").forEach((btn) =>
        btn.addEventListener("click", () => {
          const a = (btn as HTMLElement).dataset.a as Action;
          warn.textContent = "";
          btn.textContent = "Press a key...";
          input.captureNextKey((k) => {
            if (k === "escape") return draw();
            const other = conflictFor(cur.bindings, a, k);
            if (other) {
              // a duplicate is refused and explained; the old key stays
              warn.textContent = `${keyLabel(k)} is already used for "${ACTION_LABEL[other]}". Pick another key.`;
              return draw();
            }
            commit({ ...cur, bindings: { ...cur.bindings, [a]: k } });
            draw();
          });
        }),
      );
    };
    $("keys-reset").addEventListener("click", () => {
      input.cancelCapture();
      warn.textContent = "";
      commit({ ...cur, bindings: { ...DEFAULT_BINDINGS } });
      draw();
    });
    draw();
  }
}

const P = (sim: Sim) => sim.player;
