import * as THREE from "three";
import { Rng } from "../sim/rng";
import type { Shape } from "../sim/maps";
import type { Sim } from "../sim/sim";
import { TUNING as T } from "../sim/tuning";

/** Standard palette of Ticket-02 (max 10% deviation per RGB channel). */
export const PAL = {
  sky: 0x0e1430, fog: 0x1b2350,
  grass: 0x2f5d50, sand: 0xc9b48a, wood: 0x6b4a2f, cloud: 0x12384a,
  lampOn: 0xffb347, lampCore: 0xffe9b0, lampOff: 0x5b5f6e,
  moteCore: 0xfff6c2, moteGlow: 0xffe58a,
  shade: 0x120a1a, shadeEdge: 0x7a3cff, shadeStun: 0x3a3450,
  shirt: 0xe8e2d0, scarf: 0xc8102e, gold: 0xf2c14e, drifter: 0x8fa3b8,
};

interface LanternView {
  group: THREE.Group;
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

const std = (color: number, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0, ...extra });

/** Everything Three.js: scene, camera, meshes. Reads the sim, never changes it. */
export class View {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(55, 1, 0.1, 500);
  private world = new THREE.Group(); // everything that depends on the night
  private lanterns = new Map<string, LanternView>();
  private motes = new Map<string, THREE.Group>();
  private shades = new Map<string, THREE.Group>();
  private drifters = new Map<string, THREE.Group>();
  private charms = new Map<string, THREE.Group>();
  private leaves: THREE.Mesh[] = [];
  private bursts: Burst[] = [];
  private may = new THREE.Group();
  private mayBody = new THREE.Group();
  private mayLight = new THREE.PointLight(PAL.lampOn, 28, 22, 2);
  private mayLamp!: THREE.Mesh;
  private dress!: THREE.Mesh;
  private hatMesh!: THREE.Mesh;
  private ambient = new THREE.HemisphereLight(0x8a94d8, 0x3a3050, 0.95);
  private ray = new THREE.Raycaster();
  private ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private heading = 0;
  private lastPos = new THREE.Vector3();
  private camPos = new THREE.Vector3(0, 6, -9);
  private time = 0;
  private clouds: THREE.Mesh[] = [];
  colorBlind = false;

  constructor(host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    host.appendChild(this.renderer.domElement);
    this.scene.background = new THREE.Color(PAL.sky);
    this.scene.fog = new THREE.FogExp2(PAL.fog, 0.0075);
    this.scene.add(this.ambient, this.world);
    const moon = new THREE.DirectionalLight(0xa8b8ff, 1.2);
    moon.position.set(-30, 60, -20);
    this.scene.add(moon);
    this.buildSky();
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

  // ---- static pieces --------------------------------------------------------------------------------
  private buildSky(): void {
    const rng = new Rng(7);
    const pts: number[] = [];
    for (let i = 0; i < 500; i++) {
      const a = rng.next() * Math.PI * 2;
      const el = 0.15 + rng.next() * 1.2;
      pts.push(Math.cos(a) * Math.cos(el) * 300, Math.sin(el) * 300, Math.sin(a) * Math.cos(el) * 300);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    this.scene.add(new THREE.Points(g, new THREE.PointsMaterial({ color: 0xfff2cf, size: 1.6, sizeAttenuation: false, fog: false })));
  }

  private buildMay(): void {
    const dress = new THREE.Mesh(new THREE.ConeGeometry(0.46, 1.0, 14), std(PAL.shirt));
    dress.position.y = 0.5;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.27, 16, 12), std(0xf2c9a0));
    head.position.y = 1.2;
    const hat = new THREE.Mesh(new THREE.ConeGeometry(0.66, 0.4, 24), std(0xe3c27d));
    hat.position.y = 1.58;
    const hatEdge = new THREE.Mesh(new THREE.TorusGeometry(0.6, 0.02, 6, 28), std(0xb89752));
    hatEdge.rotation.x = Math.PI / 2;
    hatEdge.position.y = 1.4;
    const scarf = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.07, 8, 20), std(PAL.scarf));
    scarf.rotation.x = Math.PI / 2;
    scarf.position.y = 0.98;
    this.dress = dress;
    this.hatMesh = hat;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1.0, 6), std(PAL.wood));
    pole.position.set(0.5, 1.05, 0.1);
    this.mayLamp = new THREE.Mesh(new THREE.SphereGeometry(0.15, 14, 10), new THREE.MeshStandardMaterial({ color: PAL.lampCore, emissive: PAL.lampOn, emissiveIntensity: 2.2 }));
    this.mayLamp.position.set(0.5, 1.62, 0.1);
    this.mayLight.position.copy(this.mayLamp.position);
    this.mayBody.add(dress, head, hat, hatEdge, scarf, pole, this.mayLamp, this.mayLight);
    this.may.add(this.mayBody);
    this.scene.add(this.may);
  }

  /** Champion look: dress and hat colour, size (the big form of the cub is 1.55). */
  setStyle(st: { dress: number; hat: number; scale: number }): void {
    (this.dress.material as THREE.MeshStandardMaterial).color.setHex(st.dress);
    (this.hatMesh.material as THREE.MeshStandardMaterial).color.setHex(st.hat);
    this.may.scale.setScalar(st.scale);
  }

  /** World (x, z) on the horizontal plane at height y under a screen point, or null. */
  groundAt(clientX: number, clientY: number, y = 0): [number, number] | null {
    const r = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(ndc, this.camera);
    this.ground.constant = -y;
    const hit = this.ray.ray.intersectPlane(this.ground, new THREE.Vector3());
    return hit ? [hit.x, hit.z] : null;
  }

  /** Screen position (pixels) of a world point; ok is false when it is behind the camera. */
  project(x: number, y: number, z: number): { x: number; y: number; ok: boolean } {
    const v = new THREE.Vector3(x, y, z).project(this.camera);
    return { x: ((v.x + 1) / 2) * window.innerWidth, y: ((1 - v.y) / 2) * window.innerHeight, ok: v.z < 1 };
  }

  // ---- the night's map ------------------------------------------------------------------------------
  /** Build the scenery of the sim's night (call once per new Sim). */
  setNight(sim: Sim): void {
    this.reset();
    this.world.clear();
    this.clouds = [];
    const rng = new Rng(21 + sim.night);
    const grass = std(PAL.grass);
    const rock = std(0x4a3d4f);
    const wood = std(PAL.wood);
    const cx0 = sim.night === 2 ? 35 : 0;
    const sea = new THREE.Mesh(new THREE.CircleGeometry(400, 48), std(PAL.cloud, { emissive: 0x0c2a38, emissiveIntensity: 0.6 }));
    sea.rotation.x = -Math.PI / 2;
    sea.position.set(cx0, -8, 0);
    this.world.add(sea);
    const cloudMat = std(0x2a5a70, { emissive: 0x143848, emissiveIntensity: 0.5, transparent: true, opacity: 0.85 });
    for (let i = 0; i < 50; i++) {
      const a = rng.next() * Math.PI * 2;
      const r = 50 + rng.next() * 130;
      const m = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), cloudMat);
      const s = 5 + rng.next() * 9;
      m.scale.set(s * 1.6, s * 0.45, s);
      m.position.set(cx0 + Math.sin(a) * r, -6 + rng.next() * 2, Math.cos(a) * r);
      this.clouds.push(m);
      this.world.add(m);
    }
    for (const s of sim.def.surfaces) this.world.add(this.buildShape(s.shape, grass, rock, wood));
    // small props on the ground floor
    const stone = std(0x6d6a7e);
    const tuft = std(0x3d7a62);
    for (let i = 0; i < 160; i++) {
      const a = rng.next() * Math.PI * 2;
      const r = Math.sqrt(rng.next()) * (sim.night === 2 ? 26 : 38);
      const cx = sim.night === 2 && rng.next() < 0.5 ? 70 : 0;
      const x = cx + Math.cos(a) * r;
      const z = Math.sin(a) * r;
      const onGround = sim.def.surfaces.some((s) => !s.solidOnly && s.top(x, z) === 0);
      const higher = sim.def.surfaces.some((s) => (s.top(x, z) ?? 0) > 0);
      if (!onGround || higher || sim.lanterns.some((l) => Math.hypot(l.pos[0] - x, l.pos[2] - z) < 6)) continue;
      const m = rng.next() < 0.65 ? new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.6 + rng.next() * 0.5, 5), tuft) : new THREE.Mesh(new THREE.DodecahedronGeometry(0.3 + rng.next() * 0.5), stone);
      m.position.set(x, 0.3, z);
      this.world.add(m);
    }
    for (const p of sim.def.pads) {
      const pad = new THREE.Mesh(new THREE.CylinderGeometry(p.radius, p.radius, 0.12, 24), new THREE.MeshStandardMaterial({ color: 0xffd27a, emissive: PAL.lampOn, emissiveIntensity: 1.1 }));
      pad.position.set(p.pos[0], p.pos[1] + 0.06, p.pos[2]);
      const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.4, 0.8, 8), new THREE.MeshBasicMaterial({ color: PAL.moteGlow }));
      arrow.position.set(p.pos[0], p.pos[1] + 1.2, p.pos[2]);
      this.world.add(pad, arrow);
    }
    for (let i = 0; i < 14; i++) {
      const leaf = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.25), new THREE.MeshBasicMaterial({ color: 0x7ec28a, side: THREE.DoubleSide, transparent: true, opacity: 0 }));
      this.leaves.push(leaf);
      this.world.add(leaf);
    }
    this.camPos.set(sim.player.pos[0], 6, sim.player.pos[2] - 9);
  }

  private buildShape(sh: Shape, grass: THREE.Material, rock: THREE.Material, wood: THREE.Material): THREE.Object3D {
    const g = new THREE.Group();
    switch (sh.type) {
      case "disc": {
        const depth = sh.y > 0 ? sh.y : 3;
        const body = new THREE.Mesh(new THREE.CylinderGeometry(sh.r, sh.r - (sh.y > 0 ? 0 : 2), depth, 64), sh.y > 0 ? rock : grass);
        body.position.set(sh.cx, sh.y - depth / 2, sh.cz);
        g.add(body);
        if (sh.y === 0) {
          const under = new THREE.Mesh(new THREE.ConeGeometry(sh.r - 2, 22, 40), rock);
          under.rotation.x = Math.PI;
          under.position.set(sh.cx, -3 - 11, sh.cz);
          const rim = new THREE.Mesh(new THREE.TorusGeometry(sh.r - 0.4, 0.45, 8, 96), std(0x8a7a62));
          rim.rotation.x = Math.PI / 2;
          rim.position.set(sh.cx, 0.05, sh.cz);
          g.add(under, rim);
        } else {
          const cap = new THREE.Mesh(new THREE.CylinderGeometry(sh.r, sh.r, 0.05, 48), grass);
          cap.position.set(sh.cx, sh.y, sh.cz);
          g.add(cap);
        }
        break;
      }
      case "rect": {
        const w = sh.x1 - sh.x0;
        const d = sh.z1 - sh.z0;
        const deck = new THREE.Mesh(new THREE.BoxGeometry(w, 0.4, d), wood);
        deck.position.set((sh.x0 + sh.x1) / 2, sh.y - 0.2, (sh.z0 + sh.z1) / 2);
        g.add(deck);
        for (let x = sh.x0 + 1; x < sh.x1; x += 2) {
          const plank = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.45, d + 0.1), std(0x4b3220));
          plank.position.set(x, sh.y - 0.2, (sh.z0 + sh.z1) / 2);
          g.add(plank);
        }
        break;
      }
      case "halfring": {
        const shape = new THREE.Shape();
        shape.absarc(0, 0, sh.r1, 0, Math.PI, false);
        shape.lineTo(-sh.r0, 0);
        shape.absarc(0, 0, sh.r0, Math.PI, 0, true);
        shape.lineTo(sh.r1, 0);
        const geo = new THREE.ExtrudeGeometry(shape, { depth: sh.y, bevelEnabled: false, curveSegments: 40 });
        geo.rotateX(Math.PI / 2);
        const m = new THREE.Mesh(geo, grass);
        m.position.y = sh.y;
        g.add(m);
        break;
      }
      case "ramp": {
        const len = Math.hypot(sh.s1 - sh.s0, sh.y0 - sh.y1);
        const a = Math.atan2(sh.y0 - sh.y1, sh.s1 - sh.s0);
        const holder = new THREE.Group();
        holder.rotation.y = -(sh.deg * Math.PI) / 180;
        const board = new THREE.Mesh(new THREE.BoxGeometry(len, 0.3, sh.width), wood);
        board.rotation.z = -a;
        board.position.set((sh.s0 + sh.s1) / 2, (sh.y0 + sh.y1) / 2 - 0.15, 0);
        holder.add(board);
        g.add(holder);
        break;
      }
      case "tower": {
        const body = new THREE.Mesh(new THREE.CylinderGeometry(sh.r * 0.8, sh.r, sh.y1 - sh.y0, 16), std(0x7a6a5a));
        body.position.y = (sh.y0 + sh.y1) / 2;
        const roof = new THREE.Mesh(new THREE.ConeGeometry(sh.r * 1.3, 2.2, 16), std(0x3b2c2c));
        roof.position.y = sh.y1 + 1.1;
        const bell = new THREE.Mesh(new THREE.SphereGeometry(0.6, 12, 10), std(PAL.gold, { emissive: 0x6b4a00, emissiveIntensity: 0.5 }));
        bell.position.y = sh.y1 - 1;
        g.add(body, roof, bell);
        break;
      }
    }
    return g;
  }

  // ---- dynamic objects -------------------------------------------------------------------------------
  private makeLantern(x: number, y: number, z: number): LanternView {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.22, 3.2, 8), std(PAL.wood));
    post.position.y = 1.6;
    const cap = new THREE.Mesh(new THREE.ConeGeometry(0.85, 0.6, 8), std(0x3b2c2c));
    cap.position.y = 4.55;
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.52, 1.3, 10), new THREE.MeshStandardMaterial({ color: PAL.lampOff, emissive: 0x6b2f00, emissiveIntensity: 0.1, roughness: 0.6 }));
    body.position.y = 3.75;
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 1.0, 0.4, 10), std(0x6a5a50));
    base.position.y = 0.2;
    const light = new THREE.PointLight(PAL.lampOn, 0, 46, 1.6);
    light.position.y = 3.8;
    const ring = new THREE.Mesh(new THREE.RingGeometry(T.safe_radius - 0.12, T.safe_radius, 64), new THREE.MeshBasicMaterial({ color: PAL.lampOn, transparent: true, opacity: 0.12, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.06;
    const halo = new THREE.Mesh(new THREE.SphereGeometry(1.7, 16, 12), new THREE.MeshBasicMaterial({ color: PAL.lampOn, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    halo.position.y = 3.75;
    g.add(post, cap, body, base, light, ring, halo);
    this.scene.add(g);
    return { group: g, body, light, ring, halo };
  }

  private makeMote(): THREE.Group {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(new THREE.SphereGeometry(0.17, 10, 8), new THREE.MeshBasicMaterial({ color: PAL.moteCore })));
    g.add(new THREE.Mesh(new THREE.SphereGeometry(0.46, 10, 8), new THREE.MeshBasicMaterial({ color: PAL.moteGlow, transparent: true, opacity: 0.28, blending: THREE.AdditiveBlending, depthWrite: false })));
    this.scene.add(g);
    return g;
  }

  private makeShade(): THREE.Group {
    const g = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: PAL.shade, emissive: 0x2c0a55, emissiveIntensity: 0.9, roughness: 0.5 });
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
    const aura = new THREE.Mesh(new THREE.SphereGeometry(1.15, 14, 10), new THREE.MeshBasicMaterial({ color: PAL.shadeEdge, transparent: true, opacity: 0.14, depthWrite: false }));
    g.add(body, drip, e1, e2, aura);
    g.userData = { mat, eyes: eyeMat, aura };
    this.scene.add(g);
    return g;
  }

  private makeDrifter(): THREE.Group {
    const g = new THREE.Group();
    const m = new THREE.MeshStandardMaterial({ color: PAL.drifter, emissive: 0x3a4a60, emissiveIntensity: 0.6, roughness: 0.6 });
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.4, 12, 10), m);
    for (let i = 0; i < 3; i++) {
      const strip = new THREE.Mesh(new THREE.PlaneGeometry(0.25, 1.6), new THREE.MeshBasicMaterial({ color: PAL.drifter, side: THREE.DoubleSide, transparent: true, opacity: 0.7 }));
      strip.position.set(-0.2 + i * 0.2, 0.1, -0.7 - i * 0.2);
      strip.rotation.x = Math.PI / 2;
      g.add(strip);
    }
    const loot = new THREE.Mesh(new THREE.SphereGeometry(0.28, 8, 6), new THREE.MeshBasicMaterial({ color: PAL.gold, transparent: true, opacity: 0.8 }));
    loot.position.y = -0.5;
    g.add(head, loot);
    g.userData = { loot };
    this.scene.add(g);
    return g;
  }

  private makeCharm(): THREE.Group {
    const g = new THREE.Group();
    const card = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.9, 0.08), std(PAL.scarf, { emissive: 0x5a0a14, emissiveIntensity: 0.6 }));
    const edge = new THREE.Mesh(new THREE.BoxGeometry(0.82, 1.02, 0.05), std(PAL.gold, { emissive: 0x6b5200, emissiveIntensity: 0.5 }));
    edge.position.z = -0.04;
    g.add(edge, card);
    this.scene.add(g);
    return g;
  }

  /** Short expanding ring on the ground (pulse, lantern lit, dash). */
  burst(x: number, z: number, color: number, to: number, life: number, y = 0): void {
    const mesh = new THREE.Mesh(new THREE.RingGeometry(0.85, 1, 48), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, y + 0.1, z);
    this.scene.add(mesh);
    this.bursts.push({ mesh, age: 0, life, from: 0.5, to });
  }

  /** Remove everything dynamic so a new sim can be shown. */
  reset(): void {
    for (const l of this.lanterns.values()) this.scene.remove(l.group);
    for (const m of this.motes.values()) this.scene.remove(m);
    for (const s of this.shades.values()) this.scene.remove(s);
    for (const d of this.drifters.values()) this.scene.remove(d);
    for (const c of this.charms.values()) this.scene.remove(c);
    for (const b of this.bursts) this.scene.remove(b.mesh);
    this.lanterns.clear();
    this.motes.clear();
    this.shades.clear();
    this.drifters.clear();
    this.charms.clear();
    this.leaves = [];
    this.bursts = [];
    this.lastPos.set(0, 0, 0);
    this.heading = 0;
  }

  // ---- per-frame --------------------------------------------------------------------------------------
  update(sim: Sim, dt: number, camYawDeg: number): void {
    this.time += dt;
    const t = this.time;
    const P = sim.player;
    const p = P.pos;
    const ratio = sim.litCount / sim.lanterns.length;

    // player
    this.may.position.set(p[0], p[1], p[2]);
    const dx = p[0] - this.lastPos.x;
    const dz = p[2] - this.lastPos.z;
    const moving = Math.hypot(dx, dz) > 1e-4;
    if (moving) {
      let d = Math.atan2(dx, dz) - this.heading;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.heading += d * Math.min(1, dt * 14);
    }
    this.lastPos.set(p[0], p[1], p[2]);
    this.may.rotation.y = this.heading;
    this.mayBody.position.y = moving && P.grounded ? Math.abs(Math.sin(t * 12)) * 0.07 : 0;
    this.mayBody.rotation.z = moving ? Math.sin(t * 12) * 0.05 : 0;
    this.may.visible = (!sim.invulnerable || Math.floor(t * 14) % 2 === 0) && P.fallWait === 0;
    this.mayLight.intensity = 24 + Math.sin(t * 7) * 3 + (P.charm > 0 ? 10 : 0);

    // lanterns
    for (const l of sim.lanterns) {
      let v = this.lanterns.get(l.id);
      if (!v) {
        v = this.makeLantern(l.pos[0], l.pos[1], l.pos[2]);
        this.lanterns.set(l.id, v);
      }
      const fill = l.lit ? 1 : l.deposited / T.lantern_cost;
      const mat = v.body.material as THREE.MeshStandardMaterial;
      mat.emissive.setHex(l.lit ? PAL.lampOn : 0x8a3a00);
      mat.emissiveIntensity = l.lit ? 1.5 + Math.sin(t * 5 + l.pos[0]) * 0.2 : 0.1 + fill * 1.2;
      mat.color.setHex(l.lit ? PAL.lampCore : PAL.lampOff);
      v.light.intensity = l.lit ? 70 + Math.sin(t * 4 + l.pos[2]) * 6 : fill * 12;
      (v.ring.material as THREE.MeshBasicMaterial).opacity = 0.35;
      (v.halo.material as THREE.MeshBasicMaterial).opacity = l.lit ? 0.13 : fill * 0.1;
      v.ring.visible = l.lit; // the safe circle only exists around lit lanterns
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
      g.visible = !(m.ttl !== null && m.ttl < 120 && Math.floor(t * 10) % 2 === 0);
      g.scale.setScalar(m.kind === "dropped" ? 0.8 : 1);
      g.position.set(m.pos[0], m.pos[1] + 0.75 + Math.sin(t * 2.2 + i * 1.7) * 0.18, m.pos[2]);
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
      const st = sim.shadeState(s);
      const stunned = st === "stunned";
      g.position.set(s.pos[0], s.pos[1] + (stunned ? -0.1 : Math.sin(t * 4 + s.pos[0]) * 0.12), s.pos[2]);
      g.rotation.y = Math.atan2(p[0] - s.pos[0], p[2] - s.pos[2]);
      const grow = st === "spawning" ? 1 - sim.stateTicksLeft(s) / 60 : 1;
      const k = (stunned ? 0.85 : 1 + Math.sin(t * 6 + s.pos[2]) * 0.06) * (0.2 + 0.8 * grow);
      g.scale.set(k, stunned ? k * 0.8 : k, k);
      const ud = g.userData as { mat: THREE.MeshStandardMaterial; eyes: THREE.MeshBasicMaterial; aura: THREE.Mesh };
      ud.mat.color.setHex(stunned ? PAL.shadeStun : PAL.shade);
      ud.mat.emissive.setHex(stunned ? 0x3a4a90 : 0x2c0a55);
      (ud.aura.material as THREE.MeshBasicMaterial).color.setHex(this.colorBlind ? 0x00b3ff : PAL.shadeEdge);
      ud.eyes.color.setHex(this.colorBlind ? 0x00b3ff : stunned ? 0xcfe0ff : 0xd9b8ff);
    }
    for (const [id, g] of this.shades) {
      if (!seenS.has(id)) {
        this.scene.remove(g);
        this.shades.delete(id);
      }
    }

    // drifters
    const seenD = new Set<string>();
    for (const d of sim.drifters) {
      seenD.add(d.id);
      let g = this.drifters.get(d.id);
      if (!g) {
        g = this.makeDrifter();
        this.drifters.set(d.id, g);
      }
      g.position.set(d.pos[0], d.pos[1] + Math.sin(t * 3 + d.pos[0]) * 0.2, d.pos[2]);
      g.rotation.y = d.state === "flee" ? Math.atan2(d.fleeDir?.[0] ?? 0, d.fleeDir?.[1] ?? 1) : Math.atan2(p[0] - d.pos[0], p[2] - d.pos[2]);
      (g.userData.loot as THREE.Mesh).visible = d.stolen > 0;
    }
    for (const [id, g] of this.drifters) {
      if (!seenD.has(id)) {
        this.scene.remove(g);
        this.drifters.delete(id);
      }
    }

    // charms
    for (const c of sim.charms) {
      let g = this.charms.get(c.id);
      if (!g) {
        g = this.makeCharm();
        this.charms.set(c.id, g);
      }
      g.visible = c.available;
      g.position.set(c.pos[0], c.pos[1] + 1.3 + Math.sin(t * 2.5) * 0.15, c.pos[2]);
      g.rotation.y = t * 1.5;
    }

    // wind leaves
    const windOn = sim.windActive || sim.windWarning;
    const dirRad = (sim.windDirDeg * Math.PI) / 180;
    this.leaves.forEach((leaf, n) => {
      (leaf.material as THREE.MeshBasicMaterial).opacity = windOn ? (sim.windActive ? 0.9 : 0.4) : 0;
      if (!windOn) return;
      const u = (t * 0.25 + n / this.leaves.length) % 1;
      const along = (u - 0.5) * 30;
      const side = ((n * 37) % 11) - 5;
      leaf.position.set(p[0] + Math.cos(dirRad) * along - Math.sin(dirRad) * side, p[1] + 1.5 + Math.sin(t * 3 + n) * 0.8, p[2] + Math.sin(dirRad) * along + Math.cos(dirRad) * side);
      leaf.rotation.set(t * 2 + n, t * 1.5, 0);
    });

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

    // ambient light grows with the lit lanterns: 0.15 + 0.55 * (lit / total)
    this.ambient.intensity = (0.15 + 0.55 * ratio) * 2.4 + 0.5;
    const sky = new THREE.Color(PAL.sky).lerp(new THREE.Color(PAL.fog), ratio);
    (this.scene.background as THREE.Color).copy(sky);
    (this.scene.fog as THREE.FogExp2).color.copy(sky);
    for (const c of this.clouds) c.position.x += Math.sin(t * 0.1 + c.position.z) * dt * 0.4;

    // third-person camera behind Mây
    const th = (camYawDeg * Math.PI) / 180;
    const fx = Math.sin(th);
    const fz = Math.cos(th);
    const ref = P.fallWait > 0 ? -2 : p[1];
    const want = new THREE.Vector3(p[0] - fx * 9.5, ref * 0.7 + 6.2, p[2] - fz * 9.5);
    this.camPos.lerp(want, Math.min(1, dt * 8));
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(p[0] + fx * 2.5, 1.3 + ref * 0.7, p[2] + fz * 2.5);
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }
}
