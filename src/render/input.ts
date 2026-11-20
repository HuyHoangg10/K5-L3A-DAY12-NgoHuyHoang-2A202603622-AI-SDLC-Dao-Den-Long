import type { SkillKey } from "../extras/kit";
import type { FrameInput } from "../sim/types";
import { DEFAULT_BINDINGS, type Action } from "./settings";

const SKILL_KEYS = ["q", "w", "e", "r"];

/**
 * Mouse + keyboard input for the live game.
 *  - Right mouse button: walk to the point under the mouse (hold it to keep following), like a MOBA.
 *  - Left or middle mouse drag: turn the camera (so the 3D view can still be rotated).
 *  - The keys of the actions (move, jump, dash, interact, glow, pause) are rebindable in Settings; F and D always
 *    work as interact and glow. Esc also pauses / goes back.
 *  - Default Mây: Q glows, E lights lanterns (by default). Champions: Q W E R are their skills.
 * Buttons are latched until a sim step has consumed them, so a quick tap between two ticks is not lost
 * (the sim itself only reacts to false -> true changes).
 */
export class InputState {
  private held = new Set<string>();
  private latch = { jump: false, interact: false, pulse: false, dash: false };
  private skills: Record<SkillKey, boolean> = { q: false, w: false, e: false, r: false };
  bindings: Record<Action, string> = { ...DEFAULT_BINDINGS };
  camYawDeg = 0;
  sensitivity = 1;
  /** true for the default character: Q and E are the base actions instead of champion skills */
  defaultMode = true;
  /** last pointer position on screen (client pixels) */
  pointer: { x: number; y: number } | null = null;
  rightHeld = false;
  private rightClick = false;
  private pauseRequest = false;
  private capture: ((key: string) => void) | null = null;
  onEnter: () => void = () => {};
  onSpace: (() => void) | null = null;
  onDigit: (n: number) => void = () => {};
  onStep: (delta: number) => void = () => {};
  onEscape: () => void = () => {};
  onPause: () => void = () => {};
  onAnyKey: () => void = () => {};
  private dragging = false;

  constructor(target: HTMLElement) {
    window.addEventListener("keydown", (e) => {
      const k = e.key.toLowerCase();
      if (this.capture) {
        // rebinding: the next key goes to the settings screen
        e.preventDefault();
        if (!e.repeat) {
          const cb = this.capture;
          this.capture = null;
          cb(k);
        }
        return;
      }
      if (e.repeat) return;
      this.onAnyKey();
      const b = this.bindings;
      if ([b.up, b.down, b.left, b.right, b.jump, b.dash, " ", "arrowleft", "arrowright"].includes(k)) e.preventDefault();
      this.held.add(k);
      if (k === b.jump) this.latch.jump = true;
      if (k === b.dash) this.latch.dash = true;
      const free = (key: string) => this.defaultMode || !SKILL_KEYS.includes(key); // champions keep Q W E R for skills
      if (k === "f" || (k === b.interact && free(k))) this.latch.interact = true;
      if (k === "d" || (k === b.pulse && free(k))) this.latch.pulse = true;
      if (!this.defaultMode && (k === "q" || k === "w" || k === "e" || k === "r")) this.skills[k] = true;
      if (k >= "1" && k <= "9") this.onDigit(Number(k));
      if (k === "arrowleft") this.onStep(-1);
      if (k === "arrowright") this.onStep(1);
      if (k === "escape") this.onEscape();
      if (k === b.pause) this.onPause();
      if (k === "enter") {
        (document.activeElement as HTMLElement | null)?.blur?.(); // a focused button must not also fire on Enter
        e.preventDefault();
        this.onEnter();
      }
      if (k === " " && this.onSpace) this.onSpace();
    });
    window.addEventListener("keyup", (e) => this.held.delete(e.key.toLowerCase()));
    window.addEventListener("blur", () => {
      this.held.clear();
      this.rightHeld = false;
    });
    target.addEventListener("contextmenu", (e) => e.preventDefault());
    target.addEventListener("pointerdown", (e) => {
      this.pointer = { x: e.clientX, y: e.clientY };
      this.onAnyKey();
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
      if (this.dragging) this.camYawDeg -= e.movementX * 0.3 * this.sensitivity; // drag right turns the view right
    });
  }

  /** The next key pressed is handed to `cb` instead of the game (used to rebind keys). */
  captureNextKey(cb: (key: string) => void): void {
    this.capture = cb;
  }
  cancelCapture(): void {
    this.capture = null;
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

  /** Move keys currently held? (they cancel a click-to-move target) */
  get arrowsHeld(): boolean {
    const b = this.bindings;
    return this.down(b.up, b.down, b.left, b.right);
  }

  /** Ask the sim to toggle its pause on the next step */
  requestPause(): void {
    this.pauseRequest = true;
  }

  /** Current input for the sim. With the camera behind Mây looking along +Z (yaw 0), screen-right is -X. */
  sample(): FrameInput {
    const b = this.bindings;
    const fwd = (this.down(b.up) ? 1 : 0) - (this.down(b.down) ? 1 : 0);
    const left = (this.down(b.left) ? 1 : 0) - (this.down(b.right) ? 1 : 0);
    const pause = this.pauseRequest;
    this.pauseRequest = false;
    const free = (key: string) => this.defaultMode || !SKILL_KEYS.includes(key);
    return {
      move: [left, fwd],
      camYawDeg: this.camYawDeg,
      jump: this.latch.jump || this.down(b.jump),
      interact: this.latch.interact || this.down("f") || (free(b.interact) && this.down(b.interact)),
      pulse: this.latch.pulse || this.down("d") || (free(b.pulse) && this.down(b.pulse)),
      dash: this.latch.dash || this.down(b.dash),
      pause,
    };
  }

  /** Call after at least one sim step ran with the sampled input. */
  consumed(): void {
    this.latch = { jump: false, interact: false, pulse: false, dash: false };
  }

  /** Skill keys pressed since the last call (each press is returned once). */
  takeSkills(): Record<SkillKey, boolean> {
    const s = this.skills;
    this.skills = { q: false, w: false, e: false, r: false };
    return s;
  }
}
