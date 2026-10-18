import { describe, expect, it } from 'vitest';
import { kH, logMeanExcess, sigmaFor, supplyExcess, fluxFromSurface } from '../src/calc/en1264';
import { pipeFlow } from '../src/calc/hydraulics';
import { computeDesign } from '../src/calc/design';
import { buildContext, roomHeatLoad, uSlabOnGround } from '../src/calc/heatload';
import { surfaceKH } from '../src/calc/surfaces';
import { autoLayout } from '../src/calc/autolayout';
import { floorShort, newFloor, newProject, newRoom, newSurface, newWall, migrateProject, applyYearBuilt } from '../src/model/factory';
import { uValue, CONSTRUCTION_TEMPLATES } from '../src/model/constructions';
import { v } from '../src/geometry/geom';

describe('EN 1264', () => {
  it('Grenzwärmestromdichte bei 29 °C / 20 °C ≈ 100 W/m²', () => {
    expect(fluxFromSurface(29, 20)).toBeCloseTo(100, 0);
  });

  it('K_H Fliesen größer als Parkett, enger Abstand größer als weiter', () => {
    const base = { screedCover: 0.045, lambdaScreed: 1.2, pipeOuter: 0.016 };
    const tile = kH({ ...base, spacing: 0.15, rLambdaB: 0.02 });
    const parquet = kH({ ...base, spacing: 0.15, rLambdaB: 0.1 });
    const dense = kH({ ...base, spacing: 0.1, rLambdaB: 0.02 });
    expect(tile).toBeGreaterThan(parquet);
    expect(dense).toBeGreaterThan(tile);
    expect(tile).toBeGreaterThan(4.3);
    expect(tile).toBeLessThan(5.6);
  });

  it('Spreizung und Vorlauf sind zueinander konsistent', () => {
    const dh = 12;
    const a = supplyExcess(dh, 5);
    expect(logMeanExcess(20 + a, 20 + a - 5, 20)).toBeCloseTo(dh, 6);
    expect(sigmaFor(20 + a, 20, dh)).toBeCloseTo(5, 4);
    expect(sigmaFor(30, 20, 11)).toBeNull();
  });
});

describe('Hydraulik', () => {
  it('Druckverlust 16×2, 120 kg/h im üblichen Bereich', () => {
    const pf = pipeFlow(120, 0.012, 80);
    expect(pf.velocity).toBeGreaterThan(0.25);
    expect(pf.velocity).toBeLessThan(0.35);
    expect(pf.gradient).toBeGreaterThan(120);
    expect(pf.gradient).toBeLessThan(280);
  });
});

describe('Bauteile', () => {
  it('U-Werte der Vorlagen liegen in plausiblen Bereichen', () => {
    const u = (k: string) => uValue(CONSTRUCTION_TEMPLATES[k].slot, CONSTRUCTION_TEMPLATES[k].layers);
    expect(u('aw_vollziegel_38')).toBeGreaterThan(1.1);
    expect(u('aw_vollziegel_38')).toBeLessThan(1.6);
    expect(u('aw_plz_365_009')).toBeGreaterThan(0.2);
    expect(u('aw_plz_365_009')).toBeLessThan(0.28);
    expect(u('aw_ks_wdvs')).toBeLessThan(0.22);
    expect(u('da_geg')).toBeLessThan(0.16);
  });

  it('Baujahr setzt Konstruktionen und Fenster', () => {
    const p = newProject();
    applyYearBuilt(p.building, 1965);
    expect(p.building.uExtWall).toBeGreaterThan(1.0);
    expect(p.building.uWindow).toBeGreaterThan(2.5);
    applyYearBuilt(p.building, 2024);
    expect(p.building.uExtWall).toBeLessThan(0.25);
    expect(p.building.uWindow).toBeLessThan(1.0);
  });

  it('Bodenplatte nach EN ISO 13370: U_equiv kleiner als Bauteil-U bei ungedämmter Platte', () => {
    // B' = 5 m, d_t ≈ 0,3 + 2·0,3 = 0,9 m
    const u = uSlabOnGround(5, 0.9);
    expect(u).toBeGreaterThan(0.4);
    expect(u).toBeLessThan(0.8);
  });
});

function setup() {
  const p = newProject();
  const f = p.floors[0];
  f.walls = [
    newWall(v(0, 0), v(5, 0), 'exterior', 0.365),
    newWall(v(5, 0), v(5, 4), 'exterior', 0.365),
    newWall(v(5, 4), v(0, 4), 'exterior', 0.365),
    newWall(v(0, 4), v(0, 0), 'exterior', 0.365),
  ];
  f.walls[0].openings.push({ id: 'o1', kind: 'window', offset: 2.5, width: 2, height: 1.4, sill: 0.9 });
  const poly = [v(0.1825, 0.1825), v(4.8175, 0.1825), v(4.8175, 3.8175), v(0.1825, 3.8175)];
  const r = newRoom(p, f, poly, 'wohnen');
  f.rooms.push(r);
  return { p, f, r };
}

describe('Heizlast und Auslegung', () => {
  it('Fenster aus Wandöffnungen, Boden gegen Erdreich, Dach', () => {
    const { p, f, r } = setup();
    const hl = roomHeatLoad(p, r, f, buildContext(p));
    expect(hl.windowArea).toBeCloseTo(2.8, 6);
    expect(hl.floorParts['Erdreich'].area).toBeGreaterThan(16);
    expect(Object.keys(hl.ceilingParts)[0]).toBe('oberste Geschossdecke');
    expect(hl.total).toBeGreaterThan(500);
    expect(hl.total).toBeLessThan(2500);
  });

  it('ohne Verteiler keine Heizkreise, mit Verteiler Kreise und Abgleich', () => {
    const { p, f, r } = setup();
    let d = computeDesign(p);
    expect(d.rooms.get(r.id)!.circuits.length).toBe(0);
    expect(d.rooms.get(r.id)!.warnings).toContain('no-manifold');
    f.manifolds.push({ id: 'm1', name: 'HKV', pos: v(4.6, 3.6), supplyLengthOverride: null, maxOutlets: 12 });
    d = computeDesign(p);
    const rr = d.rooms.get(r.id)!;
    expect(rr.circuits.length).toBeGreaterThanOrEqual(1);
    expect(d.thetaSupply).toBeGreaterThan(24);
    expect(d.thetaSupply).toBeLessThan(45);
    expect(Math.abs(rr.surfaces[0].sigma - 5)).toBeLessThan(0.3);
    expect(d.manifolds[0].outlets).toBe(rr.circuits.length);
  });

  it('Treppenöffnung reduziert die Fußbodenfläche im Obergeschoss', () => {
    const { p } = setup();
    const og = newFloor('OG', 2.9);
    og.walls = p.floors[0].walls.map((w) => newWall(w.a, w.b, w.kind, w.thickness));
    const ro = newRoom(p, og, p.floors[0].rooms[0].polygon, 'flur');
    og.rooms.push(ro);
    og.voids.push({ id: 'v1', kind: 'stair', polygon: [v(1, 1), v(2, 1), v(2, 3.5), v(1, 3.5)] });
    p.floors.push(og);
    og.manifolds.push({ id: 'm2', name: 'HKV OG', pos: v(4.6, 3.6), supplyLengthOverride: null, maxOutlets: 12 });
    const d = computeDesign(p);
    const rr = d.rooms.get(ro.id)!;
    expect(rr.heatLoad.voidArea).toBeGreaterThan(2.3);
    expect(rr.heatLoad.voidArea).toBeLessThan(2.7);
    expect(rr.surfaces[0].area).toBeCloseTo(rr.area - rr.heatLoad.voidArea, 3);
    // EG-Decke unter beheiztem OG: keine Dachverluste mehr, nur Wärmestrom zum kühleren Flur (15 °C)
    const eg = d.rooms.get(p.floors[0].rooms[0].id)!;
    expect(eg.heatLoad.ceilingParts['oberste Geschossdecke']).toBeUndefined();
    const toFlur = Object.entries(eg.heatLoad.ceilingParts).find(([k]) => k.startsWith('unter'))!;
    expect(toFlur[1].area).toBeLessThan(eg.area - 2.3);
  });

  it('Garage unter einem Raum erhöht dessen Bodenverlust', () => {
    const { p } = setup();
    p.floors[0].rooms[0].type = 'garage';
    p.floors[0].rooms[0].heated = false;
    const og = newFloor('OG', 2.9);
    og.walls = p.floors[0].walls.map((w) => newWall(w.a, w.b, w.kind, w.thickness));
    const ro = newRoom(p, og, p.floors[0].rooms[0].polygon, 'kind');
    og.rooms.push(ro);
    p.floors.push(og);
    const d = computeDesign(p);
    const parts = d.rooms.get(ro.id)!.heatLoad.floorParts;
    expect(Object.keys(parts)[0]).toContain('über');
    expect(Object.values(parts)[0].loss).toBeGreaterThan(50);
  });

  it('mehrere Heizflächen: Wandheizung übernimmt einen Lastanteil', () => {
    const { p, f, r } = setup();
    f.manifolds.push({ id: 'm1', name: 'HKV', pos: v(4.6, 3.6), supplyLengthOverride: null, maxOutlets: 12 });
    const s = newSurface('wall', 'wall_wet', 0.1);
    s.wallId = f.walls[3].id;
    r.surfaces.push(s);
    const rr = computeDesign(p).rooms.get(r.id)!;
    expect(rr.surfaces.length).toBe(2);
    expect(rr.surfaces[1].area).toBeGreaterThan(4);
    expect(rr.surfaces[1].load).toBeGreaterThan(0);
    expect(rr.surfaces[0].load + rr.surfaces[1].load).toBeCloseTo(rr.heatLoad.total, 3);
  });

  it('Elektro-Fußbodenheizung: installierte Leistung und Stromkreise, keine Wasserkreise', () => {
    const { p, r } = setup();
    r.surfaces = [{ ...newSurface('floor', 'electric'), electricPower: 150 }];
    const sr = computeDesign(p).rooms.get(r.id)!.surfaces[0];
    expect(sr.electric!.installed).toBeCloseTo(150 * sr.area, 3);
    expect(sr.circuits.length).toBe(0);
  });

  it('Fräs-System leistet bei gleichem Abstand mehr als Nasssystem (geringe Überdeckung)', () => {
    const { p, r } = setup();
    const wet = surfaceKH(newSurface('floor', 'wet', 0.1), r, p.design);
    const milled = surfaceKH(newSurface('floor', 'milled', 0.1), r, p.design);
    expect(milled).toBeGreaterThan(wet);
  });

  it('automatische Verteilung ordnet zu und wählt Abstände aus der Liste', () => {
    const { p, f, r } = setup();
    f.manifolds.push({ id: 'm1', name: 'HKV', pos: v(4.6, 3.6), supplyLengthOverride: null, maxOutlets: 12 });
    p.design.allowedSpacings = [0.1, 0.15, 0.2];
    const rep = autoLayout(p);
    expect(rep.assigned).toBe(1);
    expect(r.manifoldId).toBe('m1');
    expect([0.1, 0.15, 0.2]).toContain(r.surfaces[0].spacing);
  });

  it('Migration v1 → v2', () => {
    const v1 = { version: 1, name: 'Alt', floors: [{ id: 'f', name: 'EG', elevation: 0, storeyHeight: 2.9, clearHeight: 2.5, background: null, walls: [{ id: 'w', a: v(0, 0), b: v(1, 0), thickness: 0.3, kind: 'exterior' }], rooms: [{ id: 'r', name: 'R', type: 'wohnen', polygon: [], heated: true, spacing: 0.1, pattern: 'meander' }], manifolds: [], routes: [] }] };
    const p = migrateProject(v1);
    expect(p.version).toBe(2);
    expect(p.floors[0].walls[0].openings).toEqual([]);
    expect(p.floors[0].rooms[0].surfaces[0].spacing).toBe(0.1);
    expect(p.floors[0].rooms[0].surfaces[0].pattern).toBe('meander');
  });
});

describe('Hilfsfunktionen', () => {
  it('Geschosskürzel', () => {
    expect(floorShort('Erdgeschoss')).toBe('EG');
    expect(floorShort('Obergeschoss')).toBe('OG');
    expect(floorShort('2. Obergeschoss')).toBe('2.OG');
    expect(floorShort('Dachgeschoss')).toBe('DG');
    expect(floorShort('Kellergeschoss')).toBe('KG');
  });
});
