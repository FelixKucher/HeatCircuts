import { describe, expect, it } from 'vitest';
import { recognizeFromGray, orthogonalize, DEFAULT_RECOGNIZE } from '../src/geometry/recognize';
import { area, v } from '../src/geometry/geom';

/** Synthetischer Grundriss: 10 × 8 m, Außenwand 36,5 cm, Innenwand 11,5 cm, Tür 0,9 m, Fenster als Dünnlinien, Text */
function plan(res: number) {
  const margin = 1;
  const W = Math.round((10 + 2 * margin) / res);
  const H = Math.round((8 + 2 * margin) / res);
  const g = new Uint8Array(W * H).fill(255);
  const rect = (x0: number, y0: number, x1: number, y1: number, val = 0) => {
    for (let j = Math.floor((y0 + margin) / res); j < Math.ceil((y1 + margin) / res); j++)
      for (let i = Math.floor((x0 + margin) / res); i < Math.ceil((x1 + margin) / res); i++) if (i >= 0 && j >= 0 && i < W && j < H) g[j * W + i] = val;
  };
  const t = 0.365 / 2;
  rect(-t, -t, 10 + t, t); // oben
  rect(-t, 8 - t, 10 + t, 8 + t); // unten
  rect(-t, -t, t, 8 + t); // links
  rect(10 - t, -t, 10 + t, 8 + t); // rechts
  // Fensteröffnung oben (1,2 m) mit Dünnlinien
  rect(3, -t, 4.2, t, 255);
  rect(3, -0.01, 4.2, 0.01, 0);
  // Innenwand x = 6 mit Tür 0,9 m
  rect(6 - 0.0575, 0, 6 + 0.0575, 4.5);
  rect(6 - 0.0575, 5.4, 6 + 0.0575, 8);
  // Türbogen und Text (dünn)
  for (let a = 0; a < Math.PI / 2; a += 0.01) rect(6 + Math.cos(a) * 0.9 - 0.01, 4.5 + Math.sin(a) * 0.9 - 0.01, 6 + Math.cos(a) * 0.9 + 0.01, 4.5 + Math.sin(a) * 0.9 + 0.01, 0);
  rect(2, 3, 3.5, 3.02, 0);
  rect(2, 3.2, 3.2, 3.22, 0);
  return { g, W, H, origin: v(-margin, -margin) };
}

describe('Grundrisserkennung', () => {
  it('erkennt zwei Räume, Außen- und Innenwände sowie Tür und Fenster', () => {
    const res = 0.025;
    const { g, W, H, origin } = plan(res);
    const r = recognizeFromGray(g, W, H, origin, { ...DEFAULT_RECOGNIZE, res });
    expect(r.rooms.length).toBe(2);
    const areas = r.rooms.map((x) => x.area).sort((a, b) => a - b);
    // links: (6 − 0,1825 − 0,0575) × (8 − 0,365) ≈ 5,76 × 7,635 ≈ 44,0; rechts ≈ 3,76 × 7,635 ≈ 28,7
    expect(areas[0]).toBeGreaterThan(27.5);
    expect(areas[0]).toBeLessThan(29.8);
    expect(areas[1]).toBeGreaterThan(42.8);
    expect(areas[1]).toBeLessThan(45.2);
    for (const room of r.rooms) expect(room.polygon.length).toBe(4);
    const ext = r.walls.filter((w) => w.kind === 'exterior');
    const int = r.walls.filter((w) => w.kind === 'interior');
    expect(ext.length).toBeGreaterThanOrEqual(4);
    expect(int.length).toBeGreaterThanOrEqual(1);
    for (const w of ext) expect(w.thickness).toBeGreaterThan(0.3);
    const doors = int.flatMap((w) => w.openings).filter((o) => o.kind === 'door');
    const windows = ext.flatMap((w) => w.openings).filter((o) => o.kind === 'window');
    expect(doors.length).toBe(1);
    expect(doors[0].width).toBeGreaterThan(0.8);
    expect(windows.length).toBe(1);
    expect(windows[0].width).toBeGreaterThan(1.1);
  });

  it('Orthogonalisierung richtet leicht schiefe Kanten aus', () => {
    const p = orthogonalize([v(0, 0), v(4, 0.05), v(4.03, 3), v(0, 2.98)]);
    expect(p.length).toBe(4);
    expect(area(p)).toBeCloseTo(4 * 3, 0);
    for (let i = 0; i < 4; i++) {
      const a = p[i];
      const b = p[(i + 1) % 4];
      const dx = Math.abs(b.x - a.x);
      const dy = Math.abs(b.y - a.y);
      expect(Math.min(dx, dy) / Math.max(dx, dy)).toBeLessThan(0.02);
    }
  });
});

describe('Nischen', () => {
  it('rechteckige Ausbuchtung in eine Fensteröffnung wird entfernt, schmale Räume bleiben vollständig', async () => {
    const { removeNotches } = await import('../src/geometry/recognize');
    // Raum 2,4 × 3 m mit 1,2 m breiter, 0,36 m tiefer Ausbuchtung nach oben (y negativ)
    const poly = [v(0, 0), v(0.6, 0), v(0.6, -0.36), v(1.8, -0.36), v(1.8, 0), v(2.4, 0), v(2.4, 3), v(0, 3)];
    const out = removeNotches(poly);
    expect(out.length).toBe(4);
    expect(area(out)).toBeCloseTo(7.2, 6);
    // nach innen gerichtete Einbuchtung (Wandvorsprung) bleibt
    const inward = [v(0, 0), v(0.6, 0), v(0.6, 0.36), v(1.8, 0.36), v(1.8, 0), v(2.4, 0), v(2.4, 3), v(0, 3)];
    expect(removeNotches(inward).length).toBe(8);
  });
});
