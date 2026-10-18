// Bearbeitungsoperationen auf einem Geschoss (rein funktional auf den Modelldaten).

import { newRoom, newWall, uid, type Level, type Project, type Vec, type Wall } from './model';
import { pointOnWall, projectOnWall, splitWall, wallLength, wallOutlines } from './walls';
import { add, area, dist, sub } from '../../src/geometry/geom';
import { detectRoom } from '../../src/geometry/detect';
import type { SelItem } from './store';
import type { Wall as HCWall } from '../../src/model/types';

const ON_TOL = 0.01;

/** Wände an Punkt p teilen, wenn p im Inneren ihrer Achse liegt (T-Stoß) */
export function splitWallsAt(level: Level, p: Vec): void {
  for (const w of [...level.walls]) {
    const L = wallLength(w);
    const { t, off } = projectOnWall(w, p);
    if (Math.abs(off) > ON_TOL || t < 0.02 || t > L - 0.02) continue;
    const [w1, w2] = splitWall(w, t, () => uid('W'));
    level.walls.splice(level.walls.indexOf(w), 1, w1, w2);
  }
}

/** Abschnitte von a–b, die nicht schon von einer kollinearen Wand belegt sind */
function uncovered(level: Level, a: Vec, b: Vec): [Vec, Vec][] {
  const L = dist(a, b);
  if (L < 1e-6) return [];
  const probe: Wall = newWall(a, b, 0.1);
  const iv: [number, number][] = [];
  for (const w of level.walls) {
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
export function addWallChain(level: Level, pts: Vec[], thickness: number, closed = false): Wall[] {
  const segs: [Vec, Vec][] = [];
  for (let i = 0; i + 1 < pts.length; i++) segs.push([pts[i], pts[i + 1]]);
  if (closed && pts.length > 2) segs.push([pts[pts.length - 1], pts[0]]);
  const created: Wall[] = [];
  for (const [a, b] of segs) {
    if (dist(a, b) < 0.02) continue;
    for (const [p, q] of uncovered(level, a, b)) {
      splitWallsAt(level, p);
      splitWallsAt(level, q);
      // vorhandene Wandenden im Inneren der neuen Wand → neue Wand dort teilen
      const cuts = [0, dist(p, q)];
      const probe = newWall(p, q, thickness);
      for (const w of level.walls)
        for (const e of [w.a, w.b]) {
          const { t, off } = projectOnWall(probe, e);
          if (Math.abs(off) < ON_TOL && t > 0.02 && t < cuts[1] - 0.02) cuts.push(t);
        }
      cuts.sort((x, y) => x - y);
      for (let i = 0; i + 1 < cuts.length; i++) {
        if (cuts[i + 1] - cuts[i] < 0.02) continue;
        const w = newWall(pointOnWall(probe, cuts[i]), pointOnWall(probe, cuts[i + 1]), thickness);
        level.walls.push(w);
        created.push(w);
      }
    }
  }
  return created;
}

const asHC = (walls: Wall[]): HCWall[] => walls.map((w) => ({ id: w.id, a: w.a, b: w.b, thickness: w.thickness, kind: 'interior', openings: [] }));

/** Raum per Klick aus umschließenden Wänden; Kanten werden exakt auf die Wandoberflächen gelegt */
export function detectRoomAt(level: Level, p: Vec): Vec[] | null {
  const r = detectRoom(p, asHC(level.walls), 0.02);
  if (!r.ok || area(r.polygon) < 0.3) return null;
  return snapToWallFaces(r.polygon, level.walls);
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

/** Rechteckraum (RoomSketcher-Stil): Wandachsen auf dem Rechteck, Raum = lichte Fläche */
export function addRectRoom(level: Level, a: Vec, b: Vec, thickness: number, name: string): { walls: Wall[]; roomId: string | null } {
  const x0 = Math.min(a.x, b.x);
  const x1 = Math.max(a.x, b.x);
  const y0 = Math.min(a.y, b.y);
  const y1 = Math.max(a.y, b.y);
  if (x1 - x0 < 0.3 || y1 - y0 < 0.3) return { walls: [], roomId: null };
  const walls = addWallChain(level, [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }], thickness, true);
  const poly = detectRoomAt(level, { x: (x0 + x1) / 2, y: (y0 + y1) / 2 });
  if (!poly) return { walls, roomId: null };
  const room = newRoom(poly, name);
  level.rooms.push(room);
  return { walls, roomId: room.id };
}

/** Auswahl um d verschieben (Wandenden verbundener Wände wandern mit) */
export function moveSelection(base: Level, level: Level, sel: SelItem[], d: Vec): void {
  const wallIds = new Set(sel.filter((s) => s.kind === 'wall').map((s) => s.id));
  if (wallIds.size) {
    const moved: Vec[] = [];
    for (const w of base.walls) if (wallIds.has(w.id)) moved.push(w.a, w.b);
    for (let i = 0; i < level.walls.length; i++) {
      const bw = base.walls[i];
      const w = level.walls[i];
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
      const br = base.rooms.find((r) => r.id === s.id);
      const r = level.rooms.find((x) => x.id === s.id);
      if (br && r) r.polygon = br.polygon.map((p) => add(p, d));
    } else if (s.kind === 'furniture') {
      const bf = base.furniture.find((r) => r.id === s.id);
      const f = level.furniture.find((x) => x.id === s.id);
      if (bf && f) f.pos = add(bf.pos, d);
    } else if (s.kind === 'stair') {
      const bf = base.stairs.find((r) => r.id === s.id);
      const f = level.stairs.find((x) => x.id === s.id);
      if (bf && f) f.pos = add(bf.pos, d);
    } else if (s.kind === 'label') {
      const bf = base.labels.find((r) => r.id === s.id);
      const f = level.labels.find((x) => x.id === s.id);
      if (bf && f) f.pos = add(bf.pos, d);
    } else if (s.kind === 'dimension') {
      const bf = base.dimensions.find((r) => r.id === s.id);
      const f = level.dimensions.find((x) => x.id === s.id);
      if (bf && f) {
        f.a = add(bf.a, d);
        f.b = add(bf.b, d);
      }
    }
  }
}

export function deleteSelection(level: Level, sel: SelItem[]): void {
  const ids = (k: SelItem['kind']) => new Set(sel.filter((s) => s.kind === k).map((s) => s.id));
  const w = ids('wall');
  const o = ids('opening');
  level.walls = level.walls.filter((x) => !w.has(x.id));
  for (const x of level.walls) x.openings = x.openings.filter((y) => !o.has(y.id));
  const r = ids('room');
  level.rooms = level.rooms.filter((x) => !r.has(x.id));
  const f = ids('furniture');
  level.furniture = level.furniture.filter((x) => !f.has(x.id));
  const s = ids('stair');
  level.stairs = level.stairs.filter((x) => !s.has(x.id));
  const dd = ids('dimension');
  level.dimensions = level.dimensions.filter((x) => !dd.has(x.id));
  const l = ids('label');
  level.labels = level.labels.filter((x) => !l.has(x.id));
}

/** Zwischenablage: ausgewählte Objekte als JSON */
export interface Clip {
  walls: Wall[];
  rooms: Level['rooms'];
  furniture: Level['furniture'];
  stairs: Level['stairs'];
  dimensions: Level['dimensions'];
  labels: Level['labels'];
}

export function copySelection(level: Level, sel: SelItem[]): Clip {
  const has = (k: SelItem['kind'], id: string) => sel.some((s) => s.kind === k && s.id === id);
  const c = <T>(x: T): T => JSON.parse(JSON.stringify(x));
  return {
    walls: c(level.walls.filter((x) => has('wall', x.id))),
    rooms: c(level.rooms.filter((x) => has('room', x.id))),
    furniture: c(level.furniture.filter((x) => has('furniture', x.id))),
    stairs: c(level.stairs.filter((x) => has('stair', x.id))),
    dimensions: c(level.dimensions.filter((x) => has('dimension', x.id))),
    labels: c(level.labels.filter((x) => has('label', x.id))),
  };
}

export function pasteClip(level: Level, clip: Clip, d: Vec): SelItem[] {
  const sel: SelItem[] = [];
  const mv = (p: Vec) => add(p, d);
  for (const w of clip.walls) {
    const n = { ...JSON.parse(JSON.stringify(w)), id: uid('W'), a: mv(w.a), b: mv(w.b) } as Wall;
    n.openings = n.openings.map((o) => ({ ...o, id: uid('O') }));
    level.walls.push(n);
    sel.push({ kind: 'wall', id: n.id });
  }
  for (const r of clip.rooms) {
    const n = { ...JSON.parse(JSON.stringify(r)), id: uid('R'), polygon: r.polygon.map(mv) };
    level.rooms.push(n);
    sel.push({ kind: 'room', id: n.id });
  }
  for (const f of clip.furniture) {
    const n = { ...f, id: uid('F'), pos: mv(f.pos) };
    level.furniture.push(n);
    sel.push({ kind: 'furniture', id: n.id });
  }
  for (const s of clip.stairs) {
    const n = { ...s, id: uid('S'), pos: mv(s.pos) };
    level.stairs.push(n);
    sel.push({ kind: 'stair', id: n.id });
  }
  for (const s of clip.dimensions) {
    const n = { ...s, id: uid('D'), a: mv(s.a), b: mv(s.b) };
    level.dimensions.push(n);
    sel.push({ kind: 'dimension', id: n.id });
  }
  for (const s of clip.labels) {
    const n = { ...s, id: uid('T'), pos: mv(s.pos) };
    level.labels.push(n);
    sel.push({ kind: 'label', id: n.id });
  }
  return sel;
}

/** Auswahl um 90° (oder beliebigen Winkel) um ihren Schwerpunkt drehen */
export function rotateSelection(level: Level, sel: SelItem[], deg: number): void {
  const pts: Vec[] = [];
  const wallIds = new Set(sel.filter((s) => s.kind === 'wall').map((s) => s.id));
  for (const w of level.walls) if (wallIds.has(w.id)) pts.push(w.a, w.b);
  for (const s of sel) {
    const r = level.rooms.find((x) => x.id === s.id);
    if (r) pts.push(...r.polygon);
    const f = level.furniture.find((x) => x.id === s.id) ?? level.stairs.find((x) => x.id === s.id) ?? level.labels.find((x) => x.id === s.id);
    if (f) pts.push(f.pos);
  }
  if (!pts.length) return;
  const ctr = { x: pts.reduce((a, p) => a + p.x, 0) / pts.length, y: pts.reduce((a, p) => a + p.y, 0) / pts.length };
  const a = (deg * Math.PI) / 180;
  const R = (p: Vec) => {
    const q = sub(p, ctr);
    return { x: ctr.x + q.x * Math.cos(a) - q.y * Math.sin(a), y: ctr.y + q.x * Math.sin(a) + q.y * Math.cos(a) };
  };
  for (const w of level.walls)
    if (wallIds.has(w.id)) {
      w.a = R(w.a);
      w.b = R(w.b);
    }
  for (const s of sel) {
    const r = level.rooms.find((x) => x.id === s.id);
    if (r) r.polygon = r.polygon.map(R);
    const f = level.furniture.find((x) => x.id === s.id) ?? level.stairs.find((x) => x.id === s.id) ?? level.labels.find((x) => x.id === s.id);
    if (f) {
      f.pos = R(f.pos);
      f.angle = (((f.angle + deg) % 360) + 360) % 360;
    }
  }
}

/** Geschoss kopieren (neue Ids), z. B. für ein weiteres Obergeschoss mit gleichen Außenwänden */
export function cloneLevel(project: Project, src: Level, name: string, onlyWalls: boolean): Level {
  const l: Level = JSON.parse(JSON.stringify(src));
  l.id = uid('L');
  l.name = name;
  l.elevation = src.elevation + src.height;
  l.walls = l.walls.map((w) => ({ ...w, id: uid('W'), openings: w.openings.map((o) => ({ ...o, id: uid('O') })) }));
  l.rooms = onlyWalls ? [] : l.rooms.map((r) => ({ ...r, id: uid('R') }));
  l.furniture = onlyWalls ? [] : l.furniture.map((f) => ({ ...f, id: uid('F') }));
  l.stairs = [];
  l.dimensions = onlyWalls ? [] : l.dimensions.map((d) => ({ ...d, id: uid('D') }));
  l.labels = onlyWalls ? [] : l.labels.map((d) => ({ ...d, id: uid('T') }));
  l.background = null;
  void project;
  return l;
}
