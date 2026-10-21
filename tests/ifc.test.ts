import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { bottomOutline, joinWalls, minAreaRect, polyArea, rectToAxis, type Tri3 } from '../src/io/ifc-geom';
import { ifcToProject } from '../src/io/ifc';
import { detectScale } from '../src/io/pdf';

/** Quader als Dreiecke (Boden, Decke, vier Seiten) */
function box(x0: number, y0: number, x1: number, y1: number, h0: number, h1: number): Tri3[] {
  const q = (a: [number, number, number], b: [number, number, number], c: [number, number, number], d: [number, number, number]): Tri3[] => [{ p: [a, b, c] }, { p: [a, c, d] }];
  const P = (x: number, y: number, h: number): [number, number, number] => [x, y, h];
  return [
    ...q(P(x0, y0, h0), P(x1, y0, h0), P(x1, y1, h0), P(x0, y1, h0)),
    ...q(P(x0, y0, h1), P(x1, y0, h1), P(x1, y1, h1), P(x0, y1, h1)),
    ...q(P(x0, y0, h0), P(x1, y0, h0), P(x1, y0, h1), P(x0, y0, h1)),
    ...q(P(x1, y0, h0), P(x1, y1, h0), P(x1, y1, h1), P(x1, y0, h1)),
    ...q(P(x1, y1, h0), P(x0, y1, h0), P(x0, y1, h1), P(x1, y1, h1)),
    ...q(P(x0, y1, h0), P(x0, y0, h0), P(x0, y0, h1), P(x0, y1, h1)),
  ];
}

describe('IFC-Geometrie', () => {
  it('Raumumriss aus der Unterseite, auch L-förmig', () => {
    const tris = [...box(0, 0, 4, 3, 0, 2.5), ...box(4, 0, 6, 1.5, 0, 2.5)];
    const poly = bottomOutline(tris)!;
    expect(Math.abs(polyArea(poly))).toBeCloseTo(4 * 3 + 2 * 1.5, 6);
    expect(poly.length).toBe(6);
  });

  it('Wandachse und Dicke aus gedrehtem Körper', () => {
    const a = Math.PI / 6;
    const pts = [
      [0, -0.15],
      [5, -0.15],
      [5, 0.15],
      [0, 0.15],
    ].map(([x, y]) => ({ x: x * Math.cos(a) - y * Math.sin(a), y: x * Math.sin(a) + y * Math.cos(a) }));
    const r = minAreaRect(pts)!;
    expect(r.length).toBeCloseTo(5, 6);
    expect(r.width).toBeCloseTo(0.3, 6);
    const w = rectToAxis(r);
    expect(Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y)).toBeCloseTo(5, 6);
  });

  it('verbindet überlappende Ecken auf den Achsenschnitt', () => {
    // zwei 30-cm-Wände, jeweils bis zur Außenkante der anderen gezogen
    const walls = [
      { a: { x: -0.15, y: 0 }, b: { x: 6.15, y: 0 }, thickness: 0.3 },
      { a: { x: 0, y: -0.15 }, b: { x: 0, y: 4.15 }, thickness: 0.3 },
    ];
    joinWalls(walls);
    expect(walls[0].a.x).toBeCloseTo(0, 6);
    expect(walls[1].a.y).toBeCloseTo(0, 6);
    expect(walls[0].b.x).toBeCloseTo(6.15, 6);
  });
});

describe('PDF-Maßstab', () => {
  it('erkennt den Planmaßstab im Schriftfeld', () => {
    expect(detectScale('Grundriss EG  M 1:100  Datum 01.10.2026')).toBe(100);
    expect(detectScale('Maßstab 1 : 50')).toBe(50);
    expect(detectScale('Plan-Nr. 12:30 Uhr')).toBeNull();
  });
});

// Optional: echtes Modell, z. B. AC20-FZK-Haus.ifc (KIT) – Pfad in IFC_SAMPLE
const sample = process.env.IFC_SAMPLE;
describe.skipIf(!sample || !existsSync(sample))('IFC-Modell', () => {
  it('übernimmt Geschosse, Räume, Wände und Öffnungen', async () => {
    const { project, stats } = await ifcToProject(new Uint8Array(readFileSync(sample!)));
    expect(stats.storeys).toBeGreaterThan(0);
    expect(stats.spaces).toBeGreaterThan(0);
    expect(stats.walls).toBeGreaterThan(3);
    for (const f of project.floors) for (const r of f.rooms) expect(Math.abs(polyArea(r.polygon))).toBeGreaterThan(0.5);
  }, 60000);
});
