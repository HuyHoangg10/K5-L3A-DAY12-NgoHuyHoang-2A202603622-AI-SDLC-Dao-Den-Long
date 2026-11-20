import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/**
 * Many copies of the same small model drawn with a few draw calls (shades, fireflies).
 * Each copy has a position, a yaw, a scale and a tint; the benchmark scene (200 shades + 100 fireflies) relies on this.
 */
export interface Part {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  /** the tint of the copy multiplies this part (true) or is ignored (false) */
  tint: boolean;
}

export class Swarm {
  readonly meshes: THREE.InstancedMesh[] = [];
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private p = new THREE.Vector3();
  private s = new THREE.Vector3();
  private yAxis = new THREE.Vector3(0, 1, 0);
  private n = 0;
  private col = new THREE.Color();

  constructor(
    scene: THREE.Object3D,
    parts: Part[],
    readonly capacity: number,
  ) {
    for (const part of parts) {
      const im = new THREE.InstancedMesh(part.geometry, part.material, capacity);
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      im.frustumCulled = false; // instances move around; the bounding sphere of the base geometry is wrong
      im.count = 0;
      if (part.tint) {
        im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3).fill(1), 3);
        im.instanceColor.setUsage(THREE.DynamicDrawUsage);
      }
      this.meshes.push(im);
      scene.add(im);
    }
  }

  begin(): void {
    this.n = 0;
  }

  /** Add one copy; returns false when the swarm is full. */
  add(x: number, y: number, z: number, yaw: number, sx: number, sy: number, tint: number, tint2: number = tint): boolean {
    if (this.n >= this.capacity) return false;
    this.q.setFromAxisAngle(this.yAxis, yaw);
    this.p.set(x, y, z);
    this.s.set(sx, sy, sx);
    this.m.compose(this.p, this.q, this.s);
    this.meshes.forEach((im, i) => {
      im.setMatrixAt(this.n, this.m);
      if (im.instanceColor) im.setColorAt(this.n, this.col.setHex(i === 0 ? tint : tint2));
    });
    this.n++;
    return true;
  }

  end(): void {
    for (const im of this.meshes) {
      im.count = this.n;
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
    }
  }

  get used(): number {
    return this.n;
  }

  dispose(scene: THREE.Object3D): void {
    for (const im of this.meshes) scene.remove(im);
  }
}

/** Paint every vertex of a geometry one colour (so several parts can be merged into one mesh with vertex colours). */
export function painted(g: THREE.BufferGeometry, hex: number): THREE.BufferGeometry {
  const c = new THREE.Color(hex);
  const n = g.attributes.position!.count;
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    a[i * 3] = c.r;
    a[i * 3 + 1] = c.g;
    a[i * 3 + 2] = c.b;
  }
  g.setAttribute("color", new THREE.BufferAttribute(a, 3));
  return g;
}

export function merged(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const out = mergeGeometries(list.map((g) => (g.index ? g.toNonIndexed() : g)));
  if (!out) throw new Error("could not merge geometries");
  return out;
}
