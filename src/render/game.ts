import { championById } from "../extras/champions";
import type { KitBase, KitEvent } from "../extras/kit";
import { KitHud, KitView } from "../extras/kit-view";
import { ChampionSelect } from "../extras/select";
import { Sim } from "../sim/sim";
import { DT, TUNING as T } from "../sim/tuning";
import type { SimEvent } from "../sim/types";
import { Hud } from "./hud";
import { InputState } from "./input";
import { steer } from "./steer";
import { View } from "./view";

/**
 * Live game loop: fixed 1/60 s sim steps fed by the mouse and keyboard, drawn with Three.js. Rules all live in src/sim.
 * Champion skills (src/extras) are layered on top here and only here, so headless runs never see them.
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
  private acc = 0;
  private last = 0;
  private time = 0;
  private running = false; // false while the champion select / start screen is up
  private runs = 0;
  private moveTarget: [number, number] | null = null;
  private aim: [number, number] | null = null;

  constructor(host: HTMLElement) {
    this.view = new View(host);
    this.kitView = new KitView(this.view.scene);
    this.input = new InputState(this.view.renderer.domElement);
    this.select = new ChampionSelect(document.getElementById("champs") as HTMLElement);
    this.input.onSpace = () => this.begin(); // Space also starts from the champion screen
    this.input.onEnter = () => this.enter();
    this.input.onStep = (d) => {
      if (!this.running) this.select.step(d);
    };
    this.input.onEscape = () => this.changeChampion();
    this.input.onDigit = (n) => {
      if (!this.running) this.select.pickIndex(n);
    };
    this.hud.startButton(() => this.begin());
    this.hud.onAgain = () => this.restart();
    this.hud.onChange = () => this.changeChampion();
    this.kitHud.setVisible(false);
    this.newRun();
    requestAnimationFrame((t) => this.frame(t));
  }

  private newRun(): void {
    // the seed is the only non-deterministic thing, and it lives here in the render layer
    const seed = (Date.now() + this.runs++ * 7919) % 2147483647;
    this.sim = new Sim({ seed });
    this.kit = championById(this.select.selected).create(this.sim);
    this.view.reset();
    this.kitView.reset();
    this.moveTarget = null;
    this.acc = 0;
    this.hud.hideEnd();
  }

  private begin(): void {
    if (this.running) return;
    this.newRun(); // fresh run with the champion that is selected now
    this.running = true;
    this.hud.hideStart();
    this.kitHud.setVisible(true);
    this.hud.toast("Right-click to walk. Pick up fireflies, then press F at a lantern", 4000);
  }

  /** Enter: start with the highlighted champion, or play again after the night is over */
  private enter(): void {
    if (!this.running) this.begin();
    else this.restart();
  }

  private restart(): void {
    if (!this.running || this.sim.state === "playing") return; // Enter only restarts after the night is over
    this.newRun();
  }

  private changeChampion(): void {
    if (this.running && this.sim.state === "playing") return; // Esc only changes champion between nights
    this.running = false;
    this.hud.hideEnd();
    this.hud.showStart();
    this.kitHud.setVisible(false);
  }

  private handle(e: SimEvent): void {
    const l = (id: unknown) => this.sim.lanterns.find((x) => x.id === id);
    switch (e.name) {
      case "deposit": {
        const lan = l(e.data.lantern_id);
        this.hud.toast(`${e.data.deposited} / ${T.lantern_cost} fireflies in the lantern`);
        if (lan) this.view.burst(lan.pos[0], lan.pos[2], 0xffc060, 3, 0.5);
        break;
      }
      case "lantern_lit": {
        const lan = l(e.data.lantern_id);
        this.hud.toast(`Lantern lit! ${this.sim.litCount} / ${T.lantern_count_night1}`, 2200);
        if (lan) this.view.burst(lan.pos[0], lan.pos[2], 0xffa040, 14, 1.2);
        break;
      }
      case "pulse":
        this.view.burst(this.sim.player.pos[0], this.sim.player.pos[2], 0xffd27a, T.pulse_radius, 0.55);
        break;
      case "player_hit":
        this.hud.hitFlash();
        this.hud.toast(e.data.dropped ? `An Ink Shade got you! You dropped ${e.data.dropped} fireflies` : "An Ink Shade got you!");
        break;
      case "shade_spawned":
        this.hud.toast("Something stirs in the mist...", 1400);
        break;
      case "game_over":
        this.hud.showEnd(this.sim, String(e.data.reason));
        break;
    }
  }

  private handleKit(e: KitEvent): void {
    if (e.msg) this.hud.toast(e.msg, 1600);
  }

  /** Right mouse: walk to the point under the mouse (hold to keep following). Arrow keys cancel it. */
  private updateTarget(): void {
    const click = this.input.takeRightClick();
    const ptr = this.input.pointer;
    this.aim = ptr ? this.view.groundAt(ptr.x, ptr.y) : null;
    if (this.input.arrowsHeld) this.moveTarget = null;
    if ((click || this.input.rightHeld) && this.aim) {
      this.moveTarget = [this.aim[0], this.aim[1]];
      if (click) this.view.burst(this.aim[0], this.aim[1], 0xffd27a, 1.1, 0.4);
    }
  }

  private frame(now: number): void {
    const dt = Math.min(0.1, (now - (this.last || now)) / 1000);
    this.last = now;
    this.time += dt;
    this.updateTarget();
    if (this.running && this.sim.state === "playing") {
      this.acc += dt;
      let steps = 0;
      while (this.acc >= DT && steps < 6) {
        const inp = this.input.sample();
        if (this.moveTarget && inp.move[0] === 0 && inp.move[1] === 0) {
          const s = steer([this.sim.player.pos[0], this.sim.player.pos[2]], this.moveTarget, inp.camYawDeg, T.player_speed, DT);
          inp.move = s.move;
          if (s.arrived) this.moveTarget = null;
        }
        this.sim.setInput(inp);
        this.sim.step();
        this.input.consumed();
        for (const e of this.sim.events) this.handle(e);
        for (const e of this.kit.tick({ pressed: this.input.takeSkills(), camYawDeg: this.input.camYawDeg, aim: this.aim })) this.handleKit(e);
        this.acc -= DT;
        steps++;
      }
      if (steps === 6) this.acc = 0; // tab was hidden; do not try to catch up
    }
    this.view.setStyle(this.kit.style);
    this.view.update(this.sim, dt, this.input.camYawDeg);
    this.kitView.update(this.kit, this.sim, this.time);
    this.kitHud.update(this.kit);
    this.hud.update(this.sim);
    this.view.render();
    requestAnimationFrame((t) => this.frame(t));
  }
}
