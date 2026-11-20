import * as THREE from "three";
import type { Sim } from "../sim/sim";
import type { Fx, KitBase, SkillKey, SlotHud } from "./kit";

interface Item {
  mesh: THREE.Object3D;
  fx: Fx;
}

const mat = (color: number, opacity: number, additive = true) =>
  new THREE.MeshBasicMaterial({ color, transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending });

/** Draws the generic effects (orbs, cards, discs, rings, cones, beams, pillars) that any kit publishes in `kit.fx`. */
export class KitView {
  private items = new Map<number, Item>();
  private badge: THREE.Mesh;
  private card = new THREE.PlaneGeometry(0.55, 0.8);

  constructor(private scene: THREE.Scene) {
    this.badge = new THREE.Mesh(this.card, new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide }));
    this.badge.visible = false;
    scene.add(this.badge);
  }

  reset(): void {
    for (const it of this.items.values()) this.scene.remove(it.mesh);
    this.items.clear();
  }

  private make(fx: Fx): THREE.Object3D {
    switch (fx.kind) {
      case "orb": {
        const g = new THREE.Group();
        g.add(new THREE.Mesh(new THREE.SphereGeometry(fx.r, 14, 10), new THREE.MeshBasicMaterial({ color: fx.color })));
        g.add(new THREE.Mesh(new THREE.SphereGeometry(fx.r * 1.7, 12, 8), mat(fx.color, 0.22)));
        return g;
      }
      case "card":
        return new THREE.Mesh(this.card, new THREE.MeshBasicMaterial({ color: fx.color, side: THREE.DoubleSide }));
      case "disc": {
        const m = new THREE.Mesh(new THREE.CircleGeometry(1, 40), mat(fx.color, 0.45));
        m.rotation.x = -Math.PI / 2;
        m.scale.setScalar(fx.r);
        return m;
      }
      case "ring": {
        const m = new THREE.Mesh(new THREE.RingGeometry(0.93, 1, 48), mat(fx.color, 0.85));
        m.rotation.x = -Math.PI / 2;
        m.scale.setScalar(fx.r);
        return m;
      }
      case "cone": {
        // a flat pie slice built in world orientation: centre at the origin, opening along fx.dir
        const dir = fx.dir ?? [0, 1];
        const base = Math.atan2(dir[0], dir[1]);
        const half = (((fx.angle ?? 60) / 2) * Math.PI) / 180;
        const pts: number[] = [0, 0, 0];
        const n = 20;
        for (let i = 0; i <= n; i++) {
          const a = base - half + (2 * half * i) / n;
          pts.push(Math.sin(a) * fx.r, 0, Math.cos(a) * fx.r);
        }
        const idx: number[] = [];
        for (let i = 1; i <= n; i++) idx.push(0, i, i + 1);
        const g = new THREE.BufferGeometry();
        g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
        g.setIndex(idx);
        return new THREE.Mesh(g, mat(fx.color, 0.45));
      }
      case "beam": {
        const to = fx.to ?? fx.pos;
        const len = Math.hypot(to[0] - fx.pos[0], to[1] - fx.pos[1]) || 0.01;
        const m = new THREE.Mesh(new THREE.CylinderGeometry(fx.r, fx.r, len, 8), mat(fx.color, 0.9));
        m.position.set((fx.pos[0] + to[0]) / 2, 1.2, (fx.pos[1] + to[1]) / 2);
        m.rotation.set(Math.PI / 2, 0, 0);
        m.rotation.order = "YXZ";
        m.rotation.y = Math.atan2(to[0] - fx.pos[0], to[1] - fx.pos[1]);
        return m;
      }
      case "pillar":
        return new THREE.Mesh(new THREE.CylinderGeometry(fx.r, fx.r * 1.5, 30, 18, 1, true), mat(fx.color, 0.35));
    }
  }

  update(kit: KitBase, sim: Sim, t: number): void {
    const seen = new Set<number>();
    for (const fx of kit.fx) {
      seen.add(fx.id);
      let it = this.items.get(fx.id);
      if (!it) {
        it = { mesh: this.make(fx), fx };
        this.scene.add(it.mesh);
        this.items.set(fx.id, it);
      }
      const m = it.mesh;
      const life = fx.total > 0 ? Math.max(0, Math.min(1, fx.ttl / fx.total)) : 1;
      if (fx.kind === "orb") m.position.set(fx.pos[0], 1.1, fx.pos[1]);
      else if (fx.kind === "card") {
        m.position.set(fx.pos[0], 1.1, fx.pos[1]);
        m.rotation.y = Math.atan2(fx.dir?.[0] ?? 0, fx.dir?.[1] ?? 1) + t * 18;
      } else if (fx.kind === "pillar") m.position.set(fx.pos[0], 15, fx.pos[1]);
      else if (fx.kind === "disc" || fx.kind === "ring") m.position.set(fx.pos[0], 0.08, fx.pos[1]);
      else if (fx.kind === "cone") m.position.set(fx.pos[0], 0.09, fx.pos[1]);
      if (fx.kind === "disc" || fx.kind === "cone") (m as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>).material.opacity = 0.15 + 0.4 * life;
      if (fx.kind === "ring") (m as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>).material.opacity = 0.35 + 0.5 * Math.abs(Math.sin(t * 8)) * life;
    }
    for (const [id, it] of this.items) {
      if (!seen.has(id)) {
        this.scene.remove(it.mesh);
        this.items.delete(id);
      }
    }

    const p = sim.player.pos;
    this.badge.visible = kit.badge !== null;
    if (kit.badge) {
      (this.badge.material as THREE.MeshBasicMaterial).color.setHex(kit.badge.color);
      this.badge.position.set(p[0], p[1] + 2.5 * kit.style.scale + Math.sin(t * 4) * 0.08, p[2]);
      this.badge.rotation.y = t * 12;
    }
  }
}

/** Skill bar (Q W E R) with cooldown fill, plus an optional meter (rage). Built from whatever the kit reports. */
export class KitHud {
  private root: HTMLElement;
  private cells = {} as Record<SkillKey, { el: HTMLElement; fill: HTMLElement; sub: HTMLElement; name: HTMLElement }>;
  private meter: HTMLElement;
  private meterFill: HTMLElement;
  private meterLabel: HTMLElement;

  constructor() {
    const style = document.createElement("style");
    style.textContent = `
      #skills { position: fixed; bottom: 110px; left: 50%; transform: translateX(-50%); display: flex; flex-direction: column; align-items: center; gap: 6px; pointer-events: none; }
      #skills .row { display: flex; gap: 10px; }
      #skills .sk { position: relative; width: 156px; height: 84px; border-radius: 14px; background: rgba(14,18,46,0.78); border: 2px solid rgba(255,199,102,0.5); overflow: hidden; text-align: center; }
      #skills .sk .k { position: absolute; top: 3px; left: 7px; font-size: 18px; color: #ffc766; font-weight: bold; }
      #skills .sk .n { position: absolute; bottom: 4px; left: 0; width: 100%; font-size: 18px; line-height: 1.1; white-space: nowrap; text-align: center; }
      #skills .sk .s { position: absolute; top: 24px; left: 0; width: 100%; font-size: 20px; }
      #skills .sk .f { position: absolute; left: 0; bottom: 0; width: 100%; background: rgba(5,6,20,0.72); }
      #skills .sk.ready { border-color: #ffc766; box-shadow: 0 0 12px rgba(255,170,70,0.55); }
      #skills .sk.on { border-color: #fff2b0; box-shadow: 0 0 16px rgba(255,240,170,0.9); }
      #skills .sk.off { opacity: 0.55; }
      #skills .meter { width: 300px; height: 22px; border-radius: 8px; background: rgba(14,18,46,0.78); border: 1px solid rgba(255,199,102,0.5); position: relative; overflow: hidden; }
      #skills .meter i { position: absolute; left: 0; top: 0; bottom: 0; background: linear-gradient(90deg, #c26a2a, #ffc766); }
      #skills .meter span { position: absolute; width: 100%; text-align: center; font-size: 18px; line-height: 22px; }
    `;
    document.head.appendChild(style);
    this.root = document.createElement("div");
    this.root.id = "skills";
    this.meter = document.createElement("div");
    this.meter.className = "meter";
    this.meter.innerHTML = `<i></i><span></span>`;
    this.meterFill = this.meter.querySelector("i") as HTMLElement;
    this.meterLabel = this.meter.querySelector("span") as HTMLElement;
    const row = document.createElement("div");
    row.className = "row";
    for (const k of ["q", "w", "e", "r"] as const) {
      const el = document.createElement("div");
      el.className = "sk";
      el.innerHTML = `<span class="k">${k.toUpperCase()}</span><span class="s"></span><span class="n"></span><div class="f"></div>`;
      row.appendChild(el);
      this.cells[k] = { el, fill: el.querySelector(".f") as HTMLElement, sub: el.querySelector(".s") as HTMLElement, name: el.querySelector(".n") as HTMLElement };
    }
    this.root.append(this.meter, row);
    document.body.appendChild(this.root);
  }

  private shown = false;
  setVisible(v: boolean): void {
    this.shown = v;
    this.root.style.display = v ? "flex" : "none";
  }

  update(kit: KitBase): void {
    const slots = kit.slots();
    this.root.style.display = this.shown && slots.length ? "flex" : "none"; // the default character has no skills
    for (const s of slots) this.slot(s);
    this.meter.style.display = kit.bar ? "block" : "none";
    if (kit.bar) {
      this.meterFill.style.width = `${Math.round(kit.bar.value * 100)}%`;
      this.meterLabel.textContent = kit.bar.label;
    }
  }

  private slot(s: SlotHud): void {
    const c = this.cells[s.key];
    c.name.textContent = s.name;
    c.fill.style.height = `${Math.round(Math.max(0, Math.min(1, s.cd / Math.max(1, s.total))) * 100)}%`;
    c.el.classList.toggle("ready", s.cd === 0 && !s.disabled);
    c.el.classList.toggle("on", s.active);
    c.el.classList.toggle("off", !!s.disabled);
    c.sub.style.fontSize = s.sub && s.cd === 0 ? "18px" : "20px";
    c.sub.textContent = s.cd > 0 ? String(Math.ceil(s.cd / 60)) : (s.sub ?? "");
  }
}
