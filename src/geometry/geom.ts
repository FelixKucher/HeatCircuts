import type { Vec } from '../model/types';

export const v = (x: number, y: number): Vec => ({ x, y });
export const add = (a: Vec, b: Vec): Vec => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y });
export const mul = (a: Vec, s: number): Vec => ({ x: a.x * s, y: a.y * s });
export const dot = (a: Vec, b: Vec): number => a.x * b.x + a.y * b.y;
export const cross = (a: Vec, b: Vec): number => a.x * b.y - a.y * b.x;
export const len = (a: Vec): number => Math.hypot(a.x, a.y);
export const dist = (a: Vec, b: Vec): number => Math.hypot(a.x - b.x, a.y - b.y);
export const norm = (a: Vec): Vec => {
  const l = len(a);
  return l > 1e-12 ? { x: a.x / l, y: a.y / l } : { x: 0, y: 0 };
};

/** Vorzeichenbehaftete Fläche (Shoelace); positiv = gegen den Uhrzeigersinn in y-oben-Koordinaten. */
export function signedArea(poly: Vec[]): number {
  let s = 0;
  for (let i = 0, n = poly.length; i < n; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % n];
    s += a.x * b.y - b.x * a.y;
  }
  return s / 2;
}

export const area = (poly: Vec[]): number => Math.abs(signedArea(poly));

export function perimeter(poly: Vec[]): number {
  let s = 0;
  for (let i = 0, n = poly.length; i < n; i++) s += dist(poly[i], poly[(i + 1) % n]);
  return s;
}

export function centroid(poly: Vec[]): Vec {
  const a = signedArea(poly);
  if (Math.abs(a) < 1e-9) {
    const s = poly.reduce((acc, p) => add(acc, p), v(0, 0));
    return mul(s, 1 / Math.max(1, poly.length));
  }
  let cx = 0;
  let cy = 0;
  for (let i = 0, n = poly.length; i < n; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % n];
    const f = p.x * q.y - q.x * p.y;
    cx += (p.x + q.x) * f;
    cy += (p.y + q.y) * f;
  }
  return v(cx / (6 * a), cy / (6 * a));
}

export function pointInPolygon(p: Vec, poly: Vec[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export function closestPointOnSegment(p: Vec, a: Vec, b: Vec): Vec {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  if (l2 < 1e-12) return a;
  const t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / l2));
  return add(a, mul(ab, t));
}

export const distToSegment = (p: Vec, a: Vec, b: Vec): number => dist(p, closestPointOnSegment(p, a, b));

export function closestPointOnPolygon(p: Vec, poly: Vec[]): Vec {
  let best = poly[0];
  let bd = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const c = closestPointOnSegment(p, poly[i], poly[(i + 1) % poly.length]);
    const d = dist(p, c);
    if (d < bd) {
      bd = d;
      best = c;
    }
  }
  return best;
}

export function polylineLength(pts: Vec[]): number {
  let s = 0;
  for (let i = 1; i < pts.length; i++) s += dist(pts[i - 1], pts[i]);
  return s;
}

/** Orthogonale Leitungsführung (erst x, dann y) – Länge = Manhattan-Abstand. */
export function manhattanPath(a: Vec, b: Vec): Vec[] {
  if (Math.abs(a.x - b.x) < 1e-9 || Math.abs(a.y - b.y) < 1e-9) return [a, b];
  return [a, v(b.x, a.y), b];
}

/** Überlappungslänge zweier nahezu kollinearer Strecken (Projektion auf Strecke a). */
export function collinearOverlap(a1: Vec, a2: Vec, b1: Vec, b2: Vec, maxOffset: number, maxAngleDeg = 5): number {
  const da = sub(a2, a1);
  const la = len(da);
  const db = sub(b2, b1);
  const lb = len(db);
  if (la < 1e-6 || lb < 1e-6) return 0;
  const ua = mul(da, 1 / la);
  const ub = mul(db, 1 / lb);
  const sinAng = Math.abs(cross(ua, ub));
  if (sinAng > Math.sin((maxAngleDeg * Math.PI) / 180)) return 0;
  // Abstand der Mittelpunkte von b zur Geraden a
  const mid = mul(add(b1, b2), 0.5);
  const off = Math.abs(cross(ua, sub(mid, a1)));
  if (off > maxOffset) return 0;
  const t1 = dot(sub(b1, a1), ua);
  const t2 = dot(sub(b2, a1), ua);
  const lo = Math.max(0, Math.min(t1, t2));
  const hi = Math.min(la, Math.max(t1, t2));
  return Math.max(0, hi - lo);
}

function lineIntersection(p1: Vec, d1: Vec, p2: Vec, d2: Vec): Vec | null {
  const den = cross(d1, d2);
  if (Math.abs(den) < 1e-12) return null;
  const t = cross(sub(p2, p1), d2) / den;
  return add(p1, mul(d1, t));
}

/** Entfernt doppelte und kollineare Punkte. */
export function cleanPolygon(poly: Vec[], eps = 1e-4): Vec[] {
  let pts = poly.filter((p, i) => dist(p, poly[(i + 1) % poly.length]) > eps);
  let changed = true;
  while (changed && pts.length > 3) {
    changed = false;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[(i - 1 + pts.length) % pts.length];
      const b = pts[i];
      const c = pts[(i + 1) % pts.length];
      const cr = cross(sub(b, a), sub(c, b));
      if (Math.abs(cr) < eps * Math.max(dist(a, b), dist(b, c), 1e-9)) {
        pts = pts.filter((_, k) => k !== i);
        changed = true;
        break;
      }
    }
  }
  return pts;
}

function segmentsIntersect(a: Vec, b: Vec, c: Vec, d: Vec): boolean {
  const d1 = cross(sub(b, a), sub(c, a));
  const d2 = cross(sub(b, a), sub(d, a));
  const d3 = cross(sub(d, c), sub(a, c));
  const d4 = cross(sub(d, c), sub(b, c));
  return d1 * d2 < 0 && d3 * d4 < 0;
}

export function isSimplePolygon(poly: Vec[]): boolean {
  const n = poly.length;
  if (n < 3) return false;
  for (let i = 0; i < n; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % n];
    for (let j = i + 1; j < n; j++) {
      if (Math.abs(i - j) <= 1 || (i === 0 && j === n - 1)) continue;
      if (segmentsIntersect(a, b, poly[j], poly[(j + 1) % n])) return false;
    }
  }
  return true;
}

/**
 * Parallelverschiebung aller Kanten nach innen um d (Gehrungsecken).
 * Liefert null, wenn das Polygon dabei kollabiert oder sich selbst schneidet.
 */
export function insetPolygon(polyIn: Vec[], d: number): Vec[] | null {
  const poly = cleanPolygon(polyIn);
  if (poly.length < 3) return null;
  const sa = signedArea(poly);
  const sign = sa > 0 ? 1 : -1;
  const n = poly.length;
  const lines: { p: Vec; d: Vec; len: number }[] = [];
  for (let i = 0; i < n; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % n];
    const dir = norm(sub(b, a));
    // Innennormale: bei positiver Fläche (CCW in Mathe-Koordinaten) links der Kante
    const nrm = mul(v(-dir.y, dir.x), sign);
    lines.push({ p: add(a, mul(nrm, d)), d: dir, len: dist(a, b) });
  }
  const out: Vec[] = [];
  for (let i = 0; i < n; i++) {
    const prev = lines[(i - 1 + n) % n];
    const cur = lines[i];
    const ip = lineIntersection(prev.p, prev.d, cur.p, cur.d);
    out.push(ip ?? cur.p);
  }
  // Kanten dürfen ihre Richtung nicht umkehren
  for (let i = 0; i < n; i++) {
    const a = out[i];
    const b = out[(i + 1) % n];
    if (dot(sub(b, a), lines[i].d) <= 1e-6) return null;
  }
  const na = signedArea(out);
  if (Math.sign(na) !== Math.sign(sa) || Math.abs(na) < 1e-4) return null;
  if (!isSimplePolygon(out)) return null;
  return out;
}

/** Sutherland–Hodgman-Clipping an einer Halbebene {p | dot(p, nrm) <= c}. */
export function clipHalfPlane(poly: Vec[], nrm: Vec, c: number): Vec[] {
  const out: Vec[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const da = dot(a, nrm) - c;
    const db = dot(b, nrm) - c;
    if (da <= 0) out.push(a);
    if ((da < 0 && db > 0) || (da > 0 && db < 0)) {
      const t = da / (da - db);
      out.push(add(a, mul(sub(b, a), t)));
    }
  }
  return out;
}

export function bbox(pts: Vec[]): { min: Vec; max: Vec } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { min: v(minX, minY), max: v(maxX, maxY) };
}

/** Schnittintervalle einer horizontalen Linie y = const mit dem Polygon. */
export function scanlineIntervals(poly: Vec[], y: number): [number, number][] {
  const xs: number[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    if (a.y > y !== b.y > y) xs.push(a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x));
  }
  xs.sort((p, q) => p - q);
  const res: [number, number][] = [];
  for (let i = 0; i + 1 < xs.length; i += 2) res.push([xs[i], xs[i + 1]]);
  return res;
}

/** Ramer–Douglas–Peucker für einen offenen Linienzug. */
export function simplifyPolyline(pts: Vec[], eps: number): Vec[] {
  if (pts.length < 3) return pts.slice();
  let maxD = 0;
  let idx = 0;
  const a = pts[0];
  const b = pts[pts.length - 1];
  for (let i = 1; i < pts.length - 1; i++) {
    const d = distToSegment(pts[i], a, b);
    if (d > maxD) {
      maxD = d;
      idx = i;
    }
  }
  if (maxD <= eps) return [a, b];
  const left = simplifyPolyline(pts.slice(0, idx + 1), eps);
  const right = simplifyPolyline(pts.slice(idx), eps);
  return left.slice(0, -1).concat(right);
}

/** RDP für geschlossene Polygone: an den zwei entferntesten Punkten aufteilen. */
export function simplifyPolygon(pts: Vec[], eps: number): Vec[] {
  if (pts.length < 4) return pts.slice();
  let i0 = 0;
  let i1 = 0;
  let best = -1;
  const c = pts[0];
  for (let i = 0; i < pts.length; i++) {
    const d = dist(c, pts[i]);
    if (d > best) {
      best = d;
      i0 = i;
    }
  }
  best = -1;
  for (let i = 0; i < pts.length; i++) {
    const d = dist(pts[i0], pts[i]);
    if (d > best) {
      best = d;
      i1 = i;
    }
  }
  const [s, e] = i0 < i1 ? [i0, i1] : [i1, i0];
  const partA = simplifyPolyline(pts.slice(s, e + 1), eps);
  const partB = simplifyPolyline(pts.slice(e).concat(pts.slice(0, s + 1)), eps);
  return cleanPolygon(partA.slice(0, -1).concat(partB.slice(0, -1)));
}

export function snapToGrid(p: Vec, step: number): Vec {
  return v(Math.round(p.x / step) * step, Math.round(p.y / step) * step);
}

/** Richtung auf 0/45/90°-Raster einrasten. */
export function orthoSnap(from: Vec, to: Vec, allowDiagonal = false): Vec {
  const d = sub(to, from);
  const ang = Math.atan2(d.y, d.x);
  const stepAng = allowDiagonal ? Math.PI / 4 : Math.PI / 2;
  const snapped = Math.round(ang / stepAng) * stepAng;
  const l = len(d);
  const dir = v(Math.cos(snapped), Math.sin(snapped));
  const proj = Math.max(0, dot(d, dir)) || l;
  return add(from, mul(dir, proj));
}
