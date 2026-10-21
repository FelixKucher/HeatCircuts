import { describe, expect, it } from 'vitest';
import { migrateProject, newFloor, newProject, newWall } from '../src/model/factory';
import { wallOutlines } from '../src/cad/walls';
import { addRectRoom, addWallChain } from '../src/cad/edit';
import { applyFormat, pickFormat } from '../src/cad/painter';
import { exportDxf, parseDxf } from '../src/io/dxf';
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

describe('Migration ohne Haus-CAD', () => {
  it('verwirft Möbel und Treppen, Treppenlöcher bleiben als Aussparung', () => {
    const p = newProject();
    p.floors.push(newFloor('OG', 2.9));
    const raw = JSON.parse(JSON.stringify(p));
    raw.floors[0].furniture = [{ id: 'f1' }];
    raw.floors[0].stairs = [{ id: 's1' }];
    raw.floors[1].voids = [{ id: 'v-s1', stairId: 's1', kind: 'stair', polygon: [v(1, 1), v(2, 1), v(2, 4), v(1, 4)] }];
    const m = migrateProject(raw);
    expect('furniture' in m.floors[0]).toBe(false);
    expect('stairs' in m.floors[0]).toBe(false);
    expect(m.floors[1].voids).toHaveLength(1);
    expect('stairId' in m.floors[1].voids[0]).toBe(false);
    normalizeProject(m);
    expect(m.floors[1].voids).toHaveLength(1);
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
    expect(og.voids.filter((x) => x.kind === 'stair')).toHaveLength(1);
    expect(eg.walls.filter((w) => w.kind === 'exterior').length).toBeGreaterThanOrEqual(8);
    expect(eg.walls.some((w) => w.openings.some((o) => o.kind === 'entrance'))).toBe(true);
    expect(eg.rooms.map((r) => r.type)).toEqual(expect.arrayContaining(['kueche', 'flur', 'wc', 'technik', 'wohnen']));
    const ctx = buildContext(p);
    const total = eg.rooms.reduce((a, r) => a + roomHeatLoad(p, r, eg, ctx).total, 0);
    expect(total).toBeGreaterThan(1500);
    expect(p.floors.flatMap((f) => f.routes).length).toBeGreaterThan(3);
  });
});
