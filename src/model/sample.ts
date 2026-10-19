// Beispielprojekt: Einfamilienhaus 10 × 8 m (Wandachsen), EG + OG, gerade Treppe im Wohnbereich,
// möbliert, Satteldach; Heizung mit Fußboden-, Wand- und Elektroflächen, je Geschoss ein Verteiler.

import type { FloorFinish, ImageStore, OpeningStyle, Project, Vec } from './types';
import { applyRoomType, applyYearBuilt, newFloor, newProject, newSurface, uid } from './factory';
import { addRectRoom, detectRoomAt, roomTypeFromName } from '../cad/edit';
import { newOpening } from '../cad/openings';
import { newStair } from '../cad/stairs';
import { nearestWall } from '../cad/walls';
import { CATALOG_BY_KEY } from '../cad/furniture';
import { centroid } from '../geometry/geom';
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

function fur(f: Floor, key: string, x: number, y: number, angle = 0, o: Partial<{ width: number; depth: number; height: number; color: string }> = {}): void {
  const it = CATALOG_BY_KEY[key];
  f.furniture.push({ id: uid('F'), catalog: key, name: it.name, pos: { x, y }, angle, width: o.width ?? it.width, depth: o.depth ?? it.depth, height: o.height ?? it.height, elevation: it.elevation ?? 0, color: o.color ?? it.color, mirrored: false, visible: true });
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
  const st = newStair('straight', W(2.42, 4.12));
  st.angle = 90;
  st.length = 4.3;
  eg.stairs.push(st);
  fur(eg, 'kbase120', 0.85, 0.4825);
  fur(eg, 'ksink', 1.9, 0.4825);
  fur(eg, 'dishwasher', 2.65, 0.4825);
  fur(eg, 'kstove', 3.25, 0.4825);
  fur(eg, 'fridge', 0.5075, 1.55, 270, { depth: 0.65 });
  fur(eg, 'kisland', 2.2, 2.25);
  fur(eg, 'kwall', 0.85, 0.3575, 0, { width: 1.2 });
  fur(eg, 'kwall', 2.25, 0.3575, 0, { width: 1.2 });
  fur(eg, 'wc', 9.4, 0.4575);
  fur(eg, 'basin', 7.35, 0.4225, 0, { width: 0.6 });
  fur(eg, 'washer', 9.5175, 2.65, 90);
  fur(eg, 'heatpump', 6.8875, 2.75, 270, { depth: 0.6, width: 0.7 });
  fur(eg, 'dining6', 3.0, 6.25);
  for (const [x, y, a] of [[2.4, 5.55, 0], [3.6, 5.55, 0], [2.4, 6.95, 180], [3.6, 6.95, 180], [1.75, 6.25, 270], [4.25, 6.25, 90]] as const) fur(eg, 'chair', x, y, a);
  fur(eg, 'sofa3', 7.8, 7.3, 180, { color: '#56687a' });
  fur(eg, 'armchair', 9.2, 5.9, 90, { color: '#a07b58' });
  fur(eg, 'coffeetable', 7.8, 6.2);
  fur(eg, 'rug', 7.8, 6.25, 0, { width: 2.6, depth: 1.8 });
  fur(eg, 'tvboard', 7.9, 3.8);
  fur(eg, 'plant', 9.5, 7.45);
  fur(eg, 'fireplace', 5.9, 3.85);

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
  fur(og, 'bed90', 1.2075, 1.4, 270);
  fur(og, 'desk', 3.2, 3.06, 180, { width: 1.2, depth: 0.7 });
  fur(og, 'wardrobe', 2.3, 0.4825, 0, { width: 1.5 });
  fur(og, 'bed90', 8.7925, 1.4, 90);
  fur(og, 'shelf', 7.5, 0.3575, 0, { width: 0.8 });
  fur(og, 'bathtub', 5.0, 0.5575);
  fur(og, 'basin2', 6.6625, 2.0, 90);
  fur(og, 'shower', 4.5375, 2.9625, 180);
  fur(og, 'wc', 6.6375, 0.9, 90);
  fur(og, 'bed180', 2.75, 6.7675, 180);
  fur(og, 'nightstand', 1.55, 7.6175, 180);
  fur(og, 'nightstand', 3.95, 7.6175, 180);
  fur(og, 'wardrobe', 5.8875, 6.5, 270, { width: 2.4 });
  fur(og, 'desk', 8.5, 7.4175, 180);
  fur(og, 'officechair', 8.5, 6.7);
  fur(og, 'shelf', 9.6425, 6.2, 90, { width: 1.2 });

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
  return { project: p, images: {} };
}
