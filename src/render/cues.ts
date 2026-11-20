// Visual cues and subtitles for sounds (Settings > Subtitles), so nothing important is told by sound or colour alone.

/** Where is a point, as the player sees it? Camera yaw 0 looks along +Z and screen-right is -X. */
export function directionWord(px: number, pz: number, tx: number, tz: number, camYawDeg: number): string {
  const th = (camYawDeg * Math.PI) / 180;
  const fx = Math.sin(th);
  const fz = Math.cos(th);
  const rx = -Math.cos(th);
  const rz = Math.sin(th);
  const dx = tx - px;
  const dz = tz - pz;
  const ahead = dx * fx + dz * fz;
  const right = dx * rx + dz * rz;
  const a = (Math.atan2(right, ahead) * 180) / Math.PI; // 0 ahead, +90 right, 180 behind
  if (Math.abs(a) <= 45) return "ahead";
  if (Math.abs(a) >= 135) return "behind you";
  return a > 0 ? "on your right" : "on your left";
}

const ARROW = { ahead: "↑", "behind you": "↓", "on your right": "→", "on your left": "←" } as Record<string, string>;
export const arrowFor = (word: string): string => ARROW[word] ?? "";

export class Cues {
  enabled = true;
  private host: HTMLElement;
  private last = new Map<string, number>();

  constructor() {
    this.host = document.getElementById("cues") as HTMLElement;
  }

  /** Show a line for `ms`; the same text is not repeated within `gap` ms. */
  say(text: string, ms = 3000, gap = 700): void {
    if (!this.enabled) return;
    const now = performance.now();
    if (now - (this.last.get(text) ?? -1e9) < gap) return;
    this.last.set(text, now);
    const el = document.createElement("div");
    el.textContent = text;
    this.host.appendChild(el);
    while (this.host.children.length > 3) this.host.firstElementChild?.remove();
    window.setTimeout(() => el.remove(), ms);
  }

  clear(): void {
    this.host.innerHTML = "";
  }
}
