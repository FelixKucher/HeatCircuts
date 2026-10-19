import { describe, expect, it } from 'vitest';
import { newFloor, newProject, newWall } from '../src/model/factory';
import { wallOutlines } from '../src/cad/walls';
import { addRectRoom, addWallChain } from '../src/cad/edit';
import { newStair, stairGeometry } from '../src/cad/stairs';
import { applyFormat, pickFormat } from '../src/cad/painter';
import { exportDxf, parseDxf } from '../src/io/dxf';
import { fromHausCad } from '../src/io/hauscad';
import { createSampleProject } from '../src/model/sample';
import { normalizeProject } from '../src/model/normalize';
import { estimateClimate } from '../src/calc/climate';
import { area } from '../src/geometry/geom';
import { buildContext, roomHeatLoad } from '../src/calc/heatload';
import { constructionFromTemplate } from '../src/model/constructions';

const v = (x: number, y: number) => ({ x, y });

describe('Wände und Räume', () => {
  it('L-Ecke wird auf Gehrung geschnitten', () => {
    const a = newWall(v(0, 0), v(4, 0), 'exterior', 0.2);
    const b = newWall(v(4, 0), v(4, 3), 'exterior', 0.2);
    const pts = wallOutlines([a, b]).get(a.id)!.poly.map((p) => [Math.round(p.x * 1000) / 1000, Math.round(p.y * 1000) / 1000]);
    expect(pts).toContainEqual([4.1, -0.1]);
    expect(pts).toContainEqual([3.9, 0.1]);
  });

  it('Rechteckräume teilen Wände, Raumfläche exakt an der Wandoberfläche, Wandart automatisch', () => {
    const p = newProject();
    const f = p.floors[0];
    addRectRoom(p, f, v(0, 0), v(4, 3), 0.2, 'wohnen', 'A');
    addRectRoom(p, f, v(4, 0), v(7, 3), 0.2, 'kueche', 'B');
    expect(f.rooms).toHaveLength(2);
    expect(f.walls.filter((w) => Math.abs(w.a.x - 4) < 1e-6 && Math.abs(w.b.x - 4) < 1e-6)).toHaveLength(1);
    expect(f.walls).toHaveLength(7);
    expect(area(f.rooms[0].polygon)).toBeCloseTo(3.8 * 2.8, 2);
    normalizeProject(p);
    expect(f.walls.filter((w) => w.kind === 'interior')).toHaveLength(1);
    expect(f.walls.filter((w) => w.kind === 'exterior')).toHaveLength(6);
    addWallChain(f, [v(2, 3), v(2, 6)], 0.2);
    expect(f.walls.filter((w) => Math.abs(w.a.y - 3) < 1e-6 && Math.abs(w.b.y - 3) < 1e-6).length).toBe(3);
  });

  it('angebaute Seite wird Haustrennwand, Heizlast mit Nachbartemperatur', () => {
    const p = newProject();
    const f = p.floors[0];
    addRectRoom(p, f, v(0, 0), v(5, 4), 0.3, 'wohnen', 'Wohnen');
    normalizeProject(p);
    const before = roomHeatLoad(p, f.rooms[0], f, buildContext(p));
    p.site.attached = ['O'];
    normalizeProject(p);
    expect(f.walls.filter((w) => w.kind === 'party')).toHaveLength(1);
    const after = roomHeatLoad(p, f.rooms[0], f, buildContext(p));
    expect(after.partyWalls).toBeGreaterThan(0);
    expect(after.total).toBeLessThan(before.total);
  });

  it('Wohnung im Zwischengeschoss: Boden und Decke gegen Nachbarwohnungen', () => {
    const p = newProject();
    const f = p.floors[0];
    addRectRoom(p, f, v(0, 0), v(6, 5), 0.3, 'wohnen', 'Wohnen');
    normalizeProject(p);
    p.site.houseType = 'whg';
    p.site.unitPosition = 'middle';
    const hl = roomHeatLoad(p, f.rooms[0], f, buildContext(p));
    expect(hl.floorParts['über Nachbarwohnung']).toBeTruthy();
    expect(hl.ceilingParts['unter Nachbarwohnung']).toBeTruthy();
    expect(hl.floorParts['Erdreich']).toBeUndefined();
  });

  it('eigener Wandaufbau ändert den Verlust nur dieser Wand', () => {
    const p = newProject();
    const f = p.floors[0];
    addRectRoom(p, f, v(0, 0), v(5, 4), 0.3, 'wohnen', 'R');
    normalizeProject(p);
    const r = f.rooms[0];
    const base = roomHeatLoad(p, r, f, buildContext(p)).extWall;
    f.walls[0].construction = constructionFromTemplate('aw_vollziegel_25');
    const worse = roomHeatLoad(p, r, f, buildContext(p)).extWall;
    expect(worse).toBeGreaterThan(base * 1.3);
  });
});

describe('Treppen und Deckenöffnungen', () => {
  it('Steigungen aus der Geschosshöhe, Treppenloch im Geschoss darüber', () => {
    const s = newStair('straight', v(2, 2));
    s.length = 4.3;
    const g = stairGeometry(s, 2.8);
    expect(g.steps).toBe(16);
    expect(g.treads[g.steps - 1].z).toBeCloseTo(2.8, 6);
    const p = newProject();
    p.floors[0].stairs.push(s);
    p.floors.push(newFloor('OG', 2.9));
    normalizeProject(p);
    expect(p.floors[1].voids).toHaveLength(1);
    expect(p.floors[1].voids[0].stairId).toBe(s.id);
    p.floors[0].stairs = [];
    normalizeProject(p);
    expect(p.floors[1].voids).toHaveLength(0);
  });
});

describe('Format übertragen', () => {
  it('Bauteile: Raumart und Aufbau, Heizflächen: Heizflächen', () => {
    const p = newProject();
    const f = p.floors[0];
    addRectRoom(p, f, v(0, 0), v(4, 3), 0.2, 'bad', 'Bad');
    addRectRoom(p, f, v(4, 0), v(7, 3), 0.2, 'wohnen', 'Gäste');
    const [a, b] = f.rooms;
    a.surfaces.push({ ...a.surfaces[0], id: 'x', kind: 'ceiling', system: 'ceiling_wet' });
    const fmtParts = pickFormat(f, { kind: 'room', id: a.id }, 'parts')!;
    expect(applyFormat(p, f, fmtParts, { kind: 'room', id: b.id })).toBe(true);
    expect(b.type).toBe('bad');
    expect(b.thetaI).toBe(24);
    const fmtHeat = pickFormat(f, { kind: 'room', id: a.id }, 'heating')!;
    applyFormat(p, f, fmtHeat, { kind: 'room', id: b.id });
    expect(b.surfaces.map((s) => s.kind).sort()).toEqual(['ceiling', 'floor']);
    expect(applyFormat(p, f, fmtHeat, { kind: 'wall', id: f.walls[0].id })).toBe(false);
  });
});

describe('Standort und Klima', () => {
  it('am Stationsort deren Werte, mit Höhenkorrektur', () => {
    const e = estimateClimate(50.11, 8.68, 112);
    expect(e.thetaE).toBeCloseTo(-12, 0);
    expect(e.stations[0].key).toBe('frankfurt');
    const high = estimateClimate(50.11, 8.68, 712);
    expect(high.thetaE).toBeCloseTo(e.thetaE - 3, 1);
  });
});

describe('Austausch', () => {
  it('Beispielhaus: DXF schreiben und lesen', () => {
    const { project } = createSampleProject();
    const d = parseDxf(exportDxf(project, project.floors[0]));
    expect(d.unit).toBe(1);
    expect(d.segments.length).toBeGreaterThan(100);
    expect(d.layers).toContain('WAENDE');
    expect(d.texts.some((t) => t.text.startsWith('Küche'))).toBe(true);
  });

  it('Beispielhaus: Heizkreise, Treppenloch, Wandarten', () => {
    const { project: p } = createSampleProject();
    const [eg, og] = p.floors;
    expect(og.voids.filter((x) => x.stairId)).toHaveLength(1);
    expect(eg.walls.filter((w) => w.kind === 'exterior').length).toBeGreaterThanOrEqual(8);
    expect(eg.walls.some((w) => w.openings.some((o) => o.kind === 'entrance'))).toBe(true);
    expect(eg.rooms.map((r) => r.type)).toEqual(expect.arrayContaining(['kueche', 'flur', 'wc', 'technik', 'wohnen']));
    const ctx = buildContext(p);
    const total = eg.rooms.reduce((a, r) => a + roomHeatLoad(p, r, eg, ctx).total, 0);
    expect(total).toBeGreaterThan(1500);
    expect(p.floors.flatMap((f) => f.routes).length).toBeGreaterThan(3);
  });

  it('HausCAD-Datei wird übernommen', () => {
    const src = {
      format: 'hauscad',
      version: 1,
      name: 'Test',
      levels: [
        {
          id: 'L1',
          name: 'EG',
          elevation: 0,
          height: 2.8,
          floorThickness: 0.25,
          visible: true,
          walls: [
            { id: 'w1', a: v(0, 0), b: v(4, 0), thickness: 0.3, height: null, colorLeft: '#fff', colorRight: '#eee', openings: [{ id: 'o1', type: 'window', offset: 2, width: 1.2, height: 1.3, sill: 0.9, side: 'left', hinge: 'a', color: '#fff' }] },
            { id: 'w2', a: v(4, 0), b: v(4, 3), thickness: 0.3, height: null, openings: [] },
            { id: 'w3', a: v(4, 3), b: v(0, 3), thickness: 0.3, height: null, openings: [] },
            { id: 'w4', a: v(0, 3), b: v(0, 0), thickness: 0.3, height: null, openings: [] },
          ],
          rooms: [{ id: 'r1', name: 'Bad', polygon: [v(0.15, 0.15), v(3.85, 0.15), v(3.85, 2.85), v(0.15, 2.85)], floorFinish: 'fliesen', floorColor: '#ddd', ceilingColor: '#fff', showFloor: true, showCeiling: true, labelOffset: v(0, 0) }],
          furniture: [{ id: 'f1', catalog: 'manifold', name: 'HKV', pos: v(1, 1), angle: 0, width: 0.75, depth: 0.15, height: 0.75, elevation: 0.3, color: '#eee', mirrored: false, visible: true }],
          stairs: [],
          dimensions: [],
          labels: [],
          background: null,
        },
      ],
      roof: { type: 'gable', pitch: 30, ridge: 'x', overhang: 0.4, color: '#933', kneeWall: 0.4 },
      settings: { wallThickness: 0.3, wallHeight: 2.5, gridStep: 0.25, showGrid: true, magnetism: true, north: 20, showRoomArea: true, showWallDims: true },
      ground: { show: true, color: '#9a9', level: -0.3 },
    };
    const { project } = fromHausCad(src);
    const f = project.floors[0];
    expect(project.version).toBe(3);
    expect(f.rooms[0].type).toBe('bad');
    expect(f.walls.every((w) => w.kind === 'exterior')).toBe(true);
    expect(f.walls[0].openings[0].kind).toBe('window');
    expect(f.manifolds).toHaveLength(1);
    expect(project.site.north).toBe(20);
    expect(project.terrain.gradeLow).toBe(-0.3);
  });
});
