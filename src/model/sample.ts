// Beispielprojekt: Einfamilienhaus mit EG und OG, 11,0 × 9,0 m (Wandachsen), Satteldach.
// Das EG erhält einen synthetisch gezeichneten Grundriss als Hintergrundbild, um Kalibrierung und Erkennung zu zeigen.

import type { Floor, ImageStore, Opening, OpeningKind, Project, Vec, WallKind } from './types';
import { applyYearBuilt, newFloor, newProject, newRoom, newSurface, newWall, uid } from './factory';
import { detectRoom } from '../geometry/detect';
import { v } from '../geometry/geom';
import { defaultField } from '../geometry/wallfield';
import { autoLayout } from '../calc/autolayout';

type OpeningSpec = [OpeningKind, number, number, number?, number?];
type WallSpec = [number, number, number, number, WallKind, number, OpeningSpec[]?];

const EXT = 0.365;
const IN1 = 0.175;
const IN2 = 0.115;

const W_STD: [number, number] = [1.35, 0.9];

const egWalls: WallSpec[] = [
  [0, 0, 11, 0, 'exterior', EXT, [['window', 1.6, 2.0, ...W_STD], ['window', 4.5, 2.0, ...W_STD], ['window', 8.7, 1.2, ...W_STD]]],
  [11, 0, 11, 9, 'exterior', EXT, [['window', 2.0, 1.0, ...W_STD], ['window', 6.5, 0.9, ...W_STD]]],
  [11, 9, 0, 9, 'exterior', EXT, [['window', 3.5, 0.6, 0.6, 1.4], ['entrance', 6.3, 1.1, 2.2, 0], ['window', 9.5, 1.2, ...W_STD]]],
  [0, 9, 0, 0, 'exterior', EXT, [['window', 6.5, 2.0, 2.2, 0]]],
  [6.5, 0, 6.5, 9, 'interior', IN1, [['door', 2.0, 1.0, 2.01, 0], ['door', 5.2, 0.8, 2.01, 0], ['door', 7.7, 0.8, 2.01, 0]]],
  [0, 5.5, 6.5, 5.5, 'interior', IN1, [['door', 4.5, 1.0, 2.01, 0]]],
  [6.5, 4, 11, 4, 'interior', IN1, [['door', 3.2, 0.9, 2.01, 0]]],
  [3, 5.5, 3, 9, 'interior', IN2, [['door', 1.0, 0.9, 2.01, 0]]],
  [8.5, 4, 8.5, 9, 'interior', IN2],
  [6.5, 6.5, 8.5, 6.5, 'interior', IN2],
];

const ogWalls: WallSpec[] = [
  [0, 0, 11, 0, 'exterior', EXT, [['window', 2.2, 1.5, ...W_STD], ['window', 6.2, 1.2, ...W_STD], ['window', 9.5, 1.2, ...W_STD]]],
  [11, 0, 11, 9, 'exterior', EXT, [['window', 2.0, 1.0, ...W_STD]]],
  [11, 9, 0, 9, 'exterior', EXT, [['window', 1.5, 0.8, 0.9, 1.2], ['window', 9.3, 1.0, 1.0, 1.0]]],
  [0, 9, 0, 0, 'exterior', EXT, [['window', 2.3, 0.8, 1.0, 1.0], ['window', 6.8, 1.2, ...W_STD]]],
  [0, 4.5, 11, 4.5, 'interior', IN1, [['door', 2.6, 0.9, 2.01, 0], ['door', 6.2, 0.9, 2.01, 0], ['door', 8.9, 0.9, 2.01, 0]]],
  [4.5, 0, 4.5, 4.5, 'interior', IN2],
  [8, 0, 8, 9, 'interior', IN2, [['door', 5.5, 0.8, 2.01, 0], ['door', 7.7, 0.8, 2.01, 0]]],
  [3.5, 4.5, 3.5, 9, 'interior', IN2, [['door', 1.2, 0.9, 2.01, 0]]],
  [8, 6.5, 11, 6.5, 'interior', IN2],
];

interface RoomSpec {
  at: Vec;
  type: string;
  name: string;
  excluded?: number;
  pattern?: 'spiral' | 'meander';
}

const egRooms: RoomSpec[] = [
  { at: v(3, 2.5), type: 'wohnen', name: 'Wohnen / Essen' },
  { at: v(8.7, 2), type: 'kueche', name: 'Küche', excluded: 3.0 },
  { at: v(1.5, 7.2), type: 'buero', name: 'Arbeitszimmer' },
  { at: v(4.7, 7.2), type: 'flur', name: 'Diele', pattern: 'meander' },
  { at: v(7.5, 7.7), type: 'wc', name: 'Gäste-WC', pattern: 'meander' },
  { at: v(7.5, 5.2), type: 'abstell', name: 'Abstellraum' },
  { at: v(9.7, 6.5), type: 'hwr', name: 'HWR / Technik', pattern: 'meander' },
];

const ogRooms: RoomSpec[] = [
  { at: v(2.2, 2.2), type: 'schlafen', name: 'Eltern' },
  { at: v(6.2, 2.2), type: 'kind', name: 'Kind 1' },
  { at: v(9.5, 2.2), type: 'kind', name: 'Kind 2' },
  { at: v(1.7, 6.7), type: 'bad', name: 'Bad', excluded: 2.2 },
  { at: v(5.7, 6.7), type: 'flur', name: 'Flur OG', pattern: 'meander' },
  { at: v(9.5, 5.5), type: 'abstell', name: 'Ankleide' },
  { at: v(9.5, 7.8), type: 'dusche', name: 'Duschbad', excluded: 1.0 },
];

function makeOpening([kind, offset, width, height, sill]: OpeningSpec): Opening {
  const door = kind === 'door' || kind === 'entrance';
  return { id: uid('o'), kind, offset, width, height: height ?? (door ? 2.01 : 1.35), sill: sill ?? (door ? 0 : 0.9) };
}

function buildFloor(project: Project, floor: Floor, walls: WallSpec[], rooms: RoomSpec[]): void {
  floor.walls = walls.map(([x1, y1, x2, y2, kind, t, ops]) => {
    const w = newWall(v(x1, y1), v(x2, y2), kind, t);
    w.openings = (ops ?? []).map(makeOpening);
    return w;
  });
  for (const r of rooms) {
    const det = detectRoom(r.at, floor.walls);
    if (!det.ok) continue;
    const room = newRoom(project, floor, det.polygon, r.type, r.name);
    room.excludedArea = r.excluded ?? 0;
    if (r.pattern) room.surfaces.forEach((s) => (s.pattern = r.pattern!));
    floor.rooms.push(room);
  }
}

/** Zeichnet einen einfachen Werkplan (1 m = pxPerM Pixel) als PNG-Data-URL. */
function drawPlanImage(walls: WallSpec[], pxPerM: number, marginM: number, widthM: number, heightM: number): string | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = Math.round((widthM + 2 * marginM) * pxPerM);
  c.height = Math.round((heightM + 2 * marginM) * pxPerM);
  const g = c.getContext('2d');
  if (!g) return null;
  g.fillStyle = '#fbfaf6';
  g.fillRect(0, 0, c.width, c.height);
  const X = (m: number) => (m + marginM) * pxPerM;
  g.lineCap = 'square';
  for (const [x1, y1, x2, y2, kind, t, ops] of walls) {
    g.strokeStyle = kind === 'exterior' ? '#2b2b2b' : '#555';
    g.lineWidth = t * pxPerM;
    // Wand mit Aussparungen für Öffnungen
    const L = Math.hypot(x2 - x1, y2 - y1);
    const dx = (x2 - x1) / L;
    const dy = (y2 - y1) / L;
    const cuts = (ops ?? []).map(([, o, w]) => [o - w / 2, o + w / 2]).sort((a, b) => a[0] - b[0]);
    let s = 0;
    for (const [a, b] of [...cuts, [L, L]]) {
      if (a > s) {
        g.beginPath();
        g.moveTo(X(x1 + dx * s), X(y1 + dy * s));
        g.lineTo(X(x1 + dx * a), X(y1 + dy * a));
        g.stroke();
      }
      s = b;
    }
    // Fenster als Dünnlinien, Türen als Bogen
    g.lineWidth = 1;
    for (const [k, o, w] of ops ?? []) {
      const ax = x1 + dx * (o - w / 2);
      const ay = y1 + dy * (o - w / 2);
      if (k === 'window') {
        for (const off of [-t / 4, 0, t / 4]) {
          g.beginPath();
          g.moveTo(X(ax - dy * off), X(ay + dx * off));
          g.lineTo(X(ax + dx * w - dy * off), X(ay + dy * w + dx * off));
          g.stroke();
        }
      } else {
        g.beginPath();
        g.arc(X(ax), X(ay), w * pxPerM, Math.atan2(dy, dx), Math.atan2(dy, dx) + Math.PI / 2);
        g.stroke();
      }
    }
  }
  g.strokeStyle = '#7a6f5a';
  g.fillStyle = '#7a6f5a';
  g.lineWidth = 1;
  g.font = `${Math.round(pxPerM * 0.28)}px sans-serif`;
  g.textAlign = 'center';
  const yDim = X(-0.7);
  g.beginPath();
  g.moveTo(X(0), yDim);
  g.lineTo(X(widthM), yDim);
  for (const xm of [0, 6.5, widthM]) {
    g.moveTo(X(xm), yDim - 6);
    g.lineTo(X(xm), yDim + 6);
  }
  g.stroke();
  g.fillText('6,50', X(3.25), yDim - 8);
  g.fillText('4,50', X(8.75), yDim - 8);
  const yBar = X(heightM + 0.75);
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(X(0), yBar);
  g.lineTo(X(5), yBar);
  g.stroke();
  g.fillText('5 m', X(2.5), yBar - 8);
  g.textAlign = 'left';
  g.fillText('Grundriss EG · M 1:100 (Beispiel)', X(6), yBar + 4);
  return c.toDataURL('image/png');
}

export function createSampleProject(): { project: Project; images: ImageStore } {
  const project = newProject('Beispiel: Einfamilienhaus');
  project.isExample = true;
  project.wizard = { done: true, step: 0 };
  project.building.client = 'Beispielprojekt';
  project.building.address = 'Musterstraße 1, 60311 Frankfurt am Main';
  applyYearBuilt(project.building, 2012);
  project.roof = { type: 'gable', pitch: 38, ridge: 'x', overhang: 0.5, insulation: 'topSlab', kneeWall: 0.5 };
  const eg = project.floors[0];
  const og = newFloor('Obergeschoss', 2.9);
  project.floors.push(og);
  buildFloor(project, eg, egWalls, egRooms);
  buildFloor(project, og, ogWalls, ogRooms);
  // Treppe EG → OG: Deckenöffnung im OG-Fußboden
  og.voids.push({ id: uid('v'), kind: 'stair', polygon: [v(4.0, 5.0), v(5.1, 5.0), v(5.1, 8.7), v(4.0, 8.7)], direction: 'y+' });

  // Gäste-WC mit Elektro-Heizmatte
  const wc = eg.rooms.find((r) => r.type === 'wc');
  if (wc) wc.surfaces = [{ ...newSurface('floor', 'electric'), electricPower: 160 }];
  // Bad OG zusätzlich mit Wandheizung an der Außenwand
  const bad = og.rooms.find((r) => r.type === 'bad');
  const leftWall = og.walls.find((w) => w.a.x === 0 && w.b.x === 0);
  if (bad && leftWall) {
    const s = newSurface('wall', 'wall_wet', 0.1);
    s.wallId = leftWall.id;
    s.field = defaultField(leftWall, bad, og.clearHeight);
    bad.surfaces.push(s);
  }

  eg.manifolds.push({ id: uid('m'), name: 'HKV EG', pos: v(6.3, 7.0), supplyLengthOverride: null, maxOutlets: 12 });
  og.manifolds.push({ id: uid('m'), name: 'HKV OG', pos: v(3.75, 6.9), supplyLengthOverride: null, maxOutlets: 12 });
  project.heatSource = { floorId: eg.id, pos: v(10.3, 8.3), name: 'Wärmepumpe (Inneneinheit)', type: 'wp_luft' };
  autoLayout(project);

  const images: ImageStore = {};
  const pxPerM = 48;
  const margin = 1.5;
  const url = drawPlanImage(egWalls, pxPerM, margin, 11, 9);
  if (url) {
    const imageId = uid('img');
    images[imageId] = url;
    eg.background = {
      imageId,
      widthPx: Math.round((11 + 2 * margin) * pxPerM),
      heightPx: Math.round((9 + 2 * margin) * pxPerM),
      pxPerM,
      offset: v(-margin, -margin),
      opacity: 0.5,
      visible: true,
      locked: true,
      calibrated: true,
    };
  }
  return { project, images };
}
