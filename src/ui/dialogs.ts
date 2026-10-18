import type { Project } from '../model/types';
import type { Store } from '../model/store';
import { BUILDING_STANDARDS, CLIMATE_LOCATIONS, PIPES, SCREEDS } from '../model/catalog';
import { optimizeSpacings, type DesignResult } from '../calc/design';
import { bindFields, fieldHtml, type FieldSpec } from './forms';
import { esc, num, parseNum } from './format';
import { WARNING_TEXT } from './sidebar';

// ---------- Modal ----------
export interface Modal {
  root: HTMLElement;
  body: HTMLElement;
  close(): void;
}

export function openModal(title: string, opts: { wide?: boolean; onClose?: () => void } = {}): Modal {
  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.innerHTML = `<div class="modal${opts.wide ? ' wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
    <div class="modal-head"><h2>${esc(title)}</h2><button class="icon-btn" data-close aria-label="Schließen">✕</button></div>
    <div class="modal-body"></div></div>`;
  document.body.appendChild(overlay);
  const close = () => {
    overlay.remove();
    document.removeEventListener('keydown', onKey, true);
    opts.onClose?.();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    }
  };
  document.addEventListener('keydown', onKey, true);
  overlay.addEventListener('pointerdown', (e) => e.target === overlay && close());
  overlay.querySelector('[data-close]')!.addEventListener('click', close);
  return { root: overlay, body: overlay.querySelector('.modal-body')!, close };
}

const grid = (fields: FieldSpec[], prefix: string) => `<div class="fields cols">${fields.map((f) => fieldHtml(f, prefix)).join('')}</div>`;

// ---------- Gebäudedaten ----------
export function openBuildingDialog(store: Store): void {
  const modal = openModal('Gebäude und Klima', { wide: true });
  const render = () => {
    const p = store.project;
    const b = p.building;
    const byCountry = new Map<string, [string, string][]>();
    for (const [k, l] of Object.entries(CLIMATE_LOCATIONS)) {
      const arr = byCountry.get(l.country) ?? [];
      arr.push([k, `${l.label} · θe ${num(l.thetaE, 0)} °C`]);
      byCountry.set(l.country, arr);
    }
    const locOptions = [...byCountry.entries()].map(([c, o]) => ({ group: c, options: o }));
    locOptions.push({ group: 'Eigene Werte', options: [['custom', 'Benutzerdefiniert']] });
    modal.body.innerHTML = `
      <section><h3>Projekt</h3>${grid(
        [
          { kind: 'text', key: 'project.name', label: 'Projektname', value: p.name },
          { kind: 'text', key: 'b.client', label: 'Bauherr', value: b.client },
          { kind: 'text', key: 'b.address', label: 'Adresse', value: b.address },
          { kind: 'text', key: 'b.planner', label: 'Planer', value: b.planner },
        ],
        'bp',
      )}</section>
      <section><h3>Klima</h3>${grid(
        [
          { kind: 'select', key: 'b.location', label: 'Standort', value: b.location, options: locOptions },
          { kind: 'num', key: 'b.thetaE', label: 'Norm-Außentemperatur θ_e', value: b.thetaE, unit: '°C', digits: 1 },
          { kind: 'num', key: 'b.thetaMeanYear', label: 'Jahresmittel θ_m,e', value: b.thetaMeanYear, unit: '°C', digits: 1 },
        ],
        'bk',
      )}<p class="note">Richtwerte zur Vorbelegung. Verbindlich sind die Werte des nationalen Anhangs (DE: DIN/TS 12831-1 nach PLZ, AT: ÖNORM H 7500-1, CH: SIA 384/2).</p></section>
      <section><h3>Bauteile (U-Werte in W/(m²·K))</h3>${grid(
        [
          { kind: 'select', key: 'b.standard', label: 'Baustandard (setzt U-Werte)', value: b.standard, options: [...Object.entries(BUILDING_STANDARDS).map(([k, s]) => [k, s.label] as [string, string]), ['custom', 'Benutzerdefiniert']] },
          { kind: 'num', key: 'b.uExtWall', label: 'Außenwand', value: b.uExtWall, digits: 3 },
          { kind: 'num', key: 'b.uWindow', label: 'Fenster / Außentür', value: b.uWindow, digits: 3 },
          { kind: 'num', key: 'b.uRoof', label: 'Dach / oberste Decke', value: b.uRoof, digits: 3 },
          { kind: 'num', key: 'b.uGroundFloor', label: 'Bodenplatte gegen Erdreich', value: b.uGroundFloor, digits: 3 },
          { kind: 'num', key: 'b.uUnheatedSlab', label: 'Decke zu unbeheizt', value: b.uUnheatedSlab, digits: 3 },
          { kind: 'num', key: 'b.uUnheatedWall', label: 'Wand zu unbeheizt', value: b.uUnheatedWall, digits: 3 },
          { kind: 'num', key: 'b.uInteriorWall', label: 'Innenwand', value: b.uInteriorWall, digits: 3 },
          { kind: 'num', key: 'b.deltaUTB', label: 'Wärmebrückenzuschlag ΔU_WB', value: b.deltaUTB, digits: 3 },
        ],
        'bu',
      )}</section>
      <section><h3>Lüftung</h3>${grid(
        [
          { kind: 'check', key: 'b.heatRecovery', label: 'Lüftungsanlage mit Wärmerückgewinnung', value: b.heatRecovery },
          { kind: 'num', key: 'b.etaHR', label: 'Rückwärmezahl η', value: b.etaHR * 100, unit: '%', digits: 0 },
        ],
        'bl',
      )}</section>
      <section><h3>Notizen</h3>${grid([{ kind: 'textarea', key: 'b.notes', label: 'Bemerkungen', value: b.notes }], 'bn')}</section>`;
  };
  render();
  bindFields(modal.body, (key, val, _el, live) => {
    if (live) return;
    const [, field] = key.split('.');
    store.commit((p) => {
      const b = p.building as unknown as Record<string, unknown>;
      if (key === 'project.name') {
        if (typeof val === 'string' && val.trim()) p.name = val.trim();
        p.isExample = false;
        return;
      }
      if (field === 'location') {
        p.building.location = String(val);
        const loc = CLIMATE_LOCATIONS[String(val)];
        if (loc) {
          p.building.thetaE = loc.thetaE;
          p.building.thetaMeanYear = loc.thetaMeanYear;
        }
        return;
      }
      if (field === 'standard') {
        p.building.standard = String(val);
        const st = BUILDING_STANDARDS[String(val)];
        if (st) Object.assign(p.building, { uExtWall: st.uExtWall, uWindow: st.uWindow, uRoof: st.uRoof, uGroundFloor: st.uGroundFloor, uUnheatedSlab: st.uUnheatedSlab, uUnheatedWall: st.uUnheatedWall, deltaUTB: st.deltaUTB });
        return;
      }
      if (field === 'etaHR' && typeof val === 'number') {
        p.building.etaHR = Math.min(0.95, Math.max(0, val / 100));
        return;
      }
      if (typeof b[field] === 'number') {
        if (typeof val === 'number') {
          b[field] = val;
          if (field === 'thetaE' || field === 'thetaMeanYear') p.building.location = 'custom';
          if (field.startsWith('u') || field === 'deltaUTB') p.building.standard = 'custom';
        }
      } else if (typeof b[field] === 'boolean') b[field] = !!val;
      else if (typeof b[field] === 'string') b[field] = String(val ?? '');
    });
    render();
  });
}

// ---------- Auslegungsparameter ----------
export function openDesignDialog(store: Store, toast: (t: string, k?: 'info' | 'warn') => void): void {
  const modal = openModal('Auslegung Fußbodenheizung', { wide: true });
  let target = 35;
  const render = () => {
    const d = store.project.design;
    const res = store.design;
    modal.body.innerHTML = `
      <section><h3>Rohr und Heizkreise</h3>${grid(
        [
          { kind: 'select', key: 'd.pipe', label: 'Heizrohr', value: d.pipe, options: Object.entries(PIPES).map(([k, p]) => [k, p.label] as [string, string]) },
          { kind: 'num', key: 'd.maxCircuitLength', label: 'max. Kreislänge inkl. Anbindung', value: d.maxCircuitLength, unit: 'm', digits: 0 },
          { kind: 'num', key: 'd.maxPressureDrop', label: 'max. Druckverlust je Kreis', value: d.maxPressureDrop / 100, unit: 'mbar', digits: 0 },
          { kind: 'num', key: 'd.wallDistance', label: 'Randabstand zur Wand', value: d.wallDistance * 100, unit: 'cm', digits: 1 },
          { kind: 'select', key: 'd.rollLength', label: 'Rollenlänge', value: String(d.rollLength), options: [['120', '120 m'], ['200', '200 m'], ['240', '240 m'], ['500', '500 m'], ['600', '600 m']] },
        ],
        'dp',
      )}</section>
      <section><h3>Temperaturen (EN 1264-3)</h3>${grid(
        [
          { kind: 'num', key: 'd.sigmaDesign', label: 'Spreizung σ Auslegungsraum', value: d.sigmaDesign, unit: 'K', digits: 1 },
          { kind: 'check', key: 'd.autoSupply', label: 'Vorlauftemperatur automatisch ermitteln', value: d.supplyTempFixed == null },
          { kind: 'num', key: 'd.supplyTempFixed', label: 'feste Vorlauftemperatur', value: d.supplyTempFixed ?? res.thetaSupply, unit: '°C', digits: 1 },
          { kind: 'readout', label: 'aktuelle Vorlauftemperatur', value: `${num(res.thetaSupply, 1)} °C${res.thetaSupplyAuto ? ' (auto)' : ' (fest)'}` },
        ],
        'dt',
      )}${res.designRoomId ? `<p class="note">Maßgebender Raum: <b>${esc(roomName(store.project, res.designRoomId))}</b> (höchste Δθ_H ohne Bäder).</p>` : ''}</section>
      <section><h3>Fußbodenaufbau (Nasssystem Typ A)</h3>${grid(
        [
          { kind: 'select', key: 'd.screed', label: 'Estrich', value: d.screed, options: Object.entries(SCREEDS).map(([k, s]) => [k, s.label] as [string, string]) },
          { kind: 'num', key: 'd.lambdaScreed', label: 'λ Estrich', value: d.lambdaScreed, unit: 'W/(m·K)', digits: 2 },
          { kind: 'num', key: 'd.screedCover', label: 'Rohrüberdeckung s_ü', value: d.screedCover * 1000, unit: 'mm', digits: 0 },
          { kind: 'num', key: 'd.insulationThickness', label: 'Dämmung unter System', value: d.insulationThickness * 1000, unit: 'mm', digits: 0 },
          { kind: 'num', key: 'd.lambdaInsulation', label: 'λ Dämmung', value: d.lambdaInsulation, unit: 'W/(m·K)', digits: 3 },
        ],
        'df',
      )}</section>
      <section><h3>Verlegeabstände optimieren</h3>
        <p class="note">Wählt je Raum den größten Verlegeabstand (≥ 10 cm), mit dem die Heizlast bei der Ziel-Vorlauftemperatur und der Auslegungsspreizung gedeckt wird. Für Wärmepumpen sind 30–35 °C üblich.</p>
        <div class="fields cols">${fieldHtml({ kind: 'num', key: 'opt.target', label: 'Ziel-Vorlauftemperatur', value: target, unit: '°C', digits: 1 }, 'do')}</div>
        <div class="actions"><button class="btn primary" data-act="optimize">Verlegeabstände anpassen</button></div>
      </section>`;
  };
  render();
  modal.body.addEventListener('click', (e) => {
    const t = (e.target as HTMLElement).closest('[data-act="optimize"]');
    if (!t) return;
    const changes = optimizeSpacings(store.project, target);
    if (!changes.size) {
      toast('Alle Verlegeabstände passen bereits zur Ziel-Vorlauftemperatur.');
      return;
    }
    store.commit((p) => p.floors.forEach((f) => f.rooms.forEach((r) => changes.has(r.id) && (r.spacing = changes.get(r.id)!))));
    const d = store.design;
    if (d.thetaSupply > target + 0.5 && d.designRoomId) {
      toast(`${changes.size} Verlegeabstände angepasst. ${num(target, 1)} °C sind nicht erreichbar: ${roomName(store.project, d.designRoomId)} benötigt ${num(d.thetaSupply, 1)} °C. Heizlast senken oder Zusatzheizfläche vorsehen.`, 'warn');
    } else toast(`${changes.size} Verlegeabstände angepasst. Neue Vorlauftemperatur: ${num(d.thetaSupply, 1)} °C.`);
    render();
  });
  bindFields(modal.body, (key, val, _el, live) => {
    if (live) return;
    if (key === 'opt.target') {
      if (typeof val === 'number') target = val;
      return;
    }
    const field = key.split('.')[1];
    const n = typeof val === 'number' ? val : null;
    store.commit((p) => {
      const d = p.design;
      switch (field) {
        case 'pipe':
          d.pipe = String(val);
          d.maxCircuitLength = PIPES[d.pipe]?.maxLength ?? d.maxCircuitLength;
          break;
        case 'maxCircuitLength':
          if (n && n >= 20) d.maxCircuitLength = n;
          break;
        case 'maxPressureDrop':
          if (n && n >= 50) d.maxPressureDrop = n * 100;
          break;
        case 'wallDistance':
          if (n !== null && n >= 0) d.wallDistance = n / 100;
          break;
        case 'rollLength':
          d.rollLength = Number(val);
          break;
        case 'sigmaDesign':
          if (n && n >= 1 && n <= 15) d.sigmaDesign = n;
          break;
        case 'autoSupply':
          d.supplyTempFixed = val ? null : Math.round(store.design.thetaSupply);
          break;
        case 'supplyTempFixed':
          if (n && n > 20 && n < 70) d.supplyTempFixed = n;
          break;
        case 'screed':
          d.screed = String(val);
          d.lambdaScreed = SCREEDS[d.screed]?.lambda ?? d.lambdaScreed;
          break;
        case 'lambdaScreed':
          if (n && n > 0.2) d.lambdaScreed = n;
          break;
        case 'screedCover':
          if (n && n >= 10) d.screedCover = n / 1000;
          break;
        case 'insulationThickness':
          if (n !== null && n >= 0) d.insulationThickness = n / 1000;
          break;
        case 'lambdaInsulation':
          if (n && n > 0.01) d.lambdaInsulation = n;
          break;
      }
    });
    render();
  });
}

function roomName(p: Project, id: string): string {
  for (const f of p.floors) {
    const r = f.rooms.find((x) => x.id === id);
    if (r) return `${r.name} (${f.name})`;
  }
  return '–';
}

// ---------- Kalibrierung ----------
export function openCalibrateDialog(measured: number, onApply: (real: number) => void, onCancel: () => void): void {
  let done = false;
  const modal = openModal('Maßstab kalibrieren', { onClose: () => !done && onCancel() });
  modal.body.innerHTML = `
    <p>Gemessener Abstand im Bild: <b>${num(measured, 3)} m</b> (bei aktuellem Maßstab).</p>
    <label class="field" for="cal-real"><span class="lab">Tatsächlicher Abstand</span><span class="inp-wrap"><input id="cal-real" type="text" inputmode="decimal" value="" placeholder="z. B. 6,50" autocomplete="off"/><span class="unit">m</span></span></label>
    <p class="note">Tipp: Nutzen Sie eine lange Maßkette. Je länger die Strecke, desto genauer der Maßstab.</p>
    <div class="actions end"><button class="btn" data-close-dlg>Abbrechen</button><button class="btn primary" data-apply>Maßstab übernehmen</button></div>`;
  const input = modal.body.querySelector<HTMLInputElement>('#cal-real')!;
  setTimeout(() => input.focus(), 30);
  const apply = () => {
    const v = parseNum(input.value);
    if (!v || v <= 0) {
      input.classList.add('invalid');
      return;
    }
    done = true;
    modal.close();
    onApply(v);
  };
  input.addEventListener('keydown', (e) => e.key === 'Enter' && apply());
  modal.body.querySelector('[data-apply]')!.addEventListener('click', apply);
  modal.body.querySelector('[data-close-dlg]')!.addEventListener('click', () => modal.close());
}

// ---------- Ergebnisse ----------
export type ResultsTab = 'rooms' | 'circuits' | 'manifolds' | 'material';

interface Table {
  head: string[];
  rows: (string | number)[][];
  align?: ('l' | 'r')[];
  foot?: (string | number)[];
}

function floorName(p: Project, id: string): string {
  return p.floors.find((f) => f.id === id)?.name ?? '';
}

export function resultTable(tab: ResultsTab, p: Project, d: DesignResult): Table {
  const rooms = [...d.rooms.values()];
  const n = (x: number, k = 1) => num(x, k);
  switch (tab) {
    case 'rooms':
      return {
        head: ['Geschoss', 'Raum', 'A [m²]', 'θ_int [°C]', 'Φ_T [W]', 'Φ_V [W]', 'Φ_HL [W]', 'q [W/m²]', 'VA [cm]', 'θ_F,m [°C]', 'σ [K]', 'FBH [W]', 'Zusatz [W]', 'Hinweis'],
        align: ['l', 'l', 'r', 'r', 'r', 'r', 'r', 'r', 'r', 'r', 'r', 'r', 'r', 'l'],
        rows: rooms.map((r) => {
          const room = p.floors.find((f) => f.id === r.floorId)?.rooms.find((x) => x.id === r.roomId);
          return [
            floorName(p, r.floorId),
            r.name,
            n(r.area, 2),
            n(room?.thetaI ?? 0, 0),
            n(r.heatLoad.transmission, 0),
            n(r.heatLoad.ventilation, 0),
            n(r.heatLoad.total, 0),
            r.hasFloorHeating ? n(r.qRequired) : '–',
            r.hasFloorHeating ? n((room?.spacing ?? 0) * 100, 1) : '–',
            r.hasFloorHeating ? n(r.surfaceTemp) : '–',
            r.hasFloorHeating ? n(r.sigma) : '–',
            r.hasFloorHeating ? n(r.output, 0) : '–',
            r.deficit > 5 ? n(r.deficit, 0) : '',
            r.warnings.map((w) => WARNING_TEXT[w]).join(' '),
          ];
        }),
        foot: ['Summe', '', n(rooms.reduce((a, r) => a + r.area, 0), 2), '', n(rooms.reduce((a, r) => a + r.heatLoad.transmission, 0), 0), n(rooms.reduce((a, r) => a + r.heatLoad.ventilation, 0), 0), n(d.totals.heatLoad, 0), '', '', '', '', n(d.totals.output, 0), n(d.totals.deficit, 0), ''],
      };
    case 'circuits': {
      const cs = rooms.flatMap((r) => r.circuits.map((c) => ({ c, r })));
      return {
        head: ['Verteiler', 'Heizkreis', 'Geschoss', 'Fläche [m²]', 'im Raum [m]', 'Anbindung [m]', 'Gesamt [m]', 'ṁ [kg/h]', 'V̇ [l/min]', 'v [m/s]', 'Δp [mbar]', 'Drossel [mbar]'],
        align: ['l', 'l', 'l', 'r', 'r', 'r', 'r', 'r', 'r', 'r', 'r', 'r'],
        rows: cs
          .sort((a, b) => (a.r.manifoldId ?? '').localeCompare(b.r.manifoldId ?? ''))
          .map(({ c, r }) => [
            d.manifolds.find((m) => m.manifoldId === r.manifoldId)?.name ?? '–',
            c.label,
            floorName(p, c.floorId),
            n(c.area, 2),
            n(c.lengthInRoom),
            n(c.lengthFeeder),
            n(c.length),
            n(c.massFlow, 0),
            n(c.litresPerMinute, 2),
            n(c.velocity, 2),
            n(c.pressureDrop / 100, 0),
            n(c.throttle / 100, 0),
          ]),
        foot: ['Summe', `${cs.length} Kreise`, '', n(d.totals.activeArea, 2), n(d.totals.pipeInRooms), n(d.totals.pipeFeeders), n(d.totals.pipeTotal), n(d.totals.massFlow, 0), '', '', '', ''],
      };
    }
    case 'manifolds':
      return {
        head: ['Verteiler', 'Geschoss', 'Abgänge', 'Leistung [W]', 'ṁ [kg/h]', 'max. Δp [mbar]', 'Zuleitung einfach [m]', 'Vor- + Rücklauf [m]', 'Dimension', 'v [m/s]', 'Δp Zuleitung [mbar]'],
        align: ['l', 'l', 'r', 'r', 'r', 'r', 'r', 'r', 'l', 'r', 'r'],
        rows: d.manifolds.map((m) => [m.name, floorName(p, m.floorId), m.outlets, n(m.heat, 0), n(m.massFlow, 0), n(m.maxPressureDrop / 100, 0), n(m.supplyLength, 2), n(2 * m.supplyLength, 2), m.supplyPipe ?? '–', n(m.supplyVelocity, 2), n(m.supplyPressureDrop / 100, 0)]),
        foot: ['Summe', '', d.totals.circuits, n(d.totals.output, 0), n(d.totals.massFlow, 0), '', '', n(d.totals.supplyLinesTotal, 2), '', '', ''],
      };
    case 'material': {
      const pipe = PIPES[p.design.pipe];
      const rows: (string | number)[][] = [
        ['Heizrohr', pipe?.label ?? p.design.pipe, `${n(d.totals.pipeTotal, 0)} m`, `${d.totals.rolls} Rollen à ${d.totals.rollLength} m (Kreise ungeteilt)`],
        ['davon im Raum', '', `${n(d.totals.pipeInRooms, 0)} m`, ''],
        ['davon Anbindeleitungen', 'Vor- und Rücklauf', `${n(d.totals.pipeFeeders, 0)} m`, ''],
        ['Systemdämmung / Trägerplatte', `${n(p.design.insulationThickness * 1000, 0)} mm, λ ${num(p.design.lambdaInsulation, 3)}`, `${n(d.totals.activeArea, 1)} m²`, 'zzgl. Verschnitt'],
        ['Randdämmstreifen', '', `${n(d.totals.edgeStrip, 0)} m`, 'Raumumfänge der beheizten Räume'],
      ];
      for (const m of d.manifolds) {
        rows.push(['Heizkreisverteiler', m.name, `${m.outlets} Abgänge`, `${floorName(p, m.floorId)} · ${n(m.massFlow, 0)} kg/h`]);
        if (m.supplyLength > 0) rows.push(['Verbundrohr Zuleitung', m.supplyPipe ?? '', `${n(2 * m.supplyLength, 1)} m`, `${m.name} ↔ Wärmeerzeuger`]);
      }
      return { head: ['Position', 'Ausführung', 'Menge', 'Bemerkung'], align: ['l', 'l', 'r', 'l'], rows };
    }
  }
}

export function tableHtml(t: Table): string {
  const al = (i: number) => (t.align?.[i] === 'r' ? ' class="r"' : '');
  return `<table class="results-table"><thead><tr>${t.head.map((h, i) => `<th${al(i)}>${esc(h)}</th>`).join('')}</tr></thead>
    <tbody>${t.rows.map((r) => `<tr>${r.map((c, i) => `<td${al(i)}>${esc(String(c))}</td>`).join('')}</tr>`).join('')}</tbody>
    ${t.foot ? `<tfoot><tr>${t.foot.map((c, i) => `<td${al(i)}>${esc(String(c))}</td>`).join('')}</tr></tfoot>` : ''}</table>`;
}

/** CSV mit Semikolon und Dezimalkomma (Excel, deutsches Gebietsschema) */
export function tableCsv(t: Table): string {
  const q = (s: string | number) => {
    const str = String(s);
    return /[;"\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
  };
  const lines = [t.head, ...t.rows, ...(t.foot ? [t.foot] : [])].map((r) => r.map(q).join(';'));
  return '﻿' + lines.join('\r\n');
}
