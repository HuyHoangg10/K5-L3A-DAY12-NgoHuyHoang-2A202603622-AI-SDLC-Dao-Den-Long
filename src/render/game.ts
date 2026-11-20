import { CardKit, type KitEvent } from "../extras/cards";
import { CardsHud, CardsView } from "../extras/cards-view";
import { Sim } from "../sim/sim";
import { DT, TUNING as T } from "../sim/tuning";
import type { SimEvent } from "../sim/types";
import { Hud } from "./hud";
import { InputState } from "./input";
import { View } from "./view";

/**
 * Live game loop: fixed 1/60 s sim steps fed by the keyboard, drawn with Three.js. Rules all live in src/sim.
 * The card skills (src/extras) are layered on top here and only here, so headless runs never see them.
 */
export class Game {
  private sim!: Sim;
  private kit!: CardKit;
  private view: View;
  private cardsView: CardsView;
  private cardsHud = new CardsHud();
  private input: InputState;
  private hud = new Hud();
  private acc = 0;
  private last = 0;
  private time = 0;
  private running = false; // false on the start screen
  private runs = 0;

  constructor(host: HTMLElement) {
    this.view = new View(host);
    this.cardsView = new CardsView(this.view.scene);
    this.input = new InputState(this.view.renderer.domElement);
    this.input.onStart = () => this.begin();
    this.input.onRestart = () => this.restart();
    this.hud.startButton(() => this.begin());
    this.hud.onAgain = () => this.restart();
    this.cardsHud.setVisible(false);
    this.newRun();
    requestAnimationFrame((t) => this.frame(t));
  }

  private newRun(): void {
    // the seed is the only non-deterministic thing, and it lives here in the render layer
    const seed = (Date.now() + this.runs++ * 7919) % 2147483647;
    this.sim = new Sim({ seed });
    this.kit = new CardKit(this.sim);
    this.view.reset();
    this.cardsView.reset();
    this.acc = 0;
    this.hud.hideEnd();
  }

  private begin(): void {
    if (this.running) return;
    this.running = true;
    this.hud.hideStart();
    this.cardsHud.setVisible(true);
    this.hud.toast("Find fireflies, then press F at a lantern", 3500);
  }

  private restart(): void {
    if (!this.running || this.sim.state === "playing") return; // Enter only restarts after the night is over
    this.newRun();
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
    switch (e.name) {
      case "no_light":
        this.hud.toast("Card Fan needs a firefly", 1200);
        break;
      case "on_cooldown":
        this.hud.toast(`${e.key.toUpperCase()} is recharging`, 900);
        break;
      case "roll_start":
        this.hud.toast("Press W again to pick the card", 1500);
        break;
      case "card_locked":
        this.hud.toast(`${e.card === "red" ? "Pink" : e.card[0]!.toUpperCase() + e.card.slice(1)} card ready: next Card Fan uses it`, 2000);
        break;
      case "card_hit":
        this.view.burst(this.sim.player.pos[0], this.sim.player.pos[2], 0xffe08a, 2, 0.3);
        break;
      case "deck_on":
        this.hud.toast("Lucky Deck: fireflies count double for 6 s", 1800);
        break;
      case "gate_start":
        this.hud.toast(`Lantern Gate opening toward ${e.lantern}... stay safe`, 1600);
        break;
      case "gate_done":
        this.view.burst(this.sim.player.pos[0], this.sim.player.pos[2], 0xfff0b0, 6, 0.6);
        break;
      case "gate_cancel":
        this.hud.toast("The gate fizzled out", 1200);
        break;
    }
  }

  private frame(now: number): void {
    const dt = Math.min(0.1, (now - (this.last || now)) / 1000);
    this.last = now;
    this.time += dt;
    if (this.running && this.sim.state === "playing") {
      this.acc += dt;
      let steps = 0;
      while (this.acc >= DT && steps < 6) {
        this.sim.setInput(this.input.sample());
        this.sim.step();
        this.input.consumed();
        for (const e of this.sim.events) this.handle(e);
        for (const e of this.kit.tick({ pressed: this.input.takeSkills(), camYawDeg: this.input.camYawDeg })) this.handleKit(e);
        this.acc -= DT;
        steps++;
      }
      if (steps === 6) this.acc = 0; // tab was hidden; do not try to catch up
    }
    this.view.update(this.sim, dt, this.input.camYawDeg);
    this.cardsView.update(this.kit, this.sim, this.time);
    this.cardsHud.update(this.kit);
    this.hud.update(this.sim);
    this.view.render();
    requestAnimationFrame((t) => this.frame(t));
  }
}
