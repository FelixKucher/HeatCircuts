// Bearbeitungsoperationen auf einem Geschoss: Wandzüge mit T-Stößen, Rechteckräume, Raumerkennung,
// Verschieben, Löschen, Kopieren, Drehen. Rein funktional auf den Modelldaten.

import type { Floor, Project, Vec, Wall } from '../model/types';
import { newFloor, newRoom, newWall, uid } from '../model/factory';
import { pointOnWall, projectOnWall, splitWall, wallLength, wallOutlines } from './walls';
import { add, area, centroid, dist, pointInPolygon, sub } from '../geometry/geom';
import { detectRoom } from '../geometry/detect';
import type { SelItem } from '../model/store';

const ON_TOL = 0.01;

/** Wände an Punkt p teilen, wenn p im Inneren ihrer Achse liegt (T-Stoß) */
export function splitWallsAt(floor: Floor, p: Vec): void {
  for (const w of [...floor.walls]) {
    const L = wallLength(w);
    const { t, off } = projectOnWall(w, p);
    if (Math.abs(off) > ON_TOL || t < 0.02 || t > L - 0.02) continue;
    const [w1, w2] = splitWall(w, t, () => uid('w'));
    floor.walls.splice(floor.walls.indexOf(w), 1, w1, w2);
  }
}

/** Abschnitte von a–b, die nicht schon von einer kollinearen Wand belegt sind */
function uncovered(floor: Floor, a: Vec, b: Vec): [Vec, Vec][] {
  const L = dist(a, b);
  if (L < 1e-6) return [];
  const probe: Wall = newWall(a, b, 'interior', 0.1);
  const iv: [number, number][] = [];
  for (const w of floor.walls) {
    const pa = projectOnWall(probe, w.a);
    const pb = projectOnWall(probe, w.b);
    if (Math.abs(pa.off) > ON_TOL || Math.abs(pb.off) > ON_TOL) continue;
    const lo = Math.max(0, Math.min(pa.t, pb.t));
    const hi = Math.min(L, Math.max(pa.t, pb.t));
    if (hi - lo > 0.01) iv.push([lo, hi]);
  }
  iv.sort((x, y) => x[0] - y[0]);
  const out: [Vec, Vec][] = [];
  let cur = 0;
  for (const [lo, hi] of iv) {
    if (lo > cur + 0.01) out.push([pointOnWall(probe, cur), pointOnWall(probe, lo)]);
    cur = Math.max(cur, hi);
  }
  if (L > cur + 0.01) out.push([pointOnWall(probe, cur), pointOnWall(probe, L)]);
  return out;
}

/** Wandzug einfügen: T-Stöße teilen, bereits vorhandene Wandabschnitte nicht doppeln */
export function addWallChain(floor: Floor, pts: Vec[], thickness: number, closed = false): Wall[] {
  const segs: [Vec, Vec][] = [];
  for (let i = 0; i + 1 < pts.length; i++) segs.push([pts[i], pts[i + 1]]);
  if (closed && pts.length > 2) segs.push([pts[pts.length - 1], pts[0]]);
  const created: Wall[] = [];
  for (const [a, b] of segs) {
    if (dist(a, b) < 0.02) continue;
    for (const [p, q] of uncovered(floor, a, b)) {
      splitWallsAt(floor, p);
      splitWallsAt(floor, q);
      // vorhandene Wandenden im Inneren der neuen Wand → neue Wand dort teilen
      const cuts = [0, dist(p, q)];
      const probe = newWall(p, q, 'interior', thickness);
      for (const w of floor.walls)
        for (const e of [w.a, w.b]) {
          const { t, off } = projectOnWall(probe, e);
          if (Math.abs(off) < ON_TOL && t > 0.02 && t < cuts[1] - 0.02) cuts.push(t);
        }
      cuts.sort((x, y) => x - y);
      for (let i = 0; i + 1 < cuts.length; i++) {
        if (cuts[i + 1] - cuts[i] < 0.02) continue;
        const w = newWall(pointOnWall(probe, cuts[i]), pointOnWall(probe, cuts[i + 1]), 'exterior', thickness, true);
        floor.walls.push(w);
        created.push(w);
      }
    }
  }
  return created;
}


/** Raum per Klick aus umschließenden Wänden; Kanten werden exakt auf die Wandoberflächen gelegt */
export function detectRoomAt(floor: Floor, p: Vec): Vec[] | null {
  const r = detectRoom(p, floor.walls, 0.02);
  if (!r.ok || area(r.polygon) < 0.3) return null;
  return snapToWallFaces(r.polygon, floor.walls);
}

/** Rasterkontur auf die Wandflächen ziehen: jede Kante auf die nächste parallele Wandfläche, Ecken neu schneiden */
export function snapToWallFaces(poly: Vec[], walls: Wall[]): Vec[] {
  const faces: [Vec, Vec][] = [];
  for (const o of wallOutlines(walls).values()) faces.push([o.poly[0], o.poly[1]], [o.poly[3], o.poly[2]]);
  const n = poly.length;
  const lines: { p: Vec; d: Vec }[] = [];
  for (let i = 0; i < n; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % n];
    const L = dist(a, b);
    const d = { x: (b.x - a.x) / L, y: (b.y - a.y) / L };
    let best: { p: Vec; d: Vec } | null = null;
    let bd = 0.06;
    for (const [f0, f1] of faces) {
      const fl = dist(f0, f1);
      if (fl < 1e-6) continue;
      const fd = { x: (f1.x - f0.x) / fl, y: (f1.y - f0.y) / fl };
      if (Math.abs(fd.x * d.y - fd.y * d.x) > 0.035) continue;
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const off = Math.abs(fd.x * (mid.y - f0.y) - fd.y * (mid.x - f0.x));
      const t = (mid.x - f0.x) * fd.x + (mid.y - f0.y) * fd.y;
      if (off < bd && t > -0.05 && t < fl + 0.05) {
        bd = off;
        best = { p: f0, d: fd };
      }
    }
    lines.push(best ?? { p: a, d });
  }
  const out: Vec[] = [];
  for (let i = 0; i < n; i++) {
    const l1 = lines[(i - 1 + n) % n];
    const l2 = lines[i];
    const den = l1.d.x * l2.d.y - l1.d.y * l2.d.x;
    if (Math.abs(den) < 1e-6) {
      out.push(poly[i]);
      continue;
    }
    const t = ((l2.p.x - l1.p.x) * l2.d.y - (l2.p.y - l1.p.y) * l2.d.x) / den;
    const q = { x: l1.p.x + l1.d.x * t, y: l1.p.y + l1.d.y * t };
    out.push(dist(q, poly[i]) < 0.15 ? q : poly[i]);
  }
  return out.filter((q, i) => dist(q, out[(i + 1) % out.length]) > 1e-4);
}

/** Raumart aus dem Namen erraten (für importierte oder umbenannte Räume) */
const ROOM_GUESS: [RegExp, string][] = [
  [/bad|dusch/i, 'bad'],
  [/wc|gäste|toilette/i, 'wc'],
  [/küche|kueche|koch/i, 'kueche'],
  [/wohn/i, 'wohnen'],
  [/ess/i, 'essen'],
  [/schlaf|eltern/i, 'schlafen'],
  [/kind/i, 'kind'],
  [/büro|buero|arbeit/i, 'buero'],
  [/flur|diele|gang|eingang/i, 'flur'],
  [/treppe/i, 'treppe'],
  [/hwr|hauswirtschaft|wasch/i, 'hwr'],
  [/abstell|speis/i, 'abstell'],
  [/technik|heiz/i, 'technik'],
  [/garage|carport/i, 'garage'],
  [/keller/i, 'keller'],
  [/dachboden|spitzboden/i, 'dachboden'],
  [/galerie|luftraum/i, 'galerie'],
];
export const roomTypeFromName = (name: string): string | null => ROOM_GUESS.find(([re]) => re.test(name))?.[1] ?? null;

/** Rechteckraum (RoomSketcher-Stil): Wandachsen auf dem Rechteck, Raum = lichte Fläche */
export function addRectRoom(project: Project, floor: Floor, a: Vec, b: Vec, thickness: number, type = 'wohnen', name?: string): { walls: Wall[]; roomId: string | null } {
  const x0 = Math.min(a.x, b.x);
  const x1 = Math.max(a.x, b.x);
  const y0 = Math.min(a.y, b.y);
  const y1 = Math.max(a.y, b.y);
  if (x1 - x0 < 0.3 || y1 - y0 < 0.3) return { walls: [], roomId: null };
  const walls = addWallChain(floor, [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }], thickness, true);
  const poly = detectRoomAt(floor, { x: (x0 + x1) / 2, y: (y0 + y1) / 2 });
  if (!poly) return { walls, roomId: null };
  const room = newRoom(project, floor, poly, type, name);
  floor.rooms.push(room);
  return { walls, roomId: room.id };
}

/** Raumpolygone nach Wandänderungen neu an die Wandflächen legen */
export function refitRooms(floor: Floor): void {
  for (const r of floor.rooms) {
    const c = centroid(r.polygon);
    if (!pointInPolygon(c, r.polygon)) continue;
    const poly = detectRoomAt(floor, c);
    if (poly && Math.abs(area(poly) - area(r.polygon)) < 0.5 * area(r.polygon)) r.polygon = poly;
  }
}

const findById = <T extends { id: string }>(arr: T[], id: string) => arr.find((x) => x.id === id);

/** Auswahl um d verschieben (Wandenden verbundener Wände wandern mit) */
export function moveSelection(base: Floor, floor: Floor, sel: SelItem[], d: Vec, project?: Project, baseProject?: Project): void {
  const wallIds = new Set(sel.filter((s) => s.kind === 'wall').map((s) => s.id));
  if (wallIds.size) {
    const moved: Vec[] = [];
    for (const w of base.walls) if (wallIds.has(w.id)) moved.push(w.a, w.b);
    for (let i = 0; i < floor.walls.length; i++) {
      const bw = base.walls[i];
      const w = floor.walls[i];
      if (!bw || bw.id !== w.id) continue;
      if (wallIds.has(w.id)) {
        w.a = add(bw.a, d);
        w.b = add(bw.b, d);
      } else {
        if (moved.some((m) => dist(m, bw.a) < 0.02)) w.a = add(bw.a, d);
        if (moved.some((m) => dist(m, bw.b) < 0.02)) w.b = add(bw.b, d);
      }
    }
  }
  for (const s of sel) {
    if (s.kind === 'room') {
      const br = findById(base.rooms, s.id);
      const r = findById(floor.rooms, s.id);
      if (br && r) {
        r.polygon = br.polygon.map((p) => add(p, d));
        if (br.connector) r.connector = add(br.connector, d);
      }
    } else if (s.kind === 'furniture' || s.kind === 'stair' || s.kind === 'label') {
      const key = s.kind === 'furniture' ? 'furniture' : s.kind === 'stair' ? 'stairs' : 'labels';
      const bf = findById(base[key] as { id: string; pos: Vec }[], s.id);
      const f = findById(floor[key] as { id: string; pos: Vec }[], s.id);
      if (bf && f) f.pos = add(bf.pos, d);
    } else if (s.kind === 'manifold') {
      const bf = findById(base.manifolds, s.id);
      const f = findById(floor.manifolds, s.id);
      if (bf && f) f.pos = add(bf.pos, d);
    } else if (s.kind === 'void') {
      const bf = findById(base.voids, s.id);
      const f = findById(floor.voids, s.id);
      if (bf && f && !f.stairId) {
        f.polygon = bf.polygon.map((p) => add(p, d));
        if (bf.center) f.center = add(bf.center, d);
      }
    } else if (s.kind === 'heatSource' && project?.heatSource && baseProject?.heatSource) {
      project.heatSource.pos = add(baseProject.heatSource.pos, d);
    } else if (s.kind === 'dimension') {
      const bf = findById(base.dimensions, s.id);
      const f = findById(floor.dimensions, s.id);
      if (bf && f) {
        f.a = add(bf.a, d);
        f.b = add(bf.b, d);
      }
    }
  }
}

export function deleteSelection(project: Project, floor: Floor, sel: SelItem[]): void {
  const ids = (k: SelItem['kind']) => new Set(sel.filter((s) => s.kind === k).map((s) => s.id));
  const w = ids('wall');
  const o = ids('opening');
  floor.walls = floor.walls.filter((x) => !w.has(x.id));
  for (const x of floor.walls) x.openings = x.openings.filter((y) => !o.has(y.id));
  const r = ids('room');
  floor.rooms = floor.rooms.filter((x) => !r.has(x.id));
  floor.routes = floor.routes.filter((x) => !r.has(x.roomId) && !ids('route').has(x.id));
  floor.furniture = floor.furniture.filter((x) => !ids('furniture').has(x.id));
  floor.stairs = floor.stairs.filter((x) => !ids('stair').has(x.id));
  floor.dimensions = floor.dimensions.filter((x) => !ids('dimension').has(x.id));
  floor.labels = floor.labels.filter((x) => !ids('label').has(x.id));
  floor.voids = floor.voids.filter((x) => !ids('void').has(x.id) || !!x.stairId);
  const m = ids('manifold');
  if (m.size) {
    floor.manifolds = floor.manifolds.filter((x) => !m.has(x.id));
    for (const f of project.floors) for (const room of f.rooms) if (room.manifoldId && m.has(room.manifoldId)) room.manifoldId = null;
  }
  if (ids('heatSource').size) project.heatSource = null;
}

/** Zwischenablage: ausgewählte Objekte als JSON */
export interface Clip {
  walls: Wall[];
  rooms: Floor['rooms'];
  furniture: Floor['furniture'];
  stairs: Floor['stairs'];
  dimensions: Floor['dimensions'];
  labels: Floor['labels'];
}

export function copySelection(floor: Floor, sel: SelItem[]): Clip {
  const has = (k: SelItem['kind'], id: string) => sel.some((s) => s.kind === k && s.id === id);
  const c = <T>(x: T): T => JSON.parse(JSON.stringify(x));
  return {
    walls: c(floor.walls.filter((x) => has('wall', x.id))),
    rooms: c(floor.rooms.filter((x) => has('room', x.id))),
    furniture: c(floor.furniture.filter((x) => has('furniture', x.id))),
    stairs: c(floor.stairs.filter((x) => has('stair', x.id))),
    dimensions: c(floor.dimensions.filter((x) => has('dimension', x.id))),
    labels: c(floor.labels.filter((x) => has('label', x.id))),
  };
}

export function pasteClip(floor: Floor, clip: Clip, d: Vec): SelItem[] {
  const sel: SelItem[] = [];
  const mv = (p: Vec) => add(p, d);
  const cp = <T>(x: T): T => JSON.parse(JSON.stringify(x));
  for (const w of clip.walls) {
    const n: Wall = { ...cp(w), id: uid('w'), a: mv(w.a), b: mv(w.b) };
    n.openings = n.openings.map((o) => ({ ...o, id: uid('o') }));
    floor.walls.push(n);
    sel.push({ kind: 'wall', id: n.id });
  }
  for (const r of clip.rooms) {
    const n = { ...cp(r), id: uid('r'), polygon: r.polygon.map(mv), connector: null, manifoldId: r.manifoldLocked ? r.manifoldId : null };
    n.surfaces = n.surfaces.map((s) => ({ ...s, id: uid('s'), wallId: undefined, field: undefined })).filter((s) => s.kind !== 'wall');
    floor.rooms.push(n);
    sel.push({ kind: 'room', id: n.id });
  }
  for (const f of clip.furniture) {
    const n = { ...f, id: uid('F'), pos: mv(f.pos) };
    floor.furniture.push(n);
    sel.push({ kind: 'furniture', id: n.id });
  }
  for (const s of clip.stairs) {
    const n = { ...s, id: uid('S'), pos: mv(s.pos) };
    floor.stairs.push(n);
    sel.push({ kind: 'stair', id: n.id });
  }
  for (const s of clip.dimensions) {
    const n = { ...s, id: uid('D'), a: mv(s.a), b: mv(s.b) };
    floor.dimensions.push(n);
    sel.push({ kind: 'dimension', id: n.id });
  }
  for (const s of clip.labels) {
    const n = { ...s, id: uid('T'), pos: mv(s.pos) };
    floor.labels.push(n);
    sel.push({ kind: 'label', id: n.id });
  }
  return sel;
}

/** Auswahl um einen Winkel um ihren Schwerpunkt drehen */
export function rotateSelection(floor: Floor, sel: SelItem[], deg: number): void {
  const pts: Vec[] = [];
  const wallIds = new Set(sel.filter((s) => s.kind === 'wall').map((s) => s.id));
  const objs = () =>
    sel.map((s) => (s.kind === 'furniture' ? findById(floor.furniture, s.id) : s.kind === 'stair' ? findById(floor.stairs, s.id) : s.kind === 'label' ? findById(floor.labels, s.id) : undefined)).filter((x): x is NonNullable<typeof x> => !!x);
  for (const w of floor.walls) if (wallIds.has(w.id)) pts.push(w.a, w.b);
  for (const s of sel) {
    const r = s.kind === 'room' ? findById(floor.rooms, s.id) : undefined;
    if (r) pts.push(...r.polygon);
  }
  for (const o of objs()) pts.push(o.pos);
  if (!pts.length) return;
  const ctr = { x: pts.reduce((a, p) => a + p.x, 0) / pts.length, y: pts.reduce((a, p) => a + p.y, 0) / pts.length };
  const a = (deg * Math.PI) / 180;
  const R = (p: Vec) => {
    const q = sub(p, ctr);
    return { x: ctr.x + q.x * Math.cos(a) - q.y * Math.sin(a), y: ctr.y + q.x * Math.sin(a) + q.y * Math.cos(a) };
  };
  for (const w of floor.walls)
    if (wallIds.has(w.id)) {
      w.a = R(w.a);
      w.b = R(w.b);
    }
  for (const s of sel) {
    const r = s.kind === 'room' ? findById(floor.rooms, s.id) : undefined;
    if (r) {
      r.polygon = r.polygon.map(R);
      if (r.connector) r.connector = R(r.connector);
    }
  }
  for (const o of objs()) {
    o.pos = R(o.pos);
    o.angle = (((o.angle + deg) % 360) + 360) % 360;
  }
}

/** Geschoss darüber/darunter mit den Außenwänden (und Fenstern) des Vorbilds */
export function cloneFloorShell(src: Floor, name: string, elevation: number, storeyHeight: number): Floor {
  const f = newFloor(name, elevation, storeyHeight);
  f.floorThickness = src.floorThickness;
  f.walls = src.walls
    .filter((w) => w.kind === 'exterior' || w.kind === 'party')
    .map((w) => ({ ...JSON.parse(JSON.stringify(w)), id: uid('w'), openings: w.openings.filter((o) => o.kind === 'window').map((o) => ({ ...o, id: uid('o') })) }));
  return f;
}

export { wallLength };
