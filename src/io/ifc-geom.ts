// Geometrie für den IFC-Import: Grundrisse aus triangulierten Körpern (Planebene x/y, y nach Süden).

import type { Vec } from '../model/types';

export interface Tri3 {
  /** drei Punkte als [x, y, h] – Planlage und Höhe */
  p: [number, number, number][];
}

const key = (p: Vec) => `${Math.round(p.x * 1000)},${Math.round(p.y * 1000)}`;

export function polyArea(poly: Vec[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

/** kollineare und doppelte Punkte entfernen */
export function simplify(poly: Vec[], tol = 0.005): Vec[] {
  let pts = poly.slice();
  let changed = true;
  while (changed && pts.length > 3) {
    changed = false;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[(i + pts.length - 1) % pts.length];
      const b = pts[i];
      const c = pts[(i + 1) % pts.length];
      const abx = b.x - a.x;
      const aby = b.y - a.y;
      const acx = c.x - a.x;
      const acy = c.y - a.y;
      const len = Math.hypot(acx, acy);
      const dup = Math.hypot(abx, aby) < tol;
      const off = len > 1e-9 ? Math.abs(abx * acy - aby * acx) / len : 0;
      if (dup || off < tol) {
        pts.splice(i, 1);
        changed = true;
        break;
      }
    }
  }
  pts = pts.map((p) => ({ x: Math.round(p.x * 1000) / 1000, y: Math.round(p.y * 1000) / 1000 }));
  return pts;
}

/**
 * Umriss der Unterseite eines Körpers: alle waagerechten Dreiecke auf Höhe der Unterkante,
 * Randkanten (nur einmal vorkommend) zu Ringen verkettet; der flächengrößte Ring ist der Umriss.
 */
export function bottomOutline(tris: Tri3[], tol = 0.02): Vec[] | null {
  if (!tris.length) return null;
  const hMin = Math.min(...tris.flatMap((t) => t.p.map((q) => q[2])));
  const faces: Vec[][] = [];
  for (const t of tris) {
    if (!t.p.every((q) => Math.abs(q[2] - hMin) < tol)) continue;
    const pts = t.p.map((q) => ({ x: q[0], y: q[1] }));
    if (Math.abs(polyArea(pts)) > 1e-8) faces.push(pts);
  }
  // Eckpunkte, die auf fremden Kanten liegen (T-Stöße), teilen diese Kanten
  const verts = [...new Map(faces.flat().map((p) => [key(p), p])).values()];
  const edges = new Map<string, { a: Vec; b: Vec; n: number }>();
  const addEdge = (a: Vec, b: Vec) => {
    const ka = key(a);
    const kb = key(b);
    if (ka === kb) return;
    const k = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
    const e = edges.get(k);
    if (e) e.n++;
    else edges.set(k, { a, b, n: 1 });
  };
  for (const pts of faces) {
    for (let i = 0; i < 3; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % 3];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      const inner = verts
        .map((v) => ({ v, s: segDist(v, a, b) }))
        .filter(({ s }) => s.d < 0.001 && s.t * len > 0.001 && (1 - s.t) * len > 0.001)
        .sort((x, y) => x.s.t - y.s.t)
        .map((x) => x.v);
      const chain = [a, ...inner, b];
      for (let k = 0; k + 1 < chain.length; k++) addEdge(chain[k], chain[k + 1]);
    }
  }
  const border = [...edges.values()].filter((e) => e.n === 1);
  if (border.length < 3) return null;
  const next = new Map<string, Vec[]>();
  const add = (p: Vec, q: Vec) => {
    const k = key(p);
    const l = next.get(k);
    if (l) l.push(q);
    else next.set(k, [q]);
  };
  for (const e of border) {
    add(e.a, e.b);
    add(e.b, e.a);
  }
  const used = new Set<string>();
  const ekey = (p: Vec, q: Vec) => {
    const a = key(p);
    const b = key(q);
    return a < b ? `${a}|${b}` : `${b}|${a}`;
  };
  let best: Vec[] | null = null;
  let bestArea = 0;
  for (const e of border) {
    if (used.has(ekey(e.a, e.b))) continue;
    const ring: Vec[] = [e.a];
    used.add(ekey(e.a, e.b));
    let prev = e.a;
    let cur = e.b;
    for (let guard = 0; guard < 10000 && key(cur) !== key(e.a); guard++) {
      ring.push(cur);
      const cand = (next.get(key(cur)) ?? []).filter((q) => !used.has(ekey(cur, q)) && key(q) !== key(prev));
      const nx = cand[0] ?? (next.get(key(cur)) ?? []).find((q) => key(q) === key(e.a));
      if (!nx) break;
      used.add(ekey(cur, nx));
      prev = cur;
      cur = nx;
    }
    if (ring.length < 3) continue;
    const a = Math.abs(polyArea(ring));
    if (a > bestArea) {
      bestArea = a;
      best = ring;
    }
  }
  return best ? simplify(best) : null;
}

/** konvexe Hülle (Andrew) */
export function hull(points: Vec[]): Vec[] {
  const pts = [...new Map(points.map((p) => [key(p), p])).values()].sort((a, b) => a.x - b.x || a.y - b.y);
  if (pts.length < 3) return pts;
  const cross = (o: Vec, a: Vec, b: Vec) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Vec[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Vec[] = [];
  for (const p of pts.slice().reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

export interface OrientedRect {
  center: Vec;
  /** Einheitsvektor der langen Seite */
  u: Vec;
  length: number;
  width: number;
}

/** kleinstes umschließendes Rechteck (Drehschieblehre über die Hüllkanten) */
export function minAreaRect(points: Vec[]): OrientedRect | null {
  const h = hull(points);
  if (h.length < 2) return null;
  let best: OrientedRect | null = null;
  let bestA = Infinity;
  for (let i = 0; i < h.length; i++) {
    const a = h[i];
    const b = h[(i + 1) % h.length];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 1e-9) continue;
    const u = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
    const n = { x: -u.y, y: u.x };
    let u0 = Infinity;
    let u1 = -Infinity;
    let n0 = Infinity;
    let n1 = -Infinity;
    for (const p of h) {
      const pu = p.x * u.x + p.y * u.y;
      const pn = p.x * n.x + p.y * n.y;
      u0 = Math.min(u0, pu);
      u1 = Math.max(u1, pu);
      n0 = Math.min(n0, pn);
      n1 = Math.max(n1, pn);
    }
    const area = (u1 - u0) * (n1 - n0);
    if (area < bestA - 1e-9) {
      bestA = area;
      const cu = (u0 + u1) / 2;
      const cn = (n0 + n1) / 2;
      const center = { x: u.x * cu + n.x * cn, y: u.y * cu + n.y * cn };
      const lu = u1 - u0;
      const ln = n1 - n0;
      best = lu >= ln ? { center, u, length: lu, width: ln } : { center, u: n, length: ln, width: lu };
    }
  }
  return best;
}

export interface AxisWall {
  a: Vec;
  b: Vec;
  thickness: number;
}

/** Wandachse aus dem Rechteck */
export function rectToAxis(r: OrientedRect): AxisWall {
  const h = r.length / 2;
  return { a: { x: r.center.x - r.u.x * h, y: r.center.y - r.u.y * h }, b: { x: r.center.x + r.u.x * h, y: r.center.y + r.u.y * h }, thickness: r.width };
}

function intersect(a: AxisWall, b: AxisWall): Vec | null {
  const d1 = { x: a.b.x - a.a.x, y: a.b.y - a.a.y };
  const d2 = { x: b.b.x - b.a.x, y: b.b.y - b.a.y };
  const den = d1.x * d2.y - d1.y * d2.x;
  const l1 = Math.hypot(d1.x, d1.y);
  const l2 = Math.hypot(d2.x, d2.y);
  if (Math.abs(den) < 0.05 * l1 * l2) return null; // nahezu parallel
  const t = ((b.a.x - a.a.x) * d2.y - (b.a.y - a.a.y) * d2.x) / den;
  return { x: a.a.x + d1.x * t, y: a.a.y + d1.y * t };
}

const dist = (p: Vec, q: Vec) => Math.hypot(p.x - q.x, p.y - q.y);

/** Abstand Punkt–Strecke und Parameter */
export function segDist(p: Vec, a: Vec, b: Vec): { d: number; t: number } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
  return { d: Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t)), t };
}

/**
 * Wandenden verbinden: Achsen aus Hüllkörpern enden an der Außenkante der anschließenden Wand.
 * Endpunkte nahe am Schnitt zweier Achsen werden auf den Schnittpunkt gesetzt (L- und T-Stoß).
 */
export function joinWalls(walls: AxisWall[]): void {
  for (let i = 0; i < walls.length; i++) {
    for (let j = 0; j < walls.length; j++) {
      if (i === j) continue;
      const w = walls[i];
      const o = walls[j];
      const x = intersect(w, o);
      if (!x) continue;
      const reach = Math.max(w.thickness, o.thickness) * 0.75 + 0.05;
      for (const end of ['a', 'b'] as const) {
        if (dist(w[end], x) > reach) continue;
        // Schnittpunkt muss auf der anderen Wand liegen (mit Toleranz an deren Enden)
        const s = segDist(x, o.a, o.b);
        if (s.d > reach) continue;
        const other = end === 'a' ? w.b : w.a;
        if (dist(other, x) < 0.1) continue;
        w[end] = { x: x.x, y: x.y };
      }
    }
  }
}
