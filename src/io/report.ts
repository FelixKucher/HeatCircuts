// Auslegungsbericht als druckfertiges HTML (DIN A4 hoch): Grundlagen, Heizlast, Temperaturen,
// Heizflächen, Heizkreise mit Einstellwerten, Verteiler, Material, Pläne, Normwerte.
import type { ConstructionSlot, ImageStore, Project } from '../model/types';
import type { DesignResult, RoomResult } from '../calc/design';
import { HEAT_SOURCE_TYPES, PIPES, SCREEDS, SURFACE_LIMITS, BATHROOM_TYPES } from '../model/catalog';
import { MATERIALS, SURFACE_RESISTANCE, WINDOW_TYPES } from '../model/constructions';
import { HEATING_SYSTEMS, SURFACE_LABEL } from '../model/systems';
import { NORM_STATUS, normRows } from '../model/norms';
import { WARNING_TEXT } from '../ui/props';
import { esc, level, num } from '../ui/format';
import { exportFloorSvg } from './export';

export const HOUSE_LABEL: Record<string, string> = {
  efh: 'Einfamilienhaus',
  dhh: 'Doppelhaushälfte',
  rmh: 'Reihenmittelhaus',
  reh: 'Reihenendhaus',
  bungalow: 'Bungalow',
  villa: 'Stadtvilla',
  mfh: 'Mehrfamilienhaus',
  whg: 'Wohnung',
};

const ROOF_LABEL: Record<string, string> = { gable: 'Satteldach', hip: 'Walmdach', shed: 'Pultdach', flat: 'Flachdach', none: 'ohne Dach' };

const n = (x: number, k = 1) => num(x, k);
const td = (v: string | number, r = false) => `<td${r ? ' class="r"' : ''}>${typeof v === 'number' ? v : v}</td>`;

function table(head: string[], rows: (string | number)[][], align: string, foot?: (string | number)[], cls = ''): string {
  const a = (i: number) => align[i] === 'r';
  return `<table class="${cls}"><thead><tr>${head.map((h, i) => `<th${a(i) ? ' class="r"' : ''}>${h}</th>`).join('')}</tr></thead><tbody>${rows
    .map((r) => `<tr>${r.map((v, i) => td(v, a(i))).join('')}</tr>`)
    .join('')}</tbody>${foot ? `<tfoot><tr>${foot.map((v, i) => td(v, a(i))).join('')}</tr></tfoot>` : ''}</table>`;
}

function kv(rows: [string, string][]): string {
  return `<dl class="kv">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>`;
}

function roomOf(p: Project, r: RoomResult) {
  return p.floors.find((f) => f.id === r.floorId)?.rooms.find((x) => x.id === r.roomId);
}

const cssString = (s: string) => `"${s.replace(/["\\]/g, '\\$&').replace(/\n/g, ' ')}"`;

export function buildReportHtml(p: Project, d: DesignResult, images: ImageStore): string {
  const b = p.building;
  const floors = p.floors.slice().sort((x, y) => x.elevation - y.elevation);
  const floorOrder = new Map(floors.map((f, i) => [f.id, i]));
  const floorName = (id: string) => p.floors.find((f) => f.id === id)?.name ?? '';
  const rooms = [...d.rooms.values()].sort((x, y) => (floorOrder.get(x.floorId) ?? 0) - (floorOrder.get(y.floorId) ?? 0));
  const heated = rooms.filter((r) => r.heatLoad.total > 0 || r.hasHeating);
  const date = new Date().toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const designRoom = d.designRoomId ? d.rooms.get(d.designRoomId) : undefined;
  const thetaReturnDesign = d.thetaSupply - d.sigmaDesign;
  const gen = HEAT_SOURCE_TYPES[p.heatSource?.type ?? p.design.generator] ?? HEAT_SOURCE_TYPES[p.design.generator] ?? '–';
  const warnCount = rooms.reduce((s, r) => s + r.warnings.length + r.surfaces.reduce((t, x) => t + x.warnings.length, 0), 0);
  const specific = d.totals.heatedArea > 0 ? d.totals.heatLoad / d.totals.heatedArea : 0;

  // ---------- Deckblatt ----------
  const kpi = (v: string, l: string) => `<div class="kpi"><b>${v}</b><span>${l}</span></div>`;
  const cover = `<section class="page cover">
    <div class="brand">Heat<b>Circuits</b></div>
    <p class="eyebrow">Auslegung Flächenheizung</p>
    <h1>${esc(p.name)}</h1>
    ${kv([
      ['Bauherr', esc(b.client || '–')],
      ['Anschrift', esc(b.address || '–')],
      ['Standort', `${esc(p.site.place || '–')}${p.site.lat != null ? ` · ${n(p.site.lat, 2)}° N, ${n(p.site.lon ?? 0, 2)}° O` : ''} · ${n(p.site.altitude, 0)} m ü. NN`],
      ['Gebäude', `${esc(HOUSE_LABEL[p.site.houseType] ?? p.site.houseType)} · Baujahr ${b.yearBuilt} · ${floors.length} Geschoss${floors.length === 1 ? '' : 'e'}`],
      ['Wärmeerzeuger', esc(gen)],
      ['Planer', esc(b.planner || '–')],
      ['Stand', date],
    ])}
    <div class="kpis">
      ${kpi(`${n(d.totals.heatLoad / 1000, 2)} kW`, 'Norm-Heizlast Φ_HL')}
      ${kpi(`${n(d.totals.heatedArea, 1)} m²`, 'beheizte Fläche')}
      ${kpi(`${n(specific, 0)} W/m²`, 'spezifische Heizlast')}
      ${kpi(`${n(d.thetaSupply, 1)} / ${n(thetaReturnDesign, 1)} °C`, 'Vorlauf / Rücklauf Auslegung')}
      ${kpi(`${d.totals.circuits}`, `Heizkreise an ${d.manifolds.length} Verteiler${d.manifolds.length === 1 ? '' : 'n'}`)}
      ${kpi(`${n(d.totals.pipeTotal, 0)} m`, 'Heizrohr gesamt')}
      ${kpi(`${n(d.totals.massFlow, 0)} kg/h`, 'Massenstrom gesamt')}
      ${kpi(`${n(b.thetaE, 1)} °C`, 'Norm-Außentemperatur θe')}
    </div>
    <h3>Inhalt</h3>
    <ol class="toc"><li>Grundlagen: Standort, Klima, Gebäude</li><li>Bauteile und U-Werte</li><li>Norm-Heizlast je Raum</li><li>Temperaturen und Heizflächen</li><li>Heizkreise und hydraulischer Abgleich</li><li>Verteiler, Zuleitungen, Material</li><li>Pläne je Geschoss</li><li>Normwerte, Annahmen, Hinweise</li></ol>
    <p class="basis">Berechnungsgrundlagen: EN 12831-1 (Norm-Heizlast, vereinfacht) · EN ISO 6946 (U-Werte) · EN ISO 13370 (Erdreich) · EN 1264-2/-3 (Flächenheizung). ${warnCount ? `<b class="warn">${warnCount} Hinweis${warnCount === 1 ? '' : 'e'}</b> – siehe Abschnitt 8.` : 'Keine offenen Hinweise.'}</p>
    <p class="disclaimer">Die Berechnung ersetzt nicht die Prüfung durch eine fachkundige Person. Herstellerangaben des gewählten Systems (Kennlinien, Druckverluste von Ventilen und Verteilern) haben Vorrang.</p>
  </section>`;

  // ---------- 1 Grundlagen ----------
  const g = d.ground;
  const s1 = `<section class="page">
    <h2><span>1</span>Grundlagen</h2>
    <div class="cols">
      <div><h3>Standort und Klima</h3>${kv([
        ['Ort', esc(p.site.place || '–')],
        ['Höhe', `${n(p.site.altitude, 0)} m ü. NN`],
        ['Norm-Außentemperatur θe', `${n(b.thetaE, 1)} °C`],
        ['Jahresmittel θm,e', `${n(b.thetaMeanYear, 1)} °C`],
        ['Nordrichtung', `${n(p.site.north, 0)}° zur Planvertikalen`],
        ['Gelände', p.terrain.type === 'flat' ? 'eben' : `Hanglage, Höhendifferenz ${n(p.terrain.rise, 2)} m, Bergseite ${p.terrain.uphill}`],
      ])}</div>
      <div><h3>Gebäude</h3>${kv([
        ['Gebäudeart', esc(HOUSE_LABEL[p.site.houseType] ?? p.site.houseType)],
        ['Angebaute Seiten', p.site.attached.length ? p.site.attached.join(', ') : 'keine'],
        ['Baujahr', String(b.yearBuilt)],
        ['Keller', b.basement === 'none' ? 'nicht unterkellert' : 'unbeheizt'],
        ['Lüftung', b.heatRecovery ? `mit Wärmerückgewinnung η = ${n(b.etaHR * 100, 0)} %` : 'freie Lüftung'],
        ['Dach', p.roof.type === 'flat' || p.roof.type === 'none' ? ROOF_LABEL[p.roof.type] : `${ROOF_LABEL[p.roof.type]} ${n(p.roof.pitch, 0)}°`],
      ])}</div>
    </div>
    <h3>Geschosse</h3>
    ${table(
      ['Geschoss', 'Höhe OK FFB', 'Geschosshöhe', 'lichte Höhe', 'Räume', 'Fläche [m²]'],
      floors.map((f) => [esc(f.name), level(f.elevation), `${n(f.storeyHeight, 2)} m`, `${n(f.clearHeight, 2)} m`, f.rooms.length, n(rooms.filter((r) => r.floorId === f.id).reduce((s, r) => s + r.area, 0), 1)]),
      'llrrrr',
    )}
    <h3>Erdreich nach EN ISO 13370</h3>
    ${kv([
      ['Bodenplattenfläche A / Umfang P', `${n(g.area, 1)} m² / ${n(g.perimeter, 1)} m`],
      ['charakteristisches Maß B′', `${n(g.bPrime, 2)} m`],
      ['wirksame Dicke d_t', `${n(g.dt, 2)} m`],
      ['U_equiv Bodenplatte', `${n(g.uSlab, 3)} W/(m²·K)`],
    ])}
  </section>`;

  // ---------- 2 Bauteile ----------
  const slots: ConstructionSlot[] = ['extWall', 'roof', 'topSlab', 'groundSlab', 'basementSlab', 'unheatedWall'];
  const uOf: Record<ConstructionSlot, number> = { extWall: b.uExtWall, roof: b.uRoof, topSlab: b.uTopSlab, groundSlab: b.uGroundFloor, basementSlab: b.uUnheatedSlab, unheatedWall: b.uUnheatedWall };
  const layerText = (slot: ConstructionSlot) =>
    b.constructions[slot].layers.map((l) => `${esc(MATERIALS[l.material]?.label ?? l.material)} ${n(l.thickness * 100, 1)} cm`).join(' · ');
  const s2 = `<section class="page">
    <h2><span>2</span>Bauteile und U-Werte</h2>
    ${table(
      ['Bauteil', 'Aufbau (innen → außen)', 'R_si / R_se', 'U [W/(m²·K)]'],
      [
        ...slots.map((s) => [esc(SURFACE_RESISTANCE[s].label), layerText(s), `${n(SURFACE_RESISTANCE[s].rsi, 2)} / ${n(SURFACE_RESISTANCE[s].rse, 2)}`, n(uOf[s], 3)]),
        ['Fenster', esc(WINDOW_TYPES[b.windowType]?.label ?? b.windowType), '–', n(b.uWindow, 2)],
        ['Außentür', '–', '–', n(b.uDoor, 2)],
        ['Innenwand', '–', '–', n(b.uInteriorWall, 2)],
        ['Haustrennwand', `zum beheizten Nachbarn (${n(p.site.neighbourTemp, 0)} °C)`, '–', n(b.uPartyWall, 2)],
      ],
      'llrr',
      undefined,
      'wrap',
    )}
    <p class="note">Wärmebrückenzuschlag ΔU_WB = ${n(b.deltaUTB, 2)} W/(m²·K) auf alle Außenbauteile. Raumeigene Bauteile (abweichende Wand- oder Bodenaufbauten, Fenster mit eigenem U-Wert) sind in der Raumberechnung berücksichtigt.</p>
  </section>`;

  // ---------- 3 Heizlast ----------
  const hlRows = heated.map((r) => {
    const room = roomOf(p, r);
    return [esc(floorName(r.floorId)), esc(r.name), n(r.area, 2), n(room?.thetaI ?? 0, 0), n(room?.airChange ?? 0, 1), n(r.heatLoad.transmission, 0), n(r.heatLoad.ventilation, 0), `<b>${n(r.heatLoad.total, 0)}</b>`, r.area > 0 ? n(r.heatLoad.total / r.area, 0) : '–'];
  });
  const sumT = heated.reduce((s, r) => s + r.heatLoad.transmission, 0);
  const sumV = heated.reduce((s, r) => s + r.heatLoad.ventilation, 0);
  const s3 = `<section class="page">
    <h2><span>3</span>Norm-Heizlast je Raum</h2>
    <p class="lead">Raumweise nach EN 12831-1 (vereinfachtes Verfahren): Transmission Φ_T über Außenbauteile, unbeheizte Nachbarräume, Erdreich und beheizte Räume abweichender Temperatur; Lüftung Φ_V mit Mindestluftwechsel n_min.</p>
    ${table(
      ['Geschoss', 'Raum', 'A [m²]', 'θ_int [°C]', 'n [1/h]', 'Φ_T [W]', 'Φ_V [W]', 'Φ_HL [W]', 'W/m²'],
      hlRows,
      'llrrrrrrr',
      ['Summe', `${heated.length} Räume`, n(d.totals.heatedArea, 1), '', '', n(sumT, 0), n(sumV, 0), `<b>${n(d.totals.heatLoad, 0)}</b>`, n(specific, 0)],
    )}
    <h3>Aufteilung der Transmission</h3>
    ${table(
      ['Raum', 'Außenwand', 'Fenster/Türen', 'Trennwand', 'Unbeheizt', 'Boden', 'Decke', 'Innen'],
      heated.map((r) => [esc(r.name), n(r.heatLoad.extWall, 0), n(r.heatLoad.windows, 0), n(r.heatLoad.partyWalls, 0), n(r.heatLoad.unheatedWalls, 0), n(r.heatLoad.floor, 0), n(r.heatLoad.ceiling, 0), n(r.heatLoad.interior, 0)]),
      'lrrrrrrr',
      undefined,
      'small',
    )}
  </section>`;

  // ---------- 4 Temperaturen und Heizflächen ----------
  const surfaces = rooms.flatMap((r) => r.surfaces.map((s) => ({ r, s })));
  const limitOf = (r: RoomResult, kind: string) => {
    const room = roomOf(p, r);
    if (kind === 'wall') return SURFACE_LIMITS.wall;
    if (kind === 'ceiling') return SURFACE_LIMITS.ceiling;
    return room && BATHROOM_TYPES.has(room.type) ? SURFACE_LIMITS.bathroom : SURFACE_LIMITS.occupied;
  };
  const s4 = `<section class="page">
    <h2><span>4</span>Temperaturen und Heizflächen</h2>
    <div class="kpis small">
      ${kpi(`${n(d.thetaSupply, 1)} °C`, `Vorlauf θ_V ${d.thetaSupplyAuto ? '(ermittelt)' : '(fest)'}`)}
      ${kpi(`${n(d.sigmaDesign, 1)} K`, 'Spreizung σ Auslegungsraum')}
      ${kpi(`${n(thetaReturnDesign, 1)} °C`, 'Rücklauf Auslegungsraum')}
      ${kpi(esc(designRoom?.name ?? '–'), 'maßgebender Raum')}
    </div>
    <p class="lead">Auslegung nach EN 1264-3: Die Vorlauftemperatur ergibt sich aus dem Raum mit der höchsten erforderlichen Heizmitteltemperatur (σ ≤ 5 K); in allen anderen Räumen stellt sich die Spreizung über den Massenstrom ein. Oberflächentemperaturen gegen die Grenzwerte nach EN 1264-2 (Aufenthaltszone ${SURFACE_LIMITS.occupied} °C, Bad ${SURFACE_LIMITS.bathroom} °C, Randzone ${SURFACE_LIMITS.edge} °C).</p>
    ${table(
      ['Raum', 'Fläche', 'System', 'A [m²]', 'VA [cm]', 'q [W/m²]', 'q_G [W/m²]', 'θ_O / max [°C]', 'σ [K]', 'θ_R [°C]', 'ṁ [kg/h]'],
      surfaces.map(({ r, s }) => {
        const lim = limitOf(r, s.kind);
        const over = s.surfaceTemp > lim + 0.05;
        return [
          esc(r.name),
          SURFACE_LABEL[s.kind],
          esc(HEATING_SYSTEMS[s.system]?.short ?? s.system),
          n(s.area, 2),
          s.medium === 'water' ? n(s.spacing * 100, 1) : '–',
          n(s.qRequired, 0),
          n(s.qLimit, 0),
          `<span class="${over ? 'warn' : ''}">${n(s.surfaceTemp, 1)} / ${lim}</span>`,
          s.medium === 'water' ? n(s.sigma, 1) : '–',
          s.medium === 'water' ? n(s.thetaReturn, 1) : '–',
          s.medium === 'water' ? n(s.massFlow, 0) : (s.electric ? `${n(s.electric.installed, 0)} W el.` : '–'),
        ];
      }),
      'lllrrrrrrrr',
    )}
    <h3>Fußbodenaufbau</h3>
    ${kv([
      ['Standardsystem', esc(HEATING_SYSTEMS[p.design.defaultFloorSystem]?.label ?? p.design.defaultFloorSystem)],
      ['Heizrohr', esc(PIPES[p.design.pipe]?.label ?? p.design.pipe)],
      ['Estrich', `${esc(SCREEDS[p.design.screed]?.label ?? p.design.screed)}, λ = ${n(p.design.lambdaScreed, 2)} W/(m·K), Überdeckung ${n(p.design.screedCover * 1000, 0)} mm`],
      ['Dämmung unter System', `${n(p.design.insulationThickness * 1000, 0)} mm, λ = ${n(p.design.lambdaInsulation, 3)} W/(m·K)`],
    ])}
  </section>`;

  // ---------- 5 Heizkreise ----------
  const byManifold = d.manifolds.map((m) => {
    const cs = rooms.flatMap((r) => r.circuits.filter(() => r.manifoldId === m.manifoldId).map((c) => ({ c, r }))).sort((a, b2) => a.c.label.localeCompare(b2.c.label, 'de', { numeric: true }));
    return `<div class="avoid"><h3>${esc(m.name)} · ${esc(floorName(m.floorId))} · ${m.outlets} von ${m.maxOutlets} Abgängen</h3>
      ${table(
        ['Nr.', 'Heizkreis', 'Raum', 'Rohr', 'Länge [m]', 'davon Anb. [m]', 'ṁ [kg/h]', 'V̇ [l/min]', 'v [m/s]', 'Δp [mbar]', 'Drossel [mbar]'],
        cs.map(({ c, r }, i) => [i + 1, esc(c.label), esc(r.name), c.pipe.replace('x', '×'), n(c.length, 1), n(c.lengthFeeder, 1), n(c.massFlow, 0), `<b>${n(c.litresPerMinute, 2)}</b>`, n(c.velocity, 2), n(c.pressureDrop / 100, 0), n(c.throttle / 100, 0)]),
        'lllrrrrrrrr',
        ['', `${cs.length} Kreise`, '', '', n(cs.reduce((s, x) => s + x.c.length, 0), 1), '', n(m.massFlow, 0), n(cs.reduce((s, x) => s + x.c.litresPerMinute, 0), 2), '', n(m.maxPressureDrop / 100, 0), ''],
      )}</div>`;
  });
  const unassigned = rooms.filter((r) => r.hasWater && !r.manifoldId);
  const s5 = `<section class="page">
    <h2><span>5</span>Heizkreise und hydraulischer Abgleich</h2>
    <p class="lead">Je Heizkreis: Rohrlänge inkl. Anbindung, Massenstrom aus Leistung und Spreizung, Druckverlust nach Darcy-Weisbach. <b>Einstellwert</b> ist der Volumenstrom V̇ am Durchflussanzeiger des Verteilers; die Spalte „Drossel“ nennt den zusätzlich am Ventil abzubauenden Druck gegenüber dem ungünstigsten Kreis. Grenzwert Druckverlust ${n(p.design.maxPressureDrop / 100, 0)} mbar je Kreis, maximale Kreislänge ${n(p.design.maxCircuitLength, 0)} m.</p>
    ${byManifold.join('') || '<p class="note">Noch kein Heizkreisverteiler gesetzt.</p>'}
    ${unassigned.length ? `<p class="note warn">Ohne Verteilerzuordnung: ${unassigned.map((r) => esc(r.name)).join(', ')}</p>` : ''}
  </section>`;

  // ---------- 6 Verteiler, Zuleitungen, Material ----------
  const material: (string | number)[][] = [];
  for (const [k, x] of Object.entries(d.totals.pipeByType)) material.push(['Heizrohr', esc(PIPES[k]?.label ?? k), `${n(x.length, 0)} m`, `${x.circuits} Kreise · ${x.rolls} Rollen à ${d.totals.rollLength} m`]);
  material.push(['davon Anbindeleitungen', 'Vor- und Rücklauf', `${n(d.totals.pipeFeeders, 0)} m`, '']);
  const bySys = new Map<string, number>();
  for (const { s } of surfaces) bySys.set(s.system, (bySys.get(s.system) ?? 0) + s.area);
  for (const [k, a] of bySys) material.push(['Heizfläche', esc(HEATING_SYSTEMS[k]?.label ?? k), `${n(a, 1)} m²`, k === 'electric' ? `${n(d.totals.electricInstalled, 0)} W, ${d.totals.electricCircuits} Stromkreise` : '']);
  material.push(['Randdämmstreifen', '', `${n(d.totals.edgeStrip, 0)} m`, 'Umfang der Räume mit Fußbodenheizung']);
  for (const m of d.manifolds) {
    material.push(['Heizkreisverteiler', esc(m.name), `${m.outlets} Abgänge`, `${esc(floorName(m.floorId))} · ${n(m.massFlow, 0)} kg/h`]);
    if (m.supplyLength > 0) material.push(['Zuleitung', esc(m.supplyPipe ?? ''), `${n(2 * m.supplyLength, 1)} m`, `${esc(m.name)} ↔ Wärmeerzeuger`]);
  }
  const s6 = `<section class="page">
    <h2><span>6</span>Verteiler, Zuleitungen, Material</h2>
    ${table(
      ['Verteiler', 'Geschoss', 'Abgänge', 'Leistung [W]', 'ṁ [kg/h]', 'max. Δp [mbar]', 'Kreise min–max [m]', 'Zuleitung', 'v [m/s]', 'Δp Zul. [mbar]'],
      d.manifolds.map((m) => [esc(m.name), esc(floorName(m.floorId)), `${m.outlets}/${m.maxOutlets}`, n(m.heat, 0), n(m.massFlow, 0), n(m.maxPressureDrop / 100, 0), `${n(m.lengthMin, 0)}–${n(m.lengthMax, 0)}`, m.supplyLength > 0 ? `${esc(m.supplyPipe ?? '')}, 2 × ${n(m.supplyLength, 1)} m` : '–', n(m.supplyVelocity, 2), n(m.supplyPressureDrop / 100, 0)]),
      'llrrrrrlrr',
      ['Summe', '', d.totals.circuits, n(d.totals.output, 0), n(d.totals.massFlow, 0), '', '', '', '', ''],
    )}
    <p class="note">Förderhöhe der Umwälzpumpe mindestens: max. Δp Heizkreis + Δp Zuleitung + Verteiler, Ventile und Wärmeerzeuger (Herstellerangaben).</p>
    <h3>Materialauszug</h3>
    ${table(['Position', 'Ausführung', 'Menge', 'Bemerkung'], material, 'llrl')}
  </section>`;

  // ---------- 7 Pläne ----------
  const plans = floors
    .map((f) => {
      const svg = exportFloorSvg(p, f, d, images, false);
      if (!svg) return '';
      const inline = svg.replace(/^<\?xml[^>]*>\s*/, '').replace(/<svg([^>]*?) width="\d+" height="\d+"/, '<svg$1 preserveAspectRatio="xMidYMid meet"');
      return `<section class="page plan-page"><h2><span>7</span>Plan ${esc(f.name)} <small>${level(f.elevation)}</small></h2><div class="plan">${inline}</div>
        <p class="legend"><i class="l-sup"></i>Vorlauf <i class="l-ret"></i>Rücklauf <i class="l-main"></i>Zuleitung Wärmeerzeuger · Maße in m</p></section>`;
    })
    .join('');

  // ---------- 8 Normwerte, Hinweise ----------
  const notes: string[] = [];
  for (const r of rooms) {
    for (const w of r.warnings) notes.push(`<li><b>${esc(r.name)}</b> (${esc(floorName(r.floorId))}): ${esc(WARNING_TEXT[w])}</li>`);
    for (const s of r.surfaces) for (const w of s.warnings) notes.push(`<li><b>${esc(r.name)} · ${SURFACE_LABEL[s.kind]}</b>: ${esc(WARNING_TEXT[w])}</li>`);
  }
  const s8 = `<section class="page">
    <h2><span>8</span>Normwerte, Annahmen, Hinweise</h2>
    ${table(
      ['Größe', 'Wert', 'Status', 'Quelle'],
      normRows(p).map((r) => [esc(r.label), esc(r.value), `<span class="badge st-${r.status}">${esc(NORM_STATUS[r.status].label)}</span>`, esc(r.source)]),
      'llll',
      undefined,
      'wrap small',
    )}
    <p class="note">Status: <b>Norm</b> normativer Wert/Verfahren · <b>Norm (national)</b> nationaler bzw. informativer Anhang · <b>Praxiswert</b> übliche Herstellerangabe · <b>Annahme</b> im Einzelfall prüfen.</p>
    <h3>Hinweise aus der Berechnung</h3>
    ${notes.length ? `<ul class="notes">${notes.join('')}</ul>` : '<p>Keine offenen Hinweise.</p>'}
  </section>`;

  const footerLeft = cssString(`${p.name} · Auslegung Flächenheizung · ${date}`);
  return `<!doctype html>
<html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Auslegung – ${esc(p.name)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Sans+Condensed:wght@500;600&family=IBM+Plex+Mono:wght@400;500&display=swap">
<style>${REPORT_CSS.replace('__FOOTER__', footerLeft)}</style></head>
<body>${cover}${s1}${s2}${s3}${s4}${s5}${s6}${plans}${s8}</body></html>`;
}

const REPORT_CSS = `
@page { size: A4 portrait; margin: 16mm 14mm 18mm 18mm;
  @bottom-left { content: __FOOTER__; font: 7.5pt 'IBM Plex Sans', sans-serif; color: #5b6772; }
  @bottom-right { content: "Seite " counter(page) " / " counter(pages); font: 7.5pt 'IBM Plex Sans', sans-serif; color: #5b6772; } }
* { box-sizing: border-box; }
html { background: #e9edf0; }
body { margin: 0; color: #111a22; font: 9.5pt/1.42 'IBM Plex Sans', -apple-system, 'Segoe UI', sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.page { width: 210mm; min-height: 297mm; margin: 10mm auto; padding: 16mm 14mm 18mm 18mm; background: #fff; box-shadow: 0 2px 14px rgb(0 0 0 / .12); }
@media print { html { background: none; } .page { width: auto; min-height: 0; margin: 0; padding: 0; box-shadow: none; break-after: page; } .page:last-child { break-after: auto; } }
h1 { font-size: 24pt; line-height: 1.15; margin: 2mm 0 8mm; font-weight: 600; }
h2 { font-size: 14pt; margin: 0 0 4mm; padding-bottom: 2mm; border-bottom: 1.5pt solid #0b6e5f; display: flex; align-items: baseline; gap: 3mm; font-weight: 600; }
h2 span { color: #0b6e5f; font-family: 'IBM Plex Mono', monospace; font-size: 12pt; }
h2 small { font: 9pt 'IBM Plex Mono', monospace; color: #586572; }
h3 { font: 600 9.5pt 'IBM Plex Sans Condensed', 'IBM Plex Sans', sans-serif; text-transform: uppercase; letter-spacing: .05em; color: #3a4754; margin: 6mm 0 2mm; break-after: avoid; }
p { margin: 0 0 3mm; }
.lead { color: #3a4754; }
.note { color: #3a4754; font-size: 8.5pt; }
.warn { color: #a2410f; font-weight: 600; }
.brand { font-size: 13pt; font-weight: 600; color: #c0341f; margin-bottom: 30mm; } .brand b { color: #111a22; }
.eyebrow { font: 600 10pt 'IBM Plex Sans Condensed', sans-serif; letter-spacing: .08em; text-transform: uppercase; color: #0b6e5f; margin: 0; }
.cover .kv { margin-bottom: 8mm; }
.kv { display: grid; grid-template-columns: 52mm 1fr; gap: 1.2mm 4mm; margin: 0 0 3mm; }
.kv dt { color: #586572; } .kv dd { margin: 0; font-weight: 500; }
.cols { display: grid; grid-template-columns: 1fr 1fr; gap: 8mm; } .cols .kv { grid-template-columns: 38mm 1fr; }
.kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 3mm; margin: 0 0 6mm; }
.kpi { border: .6pt solid #cdd5dc; border-left: 2.5pt solid #0b6e5f; border-radius: 1.5mm; padding: 2.5mm 3mm; break-inside: avoid; }
.kpi b { display: block; font: 600 12pt 'IBM Plex Mono', monospace; white-space: nowrap; }
.kpi span { font-size: 7.5pt; color: #586572; }
.kpis.small .kpi b { font-size: 10.5pt; }
.toc { padding-left: 5mm; margin: 0 0 6mm; } .toc li { margin: .8mm 0; }
.basis { font-size: 8.5pt; color: #3a4754; border-top: .6pt solid #cdd5dc; padding-top: 3mm; }
table { width: 100%; border-collapse: collapse; margin: 0 0 4mm; font-size: 8.3pt; font-variant-numeric: tabular-nums; }
th { text-align: left; font: 600 7.5pt 'IBM Plex Sans Condensed', sans-serif; color: #3a4754; border-bottom: .9pt solid #111a22; padding: 1.2mm 1.4mm; vertical-align: bottom; }
td { padding: 1.1mm 1.4mm; border-bottom: .4pt solid #dfe5e9; vertical-align: top; }
td.r, th.r { text-align: right; } td.r { font-family: 'IBM Plex Mono', monospace; font-size: 7.9pt; white-space: nowrap; }
tbody tr:nth-child(even) td { background: #f6f8fa; }
tfoot td { border-top: .9pt solid #111a22; border-bottom: 0; font-weight: 600; }
table.small { font-size: 7.6pt; } table.small td.r { font-size: 7.4pt; }
table.wrap td { white-space: normal; }
tr, .avoid { break-inside: avoid; }
thead { display: table-header-group; }
.badge { display: inline-block; padding: 0 1.6mm; border: .6pt solid currentColor; border-radius: 3mm; font: 600 7pt 'IBM Plex Sans Condensed', sans-serif; white-space: nowrap; }
.st-norm { color: #21703a; } .st-national { color: #09594d; } .st-praxis { color: #2456b8; } .st-annahme { color: #a2410f; background: #f8e4d6; }
.plan-page .plan { border: .6pt solid #cdd5dc; border-radius: 1.5mm; padding: 2mm; }
.plan svg { display: block; width: 100%; height: auto; max-height: 225mm; }
.plan svg text { font-family: 'IBM Plex Sans', sans-serif; }
.legend { font-size: 8pt; color: #3a4754; margin-top: 2mm; }
.legend i { display: inline-block; width: 7mm; height: 0; border-top: 1.6pt solid; vertical-align: middle; margin: 0 1.5mm 0 4mm; }
.legend i:first-child { margin-left: 0; }
.l-sup { color: #c8372d; } .l-ret { color: #2d64c8; } .l-main { border-top-style: dashed !important; color: #7a3fb3; }
.notes { padding-left: 5mm; font-size: 8.5pt; } .notes li { margin: 1mm 0; }
.disclaimer { margin-top: 3mm; font-size: 7.5pt; color: #586572; }
`;
