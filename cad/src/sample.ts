// Beispielhaus: Einfamilienhaus 10 × 8 m, EG + OG, gerade Treppe im Wohnbereich, möbliert, Satteldach.

import { CATALOG_BY_KEY } from './catalog';
import { addRectRoom, detectRoomAt } from './edit';
import { FLOOR_FINISHES, newLevel, newOpening, newProject, newStair, uid, type FloorFinish, type Level, type OpeningType, type Project, type Vec } from './model';
import { nearestWall } from './walls';
import { centroid } from '../../src/geometry/geom';

const EXT = 0.365;
const INT = 0.175;

function rooms(l: Level, rects: [string, number, number, number, number, FloorFinish][]): void {
  for (const [name, x0, y0, x1, y1] of rects) addRectRoom(l, { x: x0, y: y0 }, { x: x1, y: y1 }, INT, name);
  // Außenwände dicker, Raumpolygone neu ermitteln
  for (const w of l.walls) {
    const onEdge = (p: Vec) => p.x < 0.01 || p.x > 9.99 || p.y < 0.01 || p.y > 7.99;
    if (onEdge(w.a) && onEdge(w.b) && (Math.abs(w.a.x - w.b.x) < 1e-6 ? w.a.x < 0.01 || w.a.x > 9.99 : w.a.y < 0.01 || w.a.y > 7.99)) {
      w.thickness = EXT;
      w.colorRight = '#e9dfcf';
      w.colorLeft = '#e9dfcf';
    }
  }
  l.rooms.forEach((r, i) => {
    const c = centroid(r.polygon);
    const poly = detectRoomAt(l, c);
    if (poly) r.polygon = poly;
    const fin = rects[i][5];
    r.floorFinish = fin;
    r.floorColor = FLOOR_FINISHES[fin].color;
  });
}

function opening(l: Level, p: Vec, type: OpeningType, side: 'left' | 'right' = 'left', o: Partial<{ width: number; height: number; sill: number; hinge: 'a' | 'b' }> = {}): void {
  const nw = nearestWall(l.walls, p, 0.3);
  if (!nw) return;
  const op = { ...newOpening(type, nw.t), side, ...o };
  nw.wall.openings.push(op);
}

function fur(l: Level, key: string, x: number, y: number, angle = 0, o: Partial<{ width: number; depth: number; height: number; color: string }> = {}): void {
  const it = CATALOG_BY_KEY[key];
  l.furniture.push({ id: uid('F'), catalog: key, name: it.name, pos: { x, y }, angle, width: o.width ?? it.width, depth: o.depth ?? it.depth, height: o.height ?? it.height, elevation: it.elevation ?? 0, color: o.color ?? it.color, mirrored: false, visible: true });
}

export function sampleHouse(): Project {
  const p = newProject();
  p.name = 'Beispielhaus EFH';
  p.roof = { type: 'gable', pitch: 38, ridge: 'x', overhang: 0.5, color: '#8f3f2c', kneeWall: 0.5 };
  const eg = p.levels[0];
  eg.height = 2.875;
  rooms(eg, [
    ['Küche', 0, 0, 4, 3.5, 'fliesen'],
    ['Flur', 4, 0, 6.5, 3.5, 'naturstein'],
    ['WC', 6.5, 0, 10, 1.75, 'fliesen'],
    ['Technik', 6.5, 1.75, 10, 3.5, 'beton'],
    ['Wohnen / Essen', 0, 3.5, 10, 8, 'parkett'],
  ]);
  const W = (a: number, b: number): Vec => ({ x: a, y: b });
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
  st.width = 1.0;
  st.length = 4.3;
  eg.stairs.push(st);
  fur(eg, 'kbase120', 0.85, 0.4825);
  fur(eg, 'ksink', 1.9, 0.4825);
  fur(eg, 'dishwasher', 2.65, 0.4825);
  fur(eg, 'kstove', 3.25, 0.4825);
  fur(eg, 'fridge', 0.5075, 1.55, 270, { depth: 0.65 });
  fur(eg, 'kisland', 2.2, 2.25, 0, { width: 1.8, depth: 0.9 });
  fur(eg, 'kwall', 0.85, 0.3575, 0, { width: 1.2 });
  fur(eg, 'kwall', 2.25, 0.3575, 0, { width: 1.2 });
  fur(eg, 'wc', 9.4, 0.4575);
  fur(eg, 'basin', 7.35, 0.4225, 0, { width: 0.6 });
  fur(eg, 'washer', 9.5175, 2.65, 90);
  fur(eg, 'heatpump', 6.8875, 2.75, 270, { depth: 0.6, width: 0.7 });
  fur(eg, 'manifold', 8.2, 1.9125);
  fur(eg, 'dining6', 3.0, 6.25);
  for (const [x, y, a] of [[2.4, 5.55, 0], [3.6, 5.55, 0], [2.4, 6.95, 180], [3.6, 6.95, 180], [1.75, 6.25, 270], [4.25, 6.25, 90]] as const) fur(eg, 'chair', x, y, a);
  fur(eg, 'sofa3', 7.8, 7.3, 180, { color: '#56687a' });
  fur(eg, 'armchair', 9.2, 5.9, 90, { color: '#a07b58' });
  fur(eg, 'coffeetable', 7.8, 6.2);
  fur(eg, 'rug', 7.8, 6.25, 0, { width: 2.6, depth: 1.8 });
  fur(eg, 'tvboard', 7.9, 3.8);
  fur(eg, 'plant', 9.5, 7.45);
  fur(eg, 'fireplace', 5.9, 3.85, 0);

  const og = newLevel('Obergeschoss', eg.elevation + eg.height, 2.75);
  p.levels.push(og);
  rooms(og, [
    ['Kind 1', 0, 0, 4, 3.5, 'laminat'],
    ['Bad', 4, 0, 7, 3.5, 'fliesen'],
    ['Kind 2', 7, 0, 10, 3.5, 'laminat'],
    ['Galerie', 0, 3.5, 10, 5, 'parkett'],
    ['Schlafen', 0, 5, 5.5, 8, 'parkett'],
    ['Ankleide', 5.5, 5, 7, 8, 'teppich'],
    ['Arbeiten', 7, 5, 10, 8, 'parkett'],
  ]);
  opening(og, W(3.3, 3.5), 'door', 'left', { hinge: 'b' });
  opening(og, W(5.5, 3.5), 'door', 'right');
  opening(og, W(7.8, 3.5), 'door', 'right');
  opening(og, W(4.95, 5), 'door', 'right', { hinge: 'b' });
  opening(og, W(6.25, 5), 'slidingDoor', 'right', { width: 0.885 });
  opening(og, W(8.5, 5), 'door', 'right');
  opening(og, W(2, 0), 'window', 'right', { width: 1.26 });
  opening(og, W(5.5, 0), 'window', 'right', { width: 1.01, sill: 1.26, height: 1.01 });
  opening(og, W(8.5, 0), 'window', 'right', { width: 1.26 });
  opening(og, W(2.75, 8), 'window', 'left', { width: 1.76 });
  opening(og, W(8.5, 8), 'window', 'left', { width: 1.51 });
  opening(og, W(0, 6.5), 'window', 'right', { width: 1.01 });
  opening(og, W(10, 4.25), 'window', 'left', { width: 1.01 });
  fur(og, 'bed90', 1.2075, 1.4, 270);
  fur(og, 'desk', 3.2, 3.0, 180, { width: 1.2, depth: 0.7 });
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
  return p;
}
