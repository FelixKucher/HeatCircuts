// Erkennung von Räumen, Wänden und Öffnungen aus einem gerasterten Grundriss.
//
//  1. Graustufen → Binärmaske (Otsu), dunkel = Wand/Linie
//  2. Öffnen mit halber Mindestwanddicke entfernt Text, Maß-, Möbel- und Türbogenlinien
//  3. Schließen mit halber Türbreite schließt Tür- und Fensteröffnungen in den Wänden
//  4. Freiflächen ohne Verbindung zum Bildrand = Räume → Konturen → Vereinfachung → Orthogonalisierung
//  5. Wände aus Raumkanten: gegenüberliegende Kanten zweier Räume → Innenwand,
//     sonst Außenwand mit gemessener Dicke; Lücken aus Schritt 3 → Türen bzw. Fenster

import type { Opening, Vec, Wall, WallKind } from '../model/types';
import { add, area, cleanPolygon, cross, dist, dot, mul, norm, simplifyPolygon, sub, v } from './geom';
import { close, components, floodOutside, open, otsu, traceContour, type Mask } from './raster';

export interface RecognizeOptions {
  /** Rasterweite in m je Zelle */
  res: number;
  /** kleinste darzustellende Wanddicke in m */
  minWall: number;
  /** größte Türbreite in m (Lücken bis zu dieser Breite trennen Räume) */
  maxGap: number;
  /** größte Fensterbreite in m (Lücken in der Außenhülle bis zu dieser Breite werden geschlossen) */
  maxWindow: number;
  /** kleinste Raumfläche in m² */
  minRoomArea: number;
  /** Wände im Plan nur als Umrisslinien gezeichnet (nicht gefüllt) */
  outlineWalls: boolean;
  /** Schwellwert-Korrektur gegenüber Otsu (−40 … +40) */
  thresholdBias: number;
}

export const DEFAULT_RECOGNIZE: RecognizeOptions = {
  res: 0.025,
  minWall: 0.09,
  maxGap: 1.02,
  maxWindow: 3.2,
  minRoomArea: 1.2,
  outlineWalls: false,
  thresholdBias: 0,
};

export interface RecognizedRoom {
  polygon: Vec[];
  area: number;
}

export interface RecognizeResult {
  rooms: RecognizedRoom[];
  walls: Wall[];
  /** Hilfsdaten für die Vorschau */
  wallMask: Mask;
  stats: { threshold: number; rooms: number; walls: number; openings: number };
}

/** Kanten nahe 0°/90° (bezogen auf die Hauptrichtung) exakt ausrichten. */
export function orthogonalize(polyIn: Vec[], tolDeg = 12): Vec[] {
  const poly = cleanPolygon(polyIn, 1e-3);
  if (poly.length < 4) return poly;
  // Hauptrichtung (mod 90°), längengewichtet
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const ang = Math.atan2(b.y - a.y, b.x - a.x) * 4;
    const l = dist(a, b);
    sx += Math.cos(ang) * l;
    sy += Math.sin(ang) * l;
  }
  const base = Math.atan2(sy, sx) / 4;
  const c = Math.cos(-base);
  const s = Math.sin(-base);
  const rot = (p: Vec, cc: number, ss: number) => v(p.x * cc - p.y * ss, p.x * ss + p.y * cc);
  const P = poly.map((p) => rot(p, c, s));
  const tol = Math.sin((tolDeg * Math.PI) / 180);
  type Edge = { o: 'h' | 'v' | 'd'; a: Vec; b: Vec };
  let edges: Edge[] = P.map((a, i) => {
    const b = P[(i + 1) % P.length];
    const d = norm(sub(b, a));
    return { o: Math.abs(d.y) < tol ? 'h' : Math.abs(d.x) < tol ? 'v' : 'd', a, b };
  });
  // gleichgerichtete Nachbarkanten zusammenfassen
  let merged = true;
  while (merged && edges.length > 3) {
    merged = false;
    for (let i = 0; i < edges.length; i++) {
      const e = edges[i];
      const n = edges[(i + 1) % edges.length];
      if (e.o !== 'd' && e.o === n.o) {
        edges[i] = { o: e.o, a: e.a, b: n.b };
        edges.splice((i + 1) % edges.length, 1);
        merged = true;
        break;
      }
    }
  }
  const lineVal = (e: Edge) => (e.o === 'h' ? (e.a.y + e.b.y) / 2 : (e.a.x + e.b.x) / 2);
  const out: Vec[] = [];
  for (let i = 0; i < edges.length; i++) {
    const prev = edges[(i - 1 + edges.length) % edges.length];
    const cur = edges[i];
    if (prev.o === 'h' && cur.o === 'v') out.push(v(lineVal(cur), lineVal(prev)));
    else if (prev.o === 'v' && cur.o === 'h') out.push(v(lineVal(prev), lineVal(cur)));
    else if (cur.o === 'h') out.push(v(cur.a.x, lineVal(cur)));
    else if (cur.o === 'v') out.push(v(lineVal(cur), cur.a.y));
    else if (prev.o === 'h') out.push(v(cur.a.x, lineVal(prev)));
    else if (prev.o === 'v') out.push(v(lineVal(prev), cur.a.y));
    else out.push(cur.a);
  }
  edges = [];
  return cleanPolygon(out.map((p) => rot(p, Math.cos(base), Math.sin(base))), 1e-3);
}

/**
 * Entfernt rechteckige Ausbuchtungen nach außen (Raumfläche, die in eine Fenster- oder
 * Türöffnung der Wand hineinragt): Folge konkav–konvex–konvex–konkav mit gleich tiefen
 * Seitenkanten bis maxDepth und einer Öffnungsbreite ab minWidth.
 */
export function removeNotches(polyIn: Vec[], maxDepth = 0.62, minWidth = 0.4): Vec[] {
  let poly = polyIn.slice();
  const sgn = Math.sign(poly.reduce((a, p, i) => a + p.x * poly[(i + 1) % poly.length].y - poly[(i + 1) % poly.length].x * p.y, 0)) || 1;
  let changed = true;
  let guard = 0;
  while (changed && poly.length > 5 && guard++ < 50) {
    changed = false;
    const n = poly.length;
    const turn = (i: number) => {
      const a = poly[(i - 1 + n) % n];
      const b = poly[i];
      const c = poly[(i + 1) % n];
      return Math.sign(cross(sub(b, a), sub(c, b))) * sgn;
    };
    for (let i = 0; i < n; i++) {
      const i0 = i;
      const i1 = (i + 1) % n;
      const i2 = (i + 2) % n;
      const i3 = (i + 3) % n;
      if (!(turn(i0) < 0 && turn(i1) > 0 && turn(i2) > 0 && turn(i3) < 0)) continue;
      const e1 = dist(poly[i0], poly[i1]);
      const e2 = dist(poly[i1], poly[i2]);
      const e3 = dist(poly[i2], poly[i3]);
      if (e1 > maxDepth || e3 > maxDepth || Math.abs(e1 - e3) > 0.06 || e2 < minWidth) continue;
      const d1 = norm(sub(poly[i1], poly[i0]));
      const d3 = norm(sub(poly[i3], poly[i2]));
      if (dot(d1, d3) > -0.95) continue;
      poly = poly.filter((_, k) => k !== i1 && k !== i2);
      poly = cleanPolygon(poly, 1e-3);
      changed = true;
      break;
    }
  }
  return poly;
}

/**
 * Kernalgorithmus auf Graustufen (0 = schwarz). Rasterzelle (i, j) liegt bei
 * origin + (i + 0,5, j + 0,5) · res in Weltkoordinaten.
 */
export function recognizeFromGray(gray: Uint8Array, W: number, H: number, origin: Vec, opts: RecognizeOptions = DEFAULT_RECOGNIZE): RecognizeResult {
  const res = opts.res;
  const thr = Math.max(10, Math.min(245, otsu(gray) + opts.thresholdBias));
  const dark: Mask = { W, H, data: new Uint8Array(W * H) };
  for (let k = 0; k < W * H; k++) dark.data[k] = gray[k] <= thr ? 1 : 0;
  let base = dark;
  if (opts.outlineWalls) base = close(base, Math.max(1, Math.round(0.2 / res)));
  const rOpen = Math.max(1, Math.floor(opts.minWall / 2 / res));
  const walls0 = open(base, rOpen);
  const rClose = Math.max(1, Math.ceil(opts.maxGap / 2 / res));
  const wallsClosed = close(walls0, rClose);
  // Gebäudehülle: Fensteröffnungen bis maxWindow schließen, nur zur Bestimmung von „außen“.
  // Die verbleibenden Ausbuchtungen der Räume in breite Öffnungen entfernt removeNotches().
  const hull = close(walls0, Math.max(rClose, Math.ceil(opts.maxWindow / 2 / res)));
  const outside = floodOutside(hull);
  const { labels, sizes } = components(W, H, (k) => !wallsClosed.data[k] && !outside[k]);
  const minCells = opts.minRoomArea / (res * res);

  const toWorld = (p: { x: number; y: number }) => v(origin.x + p.x * res, origin.y + p.y * res);
  const rooms: RecognizedRoom[] = [];
  const firstCell = new Map<number, number>();
  for (let k = 0; k < W * H; k++) {
    const l = labels[k];
    if (l >= 0 && !firstCell.has(l)) firstCell.set(l, k);
  }
  for (const [label, start] of firstCell) {
    if (sizes[label] < minCells) continue;
    const pts = traceContour(W, H, (i, j) => labels[j * W + i] === label, start).map(toWorld);
    let poly = cleanPolygon(simplifyPolygon(pts, res * 2), 1e-3);
    if (poly.length < 3) continue;
    poly = removeNotches(orthogonalize(poly));
    poly = poly.map((p) => v(Math.round(p.x * 100) / 100, Math.round(p.y * 100) / 100));
    const a = area(poly);
    if (a < opts.minRoomArea) continue;
    rooms.push({ polygon: poly, area: a });
  }

  const cellOf = (p: Vec) => {
    const i = Math.floor((p.x - origin.x) / res);
    const j = Math.floor((p.y - origin.y) / res);
    return i >= 0 && j >= 0 && i < W && j < H ? j * W + i : -1;
  };
  const walls = wallsFromRooms(rooms, (p) => {
    const k = cellOf(p);
    return k >= 0 && (walls0.data[k] === 1 || hull.data[k] === 1);
  }, (p) => {
    const k = cellOf(p);
    return k < 0 || outside[k] === 1;
  });
  // Öffnungen: Lücken in den Wänden, die erst durch das Schließen gefüllt wurden
  let openings = 0;
  for (const w of walls) {
    const L = dist(w.a, w.b);
    const dir = norm(sub(w.b, w.a));
    const nrm = v(-dir.y, dir.x);
    let runStart = -1;
    const flush = (t: number) => {
      if (runStart < 0) return;
      const width = t - runStart;
      if (width >= 0.55 && width <= (w.kind === 'exterior' ? opts.maxWindow : opts.maxGap) + 0.1) {
        const o: Opening =
          w.kind === 'exterior'
            ? { id: rid('o'), kind: 'window', offset: runStart + width / 2, width: Math.round(width * 100) / 100, height: 1.35, sill: 0.9 }
            : { id: rid('o'), kind: 'door', offset: runStart + width / 2, width: Math.round(width * 100) / 100, height: 2.01, sill: 0 };
        w.openings.push(o);
        openings++;
      }
      runStart = -1;
    };
    for (let t = 0; t <= L; t += res) {
      // Lücke, wenn über die Wanddicke kaum Wandpixel der geöffneten Maske liegen
      let solid = 0;
      let n = 0;
      for (let o = -w.thickness / 2 + res / 2; o <= w.thickness / 2; o += res) {
        const k = cellOf(add(add(w.a, mul(dir, t)), mul(nrm, o)));
        if (k < 0) continue;
        n++;
        if (walls0.data[k]) solid++;
      }
      const gap = n > 0 && solid / n < 0.35;
      if (gap && runStart < 0) runStart = t;
      if (!gap) flush(t);
    }
    flush(L);
  }
  return { rooms, walls, wallMask: walls0, stats: { threshold: thr, rooms: rooms.length, walls: walls.length, openings } };
}

let ridCounter = 0;
const rid = (p: string) => `${p}${Date.now().toString(36)}${(ridCounter++).toString(36)}`;

/**
 * Wände aus Raumkonturen: Kantenabschnitte mit gegenüberliegender Kante eines anderen Raums
 * (Abstand 3–60 cm) ergeben Innenwände auf der Mittellinie; übrige Abschnitte mit Außenluft
 * dahinter ergeben Außenwände mit gemessener Dicke.
 */
export function wallsFromRooms(rooms: RecognizedRoom[], isWall: (p: Vec) => boolean, isOutside: (p: Vec) => boolean): Wall[] {
  type Seg = { a: Vec; b: Vec; t: number; kind: WallKind };
  const segs: Seg[] = [];
  const edgesOf = (poly: Vec[]) => poly.map((a, i) => [a, poly[(i + 1) % poly.length]] as [Vec, Vec]);
  const orient = (poly: Vec[]) => {
    let s = 0;
    for (let i = 0; i < poly.length; i++) s += poly[i].x * poly[(i + 1) % poly.length].y - poly[(i + 1) % poly.length].x * poly[i].y;
    return s > 0 ? 1 : -1;
  };
  rooms.forEach((r, ri) => {
    const sgn = orient(r.polygon);
    for (const [a, b] of edgesOf(r.polygon)) {
      const L = dist(a, b);
      if (L < 0.2) continue;
      const dir = norm(sub(b, a));
      // Außennormale (vom Raum weg)
      const out = mul(v(dir.y, -dir.x), sgn);
      // Partnerabschnitte
      const covered: [number, number, number][] = [];
      rooms.forEach((o, oi) => {
        if (oi === ri) return;
        for (const [c, d] of edgesOf(o.polygon)) {
          const od = norm(sub(d, c));
          if (Math.abs(cross(dir, od)) > 0.05 || dot(dir, od) > -0.5) continue;
          const gap = dot(sub(c, a), out);
          if (gap < 0.03 || gap > 0.6) continue;
          const t1 = dot(sub(c, a), dir);
          const t2 = dot(sub(d, a), dir);
          const lo = Math.max(0, Math.min(t1, t2));
          const hi = Math.min(L, Math.max(t1, t2));
          if (hi - lo > 0.1) covered.push([lo, hi, gap]);
        }
      });
      covered.sort((x, y) => x[0] - y[0]);
      // Innenwände entstehen von beiden Seiten deckungsgleich und werden unten zusammengeführt
      for (const [lo, hi, gap] of covered) {
        const pa = add(add(a, mul(dir, lo)), mul(out, gap / 2));
        const pb = add(add(a, mul(dir, hi)), mul(out, gap / 2));
        segs.push({ a: pa, b: pb, t: Math.round(gap * 200) / 200, kind: 'interior' });
      }
      // Restabschnitte
      let cursor = 0;
      const rest: [number, number][] = [];
      for (const [lo, hi] of covered) {
        if (lo > cursor + 0.15) rest.push([cursor, lo]);
        cursor = Math.max(cursor, hi);
      }
      if (L > cursor + 0.15) rest.push([cursor, L]);
      for (const [lo, hi] of rest) {
        const mid = add(a, mul(dir, (lo + hi) / 2));
        // Wanddicke messen
        let t = 0;
        for (let o = 0.0125; o < 0.7; o += 0.025) {
          if (isWall(add(mid, mul(out, o)))) t = o + 0.0125;
          else if (o > t + 0.06) break;
        }
        t = Math.max(0.1, Math.min(0.6, t || 0.24));
        const exterior = isOutside(add(mid, mul(out, t + 0.15)));
        const pa = add(add(a, mul(dir, lo)), mul(out, t / 2));
        const pb = add(add(a, mul(dir, hi)), mul(out, t / 2));
        segs.push({ a: pa, b: pb, t: Math.round(t * 200) / 200, kind: exterior ? 'exterior' : 'interior' });
      }
    }
  });
  // kollineare, überlappende Abschnitte gleicher Art zusammenführen
  const merged: Seg[] = [];
  for (const s of segs) {
    const hit = merged.find((m) => m.kind === s.kind && Math.abs(m.t - s.t) < 0.06 && touching(m, s));
    if (hit) {
      const dir = norm(sub(hit.b, hit.a));
      const ts = [0, dot(sub(hit.b, hit.a), dir), dot(sub(s.a, hit.a), dir), dot(sub(s.b, hit.a), dir)];
      const lo = Math.min(...ts);
      const hi = Math.max(...ts);
      const a0 = hit.a;
      hit.a = add(a0, mul(dir, lo));
      hit.b = add(a0, mul(dir, hi));
      hit.t = Math.max(hit.t, s.t);
    } else merged.push({ ...s });
  }
  // Enden um die halbe Dicke verlängern, damit Ecken geschlossen sind
  return merged.map((s) => {
    const dir = norm(sub(s.b, s.a));
    return {
      id: rid('w'),
      a: sub(s.a, mul(dir, s.t / 2)),
      b: add(s.b, mul(dir, s.t / 2)),
      thickness: s.t,
      kind: s.kind,
      openings: [],
    };
  });
}

function touching(m: { a: Vec; b: Vec }, s: { a: Vec; b: Vec }): boolean {
  const dir = norm(sub(m.b, m.a));
  if (Math.abs(cross(dir, norm(sub(s.b, s.a)))) > 0.05) return false;
  const off = Math.abs(cross(dir, sub(s.a, m.a)));
  if (off > 0.04) return false;
  const L = dist(m.a, m.b);
  const t1 = dot(sub(s.a, m.a), dir);
  const t2 = dot(sub(s.b, m.a), dir);
  return Math.max(t1, t2) >= -0.05 && Math.min(t1, t2) <= L + 0.05;
}

/** Bild in Graustufen auf einem Raster der Weite `res` (m) laden. Läuft nur im Browser. */
export async function loadGray(url: string, widthPx: number, heightPx: number, pxPerM: number, res: number): Promise<{ gray: Uint8Array; W: number; H: number }> {
  const img = new Image();
  img.src = url;
  await img.decode();
  const W = Math.max(8, Math.round(widthPx / pxPerM / res));
  const H = Math.max(8, Math.round(heightPx / pxPerM / res));
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.fillStyle = '#fff';
  g.fillRect(0, 0, W, H);
  g.imageSmoothingQuality = 'high';
  g.drawImage(img, 0, 0, W, H);
  const d = g.getImageData(0, 0, W, H).data;
  const gray = new Uint8Array(W * H);
  for (let k = 0; k < W * H; k++) gray[k] = Math.round(0.299 * d[4 * k] + 0.587 * d[4 * k + 1] + 0.114 * d[4 * k + 2]);
  return { gray, W, H };
}
