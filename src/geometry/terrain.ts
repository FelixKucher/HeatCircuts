// Gelände und Erdanschüttung: Geländehöhe als geneigte Ebene über den Gebäudegrenzen,
// mittlere Erdanschüttung je Außenwand (auch schräg verlaufend entlang von Seitenwänden).

import type { Floor, Project, Vec, Wall } from '../model/types';
import { add, bbox, dist, mul, norm, sub, v } from './geom';

export interface Bounds {
  min: Vec;
  max: Vec;
}

/** Grundrissgrenzen aller Außenwände (sonst aller Räume) */
export function buildingBounds(project: Project): Bounds | null {
  const pts: Vec[] = [];
  for (const f of project.floors) for (const w of f.walls) if (w.kind === 'exterior') pts.push(w.a, w.b);
  if (!pts.length) for (const f of project.floors) for (const r of f.rooms) pts.push(...r.polygon);
  return pts.length ? bbox(pts) : null;
}

/** Geländehöhe relativ zu ±0,00 am Planpunkt p */
export function groundLevel(project: Project, p: Vec, b: Bounds | null): number {
  const t = project.terrain;
  if (t.type === 'flat' || !b) return t.gradeLow;
  const dx = Math.max(0.01, b.max.x - b.min.x);
  const dy = Math.max(0.01, b.max.y - b.min.y);
  let s: number;
  switch (t.uphill) {
    case 'N':
      s = (b.max.y - p.y) / dy;
      break;
    case 'S':
      s = (p.y - b.min.y) / dy;
      break;
    case 'O':
      s = (p.x - b.min.x) / dx;
      break;
    default:
      s = (b.max.x - p.x) / dx;
  }
  return t.gradeLow + t.rise * Math.min(1, Math.max(0, s));
}

/**
 * Mittlere Erdanschüttung (Höhe Erdreich über OK FFB, 0 … Geschosshöhe) entlang eines Wandabschnitts
 * [t0, t1] (Abstand ab Wandpunkt a). Manuelle Angabe an der Wand und „Geschoss im Erdreich“ haben Vorrang.
 */
export function buriedHeight(project: Project, floor: Floor, wall: Wall, b: Bounds | null, t0 = 0, t1 = dist(wall.a, wall.b)): number {
  const H = floor.storeyHeight;
  if (wall.earthHeight != null) return Math.min(H, Math.max(0, wall.earthHeight));
  const dir = norm(sub(wall.b, wall.a));
  const n = 9;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const t = t0 + ((t1 - t0) * i) / (n - 1);
    const p = add(wall.a, mul(dir, t));
    sum += Math.min(H, Math.max(0, groundLevel(project, p, b) - floor.elevation));
  }
  const mean = sum / n;
  // Geschoss als „im Erdreich“ markiert, aber Gelände nicht passend eingetragen → voll erdberührt
  if (floor.belowGrade && mean < 0.05) return H;
  return mean;
}

/** Geländehöhe an den vier Ecken der Grenzen (für die 3D-Darstellung) */
export function terrainCorners(project: Project, b: Bounds): { p: Vec; z: number }[] {
  return [v(b.min.x, b.min.y), v(b.max.x, b.min.y), v(b.max.x, b.max.y), v(b.min.x, b.max.y)].map((p) => ({ p, z: groundLevel(project, p, b) }));
}
