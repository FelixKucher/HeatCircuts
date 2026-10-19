// 3D-Ansicht: Wände mit Gehrung und Öffnungen, Böden mit Materialien, Decken, Möbel, Treppen, Dach, Gelände
// (auch Hanglage) und Heizung (Heizkreise, Wand- und Deckenheizfelder, Verteiler, Wärmeerzeuger).
// Planachsen: x → X, y → Z, Höhe → Y. Modi: Luftbild (Orbit) und Rundgang (Augenhöhe 1,65 m).

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CATALOG_BY_KEY, mat } from '../cad/furniture';
import { styleOf } from '../cad/openings';
import type { FloorFinish, Floor as Level, Opening, Project, Room, Vec, Wall } from '../model/types';
import { aboveOf, belowOf, finishOf, floorColorOf } from './plan-render';
import { stairGeometry } from '../cad/stairs';
import type { Store } from '../model/store';
import { left, pointOnWall, wallDir, wallLength, wallOutlines, type WallOutline } from '../cad/walls';
import type { DesignResult } from '../calc/design';
import { add, centroid, cross, mul, norm, sub } from '../geometry/geom';
import { defaultField, fieldRuns } from '../geometry/wallfield';
import { subtractVoids } from '../geometry/subtract';
import { buildingBounds, groundLevel } from '../geometry/terrain';
import { circuitDrawings } from './render';

const wallHeight = (w: Wall, l: Level): number => w.height ?? l.storeyHeight;
const P3 = (p: Vec, y: number) => new THREE.Vector3(p.x, y, p.y);
const COL = { supply: 0xd23c2a, ret: 0x2c62c9, manifold: 0x0c7566, source: 0x7a3fb3, wallHeat: 0xe06a4a, ceilHeat: 0xf0a060 };

export interface View3DOptions {
  allLevels: boolean;
  showRoof: boolean;
  showCeilings: boolean;
  shadows: boolean;
  /** Heizkreise und Heizflächen zeigen */
  showHeating: boolean;
}

const EYE = 1.65;

export class View3D {
  readonly renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private group = new THREE.Group();
  private sun: THREE.DirectionalLight;
  private pickables: THREE.Object3D[] = [];
  private needsFit = true;
  private timer = 0;
  mode: 'orbit' | 'walk' = 'orbit';
  options: View3DOptions = { allLevels: true, showRoof: true, showCeilings: true, shadows: true, showHeating: false };
  private terrain = new THREE.Group();
  private walk = { pos: new THREE.Vector3(), yaw: 0, pitch: 0, keys: new Set<string>(), raf: 0, last: 0 };
  private textures = new Map<string, THREE.Texture>();
  private headlight = new THREE.PointLight(0xfff4e6, 0, 14, 1.4);
  private wasEmpty = true;

  constructor(
    private host: HTMLElement,
    private store: Store,
    private onPick: (kind: string, id: string, wallId: string | undefined, floorId: string | undefined) => void,
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    host.appendChild(this.renderer.domElement);
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.05, 800);
    this.camera.position.set(14, 14, 18);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.maxPolarAngle = Math.PI * 0.49;
    this.controls.addEventListener('change', () => this.draw());
    this.scene.background = new THREE.Color(0xdfe8ee);
    this.scene.fog = new THREE.Fog(0xdfe8ee, 80, 260);
    this.scene.add(new THREE.HemisphereLight(0xf4f7fb, 0x8b8f80, 1.15));
    this.sun = new THREE.DirectionalLight(0xffffff, 2.1);
    this.sun.position.set(-18, 30, 14);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.04;
    this.scene.add(this.sun, this.sun.target);
    this.scene.add(this.terrain, this.group, this.camera);
    this.camera.add(this.headlight);
    new ResizeObserver(() => this.resize()).observe(host);
    this.bindPick();
    this.bindWalk();
  }

  // ---------- Ansicht ----------

  private resize(): void {
    const r = this.host.getBoundingClientRect();
    if (r.width < 10 || r.height < 10) return;
    this.renderer.setSize(r.width, r.height, false);
    this.camera.aspect = r.width / r.height;
    this.camera.updateProjectionMatrix();
    this.draw();
  }

  draw(): void {
    if (this.mode === 'walk') this.applyWalkCamera();
    this.renderer.render(this.scene, this.camera);
  }

  requestRebuild(): void {
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.rebuild(), 60);
  }

  fit(): void {
    const box = new THREE.Box3().setFromObject(this.group);
    if (box.isEmpty()) box.set(new THREE.Vector3(-5, 0, -5), new THREE.Vector3(5, 3, 5));
    const c = box.getCenter(new THREE.Vector3());
    const size = Math.max(6, box.getSize(new THREE.Vector3()).length());
    this.controls.target.copy(c);
    this.camera.position.copy(c.clone().add(new THREE.Vector3(0.55, 0.62, 0.95).normalize().multiplyScalar(size * 1.1)));
    this.camera.updateProjectionMatrix();
    this.controls.update();
    this.needsFit = false;
    this.draw();
  }

  setMode(m: 'orbit' | 'walk'): void {
    this.mode = m;
    this.controls.enabled = m === 'orbit';
    if (m === 'walk') {
      // Start im größten Raum des aktiven Geschosses, Blick entlang seiner längeren Seite
      const l = this.store.floor;
      const room = l.rooms.slice().sort((a, b) => polyArea(b.polygon) - polyArea(a.polygon))[0];
      let c = { x: 0, y: 0 };
      let yaw = 0;
      if (room) {
        const xs = room.polygon.map((q) => q.x);
        const ys = room.polygon.map((q) => q.y);
        const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
        const wide = x1 - x0 >= y1 - y0;
        c = wide ? { x: x0 + 0.6, y: (y0 + y1) / 2 } : { x: (x0 + x1) / 2, y: y0 + 0.6 };
        yaw = wide ? Math.PI / 2 : 0;
      }
      this.walk.pos.set(c.x, l.elevation + EYE, c.y);
      this.walk.yaw = yaw;
      this.walk.pitch = -0.08;
      this.camera.fov = 68;
    } else {
      this.camera.fov = 50;
      this.needsFit = true;
    }
    this.headlight.intensity = m === 'walk' ? 1.6 : 0;
    this.camera.updateProjectionMatrix();
    this.rebuild();
  }

  private applyWalkCamera(): void {
    const w = this.walk;
    this.camera.position.copy(w.pos);
    const dir = new THREE.Vector3(Math.sin(w.yaw) * Math.cos(w.pitch), Math.sin(w.pitch), Math.cos(w.yaw) * Math.cos(w.pitch));
    this.camera.lookAt(w.pos.clone().add(dir));
  }

  private bindWalk(): void {
    const el = this.renderer.domElement;
    el.tabIndex = 0;
    let drag: { x: number; y: number; yaw: number; pitch: number } | null = null;
    el.addEventListener('pointerdown', (e) => {
      if (this.mode !== 'walk') return;
      el.focus();
      drag = { x: e.clientX, y: e.clientY, yaw: this.walk.yaw, pitch: this.walk.pitch };
      el.setPointerCapture(e.pointerId);
    });
    el.addEventListener('pointermove', (e) => {
      if (!drag || this.mode !== 'walk') return;
      this.walk.yaw = drag.yaw - (e.clientX - drag.x) * 0.005;
      this.walk.pitch = Math.max(-1.2, Math.min(1.2, drag.pitch - (e.clientY - drag.y) * 0.005));
      this.draw();
    });
    el.addEventListener('pointerup', () => (drag = null));
    el.addEventListener('wheel', (e) => {
      if (this.mode !== 'walk') return;
      e.preventDefault();
      this.step(-e.deltaY * 0.004, 0);
    });
    const keyMap = ['w', 's', 'a', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'q', 'e'];
    el.addEventListener('keydown', (e) => {
      const k = e.key.toLowerCase();
      if (this.mode !== 'walk' || !keyMap.includes(k)) return;
      e.preventDefault();
      e.stopPropagation();
      this.walk.keys.add(k);
      if (!this.walk.raf) {
        this.walk.last = performance.now();
        this.walk.raf = requestAnimationFrame((t) => this.tick(t));
      }
    });
    el.addEventListener('keyup', (e) => this.walk.keys.delete(e.key.toLowerCase()));
    el.addEventListener('blur', () => this.walk.keys.clear());
  }

  private tick(t: number): void {
    const dt = Math.min(0.05, (t - this.walk.last) / 1000);
    this.walk.last = t;
    const k = this.walk.keys;
    const v = 1.6 * dt * (k.has('shift') ? 2 : 1);
    let f = 0;
    let s = 0;
    if (k.has('w') || k.has('arrowup')) f += v;
    if (k.has('s') || k.has('arrowdown')) f -= v;
    if (k.has('a')) s -= v;
    if (k.has('d')) s += v;
    if (k.has('arrowleft')) this.walk.yaw += 1.6 * dt;
    if (k.has('arrowright')) this.walk.yaw -= 1.6 * dt;
    if (k.has('q')) this.walk.pos.y += v;
    if (k.has('e')) this.walk.pos.y -= v;
    this.step(f, s);
    if (k.size) this.walk.raf = requestAnimationFrame((tt) => this.tick(tt));
    else this.walk.raf = 0;
  }

  private step(forward: number, side: number): void {
    const y = this.walk.yaw;
    this.walk.pos.x += Math.sin(y) * forward - Math.cos(y) * side;
    this.walk.pos.z += Math.cos(y) * forward + Math.sin(y) * side;
    this.draw();
  }

  /** Augenhöhe auf das aktive Geschoss setzen */
  syncWalkLevel(): void {
    if (this.mode !== 'walk') return;
    this.walk.pos.y = this.store.floor.elevation + EYE;
    this.draw();
  }

  private bindPick(): void {
    const el = this.renderer.domElement;
    let down: { x: number; y: number } | null = null;
    el.addEventListener('pointerdown', (e) => (down = { x: e.clientX, y: e.clientY }));
    el.addEventListener('pointerup', (e) => {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) return;
      const r = el.getBoundingClientRect();
      const ray = new THREE.Raycaster();
      ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), this.camera);
      const hit = ray.intersectObjects(this.pickables, true)[0];
      let o: THREE.Object3D | null = hit?.object ?? null;
      while (o && !o.userData.sel) o = o.parent;
      if (o) this.onPick(o.userData.sel.kind, o.userData.sel.id, o.userData.sel.wallId, o.userData.sel.floorId);
    });
  }

  snapshot(): string {
    this.draw();
    return this.renderer.domElement.toDataURL('image/png');
  }

  exportGroup(): THREE.Group {
    return this.group;
  }

  // ---------- Aufbau ----------

  rebuild(): void {
    for (const c of [...this.group.children]) {
      this.group.remove(c);
      c.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
    }
    this.pickables = [];
    const p = this.store.project;
    const sorted = p.floors.slice().sort((a, b) => a.elevation - b.elevation);
    const act = this.store.floor;
    const shown = sorted.filter((l) => l.visible && (this.options.allLevels || l.elevation <= act.elevation + 1e-6));
    const design = this.options.showHeating ? this.store.design : null;
    for (const l of shown) this.buildLevel(p, l, l.id === act.id, design);
    this.buildTerrain(p, sorted);
    const top = shown[shown.length - 1];
    if (this.options.showRoof && top && top.id === sorted[sorted.length - 1].id && this.mode === 'orbit') this.buildRoof(p, top);
    for (const o of this.group.children)
      o.traverse((m) => {
        (m as THREE.Mesh).castShadow = this.options.shadows;
        (m as THREE.Mesh).receiveShadow = this.options.shadows && !m.userData.noReceive;
      });
    this.renderer.shadowMap.enabled = this.options.shadows;
    const box = new THREE.Box3().setFromObject(this.group);
    if (!box.isEmpty()) {
      const c = box.getCenter(new THREE.Vector3());
      const R = Math.max(8, box.getSize(new THREE.Vector3()).length() * 0.7);
      this.sun.target.position.copy(c);
      // Sonne aus Südsüdwest, gedreht mit der Nordrichtung des Plans
      const sunDir = new THREE.Vector3(-0.55, 0.9, 0.42).applyAxisAngle(new THREE.Vector3(0, 1, 0), (-(p.site?.north ?? 0) * Math.PI) / 180);
      this.sun.position.copy(c.clone().add(sunDir.normalize().multiplyScalar(R * 2)));
      const cam = this.sun.shadow.camera;
      cam.left = -R;
      cam.right = R;
      cam.top = R;
      cam.bottom = -R;
      cam.near = 0.5;
      cam.far = R * 4;
      cam.updateProjectionMatrix();
    }
    const empty = box.isEmpty();
    if (this.wasEmpty && !empty) this.needsFit = true;
    this.wasEmpty = empty;
    if (this.needsFit && this.mode === 'orbit') this.fit();
    else this.draw();
  }

  private buildLevel(p: Project, l: Level, active: boolean, design: DesignResult | null): void {
    const g = new THREE.Group();
    g.name = l.name;
    const below = belowOf(p, l);
    const above = aboveOf(p, l);
    const z0 = l.elevation;
    // Böden mit Treppenausschnitten aus dem Geschoss darunter
    const cuts = l.voids.map((v) => v.polygon);
    for (const r of l.rooms) {
      if (r.polygon.length < 3) continue;
      if (r.showFloor ?? true) {
        const geo = new THREE.ShapeGeometry(horizontalShape(r.polygon, cuts));
        geo.rotateX(-Math.PI / 2);
        geo.translate(0, z0 + 0.001, 0);
        const m = new THREE.Mesh(geo, this.floorMaterial(finishOf(r), floorColorOf(r)));
        m.userData.sel = { kind: 'room', id: r.id, floorId: l.id };
        g.add(m);
        this.pickables.push(m);
        if (below) {
          // Rohdecke unter dem Boden
          const slab = new THREE.ExtrudeGeometry(horizontalShape(r.polygon, cuts), { depth: l.floorThickness, bevelEnabled: false });
          slab.rotateX(-Math.PI / 2);
          slab.translate(0, z0 - l.floorThickness, 0);
          g.add(new THREE.Mesh(slab, mat('#d8d4cc')));
        }
      }
      if ((r.showCeiling ?? true) && this.options.showCeilings) {
        const ceilZ = z0 + l.storeyHeight - (above?.floorThickness ?? 0.2);
        const holes = above ? above.voids.map((v) => v.polygon) : [];
        const geo = new THREE.ShapeGeometry(horizontalShape(r.polygon, holes));
        geo.rotateX(-Math.PI / 2);
        geo.translate(0, ceilZ, 0);
        const cm = new THREE.MeshStandardMaterial({ color: r.ceilingColor ?? '#fbfaf7', roughness: 0.95, side: THREE.BackSide });
        g.add(new THREE.Mesh(geo, cm));
      }
      if (design) this.addHeating(g, p, l, r, design, z0, above);
    }
    // Wände
    const outl = wallOutlines(l.walls);
    for (const w of l.walls) {
      const ol = outl.get(w.id);
      if (ol) this.addWall(g, w, ol, z0, wallHeight(w, l));
    }
    // Treppen
    for (const s of l.stairs) {
      const sg = stairGeometry(s, l.storeyHeight);
      const sm = new THREE.Group();
      sm.userData.sel = { kind: 'stair', id: s.id };
      const th = s.type === 'spiral' ? 0.05 : 0.06;
      for (const t of sg.treads) {
        const geo = new THREE.ExtrudeGeometry(horizontalShape(t.poly, []), { depth: th, bevelEnabled: false });
        geo.rotateX(-Math.PI / 2);
        geo.translate(0, z0 + t.z - th, 0);
        sm.add(new THREE.Mesh(geo, mat(s.color)));
      }
      if (s.type === 'spiral') {
        const col = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, l.storeyHeight + 0.9, 16), mat('#5c6166', { metal: 0.6, rough: 0.35 }));
        col.position.set(s.pos.x, z0 + (l.storeyHeight + 0.9) / 2, s.pos.y);
        sm.add(col);
      } else {
        // Wangen als schräge Bänder entlang der Lauflinie
        const wl = sg.walkline;
        for (let i = 0; i + 1 < wl.length; i++) {
          const a = wl[i];
          const b = wl[i + 1];
          const len = Math.hypot(b.x - a.x, b.y - a.y);
          if (len < 0.2) continue;
          const z1 = (sg.treads.findIndex((t) => insidePoly(a, t.poly)) + 1) * sg.riser;
          const z2 = (sg.treads.findIndex((t) => insidePoly(b, t.poly)) + 1) * sg.riser;
          const n = left({ x: (b.x - a.x) / len, y: (b.y - a.y) / len });
          for (const sd of [-1, 1]) {
            const off = (s.width / 2) * sd;
            const A = { x: a.x + n.x * off, y: a.y + n.y * off };
            const B = { x: b.x + n.x * off, y: b.y + n.y * off };
            const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1, 8), mat('#5c6166', { metal: 0.6, rough: 0.35 }));
            const pa = new THREE.Vector3(A.x, z0 + z1 + 0.9, A.y);
            const pb = new THREE.Vector3(B.x, z0 + z2 + 0.9, B.y);
            rail.position.copy(pa.clone().add(pb).multiplyScalar(0.5));
            rail.scale.y = pa.distanceTo(pb);
            rail.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), pb.clone().sub(pa).normalize());
            sm.add(rail);
          }
        }
      }
      g.add(sm);
      this.pickables.push(sm);
    }
    // Möbel
    for (const f of l.furniture) {
      if (!f.visible) continue;
      const it = CATALOG_BY_KEY[f.catalog];
      const m = it ? it.model(f.width, f.depth, f.height, f.color) : new THREE.Group();
      if (!it) {
        const b = new THREE.Mesh(new THREE.BoxGeometry(f.width, f.height, f.depth), mat(f.color));
        b.position.y = f.height / 2;
        m.add(b);
      }
      m.position.set(f.pos.x, z0 + f.elevation, f.pos.y);
      m.rotation.y = (-f.angle * Math.PI) / 180;
      if (f.mirrored) m.scale.x = -1;
      m.userData.sel = { kind: 'furniture', id: f.id };
      if (this.store.isSelected('furniture', f.id)) {
        const bh = new THREE.Box3Helper(new THREE.Box3(new THREE.Vector3(-f.width / 2, 0, -f.depth / 2), new THREE.Vector3(f.width / 2, f.height, f.depth / 2)), 0x2f7de1);
        m.add(bh);
      }
      g.add(m);
      this.pickables.push(m);
    }
    this.addTechnics(g, p, l);
    g.traverse((o) => {
      if (o.userData.sel) o.userData.sel.floorId ??= l.id;
    });
    void active;
    this.group.add(g);
  }

  private floorMaterial(fin: FloorFinish, color: string): THREE.MeshStandardMaterial {
    const key = `${fin}|${color}`;
    let tex = this.textures.get(key);
    if (!tex) {
      tex = floorTexture(fin, color);
      this.textures.set(key, tex);
    }
    return new THREE.MeshStandardMaterial({ map: tex, roughness: fin === 'fliesen' || fin === 'naturstein' ? 0.35 : 0.75 });
  }

  /** Wand als extrudierte Ansichtsfläche mit Öffnungslöchern; Stirnseiten auf die Gehrung verschoben */
  private addWall(g: THREE.Group, w: Wall, ol: WallOutline, z0: number, H: number): void {
    const L = wallLength(w);
    if (L < 0.01) return;
    const t = w.thickness;
    // Außenkontur in der Wandansicht; Öffnungen bis zum Fußboden schneiden die Unterkante ein, andere sind Löcher
    const doors = w.openings
      .filter((o) => o.sill < 0.002)
      .map((o) => [Math.max(0.005, o.offset - o.width / 2), Math.min(L - 0.005, o.offset + o.width / 2), Math.min(H - 0.005, o.height)] as const)
      .filter(([x0, x1]) => x1 - x0 > 0.02)
      .sort((a, b) => a[0] - b[0]);
    const outer: THREE.Vector2[] = [new THREE.Vector2(0, 0)];
    let cur = 0;
    for (const [x0, x1, h] of doors) {
      if (x0 < cur + 0.005) continue;
      outer.push(new THREE.Vector2(x0, 0), new THREE.Vector2(x0, h), new THREE.Vector2(x1, h), new THREE.Vector2(x1, 0));
      cur = x1;
    }
    outer.push(new THREE.Vector2(L, 0), new THREE.Vector2(L, H), new THREE.Vector2(0, H));
    const shape = new THREE.Shape(outer);
    for (const o of w.openings) {
      if (o.sill < 0.002) continue;
      const x0 = Math.max(0.005, o.offset - o.width / 2);
      const x1 = Math.min(L - 0.005, o.offset + o.width / 2);
      const y1 = Math.min(H - 0.005, o.sill + o.height);
      if (x1 - x0 < 0.02 || y1 - o.sill < 0.02) continue;
      shape.holes.push(new THREE.Path([new THREE.Vector2(x0, o.sill), new THREE.Vector2(x0, y1), new THREE.Vector2(x1, y1), new THREE.Vector2(x1, o.sill)]));
    }
    const geo = new THREE.ExtrudeGeometry(shape, { depth: t, bevelEnabled: false, curveSegments: 1 });
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    const d = wallDir(w);
    const n = left(d);
    for (let i = 0; i < pos.count; i++) {
      let X = pos.getX(i);
      const Y = pos.getY(i);
      const off = pos.getZ(i) - t / 2;
      const isL = off > 0;
      if (X < 1e-4) X = isL ? ol.ta.l : ol.ta.r;
      else if (X > L - 1e-4) X = L + (isL ? ol.tb.l : ol.tb.r);
      pos.setXYZ(i, w.a.x + d.x * X + n.x * off, z0 + Y, w.a.y + d.y * X + n.y * off);
    }
    geo.computeVertexNormals();
    const [gl, gr, ge] = splitByNormal(geo, new THREE.Vector3(n.x, 0, n.y));
    const holder = new THREE.Group();
    holder.userData.sel = { kind: 'wall', id: w.id };
    holder.add(new THREE.Mesh(gl, mat(w.colorLeft ?? '#f2efe9', { rough: 0.92 })), new THREE.Mesh(gr, mat(w.colorRight ?? (w.kind === 'exterior' ? '#e9e2d6' : '#f2efe9'), { rough: 0.92 })), new THREE.Mesh(ge, mat('#e9e6df', { rough: 0.92 })));
    geo.dispose();
    g.add(holder);
    this.pickables.push(holder);
    for (const o of w.openings) {
      const og = openingModel(o, t);
      const c = pointOnWall(w, o.offset);
      og.position.set(c.x, z0 + o.sill, c.y);
      og.rotation.y = -Math.atan2(d.y, d.x);
      og.userData.sel = { kind: 'opening', id: o.id, wallId: w.id };
      g.add(og);
      this.pickables.push(og);
    }
  }

  /** Heizung eines Raums: Fußboden-Heizkreise, Wand- und Deckenheizfelder; Verteiler und Wärmeerzeuger */
  private addHeating(g: THREE.Group, p: Project, l: Level, r: Room, d: DesignResult, z0: number, above: Level | null): void {
    const rr = d.rooms.get(r.id);
    if (!rr || !r.heated) return;
    const line = (pts: THREE.Vector3[], color: number) => g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color })));
    for (const sr of rr.surfaces) {
      const s = r.surfaces.find((x) => x.id === sr.surfaceId);
      if (!s) continue;
      if (sr.kind === 'floor' && sr.medium === 'water' && sr.circuits.length) {
        const poly = subtractVoids(r.polygon, l.voids);
        const y = z0 + 0.012;
        for (const dw of circuitDrawings(poly, sr.circuits.length, s.spacing, s.pattern, p.design.wallDistance, rr.connector)) {
          for (const ln of dw.supply) line(ln.map((q) => P3(q, y)), COL.supply);
          for (const ln of dw.ret) line(ln.map((q) => P3(q, y)), COL.ret);
        }
        if (rr.feederPath.length > 1 && rr.manifoldFloorId === l.id) line(rr.feederPath.map((q) => P3(q, y + 0.01)), COL.supply);
      }
      if (sr.kind === 'floor' && sr.medium === 'electric') {
        const geo = new THREE.ShapeGeometry(horizontalShape(subtractVoids(r.polygon, l.voids), []));
        geo.rotateX(-Math.PI / 2);
        geo.translate(0, z0 + 0.01, 0);
        g.add(new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: COL.ceilHeat, transparent: true, opacity: 0.35 })));
      }
      if (s.kind === 'ceiling') {
        const geo = new THREE.ShapeGeometry(horizontalShape(r.polygon, []));
        geo.rotateX(-Math.PI / 2);
        geo.translate(0, z0 + l.storeyHeight - (above?.floorThickness ?? 0.2) - 0.01, 0);
        g.add(new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: COL.ceilHeat, transparent: true, opacity: 0.45, side: THREE.DoubleSide })));
      }
      if (s.kind === 'wall') {
        const w = l.walls.find((x) => x.id === s.wallId);
        if (!w) continue;
        const fld = s.field ?? defaultField(w, r, l.clearHeight)!;
        const dir = norm(sub(w.b, w.a));
        const n0 = { x: -dir.y, y: dir.x };
        const side = cross(dir, sub(centroid(r.polygon), w.a)) > 0 ? 1 : -1;
        const off = mul(n0, side * (w.thickness / 2 + 0.012));
        const plane = new THREE.Mesh(new THREE.PlaneGeometry(fld.x1 - fld.x0, fld.z1 - fld.z0), new THREE.MeshStandardMaterial({ color: COL.wallHeat, transparent: true, opacity: 0.35, side: THREE.DoubleSide }));
        plane.position.copy(P3(add(add(w.a, mul(dir, (fld.x0 + fld.x1) / 2)), off), z0 + (fld.z0 + fld.z1) / 2));
        plane.rotation.y = -Math.atan2(dir.y, dir.x);
        g.add(plane);
        const pts: THREE.Vector3[] = [];
        for (const row of fieldRuns(fld, w.openings, s.spacing))
          for (const [xa, xb] of row.runs) pts.push(P3(add(add(w.a, mul(dir, xa)), mul(off, 1.3)), z0 + row.z), P3(add(add(w.a, mul(dir, xb)), mul(off, 1.3)), z0 + row.z));
        if (pts.length) g.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: COL.supply })));
      }
    }
  }

  private addTechnics(g: THREE.Group, p: Project, l: Level): void {
    for (const m of l.manifolds) {
      const box = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.7, 0.12), mat('#0c7566', { rough: 0.5 }));
      box.position.copy(P3(m.pos, l.elevation + 0.65));
      box.userData.sel = { kind: 'manifold', id: m.id, floorId: l.id };
      g.add(box);
      this.pickables.push(box);
    }
    if (p.heatSource?.floorId === l.id) {
      const box = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.8, 0.6), mat('#7a3fb3', { rough: 0.5 }));
      box.position.copy(P3(p.heatSource.pos, l.elevation + 0.9));
      box.userData.sel = { kind: 'heatSource', id: 'hs', floorId: l.id };
      g.add(box);
      this.pickables.push(box);
    }
  }

  /** Gelände als Netz (eben oder Hang) mit Aussparung unter dem Gebäude und Baugrube */
  private buildTerrain(p: Project, sorted: Level[]): void {
    for (const c of [...this.terrain.children]) {
      this.terrain.remove(c);
      const m = c as THREE.Mesh;
      m.geometry?.dispose();
      (m.material as THREE.Material | undefined)?.dispose();
    }
    const b0 = buildingBounds(p);
    const earth = new THREE.MeshStandardMaterial({ color: 0xb9c4a4, roughness: 1, side: THREE.DoubleSide });
    if (!b0) {
      const g = new THREE.Mesh(new THREE.CircleGeometry(80, 48), earth);
      g.rotation.x = -Math.PI / 2;
      g.position.y = p.terrain.gradeLow - 0.01;
      g.receiveShadow = true;
      this.terrain.add(g);
      return;
    }
    const tMax = Math.max(0.1, ...sorted.flatMap((f) => f.walls.filter((w) => w.kind === 'exterior' || w.kind === 'party').map((w) => w.thickness)));
    const b = { min: { x: b0.min.x - tMax / 2, y: b0.min.y - tMax / 2 }, max: { x: b0.max.x + tMax / 2, y: b0.max.y + tMax / 2 } };
    const lines = (lo: number, hi: number) => {
      const out: number[] = [];
      const seg = (a: number, z: number, n: number) => {
        for (let i = 0; i < n; i++) out.push(a + ((z - a) * i) / n);
      };
      seg(lo - 60, lo, 20);
      seg(lo, hi, Math.max(2, Math.ceil((hi - lo) / 0.5)));
      seg(hi, hi + 60, 20);
      out.push(hi + 60);
      return out;
    };
    const xs = lines(b.min.x, b.max.x);
    const ys = lines(b.min.y, b.max.y);
    const pos: number[] = [];
    const idx: number[] = [];
    const h = (x: number, y: number) => groundLevel(p, { x, y }, b0) - 0.01;
    for (const y of ys) for (const x of xs) pos.push(x, h(x, y), y);
    const W = xs.length;
    const eps = 1e-6;
    for (let j = 0; j < ys.length - 1; j++)
      for (let i = 0; i < W - 1; i++) {
        const cx = (xs[i] + xs[i + 1]) / 2;
        const cy = (ys[j] + ys[j + 1]) / 2;
        if (cx > b.min.x + eps && cx < b.max.x - eps && cy > b.min.y + eps && cy < b.max.y - eps) continue;
        const a = j * W + i;
        idx.push(a, a + W, a + 1, a + 1, a + W, a + W + 1);
      }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const tm = new THREE.Mesh(geo, earth);
    tm.receiveShadow = true;
    this.terrain.add(tm);
    const bottom = Math.min(...sorted.map((f) => f.elevation)) - 0.35;
    const ring = [b.min, { x: b.max.x, y: b.min.y }, b.max, { x: b.min.x, y: b.max.y }];
    const sp: number[] = [];
    for (let k = 0; k < 4; k++) {
      const a = ring[k];
      const c = ring[(k + 1) % 4];
      for (let i = 0; i < 24; i++) {
        const p0 = { x: a.x + ((c.x - a.x) * i) / 24, y: a.y + ((c.y - a.y) * i) / 24 };
        const p1 = { x: a.x + ((c.x - a.x) * (i + 1)) / 24, y: a.y + ((c.y - a.y) * (i + 1)) / 24 };
        const z0 = h(p0.x, p0.y);
        const z1 = h(p1.x, p1.y);
        if (Math.max(z0, z1) <= bottom) continue;
        sp.push(p0.x, z0, p0.y, p0.x, bottom, p0.y, p1.x, z1, p1.y, p1.x, z1, p1.y, p0.x, bottom, p0.y, p1.x, bottom, p1.y);
      }
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
    sg.computeVertexNormals();
    this.terrain.add(new THREE.Mesh(sg, new THREE.MeshStandardMaterial({ color: 0x8f8170, roughness: 1, side: THREE.DoubleSide })));
  }

  private buildRoof(p: Project, top: Level): void {
    const roof = p.roof;
    if (roof.type === 'none' || !top.walls.length) return;
    const pts: Vec[] = [];
    top.walls.forEach((w) => pts.push(w.a, w.b));
    const t = Math.max(...top.walls.map((w) => w.thickness)) / 2;
    const o = roof.overhang + t;
    const x0 = Math.min(...pts.map((q) => q.x)) - o;
    const x1 = Math.max(...pts.map((q) => q.x)) + o;
    const y0 = Math.min(...pts.map((q) => q.y)) - o;
    const y1 = Math.max(...pts.map((q) => q.y)) + o;
    const knee = roof.insulation === 'topSlab' ? roof.kneeWall : 0;
    const eave = top.elevation + top.storeyHeight + knee;
    const tan = Math.tan((roof.pitch * Math.PI) / 180);
    const roofMat = mat(roof.color ?? '#8f3f2c', { rough: 0.8 });
    roofMat.side = THREE.DoubleSide;
    const gableMat = mat('#efebe4', { rough: 0.9 });
    gableMat.side = THREE.DoubleSide;
    const tri: number[] = [];
    const gable: number[] = [];
    const push = (arr: number[], ...v3: THREE.Vector3[]) => v3.forEach((q) => arr.push(q.x, q.y, q.z));
    const V = (x: number, y: number, h: number) => new THREE.Vector3(x, h, y);
    // Kniestock
    if (knee > 0) {
      const ol = wallOutlines(top.walls);
      for (const w of top.walls) {
        const out = ol.get(w.id);
        if (!out) continue;
        const sh = new THREE.Shape(out.poly.map((q) => new THREE.Vector2(q.x, -q.y)));
        const geo = new THREE.ExtrudeGeometry(sh, { depth: knee, bevelEnabled: false });
        geo.rotateX(-Math.PI / 2);
        geo.translate(0, top.elevation + top.storeyHeight, 0);
        this.group.add(new THREE.Mesh(geo, gableMat));
      }
    }
    if (roof.type === 'flat') {
      const slab = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, 0.3, y1 - y0), mat('#6f7478'));
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
        push(gable, V(x0 + o, y0 + o, eave), V(x0 + o, y0 + o, eave + rise - o * tan), V(x1 - o, y0 + o, eave), V(x0 + o, y1 - o, eave), V(x0 + o, y1 - o, eave + rise - o * tan), V(x1 - o, y1 - o, eave));
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
    const roofMesh = new THREE.Mesh(geo, roofMat);
    roofMesh.userData.noReceive = true;
    this.group.add(roofMesh);
    if (gable.length) {
      const gg = new THREE.BufferGeometry();
      gg.setAttribute('position', new THREE.Float32BufferAttribute(gable, 3));
      gg.computeVertexNormals();
      this.group.add(new THREE.Mesh(gg, gableMat));
    }
  }
}

// ---------- Hilfen ----------

function polyArea(poly: Vec[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a / 2);
}

function insidePoly(p: Vec, poly: Vec[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Shape in (x, −y), nach rotateX(−π/2) liegt sie horizontal in Planlage */
function horizontalShape(poly: Vec[], holes: Vec[][]): THREE.Shape {
  const ccw = (pts: Vec[], want: boolean) => {
    let a = 0;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const q = pts[(i + 1) % pts.length];
      a += p.x * -q.y - q.x * -p.y;
    }
    return a > 0 === want ? pts : pts.slice().reverse();
  };
  const s = new THREE.Shape(ccw(poly, true).map((p) => new THREE.Vector2(p.x, -p.y)));
  for (const h of holes) {
    if (!h.some((q) => insidePoly(q, poly))) continue;
    s.holes.push(new THREE.Path(ccw(h, false).map((p) => new THREE.Vector2(p.x, -p.y))));
  }
  return s;
}

function splitByNormal(geo: THREE.BufferGeometry, n: THREE.Vector3): [THREE.BufferGeometry, THREE.BufferGeometry, THREE.BufferGeometry] {
  const src = geo.index ? geo.toNonIndexed() : geo;
  const pos = src.getAttribute('position') as THREE.BufferAttribute;
  const uvAttr = src.getAttribute('uv') as THREE.BufferAttribute | undefined;
  const out: number[][] = [[], [], []];
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const nn = new THREE.Vector3();
  for (let i = 0; i < pos.count; i += 3) {
    a.fromBufferAttribute(pos, i);
    b.fromBufferAttribute(pos, i + 1);
    c.fromBufferAttribute(pos, i + 2);
    nn.subVectors(c, b).cross(new THREE.Vector3().subVectors(a, b)).normalize();
    const d = nn.dot(n);
    const k = d > 0.9 ? 0 : d < -0.9 ? 1 : 2;
    out[k].push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  }
  void uvAttr;
  return out.map((arr) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
    g.computeVertexNormals();
    return g;
  }) as [THREE.BufferGeometry, THREE.BufferGeometry, THREE.BufferGeometry];
}

/** Rahmen, Glas, Türblatt; lokal: x entlang der Wand (Mitte = 0), y ab Brüstung, z = Wandnormale (+ links) */
function openingModel(o: Opening, t: number): THREE.Group {
  const g = new THREE.Group();
  const W = o.width;
  const H = o.height;
  const fr = 0.06;
  const style = styleOf(o);
  const color = o.color ?? (style === 'door' || style === 'doubleDoor' ? '#f4f1ea' : style === 'garageDoor' ? '#d9dcde' : '#ffffff');
  const frame = mat(color, { rough: 0.5 });
  const B = (w: number, h: number, d: number, x: number, y: number, z: number, m: THREE.Material) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    mesh.position.set(x, y, z);
    g.add(mesh);
    return mesh;
  };
  const glass = new THREE.MeshStandardMaterial({ color: 0xbcd9ea, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.32 });
  const sgn = (o.side ?? 'left') === 'left' ? 1 : -1;
  const isWin = style === 'window' || style === 'frenchWindow' || style === 'roofWindow';
  if (isWin) {
    const fd = 0.08;
    B(W, fr, fd, 0, fr / 2, 0, frame);
    B(W, fr, fd, 0, H - fr / 2, 0, frame);
    B(fr, H, fd, -W / 2 + fr / 2, H / 2, 0, frame);
    B(fr, H, fd, W / 2 - fr / 2, H / 2, 0, frame);
    if (W > 1.1) B(fr * 0.8, H, fd, 0, H / 2, 0, frame);
    B(W - fr, H - fr, 0.012, 0, H / 2, 0, glass);
    if (style !== 'frenchWindow') B(W + 0.04, 0.03, t / 2 + 0.06, 0, -0.015, -sgn * (t / 4 + 0.03), mat('#c8c3b9'));
  } else if (style === 'slidingDoor') {
    // Hebe-Schiebetür: zwei verglaste Flügel hintereinander
    const fd = 0.07;
    B(W, fr, t * 0.6, 0, fr / 2, 0, frame);
    B(W, fr, t * 0.6, 0, H - fr / 2, 0, frame);
    B(fr, H, t * 0.6, -W / 2 + fr / 2, H / 2, 0, frame);
    B(fr, H, t * 0.6, W / 2 - fr / 2, H / 2, 0, frame);
    const lw = W / 2 + 0.04;
    for (const [x, z] of [[-W / 4 + 0.02, -0.04], [W / 4 - 0.02, 0.04]]) {
      B(lw, fr * 0.8, fd, x, H - fr * 1.4, z, frame);
      B(lw, fr * 0.8, fd, x, fr * 1.4, z, frame);
      B(fr * 0.8, H - fr * 2, fd, x - lw / 2 + fr * 0.4, H / 2, z, frame);
      B(fr * 0.8, H - fr * 2, fd, x + lw / 2 - fr * 0.4, H / 2, z, frame);
      B(lw - fr * 1.6, H - fr * 3.6, 0.012, x, H / 2, z, glass);
    }
  } else if (style === 'door' || style === 'doubleDoor') {
    const zFace = sgn * (t / 2 - 0.03);
    B(fr * 0.6, H, t + 0.02, -W / 2 + fr * 0.3, H / 2, 0, frame);
    B(fr * 0.6, H, t + 0.02, W / 2 - fr * 0.3, H / 2, 0, frame);
    B(W, fr * 0.6, t + 0.02, 0, H - fr * 0.3, 0, frame);
    const leafMat = mat(color, { rough: 0.55 });
    const leaves = style === 'doubleDoor' ? 2 : 1;
    const lw = (W - fr * 1.2) / leaves;
    for (let i = 0; i < leaves; i++) {
      const x = -W / 2 + fr * 0.6 + lw * (i + 0.5);
      const off = zFace;
      B(lw - 0.005, H - fr * 0.6 - 0.01, 0.04, x, (H - fr * 0.6) / 2, off, leafMat);
      const hx = style === 'doubleDoor' ? (i === 0 ? x + lw / 2 - 0.08 : x - lw / 2 + 0.08) : (o.hinge ?? 'a') === 'a' ? x + lw / 2 - 0.08 : x - lw / 2 + 0.08;
      for (const sz of [-1, 1]) B(0.12, 0.02, 0.02, hx, 1.05, off + sz * 0.035, mat('#b7bbbf', { metal: 0.8, rough: 0.25 }));
    }
  } else if (style === 'garageDoor') {
    const gm = mat(color, { rough: 0.45, metal: 0.2 });
    const n = Math.max(3, Math.round(H / 0.5));
    for (let i = 0; i < n; i++) B(W - 0.02, H / n - 0.012, 0.045, 0, (H / n) * (i + 0.5), -sgn * (t / 2 - 0.05), gm);
  }
  return g;
}

/** prozedurale Bodentexturen (1 Kachel = 1 m) */
function floorTexture(fin: FloorFinish, color: string): THREE.Texture {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const x = c.getContext('2d')!;
  const base = new THREE.Color(color);
  const css = (f: number) => `#${base.clone().multiplyScalar(f).getHexString()}`;
  x.fillStyle = css(1);
  x.fillRect(0, 0, S, S);
  let rnd = 7;
  const rand = () => ((rnd = (rnd * 16807) % 2147483647) / 2147483647);
  if (fin === 'parkett' || fin === 'laminat') {
    const rows = fin === 'parkett' ? 8 : 5;
    const h = S / rows;
    for (let r = 0; r < rows; r++) {
      let xx = -rand() * S * 0.5;
      while (xx < S) {
        const len = S * (fin === 'parkett' ? 0.45 + rand() * 0.2 : 0.9 + rand() * 0.3);
        x.fillStyle = css(0.88 + rand() * 0.2);
        x.fillRect(xx, r * h, len, h);
        x.strokeStyle = css(0.7);
        x.lineWidth = 1;
        x.strokeRect(xx + 0.5, r * h + 0.5, len, h);
        for (let k = 0; k < 6; k++) {
          x.strokeStyle = `rgba(0,0,0,${0.03 + rand() * 0.05})`;
          x.beginPath();
          const yy = r * h + rand() * h;
          x.moveTo(xx, yy);
          x.bezierCurveTo(xx + len / 3, yy + rand() * 4 - 2, xx + (2 * len) / 3, yy + rand() * 4 - 2, xx + len, yy);
          x.stroke();
        }
        xx += len;
      }
    }
  } else if (fin === 'fliesen' || fin === 'naturstein') {
    const n = fin === 'fliesen' ? 3 : 2;
    const s = S / n;
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) {
        x.fillStyle = css(0.94 + rand() * 0.1);
        x.fillRect(i * s + 2, j * s + 2, s - 4, s - 4);
      }
    x.strokeStyle = css(0.72);
    x.lineWidth = 3;
    for (let i = 0; i <= n; i++) {
      x.beginPath();
      x.moveTo(i * s, 0);
      x.lineTo(i * s, S);
      x.moveTo(0, i * s);
      x.lineTo(S, i * s);
      x.stroke();
    }
  } else if (fin === 'teppich' || fin === 'beton') {
    const img = x.getImageData(0, 0, S, S);
    for (let i = 0; i < img.data.length; i += 4) {
      const f = 1 + (rand() - 0.5) * (fin === 'teppich' ? 0.18 : 0.1);
      img.data[i] *= f;
      img.data[i + 1] *= f;
      img.data[i + 2] *= f;
    }
    x.putImageData(img, 0, 0);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}
