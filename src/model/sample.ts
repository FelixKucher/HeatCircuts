// Beispielprojekt: Einfamilienhaus mit EG und OG, 11,0 × 9,0 m (Wandachsen).
// Das EG erhält einen synthetisch gezeichneten Grundriss als Hintergrundbild, um Kalibrierung und Nachzeichnen zu zeigen.

import type { Floor, ImageStore, Project, Vec, WallKind } from './types';
import { newFloor, newProject, newRoom, newWall, uid } from './factory';
import { detectRoom } from '../geometry/detect';
import { v } from '../geometry/geom';

type WallSpec = [number, number, number, number, WallKind, number];

const EXT = 0.365;
const IN1 = 0.175;
const IN2 = 0.115;

const exterior: WallSpec[] = [
  [0, 0, 11, 0, 'exterior', EXT],
  [11, 0, 11, 9, 'exterior', EXT],
  [11, 9, 0, 9, 'exterior', EXT],
  [0, 9, 0, 0, 'exterior', EXT],
];

const egWalls: WallSpec[] = [
  ...exterior,
  [6.5, 0, 6.5, 9, 'interior', IN1],
  [0, 5.5, 6.5, 5.5, 'interior', IN1],
  [6.5, 4, 11, 4, 'interior', IN1],
  [3, 5.5, 3, 9, 'interior', IN2],
  [8.5, 4, 8.5, 9, 'interior', IN2],
  [6.5, 6.5, 8.5, 6.5, 'interior', IN2],
];

const ogWalls: WallSpec[] = [
  ...exterior,
  [0, 4.5, 11, 4.5, 'interior', IN1],
  [4.5, 0, 4.5, 4.5, 'interior', IN2],
  [8, 0, 8, 9, 'interior', IN2],
  [3.5, 4.5, 3.5, 9, 'interior', IN2],
  [8, 6.5, 11, 6.5, 'interior', IN2],
];

interface RoomSpec {
  at: Vec;
  type: string;
  name: string;
  window: number;
  pattern?: 'spiral' | 'meander';
  excluded?: number;
  spacing?: number;
}

const egRooms: RoomSpec[] = [
  { at: v(3, 2.5), type: 'wohnen', name: 'Wohnen / Essen', window: 9.5 },
  { at: v(8.7, 2), type: 'kueche', name: 'Küche', window: 2.5, excluded: 3.0, spacing: 0.1 },
  { at: v(1.5, 7.2), type: 'buero', name: 'Arbeitszimmer', window: 2.0 },
  { at: v(4.7, 7.2), type: 'flur', name: 'Diele', window: 0.8, pattern: 'meander' },
  { at: v(7.5, 7.7), type: 'wc', name: 'Gäste-WC', window: 0.5, pattern: 'meander' },
  { at: v(7.5, 5.2), type: 'abstell', name: 'Abstellraum', window: 0 },
  { at: v(9.7, 6.5), type: 'hwr', name: 'HWR / Technik', window: 1.0, pattern: 'meander' },
];

const ogRooms: RoomSpec[] = [
  { at: v(2.2, 2.2), type: 'schlafen', name: 'Eltern', window: 3.0 },
  { at: v(6.2, 2.2), type: 'kind', name: 'Kind 1', window: 2.5 },
  { at: v(9.5, 2.2), type: 'kind', name: 'Kind 2', window: 2.5 },
  { at: v(1.7, 6.7), type: 'bad', name: 'Bad', window: 1.5, excluded: 2.2 },
  { at: v(5.7, 6.7), type: 'flur', name: 'Flur OG', window: 0, pattern: 'meander' },
  { at: v(9.5, 5.5), type: 'abstell', name: 'Ankleide', window: 0 },
  { at: v(9.5, 7.8), type: 'dusche', name: 'Duschbad', window: 1.0, excluded: 1.0 },
];

function buildFloor(project: Project, floor: Floor, walls: WallSpec[], rooms: RoomSpec[]): void {
  floor.walls = walls.map(([x1, y1, x2, y2, kind, t]) => newWall(v(x1, y1), v(x2, y2), kind, t));
  for (const r of rooms) {
    const det = detectRoom(r.at, floor.walls);
    if (!det.ok) continue;
    const room = newRoom(project, floor, det.polygon, r.type, r.name);
    room.windowArea = r.window;
    room.excludedArea = r.excluded ?? 0;
    if (r.pattern) room.pattern = r.pattern;
    if (r.spacing) room.spacing = r.spacing;
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
  for (const [x1, y1, x2, y2, kind, t] of walls) {
    g.strokeStyle = kind === 'exterior' ? '#2b2b2b' : '#555';
    g.lineWidth = t * pxPerM;
    g.beginPath();
    g.moveTo(X(x1), X(y1));
    g.lineTo(X(x2), X(y2));
    g.stroke();
  }
  // Maßkette oben
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
  // Maßstabsleiste 5 m
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
  project.building.client = 'Beispielprojekt';
  project.building.address = 'Musterstraße 1, 60311 Frankfurt am Main';
  const eg = project.floors[0];
  const og = newFloor('Obergeschoss', 2.9);
  project.floors.push(og);
  buildFloor(project, eg, egWalls, egRooms);
  buildFloor(project, og, ogWalls, ogRooms);

  eg.manifolds.push({ id: uid('m'), name: 'HKV EG', pos: v(6.3, 7.6), supplyLengthOverride: null });
  og.manifolds.push({ id: uid('m'), name: 'HKV OG', pos: v(3.75, 6.9), supplyLengthOverride: null });
  project.heatSource = { floorId: eg.id, pos: v(10.3, 8.3), name: 'Wärmepumpe (Inneneinheit)', type: 'wp_luft' };

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
      opacity: 0.55,
      visible: true,
      locked: true,
      calibrated: true,
    };
  }
  return { project, images };
}
