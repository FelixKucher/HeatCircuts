// Wandgeometrie: Gehrungen an Knoten, Umriss je Wand, Verbindungen und Öffnungslage.

import type { Floor, Opening, Vec, Wall } from '../model/types';
import { add, cross, dist, dot, len, mul, norm, sub } from '../geometry/geom';

export const JOIN_TOL = 0.02;
const MAX_MITER = 3;

export const left = (d: Vec): Vec => ({ x: -d.y, y: d.x });

interface End {
  wall: Wall;
  /** Wandende am Knoten: 'a' oder 'b' */
  end: 'a' | 'b';
  /** Richtung vom Knoten weg */
  d: Vec;
  ang: number;
}

/** Eckpunkte des Wandumrisses: [a links, b links, b rechts, a rechts] ('links' = +n bezogen auf a→b) */
export interface WallOutline {
  wall: Wall;
  poly: Vec[];
  /** Verschiebung der Stirnseiten entlang der Achse (für 3D): links/rechts an a und b */
  ta: { l: number; r: number };
  tb: { l: number; r: number };
}

function intersect(p1: Vec, d1: Vec, p2: Vec, d2: Vec): Vec | null {
  const den = cross(d1, d2);
  if (Math.abs(den) < 1e-9) return null;
  const t = cross(sub(p2, p1), d2) / den;
  return add(p1, mul(d1, t));
}

/** Knoten: Wandenden, die sich (innerhalb JOIN_TOL) treffen */
export function nodesOf(walls: Wall[]): { p: Vec; ends: End[] }[] {
  const nodes: { p: Vec; ends: End[] }[] = [];
  for (const w of walls) {
    const L = dist(w.a, w.b);
    if (L < 1e-6) continue;
    const d = norm(sub(w.b, w.a));
    for (const end of ['a', 'b'] as const) {
      const p = w[end];
      const dd = end === 'a' ? d : mul(d, -1);
      let n = nodes.find((x) => dist(x.p, p) < JOIN_TOL);
      if (!n) nodes.push((n = { p, ends: [] }));
      n.ends.push({ wall: w, end, d: dd, ang: Math.atan2(dd.y, dd.x) });
    }
  }
  return nodes;
}

/** Umrisse aller Wände mit Gehrungen an Knoten (L-, T- und Kreuzstöße). */
export function wallOutlines(walls: Wall[]): Map<string, WallOutline> {
  const res = new Map<string, WallOutline>();
  // je Wandende: Eckpunkt auf der +n-Seite (zur nächsten Wand gegen den Uhrzeigersinn) und −n-Seite
  const corner = new Map<string, { pl: Vec; pr: Vec }>();
  for (const node of nodesOf(walls)) {
    const ends = node.ends.slice().sort((x, y) => x.ang - y.ang);
    const k = ends.length;
    for (let i = 0; i < k; i++) {
      const e = ends[i];
      const t = e.wall.thickness / 2;
      const n = left(e.d);
      let pl = add(node.p, mul(n, t));
      let pr = add(node.p, mul(n, -t));
      if (k > 1) {
        const nx = ends[(i + 1) % k];
        const pv = ends[(i - 1 + k) % k];
        const ql = intersect(pl, e.d, add(node.p, mul(left(nx.d), -nx.wall.thickness / 2)), nx.d);
        const qr = intersect(pr, e.d, add(node.p, mul(left(pv.d), pv.wall.thickness / 2)), pv.d);
        const lim = MAX_MITER * Math.max(t, 0.05);
        if (ql && dist(ql, node.p) < lim) pl = ql;
        if (qr && dist(qr, node.p) < lim) pr = qr;
      }
      corner.set(`${e.wall.id}|${e.end}`, { pl, pr });
    }
  }
  for (const w of walls) {
    const L = dist(w.a, w.b);
    if (L < 1e-6) continue;
    const d = norm(sub(w.b, w.a));
    const n = left(d);
    const t = w.thickness / 2;
    const ca = corner.get(`${w.id}|a`) ?? { pl: add(w.a, mul(n, t)), pr: add(w.a, mul(n, -t)) };
    const cb = corner.get(`${w.id}|b`) ?? { pl: add(w.b, mul(n, -t)), pr: add(w.b, mul(n, t)) };
    // an b ist die Richtung umgekehrt: dort liegt pl auf der −n-Seite der Wand
    const aL = ca.pl;
    const aR = ca.pr;
    const bL = cb.pr;
    const bR = cb.pl;
    const along = (p: Vec) => dot(sub(p, w.a), d);
    res.set(w.id, {
      wall: w,
      poly: [aL, bL, bR, aR],
      ta: { l: along(aL), r: along(aR) },
      tb: { l: along(bL) - L, r: along(bR) - L },
    });
  }
  return res;
}

/** Wandenden, die am Punkt p liegen (für gemeinsames Verschieben von Ecken) */
export function endsAt(walls: Wall[], p: Vec, tol = JOIN_TOL): { wall: Wall; end: 'a' | 'b' }[] {
  const out: { wall: Wall; end: 'a' | 'b' }[] = [];
  for (const w of walls) {
    if (dist(w.a, p) < tol) out.push({ wall: w, end: 'a' });
    if (dist(w.b, p) < tol) out.push({ wall: w, end: 'b' });
  }
  return out;
}

export const wallLength = (w: Wall): number => dist(w.a, w.b);
export const wallDir = (w: Wall): Vec => norm(sub(w.b, w.a));

/** Projektion eines Punkts auf die Wandachse: Abstand t ab a und senkrechter Abstand */
export function projectOnWall(w: Wall, p: Vec): { t: number; off: number } {
  const d = wallDir(w);
  return { t: dot(sub(p, w.a), d), off: cross(d, sub(p, w.a)) };
}

export const pointOnWall = (w: Wall, t: number, off = 0): Vec => add(add(w.a, mul(wallDir(w), t)), mul(left(wallDir(w)), off));

/** nächstgelegene Wand zu p innerhalb maxDist (für Öffnungen und Möbel) */
export function nearestWall(walls: Wall[], p: Vec, maxDist: number): { wall: Wall; t: number; off: number } | null {
  let best: { wall: Wall; t: number; off: number } | null = null;
  let bd = maxDist;
  for (const w of walls) {
    const L = wallLength(w);
    const { t, off } = projectOnWall(w, p);
    if (t < 0 || t > L) continue;
    const dd = Math.abs(off) - w.thickness / 2;
    if (dd < bd) {
      bd = dd;
      best = { wall: w, t, off };
    }
  }
  return best;
}

/** Öffnungslage auf der Wand begrenzen und Überschneidung mit anderen Öffnungen vermeiden */
export function clampOpening(w: Wall, o: Opening, t: number): number {
  const L = wallLength(w);
  const half = o.width / 2;
  let c = Math.min(L - half - 0.01, Math.max(half + 0.01, t));
  if (L < o.width + 0.02) c = L / 2;
  return c;
}

/** Wand bei t teilen (Öffnungen werden zugeordnet) */
export function splitWall(w: Wall, t: number, mkId: () => string): [Wall, Wall] {
  const p = pointOnWall(w, t);
  const w1: Wall = { ...w, b: { ...p }, openings: w.openings.filter((o) => o.offset < t).map((o) => ({ ...o })) };
  const w2: Wall = { ...w, id: mkId(), a: { ...p }, openings: w.openings.filter((o) => o.offset >= t).map((o) => ({ ...o, offset: o.offset - t })) };
  return [w1, w2];
}

/** Gesamtlänge einer Wandseite für Bemaßungen innen/außen */
export function sideLengths(o: WallOutline): { left: number; right: number } {
  return { left: dist(o.poly[0], o.poly[1]), right: dist(o.poly[3], o.poly[2]) };
}

export function floorContentBounds(l: Floor): { min: Vec; max: Vec } | null {
  const pts: Vec[] = [];
  for (const w of l.walls) pts.push(w.a, w.b);
  for (const r of l.rooms) pts.push(...r.polygon);
  if (!pts.length) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { min: { x: minX, y: minY }, max: { x: maxX, y: maxY } };
}

export { len };
