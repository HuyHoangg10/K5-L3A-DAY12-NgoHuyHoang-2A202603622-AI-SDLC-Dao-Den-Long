import { CHAMPIONS, championById } from "./champions";
import type { SkillInfo } from "./kit";

/** Champion pick screen: three cards in the start overlay. Click one or press 1 / 2 / 3 / 4. */
export class ChampionSelect {
  selected = CHAMPIONS[0]?.id ?? "default";
  private els = new Map<string, HTMLElement>();

  constructor(private host: HTMLElement, private onPick: (id: string) => void = () => {}) {
    const style = document.createElement("style");
    style.textContent = `
      #champs { display: flex; gap: 12px; justify-content: center; margin: 14px 0 4px; flex-wrap: wrap; }
      #champs .ch { width: 205px; text-align: left; padding: 10px 12px; border-radius: 14px; background: rgba(255,255,255,0.05); border: 2px solid rgba(255,199,102,0.25); cursor: pointer; }
      #champs .ch:hover { background: rgba(255,255,255,0.09); }
      #champs .ch.sel { border-color: #ffc766; box-shadow: 0 0 18px rgba(255,170,70,0.45); background: rgba(255,199,102,0.12); }
      #champs .ch h3 { margin: 0 0 2px; font-size: 16px; color: #ffc766; }
      #champs .ch p { margin: 0 0 6px; font-size: 12px; opacity: 0.85; line-height: 1.3; }
      #champs .ch li { font-size: 11.5px; line-height: 1.3; margin: 3px 0; list-style: none; }
      #champs .ch ul { margin: 0; padding: 0; }
      #champs .ch b { color: #ffc766; }
    `;
    document.head.appendChild(style);
    CHAMPIONS.forEach((c, i) => {
      const el = document.createElement("div");
      el.className = "ch";
      const sk = this.skillsOf(c.id).map((s) => `<li><b>${s.key.toUpperCase()}</b> ${s.name}</li>`).join("");
      el.innerHTML = `<h3>${i + 1}. ${c.name}</h3><p>${c.tagline}</p><ul>${sk}</ul>`;
      el.addEventListener("click", () => this.pick(c.id));
      host.appendChild(el);
      this.els.set(c.id, el);
    });
    this.pick(this.selected);
  }

  private skillsOf(id: string): SkillInfo[] {
    return STATIC_SKILLS[id] ?? [];
  }

  pick(id: string): void {
    this.selected = championById(id).id;
    for (const [k, el] of this.els) el.classList.toggle("sel", k === this.selected);
    this.onPick(this.selected);
  }

  /** move the highlight left (-1) or right (+1), wrapping around */
  step(delta: number): void {
    const i = CHAMPIONS.findIndex((c) => c.id === this.selected);
    const next = CHAMPIONS[(i + delta + CHAMPIONS.length) % CHAMPIONS.length];
    if (next) this.pick(next.id);
  }

  pickIndex(n: number): void {
    const c = CHAMPIONS[n - 1];
    if (c) this.pick(c.id);
  }
}

// Short skill lists for the pick screen (the full descriptions are in each kit and in the README).
const STATIC_SKILLS: Record<string, SkillInfo[]> = {
  default: [
    { key: "q", name: "Q glow, E lantern", desc: "" },
    { key: "w", name: "Shift dash, Space jump", desc: "" },
  ],
  cards: [
    { key: "q", name: "Card Fan", desc: "" },
    { key: "w", name: "Roll the Card", desc: "" },
    { key: "e", name: "Lure Lantern", desc: "" },
    { key: "r", name: "Lantern Gate", desc: "" },
  ],
  cub: [
    { key: "q", name: "Rebound Stone / Boulder Toss", desc: "" },
    { key: "w", name: "Zippy Streak / Wallop", desc: "" },
    { key: "e", name: "Bounce / Crunch", desc: "" },
    { key: "r", name: "Rampage (big form)", desc: "" },
  ],
  weaver: [
    { key: "q", name: "Venom Burst", desc: "" },
    { key: "w", name: "Haze Ring", desc: "" },
    { key: "e", name: "Twin Sting", desc: "" },
    { key: "r", name: "Stone Stare", desc: "" },
  ],
};
