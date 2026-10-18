// Rasterbasierte Flächenoperationen: Überlagerung von Räumen verschiedener Geschosse,
// Gebäudegrundfläche aus den Außenwänden, Schnittflächen mit Deckenöffnungen.

import type { FloorVoid, Room, Vec, Wall } from '../model/types';
import { bbox, distToSegment, pointInPolygon, v } from './geom';

/** Rasterpunkte (Zellmitten) innerhalb eines Polygons; jeder Punkt steht für step² m². */
export function samplePolygon(poly: Vec[], step: number): Vec[] {
  if (poly.length < 3) return [];
  const b = bbox(poly);
  const out: Vec[] = [];
  for (let y = b.min.y + step / 2; y < b.max.y; y += step) {
    for (let x = b.min.x + step / 2; x < b.max.x; x += step) {
      const p = v(x, y);
      if (pointInPolygon(p, poly)) out.push(p);
    }
  }
  return out;
}

export function inVoid(p: Vec, voids: FloorVoid[]): boolean {
  return voids.some((vd) => pointInPolygon(p, vd.polygon));
}

export function roomAt(p: Vec, rooms: Room[]): Room | undefined {
  return rooms.find((r) => pointInPolygon(p, r.polygon));
}

/** Liegt der Punkt in einer Wand des Geschosses? */
export function inWalls(p: Vec, walls: Wall[]): boolean {
  return walls.some((w) => distToSegment(p, w.a, w.b) <= w.thickness / 2 + 0.02);
}

/**
 * Grundfläche innerhalb der Außenwände (inkl. Wände): Raster, Flutung von außen,
 * alle nicht erreichten Zellen gehören zum Gebäude.
 */
export function footprint(walls: Wall[], res = 0.05): { area: number; inside: (p: Vec) => boolean } | null {
  const ext = walls.filter((w) => w.kind !== 'interior');
  if (ext.length < 3) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const w of ext) {
    const r = w.thickness / 2;
    minX = Math.min(minX, w.a.x - r, w.b.x - r);
    minY = Math.min(minY, w.a.y - r, w.b.y - r);
    maxX = Math.max(maxX, w.a.x + r, w.b.x + r);
    maxY = Math.max(maxY, w.a.y + r, w.b.y + r);
  }
  minX -= 2 * res;
  minY -= 2 * res;
  maxX += 2 * res;
  maxY += 2 * res;
  const W = Math.ceil((maxX - minX) / res);
  const H = Math.ceil((maxY - minY) / res);
  if (W * H > 6e6) return null;
  const blocked = new Uint8Array(W * H);
  for (const w of ext) {
    const r = w.thickness / 2 + res * 0.75;
    const i0 = Math.max(0, Math.floor((Math.min(w.a.x, w.b.x) - r - minX) / res));
    const i1 = Math.min(W - 1, Math.ceil((Math.max(w.a.x, w.b.x) + r - minX) / res));
    const j0 = Math.max(0, Math.floor((Math.min(w.a.y, w.b.y) - r - minY) / res));
    const j1 = Math.min(H - 1, Math.ceil((Math.max(w.a.y, w.b.y) + r - minY) / res));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        if (distToSegment(v(minX + (i + 0.5) * res, minY + (j + 0.5) * res), w.a, w.b) <= r) blocked[j * W + i] = 1;
      }
    }
  }
  const outside = new Uint8Array(W * H);
  const stack = [0];
  outside[0] = 1;
  while (stack.length) {
    const k = stack.pop()!;
    const i = k % W;
    const j = (k - i) / W;
    const nb = [i > 0 ? k - 1 : -1, i < W - 1 ? k + 1 : -1, j > 0 ? k - W : -1, j < H - 1 ? k + W : -1];
    for (const q of nb) {
      if (q >= 0 && !outside[q] && !blocked[q]) {
        outside[q] = 1;
        stack.push(q);
      }
    }
  }
  let count = 0;
  for (let k = 0; k < W * H; k++) if (!outside[k]) count++;
  const area = count * res * res;
  // ganz offen (keine geschlossene Hülle) → keine Grundfläche
  if (area < 4) return null;
  return {
    area,
    inside: (p: Vec) => {
      const i = Math.floor((p.x - minX) / res);
      const j = Math.floor((p.y - minY) / res);
      if (i < 0 || j < 0 || i >= W || j >= H) return false;
      return !outside[j * W + i];
    },
  };
}

/** Fläche eines Polygons, die in Deckenöffnungen liegt */
export function voidAreaIn(poly: Vec[], voids: FloorVoid[], step = 0.05): number {
  if (!voids.length) return 0;
  let n = 0;
  for (const vd of voids) {
    const pts = samplePolygon(vd.polygon, step);
    for (const p of pts) if (pointInPolygon(p, poly)) n++;
  }
  return n * step * step;
}
