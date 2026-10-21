import type { Vec, Wall } from '../model/types';
import { cleanPolygon, distToSegment, simplifyPolygon, v } from './geom';

export type DetectResult = { ok: true; polygon: Vec[] } | { ok: false; reason: 'in-wall' | 'open' | 'no-walls' };

/**
 * Raumerkennung per Klick: Die Wände werden auf ein Raster gezeichnet, ab dem Klickpunkt wird
 * die freie Fläche geflutet und deren Außenkontur verfolgt. Ergebnis ist die Innenkante der Wände.
 */
export function detectRoom(click: Vec, walls: Wall[], resolution = 0.02): DetectResult {
  if (walls.length === 0) return { ok: false, reason: 'no-walls' };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const w of walls) {
    const r = w.thickness / 2;
    minX = Math.min(minX, w.a.x - r, w.b.x - r);
    minY = Math.min(minY, w.a.y - r, w.b.y - r);
    maxX = Math.max(maxX, w.a.x + r, w.b.x + r);
    maxY = Math.max(maxY, w.a.y + r, w.b.y + r);
  }
  if (click.x < minX || click.x > maxX || click.y < minY || click.y > maxY) return { ok: false, reason: 'open' };
  const margin = 0.2;
  minX -= margin;
  minY -= margin;
  maxX += margin;
  maxY += margin;
  let res = resolution;
  while (((maxX - minX) / res) * ((maxY - minY) / res) > 8e6) res *= 1.5;
  const W = Math.ceil((maxX - minX) / res);
  const H = Math.ceil((maxY - minY) / res);
  const blocked = new Uint8Array(W * H);

  for (const w of walls) {
    const r = w.thickness / 2 + res * 0.75;
    const i0 = Math.max(0, Math.floor((Math.min(w.a.x, w.b.x) - r - minX) / res));
    const i1 = Math.min(W - 1, Math.ceil((Math.max(w.a.x, w.b.x) + r - minX) / res));
    const j0 = Math.max(0, Math.floor((Math.min(w.a.y, w.b.y) - r - minY) / res));
    const j1 = Math.min(H - 1, Math.ceil((Math.max(w.a.y, w.b.y) + r - minY) / res));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const c = v(minX + (i + 0.5) * res, minY + (j + 0.5) * res);
        if (distToSegment(c, w.a, w.b) <= r) blocked[j * W + i] = 1;
      }
    }
  }

  const ci = Math.floor((click.x - minX) / res);
  const cj = Math.floor((click.y - minY) / res);
  if (blocked[cj * W + ci]) return { ok: false, reason: 'in-wall' };

  const filled = new Uint8Array(W * H);
  const stack: number[] = [cj * W + ci];
  filled[cj * W + ci] = 1;
  while (stack.length) {
    const k = stack.pop()!;
    const i = k % W;
    const j = (k - i) / W;
    if (i === 0 || j === 0 || i === W - 1 || j === H - 1) return { ok: false, reason: 'open' };
    const nb = [k - 1, k + 1, k - W, k + W];
    for (const q of nb) {
      if (!filled[q] && !blocked[q]) {
        filled[q] = 1;
        stack.push(q);
      }
    }
  }

  const isFilled = (i: number, j: number) => i >= 0 && j >= 0 && i < W && j < H && filled[j * W + i] === 1;

  // Startzelle: oberste, dann linkeste gefüllte Zelle – deren Oberkante liegt sicher auf der Außenkontur.
  let start = -1;
  for (let k = 0; k < W * H; k++) {
    if (filled[k]) {
      start = k;
      break;
    }
  }
  const si = start % W;
  const sj = (start - si) / W;

  // Kantenverfolgung auf den Rasterecken, gefüllte Zellen bleiben rechts (Bildschirmkoordinaten).
  const DX = [1, 0, -1, 0];
  const DY = [0, 1, 0, -1];
  const aheadRight = (x: number, y: number, d: number) =>
    d === 0 ? isFilled(x, y) : d === 1 ? isFilled(x - 1, y) : d === 2 ? isFilled(x - 1, y - 1) : isFilled(x, y - 1);
  const aheadLeft = (x: number, y: number, d: number) =>
    d === 0 ? isFilled(x, y - 1) : d === 1 ? isFilled(x, y) : d === 2 ? isFilled(x - 1, y) : isFilled(x - 1, y - 1);

  let x = si + 1;
  let y = sj;
  let d = 0;
  const pts: Vec[] = [v(minX + si * res, minY + sj * res)];
  const maxSteps = 4 * (W + H) * 50;
  for (let step = 0; step < maxSteps; step++) {
    if (x === si && y === sj) break;
    let nd = d;
    if (!aheadRight(x, y, d)) nd = (d + 1) % 4;
    else if (aheadLeft(x, y, d)) nd = (d + 3) % 4;
    if (nd !== d) pts.push(v(minX + x * res, minY + y * res));
    d = nd;
    x += DX[d];
    y += DY[d];
  }

  const simplified = cleanPolygon(simplifyPolygon(pts, res * 1.5), 1e-3);
  if (simplified.length < 3) return { ok: false, reason: 'open' };
  // auf Zentimeter runden
  return { ok: true, polygon: simplified.map((p) => v(Math.round(p.x * 100) / 100, Math.round(p.y * 100) / 100)) };
}
