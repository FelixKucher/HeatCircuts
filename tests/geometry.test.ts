import { describe, expect, it } from 'vitest';
import { area, insetPolygon, v } from '../src/geometry/geom';
import { detectRoom } from '../src/geometry/detect';
import { generateLayout, splitPolygon } from '../src/geometry/layout';
import { newWall } from '../src/model/factory';

const rect = (x0: number, y0: number, x1: number, y1: number) => [v(x0, y0), v(x1, y0), v(x1, y1), v(x0, y1)];

describe('Geometrie', () => {
  it('Fläche und Einrücken eines Rechtecks', () => {
    const r = rect(0, 0, 4, 3);
    expect(area(r)).toBeCloseTo(12);
    const ins = insetPolygon(r, 0.5)!;
    expect(area(ins)).toBeCloseTo(3 * 2);
    expect(insetPolygon(r, 1.6)).toBeNull();
  });

  it('Einrücken eines L-förmigen Raums', () => {
    const L = [v(0, 0), v(4, 0), v(4, 2), v(2, 2), v(2, 4), v(0, 4)];
    const ins = insetPolygon(L, 0.25)!;
    expect(ins).not.toBeNull();
    // (3,5 × 1,5) + (1,5 × 2,0) = 5,25 + 3,0
    expect(area(ins)).toBeCloseTo(8.25, 2);
  });

  it('Raumerkennung liefert die Innenkante der Wände', () => {
    const walls = [
      newWall(v(0, 0), v(5, 0), 'exterior', 0.4),
      newWall(v(5, 0), v(5, 4), 'exterior', 0.4),
      newWall(v(5, 4), v(0, 4), 'exterior', 0.4),
      newWall(v(0, 4), v(0, 0), 'exterior', 0.4),
    ];
    const res = detectRoom(v(2.5, 2), walls);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // innen: 4,6 × 3,6 = 16,56 m²; Rastertoleranz ±2 cm je Seite
    expect(area(res.polygon)).toBeGreaterThan(16.0);
    expect(area(res.polygon)).toBeLessThan(16.9);
    expect(res.polygon.length).toBe(4);
  });

  it('offener Raum wird erkannt', () => {
    const walls = [newWall(v(0, 0), v(5, 0), 'exterior', 0.3), newWall(v(5, 0), v(5, 4), 'exterior', 0.3)];
    expect(detectRoom(v(2.5, 2), walls).ok).toBe(false);
  });

  it('Aufteilung in flächengleiche Kreise', () => {
    const parts = splitPolygon(rect(0, 0, 9, 4), 3);
    expect(parts).toHaveLength(3);
    for (const p of parts) expect(area(p)).toBeCloseTo(12, 3);
  });

  it('Verlegemuster: Schnecke und Mäander erzeugen Linien im Raum', () => {
    const r = rect(0, 0, 4, 3);
    const s = generateLayout(r, 0.15, 0.1, 'spiral', v(0, 0));
    const m = generateLayout(r, 0.15, 0.1, 'meander', v(0, 0));
    const lenOf = (pl: { x: number; y: number }[][]) =>
      pl.reduce((a, l) => a + l.slice(1).reduce((b, p, i) => b + Math.hypot(p.x - l[i].x, p.y - l[i].y), 0), 0);
    // Richtwert A/VA ≈ 80 m (abzüglich Wandabstand etwas weniger)
    expect(lenOf(s.supply) + lenOf(s.ret)).toBeGreaterThan(55);
    expect(lenOf(m.supply) + lenOf(m.ret)).toBeGreaterThan(55);
  });
});
