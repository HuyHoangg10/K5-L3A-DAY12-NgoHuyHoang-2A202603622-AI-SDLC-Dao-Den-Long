import type { SkillKey } from "../extras/kit";
import type { FrameInput } from "../sim/types";

/**
 * Mouse + keyboard input for the live game.
 *  - Right mouse button: walk to the point under the mouse (hold it to keep following), like a MOBA.
 *  - Left or middle mouse drag: turn the camera (so the 3D view can still be rotated).
 *  - Arrow keys also move. Space jump, F put fireflies in a lantern, D glow, Q W E R champion skills.
 * Buttons are latched until a sim step has consumed them, so a quick tap between two ticks is not lost
 * (the sim itself only reacts to false -> true changes).
 */
export class InputState {
  private held = new Set<string>();
  private latch = { jump: false, interact: false, pulse: false };
  private skills: Record<SkillKey, boolean> = { q: false, w: false, e: false, r: false };
  camYawDeg = 0;
  /** last pointer position on screen (client pixels) */
  pointer: { x: number; y: number } | null = null;
  rightHeld = false;
  private rightClick = false;
  onRestart: () => void = () => {};
  onStart: () => void = () => {};
  onDigit: (n: number) => void = () => {};
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
      if (k >= "1" && k <= "9") this.onDigit(Number(k));
      if (k === "enter") this.onRestart();
      if (k === " " || k === "enter") this.onStart();
    });
    window.addEventListener("keyup", (e) => this.held.delete(e.key.toLowerCase()));
    window.addEventListener("blur", () => {
      this.held.clear();
      this.rightHeld = false;
    });
    target.addEventListener("contextmenu", (e) => e.preventDefault());
    target.addEventListener("pointerdown", (e) => {
      this.pointer = { x: e.clientX, y: e.clientY };
      if (e.button === 2) {
        this.rightHeld = true;
        this.rightClick = true;
      } else {
        this.dragging = true; // left or middle: turn the camera
      }
    });
    window.addEventListener("pointerup", (e) => {
      if (e.button === 2) this.rightHeld = false;
      else this.dragging = false;
    });
    window.addEventListener("pointermove", (e) => {
      this.pointer = { x: e.clientX, y: e.clientY };
      if (this.dragging) this.camYawDeg -= e.movementX * 0.3; // drag right turns the view right
    });
  }

  private down(...keys: string[]): boolean {
    return keys.some((k) => this.held.has(k));
  }

  /** true once per right click (and consumed) */
  takeRightClick(): boolean {
    const c = this.rightClick;
    this.rightClick = false;
    return c;
  }

  /** Arrow keys currently held? (they cancel a click-to-move target) */
  get arrowsHeld(): boolean {
    return this.down("arrowup", "arrowdown", "arrowleft", "arrowright");
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
