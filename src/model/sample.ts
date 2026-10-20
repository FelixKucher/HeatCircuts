// Beispielprojekt: Einfamilienhaus 10 × 8 m (Wandachsen), EG + OG, je Geschoss ein Architektenplan als Vorlage,
// Treppenöffnung im OG als Aussparung; Heizung mit Fußboden-, Wand- und Elektroflächen, je Geschoss ein Verteiler.

import type { FloorFinish, ImageStore, OpeningStyle, Project, Vec } from './types';
import { applyRoomType, applyYearBuilt, newFloor, newProject, newSurface, uid } from './factory';
import { addRectRoom, detectRoomAt, roomTypeFromName } from '../cad/edit';
import { newOpening } from '../cad/openings';
import { nearestWall, pointOnWall, wallOutlines } from '../cad/walls';
import { area, centroid } from '../geometry/geom';
import { defaultField } from '../geometry/wallfield';
import { autoLayout } from '../calc/autolayout';
import { normalizeProject } from './normalize';
import type { Floor } from './types';

const EXT = 0.365;
const INT = 0.175;
const COVER: Partial<Record<FloorFinish, string>> = { fliesen: 'fliesen', naturstein: 'naturstein', parkett: 'parkett_klebe', laminat: 'laminat', teppich: 'teppich', beton: 'none' };

function rooms(p: Project, f: Floor, rects: [string, number, number, number, number, FloorFinish][]): void {
  for (const [name, x0, y0, x1, y1] of rects) addRectRoom(p, f, { x: x0, y: y0 }, { x: x1, y: y1 }, INT, 'wohnen', name);
  for (const w of f.walls) {
    const onX = (x: number) => Math.abs(x) < 0.01 || Math.abs(x - 10) < 0.01;
    const onY = (y: number) => Math.abs(y) < 0.01 || Math.abs(y - 8) < 0.01;
    const hull = (Math.abs(w.a.x - w.b.x) < 1e-6 && onX(w.a.x)) || (Math.abs(w.a.y - w.b.y) < 1e-6 && onY(w.a.y));
    if (hull) w.thickness = EXT;
  }
  f.rooms.forEach((r, i) => {
    const poly = detectRoomAt(f, centroid(r.polygon));
    if (poly) r.polygon = poly;
    const [name, , , , , fin] = rects[i];
    applyRoomType(p, r, roomTypeFromName(name) ?? 'wohnen');
    r.name = name;
    r.covering = COVER[fin] ?? r.covering;
  });
}

function opening(f: Floor, p: Vec, style: OpeningStyle, side: 'left' | 'right' = 'left', o: Partial<{ width: number; height: number; sill: number; hinge: 'a' | 'b' }> = {}): void {
  const nw = nearestWall(f.walls, p, 0.3);
  if (!nw) return;
  nw.wall.openings.push({ ...newOpening(style, nw.t, nw.wall), side, ...o });
}

export function createSampleProject(): { project: Project; images: ImageStore } {
  const p = newProject('Beispiel: Einfamilienhaus');
  p.isExample = true;
  p.wizard = { done: true, step: 5 };
  applyYearBuilt(p.building, 2016);
  p.roof = { type: 'gable', pitch: 38, ridge: 'x', overhang: 0.5, insulation: 'topSlab', kneeWall: 0.5, color: '#8f3f2c' };
  const W = (a: number, b: number): Vec => ({ x: a, y: b });

  const eg = p.floors[0];
  eg.storeyHeight = 2.875;
  eg.clearHeight = 2.5;
  rooms(p, eg, [
    ['Küche', 0, 0, 4, 3.5, 'fliesen'],
    ['Flur', 4, 0, 6.5, 3.5, 'naturstein'],
    ['WC', 6.5, 0, 10, 1.75, 'fliesen'],
    ['Technik', 6.5, 1.75, 10, 3.5, 'beton'],
    ['Wohnen / Essen', 0, 3.5, 10, 8, 'parkett'],
  ]);
  opening(eg, W(5.25, 0), 'door', 'left', { width: 1.135, height: 2.135 });
  opening(eg, W(5.25, 3.5), 'doubleDoor', 'left');
  opening(eg, W(4, 2.6), 'door', 'right', { hinge: 'b' });
  opening(eg, W(6.5, 0.9), 'door', 'left');
  opening(eg, W(6.5, 2.6), 'door', 'left', { hinge: 'b' });
  opening(eg, W(2, 0), 'window', 'right', { width: 1.51, sill: 1.01, height: 1.135 });
  opening(eg, W(8.25, 0), 'window', 'right', { width: 0.76, sill: 1.385, height: 0.76 });
  opening(eg, W(10, 2.6), 'window', 'right', { width: 0.885 });
  opening(eg, W(2.2, 8), 'frenchWindow', 'left', { width: 1.76 });
  opening(eg, W(5.6, 8), 'slidingDoor', 'right', { width: 2.51, height: 2.26 });
  opening(eg, W(8.6, 8), 'window', 'left', { width: 1.51, sill: 0.51, height: 1.76 });
  opening(eg, W(0, 6.3), 'window', 'right', { width: 1.26 });
  opening(eg, W(10, 5.8), 'window', 'left', { width: 1.26 });

  const og = newFloor('Obergeschoss', eg.elevation + eg.storeyHeight, 2.75);
  og.clearHeight = 2.5;
  p.floors.push(og);
  rooms(p, og, [
    ['Kind 1', 0, 0, 4, 3.5, 'laminat'],
    ['Bad', 4, 0, 7, 3.5, 'fliesen'],
    ['Kind 2', 7, 0, 10, 3.5, 'laminat'],
    ['Galerie / Flur', 0, 3.5, 10, 5, 'parkett'],
    ['Schlafen', 0, 5, 5.5, 8, 'parkett'],
    ['Ankleide', 5.5, 5, 7, 8, 'teppich'],
    ['Arbeiten', 7, 5, 10, 8, 'parkett'],
  ]);
  opening(og, W(3.3, 3.5), 'door', 'left', { hinge: 'b' });
  opening(og, W(5.5, 3.5), 'door', 'right');
  opening(og, W(7.8, 3.5), 'door', 'right');
  opening(og, W(4.95, 5), 'door', 'right', { hinge: 'b' });
  opening(og, W(6.25, 5), 'passage', 'right', { width: 0.885 });
  opening(og, W(8.5, 5), 'door', 'right');
  opening(og, W(2, 0), 'window', 'right', { width: 1.26 });
  opening(og, W(5.5, 0), 'window', 'right', { width: 1.01, sill: 1.26, height: 1.01 });
  opening(og, W(8.5, 0), 'window', 'right', { width: 1.26 });
  opening(og, W(2.75, 8), 'window', 'left', { width: 1.76 });
  opening(og, W(8.5, 8), 'window', 'left', { width: 1.51 });
  opening(og, W(0, 6.5), 'window', 'right', { width: 1.01 });
  opening(og, W(10, 4.25), 'window', 'left', { width: 1.01 });
  // Treppenöffnung (gerader Lauf im Wohnbereich darunter): keine Heizfläche
  og.voids.push({ id: uid('v'), kind: 'stair', polygon: [W(0.27, 3.67), W(4.57, 3.67), W(4.57, 4.57), W(0.27, 4.57)] });

  normalizeProject(p);
  // Heizung: WC mit Elektro-Heizmatte, Bad zusätzlich mit Wandheizung an der Außenwand
  const wc = eg.rooms.find((r) => r.name === 'WC')!;
  wc.surfaces = [newSurface('floor', 'electric')];
  wc.surfaces[0].electricPower = 160;
  const bad = og.rooms.find((r) => r.name === 'Bad')!;
  const extWall = og.walls.find((w) => w.kind === 'exterior' && Math.abs(w.a.y) < 0.01 && Math.min(w.a.x, w.b.x) <= 4.5 && Math.max(w.a.x, w.b.x) >= 6.5);
  if (extWall) {
    const s = newSurface('wall', 'wall_wet');
    s.wallId = extWall.id;
    s.field = defaultField(extWall, bad, og.clearHeight);
    bad.surfaces.push(s);
  }
  eg.manifolds.push({ id: uid('m'), name: 'HKV EG', pos: W(4.65, 3.3), supplyLengthOverride: null, maxOutlets: 10 });
  og.manifolds.push({ id: uid('m'), name: 'HKV OG', pos: W(9.0, 3.67), supplyLengthOverride: null, maxOutlets: 10 });
  p.heatSource = { floorId: eg.id, pos: W(7.3, 2.75), name: 'Luft/Wasser-Wärmepumpe', type: 'wp_luft' };
  autoLayout(p);
  // Vorlagen: so, wie der Plan vom Architekten käme (Linien, Raumstempel, Maßstab)
  const images: ImageStore = {};
  for (const [f, title] of [[eg, 'Grundriss Erdgeschoss'], [og, 'Grundriss Obergeschoss']] as const) {
    const d = planDrawing(f, title);
    const id = uid('img');
    images[id] = d.dataUrl;
    f.background = { imageId: id, widthPx: d.widthPx, heightPx: d.heightPx, pxPerM: d.pxPerM, offset: d.offset, opacity: 0.75, visible: true, locked: true, calibrated: true };
  }
  return { project: p, images };
}

/** Planzeichnung eines Geschosses als SVG-Bild (schwarz-weiß, 1 m = 100 px) */
function planDrawing(f: Floor, title: string): { dataUrl: string; widthPx: number; heightPx: number; pxPerM: number; offset: Vec } {
  const k = 100;
  const ox = -1.2;
  const oy = -1.2;
  const W = 12.4;
  const H = 11;
  const X = (q: Vec) => `${((q.x - ox) * k).toFixed(1)},${((q.y - oy) * k).toFixed(1)}`;
  const outl = wallOutlines(f.walls);
  let g = '';
  for (const o of outl.values()) g += `<polygon points="${o.poly.map(X).join(' ')}" fill="url(#h)" stroke="#111" stroke-width="2.2"/>`;
  for (const w of f.walls)
    for (const op of w.openings) {
      const a = pointOnWall(w, op.offset - op.width / 2);
      const b = pointOnWall(w, op.offset + op.width / 2);
      const n = { x: -(w.b.y - w.a.y), y: w.b.x - w.a.x };
      const L = Math.hypot(n.x, n.y) || 1;
      const t = w.thickness / 2 + 0.01;
      const off = (q: Vec, s: number) => ({ x: q.x + (n.x / L) * t * s, y: q.y + (n.y / L) * t * s });
      g += `<polygon points="${[off(a, 1), off(b, 1), off(b, -1), off(a, -1)].map(X).join(' ')}" fill="#fff"/>`;
      if (op.kind === 'window') g += `<polyline points="${[off(a, 0.25), off(b, 0.25)].map(X).join(' ')}" stroke="#111" stroke-width="1.4"/><polyline points="${[off(a, -0.25), off(b, -0.25)].map(X).join(' ')}" stroke="#111" stroke-width="1.4"/>`;
      else {
        const s = op.side === 'right' ? -1 : 1;
        const hinge = op.hinge === 'b' ? b : a;
        const free = op.hinge === 'b' ? a : b;
        const leaf = { x: hinge.x + (n.x / L) * op.width * s, y: hinge.y + (n.y / L) * op.width * s };
        g += `<polyline points="${[hinge, leaf].map(X).join(' ')}" stroke="#111" stroke-width="1.6"/><path d="M${X(leaf)} A${(op.width * k).toFixed(1)} ${(op.width * k).toFixed(1)} 0 0 ${s * (op.hinge === 'b' ? -1 : 1) > 0 ? 1 : 0} ${X(free)}" fill="none" stroke="#111" stroke-width="0.8" stroke-dasharray="5 4"/>`;
      }
    }
  for (const r of f.rooms) {
    // Raumstempel oben links im Raum, wie im Architektenplan
    const x0 = Math.min(...r.polygon.map((q) => q.x)) + 0.22;
    const y0 = Math.min(...r.polygon.map((q) => q.y)) + 0.42;
    const tx = ((x0 - ox) * k).toFixed(1);
    g += `<text x="${tx}" y="${((y0 - oy) * k).toFixed(1)}" font-size="20" font-family="Helvetica,Arial,sans-serif" fill="#111">${r.name.replace(/&/g, '&amp;')}</text><text x="${tx}" y="${((y0 - oy) * k + 21).toFixed(1)}" font-size="15" font-family="Helvetica,Arial,sans-serif" fill="#333">${area(r.polygon).toFixed(2).replace('.', ',')} m²</text>`;
  }
  for (const v of f.voids) g += `<polygon points="${v.polygon.map(X).join(' ')}" fill="none" stroke="#111" stroke-width="1" stroke-dasharray="8 5"/><polyline points="${[v.polygon[0], v.polygon[2]].map(X).join(' ')}" stroke="#111" stroke-width="0.8"/>`;
  g += `<text x="${(W * k - 30).toFixed(0)}" y="${(H * k - 34).toFixed(0)}" font-size="26" text-anchor="end" font-family="Helvetica,Arial,sans-serif" fill="#111">${title}</text><text x="${(W * k - 30).toFixed(0)}" y="${(H * k - 8).toFixed(0)}" font-size="20" text-anchor="end" font-family="Helvetica,Arial,sans-serif" fill="#333">M 1:100 · Beispielplan</text>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W * k}" height="${H * k}" viewBox="0 0 ${W * k} ${H * k}"><defs><pattern id="h" width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="10" height="10" fill="#fff"/><line x1="0" y1="0" x2="0" y2="10" stroke="#555" stroke-width="1.2"/></pattern></defs><rect width="100%" height="100%" fill="#fff"/>${g}</svg>`;
  return { dataUrl: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`, widthPx: W * k, heightPx: H * k, pxPerM: k, offset: { x: ox, y: oy } };
}
