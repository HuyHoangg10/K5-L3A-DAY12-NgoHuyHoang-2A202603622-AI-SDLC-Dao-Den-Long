import { championById } from "../extras/champions";
import type { KitBase, KitEvent } from "../extras/kit";
import { KitHud, KitView } from "../extras/kit-view";
import { ChampionSelect } from "../extras/select";
import type { Night } from "../sim/maps";
import { Sim } from "../sim/sim";
import { DT, TUNING as T } from "../sim/tuning";
import type { SimEvent } from "../sim/types";
import { Audio } from "./audio";
import { Hud } from "./hud";
import { InputState } from "./input";
import { loadSettings, saveSettings, type Settings } from "./settings";
import { steer } from "./steer";
import { View } from "./view";

type Mode = "menu" | "intro" | "playing" | "result";

/**
 * Live game loop: fixed 1/60 s sim steps fed by the mouse and keyboard, drawn with Three.js. Rules all live in src/sim.
 * Menus, the night chain, sound and the champion skills (src/extras) are layered on top here and only here,
 * so headless runs never see them.
 */
export class Game {
  private sim!: Sim;
  private kit!: KitBase;
  private view: View;
  private kitView: KitView;
  private kitHud = new KitHud();
  private select: ChampionSelect;
  private input: InputState;
  private hud = new Hud();
  private settings: Settings = loadSettings();
  private audio = new Audio(() => this.settings);
  private mode: Mode = "menu";
  private night: Night = 1;
  private total = 0; // score of the nights won so far
  private acc = 0;
  private last = 0;
  private time = 0;
  private runs = 0;
  private moveTarget: [number, number] | null = null;
  private aim: [number, number] | null = null;
  private lastSecond = -1;
  private settingsFrom: "start" | "pause" = "start";

  constructor(host: HTMLElement) {
    this.view = new View(host);
    this.kitView = new KitView(this.view.scene);
    this.input = new InputState(this.view.renderer.domElement);
    this.select = new ChampionSelect(document.getElementById("champs") as HTMLElement);
    this.applySettings();
    this.wire();
    this.newSim();
    this.hud.showHud(false);
    this.kitHud.setVisible(false);
    requestAnimationFrame((t) => this.frame(t));
  }

  // ---- wiring ---------------------------------------------------------------------------------------
  private wire(): void {
    const i = this.input;
    i.onAnyKey = () => this.audio.resume();
    i.onEnter = () => this.enter();
    i.onEscape = () => this.escape();
    i.onPause = () => {
      if (this.mode === "playing") i.requestPause();
    };
    i.onDigit = (n) => {
      if (this.mode === "menu" && !this.hud.isShown("settings")) this.select.pickIndex(n);
    };
    i.onStep = (d) => {
      if (this.mode === "menu" && !this.hud.isShown("settings")) this.select.step(d);
    };
    this.hud.on("start-btn", () => this.enter());
    this.hud.on("start-settings", () => this.openSettings("start"));
    this.hud.on("intro-btn", () => this.enter());
    this.hud.on("end-btn", () => this.enter());
    this.hud.on("change-btn", () => this.toMenu());
    this.hud.on("pause-resume", () => this.input.requestPause());
    this.hud.on("pause-restart", () => this.restartNight());
    this.hud.on("pause-settings", () => this.openSettings("pause"));
    this.hud.on("pause-menu", () => this.toMenu());
    this.hud.on("set-close", () => this.closeSettings());
    this.hud.settingsUI(this.settings, (s) => {
      this.settings = s;
      saveSettings(s);
      this.applySettings();
    });
  }

  private applySettings(): void {
    this.audio.applyVolume();
    this.input.sensitivity = this.settings.sensitivity;
    this.view.colorBlind = this.settings.colorBlind;
    document.body.classList.toggle("cb", this.settings.colorBlind);
  }

  // ---- flow -----------------------------------------------------------------------------------------
  private newSim(): void {
    // the seed is the only non-deterministic thing, and it lives here in the render layer
    const seed = (Date.now() + this.runs++ * 7919) % 2147483647;
    this.sim = new Sim({ seed, night: this.night });
    this.kit = championById(this.select.selected).create(this.sim);
    this.input.defaultMode = this.kit.id === "default";
    this.view.setNight(this.sim);
    this.kitView.reset();
    this.moveTarget = null;
    this.acc = 0;
    this.lastSecond = -1;
  }

  private enter(): void {
    if (this.hud.isShown("settings")) return;
    if (this.mode === "menu") {
      this.audio.resume();
      this.night = 1;
      this.total = 0;
      this.hud.show("start", false);
      this.newSim();
      this.showIntro();
    } else if (this.mode === "intro") this.beginNight();
    else if (this.mode === "result") {
      this.hud.show("end", false);
      if (this.sim.status === "won") {
        if (this.night < 3) {
          this.total += this.sim.score;
          this.night = (this.night + 1) as Night;
          this.newSim();
          this.showIntro();
        } else this.toMenu();
      } else {
        this.newSim();
        this.showIntro();
      }
    }
  }

  private escape(): void {
    if (this.hud.isShown("settings")) return this.closeSettings();
    if (this.mode === "playing") this.input.requestPause();
    else if (this.mode === "result" || this.mode === "intro") this.toMenu();
  }

  private showIntro(): void {
    this.mode = "intro";
    this.hud.showHud(false);
    this.kitHud.setVisible(false);
    this.hud.showIntro(this.night);
  }

  private beginNight(): void {
    this.mode = "playing";
    this.hud.show("intro", false);
    this.hud.showHud(true);
    this.kitHud.setVisible(true);
    this.audio.startMusic();
    this.audio.setFast(false);
    this.hud.toast(this.input.defaultMode ? "Right-click to walk. Collect fireflies, then press E at a lantern" : "Right-click to walk. Collect fireflies, then press F at a lantern", 4200);
  }

  private restartNight(): void {
    this.hud.show("pause", false);
    this.newSim();
    this.beginNight();
  }

  private toMenu(): void {
    this.mode = "menu";
    for (const id of ["intro", "pause", "end", "settings"] as const) this.hud.show(id, false);
    this.hud.show("start", true);
    this.hud.showHud(false);
    this.kitHud.setVisible(false);
    this.audio.stopMusic();
    this.night = 1;
    this.total = 0;
    this.newSim();
  }

  private openSettings(from: "start" | "pause"): void {
    this.settingsFrom = from;
    this.hud.show("settings", true);
  }
  private closeSettings(): void {
    this.hud.show("settings", false);
  }

  // ---- events ---------------------------------------------------------------------------------------
  private handle(e: SimEvent): void {
    const l = (id: unknown) => this.sim.lanterns.find((x) => x.id === id);
    const P = this.sim.player;
    switch (e.name) {
      case "mote_picked":
        this.audio.play("pickup");
        break;
      case "deposit": {
        const lan = l(e.data.lantern_id);
        this.audio.play("deposit");
        this.hud.toast(`${e.data.deposited} / ${T.lantern_cost} fireflies in the lantern`);
        if (lan) this.view.burst(lan.pos[0], lan.pos[2], 0xffc060, 3, 0.5, lan.pos[1]);
        break;
      }
      case "lantern_lit": {
        const lan = l(e.data.lantern_id);
        this.audio.play("lit");
        this.hud.toast(`Lantern lit! ${this.sim.litCount} / ${this.sim.lanterns.length}`, 2200);
        if (lan) this.view.burst(lan.pos[0], lan.pos[2], 0xffa040, T.safe_radius, 1.2, lan.pos[1]);
        break;
      }
      case "pulse":
        this.audio.play("pulse");
        this.view.burst(P.pos[0], P.pos[2], 0xffd27a, T.pulse_radius, 0.55, P.pos[1]);
        break;
      case "dash":
        this.audio.play("dash");
        this.view.burst(P.pos[0], P.pos[2], 0xffffff, 1.6, 0.3, P.pos[1]);
        break;
      case "player_hit":
        this.hud.hitFlash();
        this.audio.play(e.data.by === "fall" ? "fall" : "hit");
        this.hud.toast(e.data.by === "fall" ? `You fell into the clouds! ${e.data.lost} fireflies lost` : e.data.dropped ? `An Ink Shade got you! You dropped ${e.data.dropped} fireflies` : "An Ink Shade got you!");
        break;
      case "shade_spawned":
        this.audio.play("spawn");
        break;
      case "charm_picked":
        this.audio.play("charm");
        this.hud.toast("Wind charm! Faster for 10 s, dash without waiting", 2400);
        break;
      case "drifter_steal":
        this.audio.play("steal");
        this.hud.toast(`A Drifter stole ${e.data.amount} fireflies! Glow at it to get them back`, 2400);
        break;
      case "drifter_drop":
        this.hud.toast("Fireflies dropped! Pick them up", 1800);
        break;
      case "paused":
        this.hud.show("pause", true);
        break;
      case "resumed":
        this.hud.show("pause", false);
        break;
      case "game_over": {
        this.mode = "result";
        const won = e.data.result === "won";
        this.audio.play(won ? "win" : "lose");
        this.hud.showResult(this.sim, String(e.data.reason), this.night, this.total);
        break;
      }
    }
  }

  private handleKit(e: KitEvent): void {
    if (e.msg) this.hud.toast(e.msg, 1600);
  }

  /** Right mouse: walk to the point under the mouse (hold to keep following). Arrow keys cancel it. */
  private updateTarget(): void {
    const click = this.input.takeRightClick();
    const ptr = this.input.pointer;
    this.aim = ptr ? this.view.groundAt(ptr.x, ptr.y, this.sim.player.pos[1]) : null;
    if (this.input.arrowsHeld) this.moveTarget = null;
    if (this.mode === "playing" && (click || this.input.rightHeld) && this.aim) {
      this.moveTarget = [this.aim[0], this.aim[1]];
      if (click) this.view.burst(this.aim[0], this.aim[1], 0xffd27a, 1.1, 0.4, this.sim.player.pos[1]);
    }
  }

  private frame(now: number): void {
    const dt = Math.min(0.1, (now - (this.last || now)) / 1000);
    this.last = now;
    this.time += dt;
    this.updateTarget();
    if (this.mode === "playing" && this.sim.status === "playing") {
      this.acc += dt;
      let steps = 0;
      while (this.acc >= DT && steps < 6 && this.mode === "playing") {
        const inp = this.input.sample();
        if (this.moveTarget && inp.move[0] === 0 && inp.move[1] === 0) {
          const s = steer([this.sim.player.pos[0], this.sim.player.pos[2]], this.moveTarget, inp.camYawDeg, T.player_speed, DT);
          inp.move = s.move;
          if (s.arrived) this.moveTarget = null;
        }
        const wasGrounded = this.sim.player.grounded;
        this.sim.setInput(inp);
        this.sim.step();
        this.input.consumed();
        if (wasGrounded && !this.sim.player.grounded && this.sim.player.vel[1] > 5) this.audio.play("jump");
        for (const e of this.sim.events) this.handle(e);
        for (const e of this.kit.tick({ pressed: this.input.takeSkills(), camYawDeg: this.input.camYawDeg, aim: this.aim })) this.handleKit(e);
        this.acc -= DT;
        steps++;
      }
      if (steps === 6) this.acc = 0; // tab was hidden; do not try to catch up
      const secs = Math.ceil(this.sim.timeLeft);
      if (secs <= 10 && secs !== this.lastSecond && !this.sim.paused) this.audio.play("tick");
      this.lastSecond = secs;
      this.audio.setFast(this.sim.timeLeft <= 30);
    }
    this.view.setStyle(this.kit.style);
    this.view.update(this.sim, dt, this.input.camYawDeg);
    this.kitView.update(this.kit, this.sim, this.time);
    this.kitHud.update(this.kit);
    if (this.mode === "playing" || this.mode === "result") this.hud.update(this.sim, this.night, this.total, this.input.defaultMode, (x, y, z) => this.view.project(x, y, z));
    this.view.render();
    requestAnimationFrame((t) => this.frame(t));
  }
}
