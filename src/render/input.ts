import type { SkillKey } from "../extras/cards";
import type { FrameInput } from "../sim/types";

/**
 * Keyboard + mouse-drag input for the live game.
 * Right hand: arrow keys move. Left hand: Q W E R are the card skills, D = glow, F = put fireflies in a lantern.
 * Buttons are latched until a sim step has consumed them, so a quick tap between two ticks is not lost
 * (the sim itself only reacts to false -> true changes).
 */
export class InputState {
  private held = new Set<string>();
  private latch = { jump: false, interact: false, pulse: false };
  private skills: Record<SkillKey, boolean> = { q: false, w: false, e: false, r: false };
  camYawDeg = 0;
  onRestart: () => void = () => {};
  onStart: () => void = () => {};
  private dragging = false;

  constructor(target: HTMLElement) {
    window.addEventListener("keydown", (e) => {
      if (e.repeat) return;
      const k = e.key.toLowerCase();
      if (["arrowup", "arrowdown", "arrowleft", "arrowright", " "].includes(k)) e.preventDefault();
      this.held.add(k);
      if (k === " ") this.latch.jump = true;
      if (k === "f") this.latch.interact = true;
      if (k === "d") this.latch.pulse = true;
      if (k === "q" || k === "w" || k === "e" || k === "r") this.skills[k] = true;
      if (k === "enter") this.onRestart();
      if (k === " " || k === "enter") this.onStart();
    });
    window.addEventListener("keyup", (e) => this.held.delete(e.key.toLowerCase()));
    window.addEventListener("blur", () => this.held.clear());
    target.addEventListener("pointerdown", () => (this.dragging = true));
    window.addEventListener("pointerup", () => (this.dragging = false));
    window.addEventListener("pointermove", (e) => {
      if (this.dragging) this.camYawDeg -= e.movementX * 0.3; // drag right turns the view right
    });
  }

  private down(...keys: string[]): boolean {
    return keys.some((k) => this.held.has(k));
  }

  /** Current input for the sim. With the camera behind Mây looking along +Z (yaw 0), screen-right is -X. */
  sample(): FrameInput {
    const fwd = (this.down("arrowup") ? 1 : 0) - (this.down("arrowdown") ? 1 : 0);
    const left = (this.down("arrowleft") ? 1 : 0) - (this.down("arrowright") ? 1 : 0);
    return {
      move: [left, fwd],
      camYawDeg: this.camYawDeg,
      jump: this.latch.jump || this.down(" "),
      interact: this.latch.interact || this.down("f"),
      pulse: this.latch.pulse || this.down("d"),
    };
  }

  /** Call after at least one sim step ran with the sampled input. */
  consumed(): void {
    this.latch = { jump: false, interact: false, pulse: false };
  }

  /** Skill keys pressed since the last call (each press is returned once). */
  takeSkills(): Record<SkillKey, boolean> {
    const s = this.skills;
    this.skills = { q: false, w: false, e: false, r: false };
    return s;
  }
}
