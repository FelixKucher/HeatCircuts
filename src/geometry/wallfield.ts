// Heizfelder der Wandheizung: Lage auf der Wand (Abstand entlang der Achse ab Punkt a, Höhe ab OK FFB).

import type { Floor, HeatingSurface, Opening, Room, Wall } from '../model/types';
import { collinearOverlap, dist, dot, norm, sub } from './geom';

export interface Interval {
  t0: number;
  t1: number;
}

/** Abschnitt der Wandachse, an dem der Raum anliegt. */
export function roomSpanOnWall(wall: Wall, room: Room): Interval | null {
  const L = dist(wall.a, wall.b);
  const dir = norm(sub(wall.b, wall.a));
  let t0 = Infinity;
  let t1 = -Infinity;
  const poly = room.polygon;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    const ov = collinearOverlap(wall.a, wall.b, p, q, wall.thickness / 2 + 0.15);
    if (ov <= 0.05) continue;
    const tp = dot(sub(p, wall.a), dir);
    const tq = dot(sub(q, wall.a), dir);
    t0 = Math.min(t0, Math.max(0, Math.min(tp, tq)));
    t1 = Math.max(t1, Math.min(L, Math.max(tp, tq)));
  }
  return t1 > t0 ? { t0, t1 } : null;
}

/** Wände, an die der Raum grenzt (für die Auswahl der Wandheizung). */
export function wallsOfRoom(floor: Floor, room: Room): { wall: Wall; span: Interval }[] {
  const res: { wall: Wall; span: Interval }[] = [];
  for (const w of floor.walls) {
    const span = roomSpanOnWall(w, room);
    if (span && span.t1 - span.t0 > 0.4) res.push({ wall: w, span });
  }
  return res;
}

export function defaultField(wall: Wall, room: Room, clearHeight: number): HeatingSurface['field'] {
  const span = roomSpanOnWall(wall, room) ?? { t0: 0, t1: dist(wall.a, wall.b) };
  return { x0: span.t0 + 0.15, x1: Math.max(span.t0 + 0.3, span.t1 - 0.15), z0: 0.2, z1: Math.max(0.6, Math.min(2.0, clearHeight - 0.25)) };
}

/** Öffnungsrechteck in Wandkoordinaten mit Sicherheitsabstand */
export function openingRect(o: Opening, margin = 0.1): { x0: number; x1: number; z0: number; z1: number } {
  return { x0: o.offset - o.width / 2 - margin, x1: o.offset + o.width / 2 + margin, z0: o.sill - margin, z1: o.sill + o.height + margin };
}

/** Belegbare Fläche des Heizfelds abzüglich Fenster- und Türöffnungen */
export function fieldArea(field: NonNullable<HeatingSurface['field']>, openings: Opening[]): number {
  let a = Math.max(0, field.x1 - field.x0) * Math.max(0, field.z1 - field.z0);
  for (const o of openings) {
    const r = openingRect(o);
    const w = Math.min(field.x1, r.x1) - Math.max(field.x0, r.x0);
    const h = Math.min(field.z1, r.z1) - Math.max(field.z0, r.z0);
    if (w > 0 && h > 0) a -= w * h;
  }
  return Math.max(0, a);
}

/** Horizontale Rohrbahnen (Mäander) im Heizfeld, unterbrochen an Öffnungen: Liste von [x0, x1] je Höhe z. */
export function fieldRuns(field: NonNullable<HeatingSurface['field']>, openings: Opening[], spacing: number): { z: number; runs: [number, number][] }[] {
  const out: { z: number; runs: [number, number][] }[] = [];
  for (let z = field.z0 + spacing / 2; z <= field.z1 - spacing / 2 + 1e-9; z += spacing) {
    let runs: [number, number][] = [[field.x0 + spacing / 2, field.x1 - spacing / 2]];
    for (const o of openings) {
      const r = openingRect(o);
      if (z < r.z0 || z > r.z1) continue;
      const next: [number, number][] = [];
      for (const [a, b] of runs) {
        if (r.x1 <= a || r.x0 >= b) next.push([a, b]);
        else {
          if (r.x0 - a > spacing) next.push([a, r.x0]);
          if (b - r.x1 > spacing) next.push([r.x1, b]);
        }
      }
      runs = next;
    }
    if (runs.length) out.push({ z, runs });
  }
  return out;
}
