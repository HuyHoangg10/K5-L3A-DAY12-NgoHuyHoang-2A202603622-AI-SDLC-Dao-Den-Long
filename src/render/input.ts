import type { FrameInput } from "../sim/types";

/**
 * Keyboard + mouse-drag input for the live game.
 * Buttons are latched until a sim step has consumed them, so a quick tap between two ticks is not lost
 * (the sim itself only reacts to false -> true changes).
 */
export class InputState {
  private held = new Set<string>();
  private latch = { jump: false, interact: false, pulse: false };
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
      if (k === "e") this.latch.interact = true;
      if (k === "q" || k === "f") this.latch.pulse = true;
      if (k === "r") this.onRestart();
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
    const fwd = (this.down("w", "arrowup") ? 1 : 0) - (this.down("s", "arrowdown") ? 1 : 0);
    const left = (this.down("a", "arrowleft") ? 1 : 0) - (this.down("d", "arrowright") ? 1 : 0);
    return {
      move: [left, fwd],
      camYawDeg: this.camYawDeg,
      jump: this.latch.jump || this.down(" "),
      interact: this.latch.interact || this.down("e"),
      pulse: this.latch.pulse || this.down("q", "f"),
    };
  }

  /** Call after at least one sim step ran with the sampled input. */
  consumed(): void {
    this.latch = { jump: false, interact: false, pulse: false };
  }
}
