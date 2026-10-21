import type { LayingPattern, Vec } from '../model/types';
import { area, bbox, clipHalfPlane, dist, insetPolygon, pointInPolygon, scanlineIntervals, v } from './geom';

export interface CircuitDrawing {
  /** Vorlauf-Linienzüge */
  supply: Vec[][];
  /** Rücklauf-Linienzüge */
  ret: Vec[][];
  /** Einspeisepunkt (Beginn Vorlauf) und Austritt (Ende Rücklauf) */
  inlet: Vec | null;
  outlet: Vec | null;
}

/** Teilt ein Polygon entlang seiner längeren Achse in n flächengleiche Abschnitte. */
export function splitPolygon(poly: Vec[], n: number): Vec[][] {
  if (n <= 1) return [poly];
  const bb = bbox(poly);
  const horizontal = bb.max.x - bb.min.x >= bb.max.y - bb.min.y;
  const nrm = horizontal ? v(1, 0) : v(0, 1);
  const lo = horizontal ? bb.min.x : bb.min.y;
  const hi = horizontal ? bb.max.x : bb.max.y;
  const total = area(poly);
  const cuts: number[] = [lo];
  for (let k = 1; k < n; k++) {
    const target = (total * k) / n;
    let a = lo;
    let b = hi;
    for (let it = 0; it < 50; it++) {
      const m = (a + b) / 2;
      const part = clipHalfPlane(poly, nrm, m);
      if (area(part) < target) a = m;
      else b = m;
    }
    cuts.push((a + b) / 2);
  }
  cuts.push(hi);
  const parts: Vec[][] = [];
  for (let k = 0; k < n; k++) {
    let part = clipHalfPlane(poly, nrm, cuts[k + 1]);
    part = clipHalfPlane(part, v(-nrm.x, -nrm.y), -cuts[k]);
    if (part.length >= 3) parts.push(part);
  }
  return parts;
}

function rotateToNearest(ring: Vec[], target: Vec): Vec[] {
  let idx = 0;
  let best = Infinity;
  ring.forEach((p, i) => {
    const d = dist(p, target);
    if (d < best) {
      best = d;
      idx = i;
    }
  });
  return ring.slice(idx).concat(ring.slice(0, idx));
}

/** Gegenstrom-Spirale (Schneckenform): Vor- und Rücklauf liegen abwechselnd nebeneinander. */
function spiralLayout(poly: Vec[], spacing: number, wallDistance: number, entry: Vec): CircuitDrawing {
  const rings: Vec[][] = [];
  for (let k = 0; k < 400; k++) {
    const ring = insetPolygon(poly, wallDistance + k * spacing);
    if (!ring) break;
    rings.push(rotateToNearest(ring, entry));
  }
  if (rings.length === 0) return { supply: [], ret: [], inlet: null, outlet: null };
  // Jeder Ring endet 2·VA vor seinem Startpunkt; von dort führt ein rechtwinkliger Versatz
  // auf den Start des übernächsten Rings (gleiche Leitung).
  const jump = 2 * spacing;
  const open = (ring: Vec[], isLast: boolean): Vec[] => {
    const v0 = ring[0];
    const vl = ring[ring.length - 1];
    const l = dist(vl, v0);
    if (isLast || l <= jump * 1.2) return ring.slice();
    const t = (l - jump) / l;
    return [...ring, v(vl.x + (v0.x - vl.x) * t, vl.y + (v0.y - vl.y) * t)];
  };
  const sup: Vec[] = [];
  const ret: Vec[] = [];
  rings.forEach((ring, k) => {
    const lastOfKind = k + 2 >= rings.length;
    (k % 2 === 0 ? sup : ret).push(...open(ring, lastOfKind));
  });
  // Umkehr in der Mitte: rechtwinklig über einen Eckpunkt im Raum
  if (ret.length) {
    const a = sup[sup.length - 1];
    const b = ret[ret.length - 1];
    if (Math.abs(a.x - b.x) > 1e-3 && Math.abs(a.y - b.y) > 1e-3) {
      const inner = rings[rings.length - 1];
      const c1 = v(b.x, a.y);
      const c2 = v(a.x, b.y);
      sup.push(pointInPolygon(c1, inner) || !pointInPolygon(c2, inner) ? c1 : c2);
    }
    sup.push(b);
  }
  const retOut = ret.slice().reverse();
  return { supply: [sup], ret: retOut.length ? [retOut] : [], inlet: sup[0] ?? null, outlet: retOut[retOut.length - 1] ?? sup[sup.length - 1] ?? null };
}

/** Mäander (Schlangenform) mit Leitungen parallel zur längeren Raumseite. */
function meanderLayout(poly: Vec[], spacing: number, wallDistance: number, entry: Vec): CircuitDrawing {
  const bb = bbox(poly);
  const transpose = bb.max.x - bb.min.x < bb.max.y - bb.min.y;
  const T = (p: Vec): Vec => (transpose ? v(p.y, p.x) : p);
  const P = poly.map(T);
  const inner = insetPolygon(P, wallDistance);
  const shape = inner ?? P;
  const shrink = inner ? 0 : wallDistance;
  const b = bbox(shape);
  const lines: { y: number; iv: [number, number][] }[] = [];
  const startY = inner ? b.min.y + spacing / 2 : b.min.y + wallDistance;
  const endY = inner ? b.max.y : b.max.y - wallDistance;
  for (let y = startY; y <= endY + 1e-9; y += spacing) {
    const iv = scanlineIntervals(shape, y)
      .map(([a, c]) => [a + shrink, c - shrink] as [number, number])
      .filter(([a, c]) => c - a > spacing * 0.5);
    lines.push({ y, iv });
  }
  const filled = lines.filter((l) => l.iv.length > 0);
  if (filled.length >= 2 && filled.every((l) => l.iv.length === 1)) return simpleMeander(filled, spacing, T(entry), T);
  return chainedMeander(lines, entry, T);
}

/**
 * Einfacher Mäander in konvexen Räumen: Start an der Seite des Anschlusspunkts, gerade Bahnanzahl,
 * Rücklauf parallel zur Anschlussseite zurück zum Anschlusspunkt.
 */
function simpleMeander(linesIn: { y: number; iv: [number, number][] }[], spacing: number, entry: Vec, T: (p: Vec) => Vec): CircuitDrawing {
  let lines = linesIn.slice();
  if (Math.abs(entry.y - lines[0].y) > Math.abs(entry.y - lines[lines.length - 1].y)) lines.reverse();
  if (lines.length % 2 === 1 && lines.length > 2) lines = lines.slice(0, -1);
  const a0 = lines[0].iv[0][0];
  const c0 = lines[0].iv[0][1];
  const startA = Math.abs(entry.x - a0) <= Math.abs(entry.x - c0);
  const path: Vec[] = [];
  lines.forEach((l, i) => {
    const [a, c] = l.iv[0];
    const forward = (i % 2 === 0) === startA;
    path.push(forward ? v(a, l.y) : v(c, l.y), forward ? v(c, l.y) : v(a, l.y));
  });
  const xr = startA ? Math.min(...lines.map((l) => l.iv[0][0])) - spacing / 2 : Math.max(...lines.map((l) => l.iv[0][1])) + spacing / 2;
  const end = path[path.length - 1];
  const back = [end, v(xr, end.y), v(xr, lines[0].y)];
  const half = splitHalf(path);
  const supply = half[0].map(T);
  const ret = [...half[1], ...back.slice(1)].map(T);
  return { supply: [supply], ret: [ret], inlet: supply[0], outlet: ret[ret.length - 1] };
}

function splitHalf(path: Vec[]): [Vec[], Vec[]] {
  let total = 0;
  for (let i = 1; i < path.length; i++) total += dist(path[i - 1], path[i]);
  const a: Vec[] = [path[0]];
  const b: Vec[] = [];
  let acc = 0;
  for (let i = 1; i < path.length; i++) {
    const l = dist(path[i - 1], path[i]);
    if (b.length === 0 && acc + l >= total / 2) {
      const t = (total / 2 - acc) / Math.max(l, 1e-9);
      const m = v(path[i - 1].x + (path[i].x - path[i - 1].x) * t, path[i - 1].y + (path[i].y - path[i - 1].y) * t);
      a.push(m);
      b.push(m, path[i]);
    } else if (b.length === 0) a.push(path[i]);
    else b.push(path[i]);
    acc += l;
  }
  return [a, b.length ? b : [path[path.length - 1]]];
}

/** Mäander für L- und U-förmige Räume: gierige Zerlegung in zusammenhängende Bahnen. */
function chainedMeander(lines: { y: number; iv: [number, number][] }[], entry: Vec, T: (p: Vec) => Vec): CircuitDrawing {
  const used = lines.map((l) => l.iv.map(() => false));
  const chains: Vec[][] = [];
  for (let s = 0; s < lines.length; s++) {
    for (let k = 0; k < lines[s].iv.length; k++) {
      if (used[s][k]) continue;
      const chain: Vec[] = [];
      let cur = lines[s].iv[k];
      used[s][k] = true;
      let dir = 0;
      let li = s;
      for (;;) {
        const y = lines[li].y;
        const [a, c] = cur;
        if (dir === 0) chain.push(v(a, y), v(c, y));
        else chain.push(v(c, y), v(a, y));
        dir = 1 - dir;
        const next = lines[li + 1];
        if (!next) break;
        let found = -1;
        let bestOverlap = 0;
        next.iv.forEach(([na, nc], idx) => {
          if (used[li + 1][idx]) return;
          const ov = Math.min(c, nc) - Math.max(a, na);
          if (ov > bestOverlap) {
            bestOverlap = ov;
            found = idx;
          }
        });
        if (found < 0) break;
        li += 1;
        used[li][found] = true;
        cur = next.iv[found];
      }
      chains.push(chain.map(T));
    }
  }
  if (chains.length === 0) return { supply: [], ret: [], inlet: null, outlet: null };
  const path: Vec[] = [];
  const remaining = chains.slice();
  let cursor = entry;
  while (remaining.length) {
    let bi = 0;
    let rev = false;
    let bd = Infinity;
    remaining.forEach((ch, i) => {
      const d0 = dist(ch[0], cursor);
      const d1 = dist(ch[ch.length - 1], cursor);
      if (d0 < bd) {
        bd = d0;
        bi = i;
        rev = false;
      }
      if (d1 < bd) {
        bd = d1;
        bi = i;
        rev = true;
      }
    });
    const ch = remaining.splice(bi, 1)[0];
    const seq = rev ? ch.slice().reverse() : ch;
    path.push(...seq);
    cursor = seq[seq.length - 1];
  }
  const [supply, ret] = splitHalf(path);
  return { supply: [supply], ret: ret.length > 1 ? [ret] : [], inlet: path[0], outlet: path[path.length - 1] };
}

export function generateLayout(
  poly: Vec[],
  spacing: number,
  wallDistance: number,
  pattern: LayingPattern,
  entry: Vec,
): CircuitDrawing {
  if (poly.length < 3 || spacing <= 0) return { supply: [], ret: [], inlet: null, outlet: null };
  return pattern === 'spiral'
    ? spiralLayout(poly, spacing, wallDistance, entry)
    : meanderLayout(poly, spacing, wallDistance, entry);
}
