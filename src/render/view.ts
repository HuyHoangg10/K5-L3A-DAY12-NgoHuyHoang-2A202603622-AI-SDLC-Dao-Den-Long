import * as THREE from "three";
import { Rng } from "../sim/rng";
import type { Sim } from "../sim/sim";
import { CONSTANTS as C, TUNING as T } from "../sim/tuning";

const WARM = 0xffb25a;
const std = (color: number, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0, ...extra });

interface LanternView {
  body: THREE.Mesh;
  light: THREE.PointLight;
  ring: THREE.Mesh;
  halo: THREE.Mesh;
}
interface Burst {
  mesh: THREE.Mesh;
  age: number;
  life: number;
  from: number;
  to: number;
}

/** Everything Three.js: scene, camera, meshes. Reads the sim, never changes it. */
export class View {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(55, 1, 0.1, 400);
  private lanterns = new Map<string, LanternView>();
  private motes = new Map<string, THREE.Group>();
  private shades = new Map<string, THREE.Group>();
  private bursts: Burst[] = [];
  private may = new THREE.Group();
  private mayBody = new THREE.Group();
  private mayLight = new THREE.PointLight(WARM, 28, 22, 2);
  private mayLamp!: THREE.Mesh;
  private ambient = new THREE.HemisphereLight(0x8a94d8, 0x3a3050, 0.95);
  private clouds: THREE.Mesh[] = [];
  private heading = 0;
  private lastPos = new THREE.Vector3();
  private camPos = new THREE.Vector3(0, 6, -9);
  private time = 0;

  constructor(host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    host.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color(0x0b1030);
    this.scene.fog = new THREE.FogExp2(0x0b1030, 0.0075);
    this.scene.add(this.ambient);
    const moon = new THREE.DirectionalLight(0xa8b8ff, 1.2);
    moon.position.set(-30, 60, -20);
    this.scene.add(moon);

    this.buildSky();
    this.buildIsland();
    this.buildMay();
    this.resize();
    window.addEventListener("resize", () => this.resize());
  }

  resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // ---- static world -------------------------------------------------------------------------
  private buildSky(): void {
    const rng = new Rng(7);
    const pts: number[] = [];
    for (let i = 0; i < 500; i++) {
      const a = rng.next() * Math.PI * 2;
      const el = 0.15 + rng.next() * 1.2;
      const r = 220;
      pts.push(Math.cos(a) * Math.cos(el) * r, Math.sin(el) * r, Math.sin(a) * Math.cos(el) * r);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    const stars = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xfff2cf, size: 1.6, sizeAttenuation: false, fog: false }));
    this.scene.add(stars);

    // sea of clouds under and around the island
    const sea = new THREE.Mesh(new THREE.CircleGeometry(260, 48), std(0x2c3466, { emissive: 0x161c44, emissiveIntensity: 0.6 }));
    sea.rotation.x = -Math.PI / 2;
    sea.position.y = -6;
    this.scene.add(sea);
    const cloudMat = std(0x56619a, { emissive: 0x242c66, emissiveIntensity: 0.5, transparent: true, opacity: 0.85 });
    for (let i = 0; i < 46; i++) {
      const a = rng.next() * Math.PI * 2;
      const r = C.island_radius + 4 + rng.next() * 110;
      const m = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), cloudMat);
      const s = 5 + rng.next() * 9;
      m.scale.set(s * 1.6, s * 0.45, s);
      m.position.set(Math.sin(a) * r, -5 + rng.next() * 2, Math.cos(a) * r);
      this.clouds.push(m);
      this.scene.add(m);
    }
  }

  private buildIsland(): void {
    const R = C.island_radius;
    const top = new THREE.Mesh(new THREE.CylinderGeometry(R, R - 2, 2.4, 64), std(0x4d7a5c));
    top.position.y = -1.2;
    this.scene.add(top);
    const rock = new THREE.Mesh(new THREE.ConeGeometry(R - 2, 22, 40), std(0x4a3d4f));
    rock.rotation.x = Math.PI;
    rock.position.y = -2.4 - 11;
    this.scene.add(rock);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(R - 0.4, 0.45, 8, 96), std(0x8a7a62));
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.05;
    this.scene.add(rim);
    // worn path from the start to each lantern
    const path = std(0x6f6a52);
    // small props, placed with a fixed seed (render-only randomness)
    const rng = new Rng(21);
    const grass = std(0x2f6b4a);
    const stone = std(0x6d6a7e);
    for (let i = 0; i < 160; i++) {
      const a = rng.next() * Math.PI * 2;
      const r = Math.sqrt(rng.next()) * (R - 2);
      const x = Math.sin(a) * r;
      const z = Math.cos(a) * r;
      if (this.nearLantern(x, z, 6)) continue;
      if (rng.next() < 0.65) {
        const tuft = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.6 + rng.next() * 0.5, 5), grass);
        tuft.position.set(x, 0.3, z);
        this.scene.add(tuft);
      } else {
        const rk = new THREE.Mesh(new THREE.DodecahedronGeometry(0.3 + rng.next() * 0.5), stone);
        rk.position.set(x, 0.15, z);
        rk.rotation.set(rng.next() * 3, rng.next() * 3, 0);
        this.scene.add(rk);
      }
    }
    const start = new THREE.Mesh(new THREE.CircleGeometry(2.4, 32), path);
    start.rotation.x = -Math.PI / 2;
    start.position.y = 0.02;
    this.scene.add(start);
  }

  private nearLantern(x: number, z: number, d: number): boolean {
    for (let i = 0; i < T.lantern_count_night1; i++) {
      const a = (i / T.lantern_count_night1) * Math.PI * 2;
      if (Math.hypot(x - C.lantern_ring_radius * Math.sin(a), z - C.lantern_ring_radius * Math.cos(a)) < d) return true;
    }
    return false;
  }

  private buildMay(): void {
    const dress = new THREE.Mesh(new THREE.ConeGeometry(0.46, 1.0, 14), std(0xd9622b));
    dress.position.y = 0.5;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.27, 16, 12), std(0xf2c9a0));
    head.position.y = 1.2;
    const hat = new THREE.Mesh(new THREE.ConeGeometry(0.66, 0.4, 24), std(0xe3c27d));
    hat.position.y = 1.58;
    const hatEdge = new THREE.Mesh(new THREE.TorusGeometry(0.6, 0.02, 6, 28), std(0xb89752));
    hatEdge.rotation.x = Math.PI / 2;
    hatEdge.position.y = 1.4;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1.0, 6), std(0x7a5a38));
    pole.position.set(0.5, 1.05, 0.1);
    this.mayLamp = new THREE.Mesh(
      new THREE.SphereGeometry(0.15, 14, 10),
      new THREE.MeshStandardMaterial({ color: 0xffe0a0, emissive: WARM, emissiveIntensity: 2.2 }),
    );
    this.mayLamp.position.set(0.5, 1.62, 0.1);
    this.mayLight.position.copy(this.mayLamp.position);
    this.mayBody.add(dress, head, hat, hatEdge, pole, this.mayLamp, this.mayLight);
    this.may.add(this.mayBody);
    this.scene.add(this.may);
  }

  // ---- dynamic objects ----------------------------------------------------------------------
  private makeLantern(id: string, x: number, z: number): LanternView {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.22, 3.2, 8), std(0x5a4636));
    post.position.y = 1.6;
    const cap = new THREE.Mesh(new THREE.ConeGeometry(0.85, 0.6, 8), std(0x3b2c2c));
    cap.position.y = 4.55;
    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(0.62, 0.52, 1.3, 10),
      new THREE.MeshStandardMaterial({ color: 0x4a3a35, emissive: 0x6b2f00, emissiveIntensity: 0.1, roughness: 0.6 }),
    );
    body.position.y = 3.75;
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 1.0, 0.4, 10), std(0x6a5a50));
    base.position.y = 0.2;
    const light = new THREE.PointLight(WARM, 0, 46, 1.6);
    light.position.y = 3.8;
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(T.safe_radius - 0.12, T.safe_radius, 64),
      new THREE.MeshBasicMaterial({ color: WARM, transparent: true, opacity: 0.12, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.04;
    const halo = new THREE.Mesh(
      new THREE.SphereGeometry(1.7, 16, 12),
      new THREE.MeshBasicMaterial({ color: WARM, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    halo.position.y = 3.75;
    g.add(post, cap, body, base, light, ring, halo);
    this.scene.add(g);
    return { body, light, ring, halo };
  }

  private makeMote(): THREE.Group {
    const g = new THREE.Group();
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.17, 10, 8), new THREE.MeshBasicMaterial({ color: 0xfff0b0 }));
    const glow = new THREE.Mesh(
      new THREE.SphereGeometry(0.46, 10, 8),
      new THREE.MeshBasicMaterial({ color: 0xffb040, transparent: true, opacity: 0.28, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    g.add(core, glow);
    this.scene.add(g);
    return g;
  }

  private makeShade(): THREE.Group {
    const g = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: 0x24123a, emissive: 0x2c0a55, emissiveIntensity: 0.9, roughness: 0.5 });
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.7, 18, 14), mat);
    body.scale.y = 1.1;
    const drip = new THREE.Mesh(new THREE.ConeGeometry(0.55, 1.0, 12), mat);
    drip.rotation.x = Math.PI;
    drip.position.y = -0.8;
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xd9b8ff });
    const e1 = new THREE.Mesh(new THREE.SphereGeometry(0.11, 8, 6), eyeMat);
    const e2 = e1.clone();
    e1.position.set(-0.22, 0.12, 0.58);
    e2.position.set(0.22, 0.12, 0.58);
    const aura = new THREE.Mesh(
      new THREE.SphereGeometry(1.15, 14, 10),
      new THREE.MeshBasicMaterial({ color: 0x7a3cff, transparent: true, opacity: 0.12, depthWrite: false }),
    );
    g.add(body, drip, e1, e2, aura);
    g.userData.mat = mat;
    g.userData.eyes = eyeMat;
    this.scene.add(g);
    return g;
  }

  /** Short expanding ring on the ground (pulse, lantern lit). */
  burst(x: number, z: number, color: number, to: number, life: number): void {
    const mesh = new THREE.Mesh(
      new THREE.RingGeometry(0.85, 1, 48),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, 0.1, z);
    this.scene.add(mesh);
    this.bursts.push({ mesh, age: 0, life, from: 0.5, to });
  }

  /** Remove everything dynamic so a new sim can be shown. */
  reset(): void {
    for (const l of this.lanterns.values()) this.scene.remove(l.body.parent as THREE.Object3D);
    for (const m of this.motes.values()) this.scene.remove(m);
    for (const s of this.shades.values()) this.scene.remove(s);
    for (const b of this.bursts) this.scene.remove(b.mesh);
    this.lanterns.clear();
    this.motes.clear();
    this.shades.clear();
    this.bursts = [];
    this.lastPos.set(0, 0, 0);
    this.heading = 0;
  }

  // ---- per-frame ----------------------------------------------------------------------------
  update(sim: Sim, dt: number, camYawDeg: number): void {
    this.time += dt;
    const t = this.time;
    const p = sim.player.pos;

    // player
    this.may.position.set(p[0], p[1], p[2]);
    const dx = p[0] - this.lastPos.x;
    const dz = p[2] - this.lastPos.z;
    const moving = Math.hypot(dx, dz) > 1e-4;
    if (moving) {
      const target = Math.atan2(dx, dz);
      let d = target - this.heading;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.heading += d * Math.min(1, dt * 14);
    }
    this.lastPos.set(p[0], p[1], p[2]);
    this.may.rotation.y = this.heading;
    this.mayBody.position.y = moving && p[1] === 0 ? Math.abs(Math.sin(t * 12)) * 0.07 : 0;
    this.mayBody.rotation.z = moving ? Math.sin(t * 12) * 0.05 : 0;
    this.may.visible = !sim.invulnerable || Math.floor(t * 14) % 2 === 0; // blink while protected
    this.mayLight.intensity = 24 + Math.sin(t * 7) * 3;

    // lanterns
    for (const l of sim.lanterns) {
      let v = this.lanterns.get(l.id);
      if (!v) {
        v = this.makeLantern(l.id, l.pos[0], l.pos[2]);
        this.lanterns.set(l.id, v);
      }
      const fill = l.lit ? 1 : l.deposited / T.lantern_cost;
      const mat = v.body.material as THREE.MeshStandardMaterial;
      mat.emissive.setHex(l.lit ? WARM : 0x8a3a00);
      mat.emissiveIntensity = l.lit ? 1.5 + Math.sin(t * 5 + l.pos[0]) * 0.2 : 0.1 + fill * 1.2;
      mat.color.setHex(l.lit ? 0xffb860 : 0x4a3a35);
      v.light.intensity = l.lit ? 70 + Math.sin(t * 4 + l.pos[2]) * 6 : fill * 12;
      (v.ring.material as THREE.MeshBasicMaterial).opacity = l.lit ? 0.35 : 0.1 + fill * 0.15;
      (v.halo.material as THREE.MeshBasicMaterial).opacity = l.lit ? 0.13 : fill * 0.1;
    }

    // motes
    const seen = new Set<string>();
    let i = 0;
    for (const m of sim.motes) {
      seen.add(m.id);
      let g = this.motes.get(m.id);
      if (!g) {
        g = this.makeMote();
        this.motes.set(m.id, g);
      }
      g.position.set(m.pos[0], 0.75 + Math.sin(t * 2.2 + i * 1.7) * 0.18, m.pos[2]);
      i++;
    }
    for (const [id, g] of this.motes) {
      if (!seen.has(id)) {
        this.scene.remove(g);
        this.motes.delete(id);
      }
    }

    // shades
    const seenS = new Set<string>();
    for (const s of sim.shades) {
      seenS.add(s.id);
      let g = this.shades.get(s.id);
      if (!g) {
        g = this.makeShade();
        this.shades.set(s.id, g);
      }
      const stunned = sim.shadeState(s) === "stunned";
      g.position.set(s.pos[0], s.pos[1] + (stunned ? -0.1 : Math.sin(t * 4 + s.pos[0]) * 0.12), s.pos[2]);
      g.rotation.y = Math.atan2(p[0] - s.pos[0], p[2] - s.pos[2]);
      const k = stunned ? 0.85 : 1 + Math.sin(t * 6 + s.pos[2]) * 0.06;
      g.scale.set(k, stunned ? 0.8 : 1, k);
      const mat = g.userData.mat as THREE.MeshStandardMaterial;
      mat.color.setHex(stunned ? 0x5b5d9a : 0x24123a);
      mat.emissive.setHex(stunned ? 0x3a4a90 : 0x2c0a55);
      (g.userData.eyes as THREE.MeshBasicMaterial).color.setHex(stunned ? 0xcfe0ff : 0xd9b8ff);
    }
    for (const [id, g] of this.shades) {
      if (!seenS.has(id)) {
        this.scene.remove(g);
        this.shades.delete(id);
      }
    }

    // bursts
    for (const b of this.bursts) b.age += dt;
    this.bursts = this.bursts.filter((b) => {
      const u = b.age / b.life;
      if (u >= 1) {
        this.scene.remove(b.mesh);
        return false;
      }
      const s = b.from + (b.to - b.from) * (1 - (1 - u) * (1 - u));
      b.mesh.scale.set(s, s, s);
      (b.mesh.material as THREE.MeshBasicMaterial).opacity = 0.8 * (1 - u);
      return true;
    });

    // island gets brighter with every lit lantern
    const lit = sim.litCount;
    this.ambient.intensity = 0.95 + lit * 0.16;
    (this.scene.background as THREE.Color).setHex(lit === 0 ? 0x0b1030 : lit < 3 ? 0x101636 : lit < 5 ? 0x181a40 : 0x24204a);
    (this.scene.fog as THREE.FogExp2).color.copy(this.scene.background as THREE.Color);
    for (const c of this.clouds) c.position.x += Math.sin(t * 0.1 + c.position.z) * dt * 0.4;

    // third-person camera behind Mây, looking along the forward direction of the current yaw
    const th = (camYawDeg * Math.PI) / 180;
    const fx = Math.sin(th);
    const fz = Math.cos(th);
    const want = new THREE.Vector3(p[0] - fx * 9.5, p[1] * 0.5 + 6.2, p[2] - fz * 9.5);
    this.camPos.lerp(want, Math.min(1, dt * 8));
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(p[0] + fx * 2.5, 1.3 + p[1] * 0.5, p[2] + fz * 2.5);
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }
}
