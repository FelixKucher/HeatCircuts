// 3D-Ansicht: Geschosse mit Wänden, Öffnungen, Böden mit Aussparungen, Heizflächen, Verteiler,
// Treppen und Dach. Planachsen: x → X, y → Z, Höhe → Y.

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { Floor, FloorVoid, Project, Room, Vec, Wall } from '../model/types';
import type { DesignResult } from '../calc/design';
import type { Store } from '../model/store';
import { add, bbox, centroid, cross, dist, mul, norm, sub, v } from '../geometry/geom';
import { defaultField, fieldRuns } from '../geometry/wallfield';
import { subtractVoids } from '../geometry/subtract';
import { circuitDrawings } from './render';

export interface View3DOptions {
  showRoof: boolean;
  upToActive: boolean;
  showCircuits: boolean;
}

const COL = {
  wallExt: 0xd9d4cb,
  wallInt: 0xece8e1,
  floorHeated: 0xf0e2d0,
  floorElectric: 0xf3cfa9,
  floorUnheated: 0xd7dadc,
  garage: 0xb9bec2,
  glass: 0x9ecbe6,
  door: 0x8a6b4f,
  roof: 0x9b4a35,
  supply: 0xd23c2a,
  ret: 0x2c62c9,
  manifold: 0x0c7566,
  source: 0x7a3fb3,
  stair: 0xc9b79c,
  wallHeat: 0xe06a4a,
  ceilHeat: 0xf0a060,
  selected: 0x18a08c,
};

const P3 = (p: Vec, y: number) => new THREE.Vector3(p.x, y, p.y);

export class View3D {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private group = new THREE.Group();
  private pickables: THREE.Object3D[] = [];
  private raycaster = new THREE.Raycaster();
  private needsFit = true;
  private rebuildTimer = 0;
  options: View3DOptions = { showRoof: true, upToActive: false, showCircuits: true };

  constructor(
    private host: HTMLElement,
    private store: Store,
    private onPick: (floorId: string, roomId: string) => void,
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.domElement.className = 'view3d-canvas';
    host.appendChild(this.renderer.domElement);
    this.camera = new THREE.PerspectiveCamera(40, 1, 0.1, 500);
    this.camera.position.set(18, 16, 22);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = false;
    this.controls.maxPolarAngle = Math.PI * 0.495;
    this.controls.addEventListener('change', () => this.draw());
    const hemi = new THREE.HemisphereLight(0xffffff, 0x8a8f94, 1.6);
    const dir = new THREE.DirectionalLight(0xffffff, 1.4);
    dir.position.set(-12, 20, -8);
    this.scene.add(hemi, dir, this.group);
    const ground = new THREE.Mesh(new THREE.CircleGeometry(60, 48), new THREE.MeshStandardMaterial({ color: 0xc8ceb8, roughness: 1 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.02;
    ground.name = 'ground';
    this.scene.add(ground);
    new ResizeObserver(() => this.resize()).observe(host);
    this.renderer.domElement.addEventListener('dblclick', (e) => this.pick(e));
  }

  get visible(): boolean {
    return !this.host.hidden;
  }

  show(): void {
    this.host.hidden = false;
    this.needsFit = true;
    this.resize();
    this.rebuild();
  }

  hide(): void {
    this.host.hidden = true;
  }

  requestRebuild(): void {
    if (!this.visible) return;
    clearTimeout(this.rebuildTimer);
    this.rebuildTimer = window.setTimeout(() => this.rebuild(), 120);
  }

  private resize(): void {
    const r = this.host.getBoundingClientRect();
    if (r.width < 10 || r.height < 10) return;
    this.renderer.setSize(r.width, r.height, false);
    this.camera.aspect = r.width / r.height;
    this.camera.updateProjectionMatrix();
    this.draw();
  }

  private draw(): void {
    if (!this.visible) return;
    const bg = getComputedStyle(document.documentElement).getPropertyValue('--paper').trim() || '#f4f6f7';
    this.scene.background = new THREE.Color(bg);
    this.renderer.render(this.scene, this.camera);
  }

  private pick(e: MouseEvent): void {
    const r = this.renderer.domElement.getBoundingClientRect();
    const m = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(m, this.camera);
    const hit = this.raycaster.intersectObjects(this.pickables, false)[0];
    if (hit?.object.userData.roomId) this.onPick(hit.object.userData.floorId, hit.object.userData.roomId);
  }

  rebuild(): void {
    const p = this.store.project;
    const d = this.store.design;
    for (const c of [...this.group.children]) {
      this.group.remove(c);
      c.traverse((o) => {
        const mesh = o as THREE.Mesh;
        mesh.geometry?.dispose();
        const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
        else mat?.dispose();
      });
    }
    this.pickables = [];
    const sorted = p.floors.slice().sort((a, b) => a.elevation - b.elevation);
    const active = this.store.floor;
    const shown = this.options.upToActive ? sorted.filter((f) => f.elevation <= active.elevation + 1e-6) : sorted;
    for (const f of shown) this.buildFloor(p, f, d, sorted, f.id === active.id);
    const top = shown[shown.length - 1];
    if (this.options.showRoof && top && top.id === sorted[sorted.length - 1].id) this.buildRoof(p, top);
    if (this.needsFit) this.fit();
    this.draw();
  }

  private fit(): void {
    const box = new THREE.Box3().setFromObject(this.group);
    if (box.isEmpty()) return;
    const c = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3()).length();
    this.controls.target.copy(c);
    this.camera.position.copy(c.clone().add(new THREE.Vector3(0.75, 0.6, 0.95).normalize().multiplyScalar(size * 1.15)));
    this.camera.near = 0.05;
    this.camera.far = size * 20;
    this.camera.updateProjectionMatrix();
    this.controls.update();
    this.needsFit = false;
  }

  private mat(color: number, opts: Partial<THREE.MeshStandardMaterialParameters> = {}): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0, ...opts });
  }

  private buildFloor(p: Project, f: Floor, d: DesignResult, sorted: Floor[], isActive: boolean): void {
    const base = f.elevation;
    const g = new THREE.Group();
    g.name = f.name;
    // Böden je Raum mit Aussparungen für Treppen/Lufträume
    for (const r of f.rooms) {
      const shape = new THREE.Shape(r.polygon.map((q) => new THREE.Vector2(q.x, q.y)));
      for (const vd of f.voids) {
        const c = centroid(vd.polygon);
        if (!pointIn(c, r.polygon)) continue;
        shape.holes.push(new THREE.Path(vd.polygon.map((q) => new THREE.Vector2(q.x, q.y))));
      }
      const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.18, bevelEnabled: false });
      geo.rotateX(Math.PI / 2);
      geo.translate(0, base, 0);
      const rr = d.rooms.get(r.id);
      const electric = r.surfaces.some((s) => s.system === 'electric');
      const color = r.type === 'garage' ? COL.garage : !r.heated ? COL.floorUnheated : electric ? COL.floorElectric : COL.floorHeated;
      const mesh = new THREE.Mesh(geo, this.mat(color, { emissive: this.store.selection?.id === r.id ? COL.selected : 0x000000, emissiveIntensity: 0.25 }));
      mesh.userData = { roomId: r.id, floorId: f.id };
      this.pickables.push(mesh);
      g.add(mesh);
      if (this.options.showCircuits && rr) this.addCircuits(g, p, f, r, rr, base);
      // Deckenheizung
      if (r.heated && r.surfaces.some((s) => s.kind === 'ceiling')) {
        const cs = new THREE.ShapeGeometry(new THREE.Shape(r.polygon.map((q) => new THREE.Vector2(q.x, q.y))));
        cs.rotateX(Math.PI / 2);
        cs.translate(0, base + f.clearHeight - 0.01, 0);
        g.add(new THREE.Mesh(cs, this.mat(COL.ceilHeat, { transparent: true, opacity: 0.45, side: THREE.DoubleSide })));
      }
    }
    // Wände mit Öffnungen
    for (const w of f.walls) this.addWall(g, w, base, f.storeyHeight, isActive);
    // Wandheizung
    for (const r of f.rooms) {
      if (!r.heated) continue;
      for (const s of r.surfaces) {
        if (s.kind !== 'wall') continue;
        const w = f.walls.find((x) => x.id === s.wallId);
        if (!w) continue;
        const fld = s.field ?? defaultField(w, r, f.clearHeight)!;
        const dir = norm(sub(w.b, w.a));
        const n0 = v(-dir.y, dir.x);
        const side = cross(dir, sub(centroid(r.polygon), w.a)) > 0 ? 1 : -1;
        const off = mul(n0, side * (w.thickness / 2 + 0.012));
        const L = fld.x1 - fld.x0;
        const plane = new THREE.Mesh(new THREE.PlaneGeometry(L, fld.z1 - fld.z0), this.mat(COL.wallHeat, { transparent: true, opacity: 0.35, side: THREE.DoubleSide }));
        const mid = add(add(w.a, mul(dir, (fld.x0 + fld.x1) / 2)), off);
        plane.position.copy(P3(mid, base + (fld.z0 + fld.z1) / 2));
        plane.rotation.y = -Math.atan2(dir.y, dir.x);
        g.add(plane);
        if (this.options.showCircuits) {
          const pts: THREE.Vector3[] = [];
          fieldRuns(fld, w.openings, s.spacing).forEach((row) => {
            for (const [xa, xb] of row.runs) {
              pts.push(P3(add(add(w.a, mul(dir, xa)), mul(off, 1.3)), base + row.z), P3(add(add(w.a, mul(dir, xb)), mul(off, 1.3)), base + row.z));
            }
          });
          if (pts.length) g.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: COL.supply })));
        }
      }
    }
    // Treppen (vom Geschoss darunter bis zu diesem Geschoss)
    const below = sorted[sorted.indexOf(f) - 1];
    for (const vd of f.voids) if (below) this.addStair(g, vd, below.elevation, base);
    // Verteiler und Wärmeerzeuger
    for (const m of f.manifolds) {
      const box = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.7, 0.12), this.mat(COL.manifold));
      box.position.copy(P3(m.pos, base + 0.65));
      g.add(box);
    }
    if (p.heatSource?.floorId === f.id) {
      const box = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.8, 0.6), this.mat(COL.source));
      box.position.copy(P3(p.heatSource.pos, base + 0.9));
      g.add(box);
    }
    this.group.add(g);
  }

  private addCircuits(g: THREE.Group, p: Project, f: Floor, r: Room, rr: NonNullable<ReturnType<DesignResult['rooms']['get']>>, base: number): void {
    for (const sr of rr.surfaces) {
      if (sr.kind !== 'floor' || sr.medium !== 'water' || !sr.circuits.length) continue;
      const s = r.surfaces.find((x) => x.id === sr.surfaceId)!;
      const poly = subtractVoids(r.polygon, f.voids);
      const drawings = circuitDrawings(poly, sr.circuits.length, s.spacing, s.pattern, p.design.wallDistance, rr.connector);
      const y = base + 0.025;
      for (const dw of drawings) {
        for (const line of dw.supply) g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(line.map((q) => P3(q, y))), new THREE.LineBasicMaterial({ color: COL.supply })));
        for (const line of dw.ret) g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(line.map((q) => P3(q, y))), new THREE.LineBasicMaterial({ color: COL.ret })));
      }
      if (rr.feederPath.length > 1 && rr.manifoldFloorId === f.id) {
        g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(rr.feederPath.map((q) => P3(q, y + 0.01))), new THREE.LineBasicMaterial({ color: COL.supply })));
      }
    }
  }

  private addWall(g: THREE.Group, w: Wall, base: number, height: number, isActive: boolean): void {
    const L = dist(w.a, w.b);
    if (L < 0.01) return;
    const dir = norm(sub(w.b, w.a));
    const ang = -Math.atan2(dir.y, dir.x);
    const matWall = this.mat(w.kind === 'exterior' ? COL.wallExt : COL.wallInt, { transparent: !isActive && this.options.upToActive === false, opacity: 1 });
    const box = (t0: number, t1: number, z0: number, z1: number, mat: THREE.Material, thick = w.thickness) => {
      if (t1 - t0 < 0.005 || z1 - z0 < 0.005) return;
      const m = new THREE.Mesh(new THREE.BoxGeometry(t1 - t0, z1 - z0, thick), mat);
      const mid = add(w.a, mul(dir, (t0 + t1) / 2));
      m.position.copy(P3(mid, base + (z0 + z1) / 2));
      m.rotation.y = ang;
      g.add(m);
    };
    const ops = w.openings.slice().sort((a, b) => a.offset - b.offset);
    let t = 0;
    for (const o of ops) {
      const o0 = Math.max(0, o.offset - o.width / 2);
      const o1 = Math.min(L, o.offset + o.width / 2);
      box(t, o0, 0, height, matWall);
      box(o0, o1, 0, o.sill, matWall);
      box(o0, o1, Math.min(height, o.sill + o.height), height, matWall);
      if (o.kind === 'window') box(o0, o1, o.sill, o.sill + o.height, this.mat(COL.glass, { transparent: true, opacity: 0.35, roughness: 0.1 }), 0.03);
      t = Math.max(t, o1);
    }
    box(t, L, 0, height, matWall);
  }

  private addStair(g: THREE.Group, vd: FloorVoid, z0: number, z1: number): void {
    if (vd.kind === 'void') return;
    const H = z1 - z0;
    const n = Math.max(8, Math.round(H / 0.18));
    const rise = H / n;
    const mat = this.mat(COL.stair);
    if (vd.kind === 'spiral' && vd.center && vd.radius) {
      const c = vd.center;
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, H, 12), this.mat(0x777777));
      post.position.copy(P3(c, z0 + H / 2));
      g.add(post);
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2 * 0.95;
        const step = new THREE.Mesh(new THREE.BoxGeometry(vd.radius, 0.04, 0.22), mat);
        const mid = add(c, v((Math.cos(a) * vd.radius) / 2, (Math.sin(a) * vd.radius) / 2));
        step.position.copy(P3(mid, z0 + (k + 1) * rise));
        step.rotation.y = -a;
        g.add(step);
      }
      return;
    }
    const b = bbox(vd.polygon);
    const alongY = vd.direction ? vd.direction.startsWith('y') : b.max.y - b.min.y >= b.max.x - b.min.x;
    const forward = !(vd.direction === 'y-' || vd.direction === 'x-');
    const len = alongY ? b.max.y - b.min.y : b.max.x - b.min.x;
    const width = alongY ? b.max.x - b.min.x : b.max.y - b.min.y;
    const run = len / n;
    for (let k = 0; k < n; k++) {
      const s = forward ? k : n - 1 - k;
      const center = alongY ? v((b.min.x + b.max.x) / 2, b.min.y + (s + 0.5) * run) : v(b.min.x + (s + 0.5) * run, (b.min.y + b.max.y) / 2);
      const h = (k + 1) * rise;
      const step = new THREE.Mesh(alongY ? new THREE.BoxGeometry(width, h, run) : new THREE.BoxGeometry(run, h, width), mat);
      step.position.copy(P3(center, z0 + h / 2));
      g.add(step);
    }
  }

  private buildRoof(p: Project, top: Floor): void {
    const roof = p.roof;
    if (roof.type === 'none') return;
    const ext = top.walls.filter((w) => w.kind === 'exterior');
    if (!ext.length) return;
    const pts: Vec[] = [];
    ext.forEach((w) => pts.push(w.a, w.b));
    const b = bbox(pts);
    const t = Math.max(...ext.map((w) => w.thickness)) / 2;
    const o = roof.overhang + t;
    const x0 = b.min.x - o;
    const x1 = b.max.x + o;
    const y0 = b.min.y - o;
    const y1 = b.max.y + o;
    const eave = top.elevation + top.storeyHeight + (roof.insulation === 'topSlab' ? roof.kneeWall : 0);
    const tan = Math.tan((roof.pitch * Math.PI) / 180);
    const mat = this.mat(COL.roof, { side: THREE.DoubleSide });
    const gableMat = this.mat(COL.wallExt, { side: THREE.DoubleSide });
    const tri: number[] = [];
    const gable: number[] = [];
    const push = (arr: number[], ...v3: THREE.Vector3[]) => v3.forEach((q) => arr.push(q.x, q.y, q.z));
    const V = (x: number, y: number, h: number) => new THREE.Vector3(x, h, y);
    // Kniestock als Wandband
    if (roof.insulation === 'topSlab' && roof.kneeWall > 0) {
      for (const w of ext) this.addWall(this.group, { ...w, openings: [] }, top.elevation + top.storeyHeight, roof.kneeWall, true);
    }
    if (roof.type === 'flat') {
      const slab = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, 0.3, y1 - y0), this.mat(0x6f7478));
      slab.position.set((x0 + x1) / 2, eave + 0.15, (y0 + y1) / 2);
      this.group.add(slab);
      return;
    }
    const alongX = roof.ridge === 'x';
    const span = alongX ? y1 - y0 : x1 - x0;
    if (roof.type === 'shed') {
      const rise = span * tan;
      if (alongX) {
        push(tri, V(x0, y0, eave + rise), V(x1, y0, eave + rise), V(x1, y1, eave), V(x0, y0, eave + rise), V(x1, y1, eave), V(x0, y1, eave));
        push(gable, V(x0 + o, y0 + o, eave), V(x0 + o, y0 + o, eave + rise - o * tan), V(x0 + o, y1 - o, eave), V(x1 - o, y0 + o, eave), V(x1 - o, y0 + o, eave + rise - o * tan), V(x1 - o, y1 - o, eave));
      } else {
        push(tri, V(x0, y0, eave + rise), V(x0, y1, eave + rise), V(x1, y1, eave), V(x0, y0, eave + rise), V(x1, y1, eave), V(x1, y0, eave));
      }
    } else {
      const rise = (span / 2) * tan;
      if (alongX) {
        const ym = (y0 + y1) / 2;
        const inset = roof.type === 'hip' ? Math.min(span / 2, (x1 - x0) / 2) : 0;
        const rx0 = x0 + inset;
        const rx1 = x1 - inset;
        push(tri, V(x0, y0, eave), V(x1, y0, eave), V(rx1, ym, eave + rise), V(x0, y0, eave), V(rx1, ym, eave + rise), V(rx0, ym, eave + rise));
        push(tri, V(x0, y1, eave), V(rx0, ym, eave + rise), V(rx1, ym, eave + rise), V(x0, y1, eave), V(rx1, ym, eave + rise), V(x1, y1, eave));
        if (roof.type === 'hip') push(tri, V(x0, y0, eave), V(rx0, ym, eave + rise), V(x0, y1, eave), V(x1, y0, eave), V(x1, y1, eave), V(rx1, ym, eave + rise));
        else push(gable, V(x0 + o, y0 + o, eave), V(x0 + o, ym, eave + rise - o * tan), V(x0 + o, y1 - o, eave), V(x1 - o, y0 + o, eave), V(x1 - o, ym, eave + rise - o * tan), V(x1 - o, y1 - o, eave));
      } else {
        const xm = (x0 + x1) / 2;
        const inset = roof.type === 'hip' ? Math.min(span / 2, (y1 - y0) / 2) : 0;
        const ry0 = y0 + inset;
        const ry1 = y1 - inset;
        push(tri, V(x0, y0, eave), V(x0, y1, eave), V(xm, ry1, eave + rise), V(x0, y0, eave), V(xm, ry1, eave + rise), V(xm, ry0, eave + rise));
        push(tri, V(x1, y0, eave), V(xm, ry0, eave + rise), V(xm, ry1, eave + rise), V(x1, y0, eave), V(xm, ry1, eave + rise), V(x1, y1, eave));
        if (roof.type === 'hip') push(tri, V(x0, y0, eave), V(xm, ry0, eave + rise), V(x1, y0, eave), V(x0, y1, eave), V(x1, y1, eave), V(xm, ry1, eave + rise));
        else push(gable, V(x0 + o, y0 + o, eave), V(xm, y0 + o, eave + rise - o * tan), V(x1 - o, y0 + o, eave), V(x0 + o, y1 - o, eave), V(xm, y1 - o, eave + rise - o * tan), V(x1 - o, y1 - o, eave));
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(tri, 3));
    geo.computeVertexNormals();
    this.group.add(new THREE.Mesh(geo, mat));
    if (gable.length) {
      const gg = new THREE.BufferGeometry();
      gg.setAttribute('position', new THREE.Float32BufferAttribute(gable, 3));
      gg.computeVertexNormals();
      this.group.add(new THREE.Mesh(gg, gableMat));
    }
  }

  /** Bild der aktuellen Ansicht als PNG */
  snapshot(): string {
    this.draw();
    return this.renderer.domElement.toDataURL('image/png');
  }
}

function pointIn(p: Vec, poly: Vec[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
