// Treppen: Stufen als Polygone in Planlage, Umriss für den Deckendurchbruch.

import type { Stair, Vec } from '../model/types';

export interface Tread {
  poly: Vec[];
  /** Oberkante der Stufe über OK FFB */
  z: number;
}

export interface StairGeometry {
  treads: Tread[];
  outline: Vec[];
  /** Lauflinie (für Pfeil im Plan) */
  walkline: Vec[];
  riser: number;
  steps: number;
}

const rot = (p: Vec, a: number): Vec => {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return { x: p.x * c - p.y * s, y: p.x * s + p.y * c };
};

export function stepCount(s: Stair, rise: number): number {
  return Math.max(3, s.steps ?? Math.round(rise / 0.175));
}

/** Stufen in lokalen Koordinaten (Antritt unten bei +y, Lauf nach −y), dann um den Mittelpunkt gedreht */
export function stairGeometry(s: Stair, rise: number): StairGeometry {
  const n = stepCount(s, rise);
  const h = rise / n;
  const treads: Tread[] = [];
  let outline: Vec[] = [];
  let walk: Vec[] = [];
  const W = s.width;
  if (s.type === 'straight') {
    const L = s.length;
    const g = L / n;
    for (let i = 0; i < n; i++) {
      const y0 = L / 2 - i * g;
      treads.push({ poly: [{ x: -W / 2, y: y0 }, { x: W / 2, y: y0 }, { x: W / 2, y: y0 - g }, { x: -W / 2, y: y0 - g }], z: (i + 1) * h });
    }
    outline = [{ x: -W / 2, y: L / 2 }, { x: W / 2, y: L / 2 }, { x: W / 2, y: -L / 2 }, { x: -W / 2, y: -L / 2 }];
    walk = [{ x: 0, y: L / 2 - g / 2 }, { x: 0, y: -L / 2 + 0.1 }];
  } else if (s.type === 'lshape') {
    // Lauf 1 nach −y (Länge L bis Podestanfang), Podest W × W, Lauf 2 nach +x (Länge L2)
    const L1 = Math.max(0.5, s.length - W);
    const L2 = Math.max(0.5, s.length2);
    const n1 = Math.max(1, Math.round(((n - 1) * L1) / (L1 + L2)));
    const n2 = Math.max(1, n - 1 - n1);
    const g1 = L1 / n1;
    const g2 = L2 / n2;
    const pts: Tread[] = [];
    for (let i = 0; i < n1; i++) pts.push({ poly: [{ x: 0, y: -i * g1 }, { x: W, y: -i * g1 }, { x: W, y: -(i + 1) * g1 }, { x: 0, y: -(i + 1) * g1 }], z: (i + 1) * h });
    pts.push({ poly: [{ x: 0, y: -L1 }, { x: W, y: -L1 }, { x: W, y: -L1 - W }, { x: 0, y: -L1 - W }], z: (n1 + 1) * h });
    for (let i = 0; i < n2; i++) pts.push({ poly: [{ x: W + i * g2, y: -L1 }, { x: W + (i + 1) * g2, y: -L1 }, { x: W + (i + 1) * g2, y: -L1 - W }, { x: W + i * g2, y: -L1 - W }], z: (n1 + 2 + i) * h });
    const ol = [{ x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: -L1 }, { x: W + L2, y: -L1 }, { x: W + L2, y: -L1 - W }, { x: 0, y: -L1 - W }];
    const wl = [{ x: W / 2, y: -g1 / 2 }, { x: W / 2, y: -L1 - W / 2 }, { x: W + L2 - 0.1, y: -L1 - W / 2 }];
    // auf die Mitte des Umrisses zentrieren
    const cx = (W + L2) / 2;
    const cy = -(L1 + W) / 2;
    const c = (p: Vec) => ({ x: p.x - cx, y: p.y - cy });
    for (const t of pts) treads.push({ poly: t.poly.map(c), z: t.z });
    outline = ol.map(c);
    walk = wl.map(c);
  } else {
    const r = s.length / 2;
    const r0 = 0.09;
    const sweep = Math.min(2 * Math.PI, (n * 22.5 * Math.PI) / 180);
    const da = sweep / n;
    const dir = s.clockwise ? 1 : -1;
    const a0 = Math.PI / 2; // Antritt unten (+y)
    for (let i = 0; i < n; i++) {
      const p: Vec[] = [];
      const k = 6;
      for (let j = 0; j <= k; j++) {
        const a = a0 + dir * (i * da + (j / k) * da);
        p.push({ x: Math.cos(a) * r, y: Math.sin(a) * r });
      }
      for (let j = k; j >= 0; j--) {
        const a = a0 + dir * (i * da + (j / k) * da);
        p.push({ x: Math.cos(a) * r0, y: Math.sin(a) * r0 });
      }
      treads.push({ poly: p, z: (i + 1) * h });
    }
    outline = Array.from({ length: 32 }, (_, i) => ({ x: Math.cos((i / 32) * 2 * Math.PI) * r, y: Math.sin((i / 32) * 2 * Math.PI) * r }));
    const rw = r * 0.6;
    walk = Array.from({ length: 24 }, (_, i) => {
      const a = a0 + dir * (da / 2 + (i / 23) * (sweep - da));
      return { x: Math.cos(a) * rw, y: Math.sin(a) * rw };
    });
  }
  const ang = (s.angle * Math.PI) / 180;
  const T = (p: Vec) => {
    const q = rot(p, ang);
    return { x: q.x + s.pos.x, y: q.y + s.pos.y };
  };
  return { treads: treads.map((t) => ({ poly: t.poly.map(T), z: t.z })), outline: outline.map(T), walkline: walk.map(T), riser: h, steps: n };
}

let sc = 0;
export function newStair(type: Stair['type'], pos: Vec): Stair {
  return {
    id: `S${Date.now().toString(36)}${(sc++).toString(36)}`,
    type,
    pos: { ...pos },
    angle: 0,
    width: type === 'spiral' ? 1.6 : 1.0,
    length: type === 'spiral' ? 1.6 : type === 'lshape' ? 2.5 : 3.6,
    length2: 1.8,
    steps: null,
    clockwise: true,
    color: '#b88a5a',
    cutCeiling: true,
  };
}
