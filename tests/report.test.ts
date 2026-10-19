import { describe, expect, it } from 'vitest';
import { createSampleProject } from '../src/model/sample';
import { computeDesign } from '../src/calc/design';
import { buildReportHtml } from '../src/io/report';
import { normDesignDefaults, normRows } from '../src/model/norms';
import { dimensionSvg } from '../src/ui/plan-render';

describe('Auslegungsbericht DIN A4', () => {
  const { project, images } = createSampleProject();
  const design = computeDesign(project);
  const html = buildReportHtml(project, design, images);

  it('setzt A4 hoch und enthält alle Abschnitte', () => {
    expect(html).toContain('size: A4 portrait');
    for (const h of ['Grundlagen', 'Bauteile und U-Werte', 'Norm-Heizlast je Raum', 'Temperaturen und Heizflächen', 'Heizkreise und hydraulischer Abgleich', 'Verteiler, Zuleitungen, Material', 'Normwerte, Annahmen, Hinweise']) expect(html).toContain(h);
  });

  it('enthält je Geschoss einen Plan und jeden Heizkreis', () => {
    for (const f of project.floors) expect(html).toContain(`Plan ${f.name}`);
    const circuits = [...design.rooms.values()].flatMap((r) => r.circuits);
    expect(circuits.length).toBeGreaterThan(0);
    for (const c of circuits) expect(html).toContain(c.label);
    expect(html).not.toContain('<?xml');
  });
});

describe('Normwerte', () => {
  it('führt Druckverlust 250 mbar als Praxiswert mit Quelle', () => {
    const { project } = createSampleProject();
    const dp = normRows(project).find((r) => r.label.includes('Druckverlust'))!;
    expect(dp.value).toBe('250 mbar');
    expect(dp.status).toBe('praxis');
    expect(dp.source).toMatch(/250 mbar/);
  });

  it('setzt die Auslegung auf europäische Vorgaben zurück', () => {
    const { project } = createSampleProject();
    project.design.maxPressureDrop = 40000;
    project.design.sigmaDesign = 8;
    Object.assign(project.design, normDesignDefaults(project.design));
    expect(project.design.maxPressureDrop).toBe(25000);
    expect(project.design.sigmaDesign).toBe(5);
  });
});

describe('Live-Bemaßung', () => {
  it('skaliert den Schrift-Halo mit dem Zoom (kein meterbreiter Balken)', () => {
    const svg = dimensionSvg({ x: 0, y: 0 }, { x: 5, y: 0 }, 0.45, 60, ' live');
    const w = Number(svg.match(/stroke-width:([\d.]+)px/)![1]);
    expect(w).toBeCloseTo(3 / 60, 3);
  });
});
