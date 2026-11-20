import * as THREE from "three";
import type { Sim } from "../sim/sim";
import { CARD_ORDER, KIT, type CardColor, type CardKit, type SkillKey } from "./cards";

export const CARD_HEX: Record<CardColor | "plain", number> = { gold: 0xffc83a, blue: 0x55a8ff, red: 0xff6fb5, plain: 0xffefb8 };
const CSS_HEX = (c: number) => `#${c.toString(16).padStart(6, "0")}`;

/** Flying cards, the card above Mây's hat and the gate beam. Pure drawing: reads the kit, never changes it. */
export class CardsView {
  private shots = new Map<number, THREE.Mesh>();
  private held: THREE.Mesh;
  private beam: THREE.Mesh;
  private ring: THREE.Mesh;
  private cardGeo = new THREE.PlaneGeometry(0.55, 0.8);

  constructor(private scene: THREE.Scene) {
    this.held = new THREE.Mesh(this.cardGeo, new THREE.MeshBasicMaterial({ color: CARD_HEX.plain, side: THREE.DoubleSide }));
    this.held.visible = false;
    this.beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.9, 1.4, 30, 20, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
    );
    this.beam.visible = false;
    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(1.2, 1.5, 40),
      new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.8, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.visible = false;
    scene.add(this.held, this.beam, this.ring);
  }

  reset(): void {
    for (const m of this.shots.values()) this.scene.remove(m);
    this.shots.clear();
  }

  update(kit: CardKit, sim: Sim, t: number): void {
    const seen = new Set<number>();
    for (const s of kit.shots) {
      seen.add(s.id);
      let m = this.shots.get(s.id);
      if (!m) {
        m = new THREE.Mesh(this.cardGeo, new THREE.MeshBasicMaterial({ color: CARD_HEX[s.card ?? "plain"], side: THREE.DoubleSide }));
        this.scene.add(m);
        this.shots.set(s.id, m);
      }
      m.position.set(s.pos[0], 1.1, s.pos[1]);
      m.rotation.set(0, Math.atan2(s.dir[0], s.dir[1]) + t * 18, 0);
    }
    for (const [id, m] of this.shots) {
      if (!seen.has(id)) {
        this.scene.remove(m);
        this.shots.delete(id);
      }
    }

    // the card Mây holds (or the one that is rolling) floats above the hat
    const p = sim.player.pos;
    const card = kit.rolling ? kit.rollCard : kit.locked;
    this.held.visible = card !== null;
    if (card) {
      (this.held.material as THREE.MeshBasicMaterial).color.setHex(CARD_HEX[card]);
      this.held.position.set(p[0], p[1] + 2.5 + Math.sin(t * 4) * 0.08, p[2]);
      this.held.rotation.y = t * (kit.rolling ? 12 : 2.5);
    }

    // gate: beam on the target lantern, ring around Mây that closes in
    const l = kit.channelLeft > 0 ? sim.lanterns.find((x) => x.id === kit.gateTarget) : undefined;
    this.beam.visible = this.ring.visible = !!l;
    if (l) {
      const u = kit.channelLeft / KIT.r.channel;
      this.beam.position.set(l.pos[0], 15, l.pos[2]);
      (this.beam.material as THREE.MeshBasicMaterial).opacity = 0.25 + 0.15 * Math.sin(t * 10);
      this.ring.position.set(p[0], p[1] + 0.1, p[2]);
      const s = 0.6 + 2.2 * u;
      this.ring.scale.set(s, s, s);
    }
  }
}

/** Skill bar: Q W E R with cooldown fill, the rolling / held card, and the deck timer. */
export class CardsHud {
  private root: HTMLElement;
  private cells = {} as Record<SkillKey, { el: HTMLElement; fill: HTMLElement; sub: HTMLElement }>;

  constructor() {
    const style = document.createElement("style");
    style.textContent = `
      #skills { position: fixed; bottom: 58px; left: 50%; transform: translateX(-50%); display: flex; gap: 10px; pointer-events: none; }
      #skills .sk { position: relative; width: 96px; height: 76px; border-radius: 14px; background: rgba(14,18,46,0.78); border: 2px solid rgba(255,199,102,0.5); overflow: hidden; text-align: center; }
      #skills .sk .k { position: absolute; top: 3px; left: 7px; font-size: 14px; color: #ffc766; font-weight: bold; }
      #skills .sk .n { position: absolute; bottom: 4px; left: 0; width: 100%; font-size: 11px; line-height: 1.1; white-space: nowrap; text-align: center; }
      #skills .sk .s { position: absolute; top: 22px; left: 0; width: 100%; font-size: 20px; }
      #skills .sk .f { position: absolute; left: 0; bottom: 0; width: 100%; background: rgba(5,6,20,0.72); }
      #skills .sk.ready { border-color: #ffc766; box-shadow: 0 0 12px rgba(255,170,70,0.55); }
      #skills .sk.on { border-color: #fff2b0; box-shadow: 0 0 16px rgba(255,240,170,0.9); }
    `;
    document.head.appendChild(style);
    this.root = document.createElement("div");
    this.root.id = "skills";
    const defs: [SkillKey, string][] = [["q", KIT.q.name], ["w", KIT.w.name], ["e", KIT.e.name], ["r", KIT.r.name]];
    for (const [k, name] of defs) {
      const el = document.createElement("div");
      el.className = "sk";
      el.innerHTML = `<span class="k">${k.toUpperCase()}</span><span class="s"></span><span class="n">${name}</span><div class="f"></div>`;
      this.root.appendChild(el);
      this.cells[k] = { el, fill: el.querySelector(".f") as HTMLElement, sub: el.querySelector(".s") as HTMLElement };
    }
    document.body.appendChild(this.root);
  }

  update(kit: CardKit): void {
    for (const k of ["q", "w", "e", "r"] as const) {
      const c = this.cells[k];
      const left = kit.cd[k] / kit.cdTotal[k];
      c.fill.style.height = `${Math.round(Math.max(0, left) * 100)}%`;
      c.el.classList.toggle("ready", kit.cd[k] === 0);
      c.sub.textContent = kit.cd[k] > 0 ? String(Math.ceil(kit.cd[k] / 60)) : "";
      c.el.classList.toggle("on", (k === "w" && (kit.rolling || kit.locked !== null)) || (k === "e" && kit.deckLeft > 0) || (k === "r" && kit.channelLeft > 0));
    }
    const w = this.cells.w;
    const card = kit.rolling ? kit.rollCard : kit.locked;
    if (card) {
      w.sub.innerHTML = `<span style="color:${CSS_HEX(CARD_HEX[card])}">&#9830; ${card}</span>`;
      w.sub.style.fontSize = "13px";
    } else {
      w.sub.style.fontSize = "20px";
    }
    if (kit.deckLeft > 0) this.cells.e.sub.textContent = `${Math.ceil(kit.deckLeft / 60)}s`;
  }

  setVisible(v: boolean): void {
    this.root.style.display = v ? "flex" : "none";
  }

  /** The three card colours with what they do, for the toast on the first roll. */
  static readonly HELP: Record<CardColor, string> = {
    gold: "Gold: long stun",
    blue: "Blue: gives a firefly back",
    red: "Pink: pushes the shade away",
  };
  static readonly ORDER = CARD_ORDER;
}
