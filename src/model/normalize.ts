// Abgeleitete Daten nach jeder Änderung: Wandart aus den angrenzenden Räumen, Öffnungsart aus der
// Darstellung, Deckenöffnungen aus den Treppen des Geschosses darunter.

import type { Compass4, Floor, Project, Wall } from './types';
import { pointInPolygon } from '../geometry/geom';
import { kindForStyle } from '../cad/openings';

const SIDE_OFF = 0.12;

/** liegt die Wand auf einer angebauten Seite (Haustrennwand)? */
function onAttachedSide(w: Wall, f: Floor, attached: Compass4[]): boolean {
  if (!attached.length || !f.walls.length) return false;
  const xs = f.walls.flatMap((x) => [x.a.x, x.b.x]);
  const ys = f.walls.flatMap((x) => [x.a.y, x.b.y]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const tol = 0.05;
  const vert = Math.abs(w.a.x - w.b.x) < tol;
  const hor = Math.abs(w.a.y - w.b.y) < tol;
  return (
    (attached.includes('W') && vert && Math.abs(w.a.x - x0) < tol) ||
    (attached.includes('O') && vert && Math.abs(w.a.x - x1) < tol) ||
    (attached.includes('N') && hor && Math.abs(w.a.y - y0) < tol) ||
    (attached.includes('S') && hor && Math.abs(w.a.y - y1) < tol)
  );
}

/** Art einer Wand aus den Räumen links und rechts (an drei Stellen geprüft) */
export function classifyWall(w: Wall, f: Floor, attached: Compass4[]): Wall['kind'] {
  const dx = w.b.x - w.a.x;
  const dy = w.b.y - w.a.y;
  const L = Math.hypot(dx, dy);
  if (L < 1e-6) return w.kind;
  const n = { x: -dy / L, y: dx / L };
  const off = w.thickness / 2 + SIDE_OFF;
  let left = 0;
  let right = 0;
  for (const t of [0.25, 0.5, 0.75]) {
    const c = { x: w.a.x + dx * t, y: w.a.y + dy * t };
    const pl = { x: c.x + n.x * off, y: c.y + n.y * off };
    const pr = { x: c.x - n.x * off, y: c.y - n.y * off };
    const rl = f.rooms.find((r) => pointInPolygon(pl, r.polygon));
    const rr = f.rooms.find((r) => pointInPolygon(pr, r.polygon));
    if (rl) left++;
    if (rr) right++;
  }
  const hasL = left >= 2;
  const hasR = right >= 2;
  if (hasL && hasR) return 'interior';
  // ohne angrenzenden Raum: bisherige Art behalten (z. B. Wand vor dem ersten Raum)
  if (!hasL && !hasR) return w.kind;
  // Wand Raum ↔ Garage ist eine Innenwand (Verlust über den Nachbarraum), Wand zur Außenluft eine Außenwand
  return onAttachedSide(w, f, attached) ? 'party' : 'exterior';
}

export function normalizeProject(p: Project): void {
  for (const f of p.floors) {
    for (const w of f.walls) {
      if (w.kindAuto) w.kind = classifyWall(w, f, p.site?.attached ?? []);
      for (const o of w.openings) if (o.style) o.kind = kindForStyle(o.style, w);
    }
  }
}
