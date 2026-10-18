import { describe, expect, it } from 'vitest';
import { kH, logMeanExcess, sigmaFor, supplyExcess, fluxFromSurface } from '../src/calc/en1264';
import { pipeFlow } from '../src/calc/hydraulics';
import { computeDesign } from '../src/calc/design';
import { roomHeatLoad } from '../src/calc/heatload';
import { newFloor, newProject, newRoom, newWall } from '../src/model/factory';
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
    // Plausibilität gegenüber üblichen Herstellerkennlinien (Fliesen, VA 15: ~5 W/m²K)
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
  it('Druckverlust 16×2, 120 kg/h, 80 m im üblichen Bereich', () => {
    const pf = pipeFlow(120, 0.012, 80);
    expect(pf.velocity).toBeGreaterThan(0.25);
    expect(pf.velocity).toBeLessThan(0.35);
    // typ. 150–250 Pa/m
    expect(pf.gradient).toBeGreaterThan(120);
    expect(pf.gradient).toBeLessThan(280);
  });
});

describe('Heizlast und Auslegung', () => {
  const setup = () => {
    const p = newProject();
    const f = p.floors[0];
    f.walls = [
      newWall(v(0, 0), v(5, 0), 'exterior', 0.365),
      newWall(v(5, 0), v(5, 4), 'interior', 0.115),
      newWall(v(5, 4), v(0, 4), 'interior', 0.115),
      newWall(v(0, 4), v(0, 0), 'exterior', 0.365),
    ];
    const poly = [v(0.1825, 0.1825), v(4.9425, 0.1825), v(4.9425, 3.9425), v(0.1825, 3.9425)];
    const r = newRoom(p, f, poly, 'wohnen');
    r.windowArea = 4;
    f.rooms.push(r);
    f.manifolds.push({ id: 'm1', name: 'HKV', pos: v(4.9, 3.9), supplyLengthOverride: null });
    return { p, f, r };
  };

  it('Außenwandlänge wird aus den gezeichneten Wänden ermittelt', () => {
    const { p, f, r } = setup();
    const hl = roomHeatLoad(r, f, p.building);
    expect(hl.extWallLengthAuto).toBeCloseTo(4.76 + 3.76, 2);
    expect(hl.total).toBeGreaterThan(500);
    expect(hl.total).toBeLessThan(2500);
  });

  it('Auslegung liefert Vorlauftemperatur, Kreise und Abgleich', () => {
    const { p, r } = setup();
    const d = computeDesign(p);
    const rr = d.rooms.get(r.id)!;
    expect(d.thetaSupply).toBeGreaterThan(24);
    expect(d.thetaSupply).toBeLessThan(45);
    expect(Math.abs(rr.sigma - 5)).toBeLessThan(0.3); // Vorlauf wird auf 0,1 K aufgerundet
    expect(rr.circuits.length).toBeGreaterThanOrEqual(1);
    const total = rr.circuits.reduce((a, c) => a + c.lengthInRoom, 0);
    expect(total).toBeCloseTo(rr.activeArea / r.spacing, 3);
    expect(d.manifolds[0].outlets).toBe(rr.circuits.length);
  });

  it('Kreis wird bei Überschreitung der Maximallänge geteilt', () => {
    const { p, r } = setup();
    r.spacing = 0.1;
    p.design.maxCircuitLength = 80;
    const rr = computeDesign(p).rooms.get(r.id)!;
    expect(rr.circuits.length).toBe(3);
    for (const c of rr.circuits) expect(c.length).toBeLessThanOrEqual(80);
  });

  it('zweites Geschoss: Zuleitung enthält Höhendifferenz', () => {
    const { p } = setup();
    const og = newFloor('OG', 2.9);
    p.floors.push(og);
    og.manifolds.push({ id: 'm2', name: 'HKV OG', pos: v(1, 1), supplyLengthOverride: null });
    p.heatSource = { floorId: p.floors[0].id, pos: v(4, 3), name: 'WP', type: 'wp_luft' };
    const d = computeDesign(p);
    const m2 = d.manifolds.find((m) => m.manifoldId === 'm2')!;
    expect(m2.supplyLengthAuto).toBeCloseTo(3 + 2 + 2.9, 6);
  });
});

describe('Hilfsfunktionen', () => {
  it('Geschosskürzel', async () => {
    const { floorShort } = await import('../src/model/factory');
    expect(floorShort('Erdgeschoss')).toBe('EG');
    expect(floorShort('Obergeschoss')).toBe('OG');
    expect(floorShort('2. Obergeschoss')).toBe('2.OG');
    expect(floorShort('Dachgeschoss')).toBe('DG');
    expect(floorShort('Kellergeschoss')).toBe('KG');
  });
});
