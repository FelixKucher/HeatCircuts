import { describe, expect, it } from 'vitest';
import { newLevel, newWall, newStair } from '../cad/src/model';
import { wallOutlines } from '../cad/src/walls';
import { addRectRoom, addWallChain } from '../cad/src/edit';
import { stairGeometry } from '../cad/src/stairs';
import { exportDxf, parseDxf, toHeatCircuits } from '../cad/src/io';
import { sampleHouse } from '../cad/src/sample';
import { area } from '../src/geometry/geom';
import { buildContext, roomHeatLoad } from '../src/calc/heatload';

const v = (x: number, y: number) => ({ x, y });

describe('HausCAD Wände', () => {
  it('L-Ecke wird auf Gehrung geschnitten', () => {
    const a = newWall(v(0, 0), v(4, 0), 0.2);
    const b = newWall(v(4, 0), v(4, 3), 0.2);
    const o = wallOutlines([a, b]);
    const pa = o.get(a.id)!.poly;
    // Außenecke (−n-Seite von a, y = −0,1) und Innenecke (+n-Seite, y = +0,1) am Knoten (4, 0)
    const pts = pa.map((p) => [Math.round(p.x * 1000) / 1000, Math.round(p.y * 1000) / 1000]);
    expect(pts).toContainEqual([4.1, -0.1]);
    expect(pts).toContainEqual([3.9, 0.1]);
  });

  it('gemeinsame Wand wird nicht verdoppelt, T-Stöße werden geteilt', () => {
    const l = newLevel('EG', 0);
    addRectRoom(l, v(0, 0), v(4, 3), 0.2, 'A');
    addRectRoom(l, v(4, 0), v(7, 3), 0.2, 'B');
    expect(l.rooms).toHaveLength(2);
    // 4 + 3 neue Wände (gemeinsame Wand x = 4 nur einmal)
    const atX4 = l.walls.filter((w) => Math.abs(w.a.x - 4) < 1e-6 && Math.abs(w.b.x - 4) < 1e-6);
    expect(atX4).toHaveLength(1);
    expect(l.walls).toHaveLength(7);
    // lichte Fläche Raum A: (4 − 0,2) × (3 − 0,2)
    expect(area(l.rooms[0].polygon)).toBeCloseTo(3.8 * 2.8, 1);
    // Wand bis zur Mitte einer vorhandenen Wand → diese wird geteilt
    addWallChain(l, [v(2, 3), v(2, 6)], 0.2);
    expect(l.walls.filter((w) => Math.abs(w.a.y - 3) < 1e-6 && Math.abs(w.b.y - 3) < 1e-6).length).toBe(3);
  });
});

describe('HausCAD Treppen', () => {
  it('Steigungen aus der Geschosshöhe', () => {
    const s = newStair('straight', v(0, 0));
    s.length = 4.3;
    const g = stairGeometry(s, 2.8);
    expect(g.steps).toBe(16);
    expect(g.riser).toBeCloseTo(0.175, 3);
    expect(g.treads[g.steps - 1].z).toBeCloseTo(2.8, 6);
    const sp = stairGeometry(newStair('spiral', v(0, 0)), 2.8);
    expect(sp.outline.length).toBe(32);
    const l = stairGeometry(newStair('lshape', v(0, 0)), 2.8);
    expect(l.treads.length).toBe(16);
  });
});

describe('HausCAD Austausch', () => {
  it('DXF schreiben und wieder lesen (Meter)', () => {
    const p = sampleHouse();
    const dxf = exportDxf(p, p.levels[0]);
    const d = parseDxf(dxf);
    expect(d.unit).toBe(1);
    expect(d.segments.length).toBeGreaterThan(100);
    expect(d.layers).toContain('WAENDE');
    expect(d.texts.some((t) => t.text.startsWith('Küche'))).toBe(true);
  });

  it('Übergabe an HeatCircuits: Außen-/Innenwände, Öffnungen, Treppenloch, Heizlast', () => {
    const p = sampleHouse();
    const f = toHeatCircuits(p);
    const hc = f.project;
    expect(hc.floors).toHaveLength(2);
    const eg = hc.floors[0];
    expect(eg.rooms.map((r) => r.type)).toEqual(expect.arrayContaining(['kueche', 'flur', 'wc', 'technik', 'wohnen']));
    expect(eg.walls.filter((w) => w.kind === 'exterior').length).toBeGreaterThanOrEqual(4);
    expect(eg.walls.some((w) => w.openings.some((o) => o.kind === 'entrance'))).toBe(true);
    expect(hc.floors[1].voids).toHaveLength(1);
    expect(eg.manifolds).toHaveLength(1);
    const ctx = buildContext(hc);
    const total = eg.rooms.reduce((a, r) => a + roomHeatLoad(hc, r, eg, ctx).total, 0);
    expect(total).toBeGreaterThan(1000);
  });
});
