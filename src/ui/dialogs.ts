import type { ConstructionSlot, Project } from '../model/types';
import type { Store } from '../model/store';
import { CLIMATE_LOCATIONS, PIPES, SCREEDS, SPACINGS } from '../model/catalog';
import { AGE_CLASSES, CONSTRUCTION_TEMPLATES, MATERIALS, SURFACE_RESISTANCE, WINDOW_TYPES, constructionFromTemplate, constructionThickness, uValue } from '../model/constructions';
import { HEATING_SYSTEMS, SURFACE_LABEL, systemsFor } from '../model/systems';
import { applyConstructionUValues, applyYearBuilt } from '../model/factory';
import type { DesignResult } from '../calc/design';
import { bindFields, fieldHtml, type FieldSpec } from './forms';
import { cm, esc, num, parseNum } from './format';
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
    <div class="modal-head"><h2>${esc(title)}</h2><button class="icon-btn" data-close aria-label="Schließen"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg></button></div>
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

export function locationOptions(): { group: string; options: [string, string][] }[] {
  const byCountry = new Map<string, [string, string][]>();
  for (const [k, l] of Object.entries(CLIMATE_LOCATIONS)) {
    const arr = byCountry.get(l.country) ?? [];
    arr.push([k, `${l.label} · θe ${num(l.thetaE, 0)} °C`]);
    byCountry.set(l.country, arr);
  }
  const res = [...byCountry.entries()].map(([c, o]) => ({ group: c, options: o }));
  res.push({ group: 'Eigene Werte', options: [['custom', 'Benutzerdefiniert']] });
  return res;
}

const SLOT_ORDER: ConstructionSlot[] = ['extWall', 'roof', 'topSlab', 'groundSlab', 'basementSlab', 'unheatedWall'];

/** Schichtaufbau-Editor einer Konstruktion (HTML) */
export function constructionEditor(p: Project, slot: ConstructionSlot): string {
  const c = p.building.constructions[slot];
  const u = uValue(slot, c.layers);
  const tpl = Object.entries(CONSTRUCTION_TEMPLATES)
    .filter(([, t]) => t.slot === slot)
    .map(([k, t]) => [k, t.label] as [string, string]);
  const matOpts = Object.entries(MATERIALS).map(([k, m]) => `<option value="${k}">${esc(m.label)} (λ ${num(m.lambda, 3)})</option>`).join('');
  const rows = c.layers
    .map(
      (l, i) => `<tr>
      <td><select data-layer="${slot}.${i}.material" aria-label="Baustoff">${matOpts.replace(`value="${l.material}"`, `value="${l.material}" selected`)}</select></td>
      <td><span class="inp-wrap"><input type="text" inputmode="decimal" data-layer="${slot}.${i}.thickness" value="${num(l.thickness * 100, 1)}" aria-label="Dicke"/><span class="unit">cm</span></span></td>
      <td class="r">${num(l.thickness / (MATERIALS[l.material]?.lambda ?? 1), 3)}</td>
      <td><button class="icon-btn small" data-act="layer-del" data-slot="${slot}" data-i="${i}" aria-label="Schicht entfernen"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg></button></td>
    </tr>`,
    )
    .join('');
  return `<div class="construction" data-slot="${slot}">
    <div class="construction-head"><b>${esc(SURFACE_RESISTANCE[slot].label)}</b><span class="u-badge">U = ${num(u, 3)} W/(m²K)</span><span class="muted">${num(constructionThickness(c.layers) * 100, 1)} cm</span></div>
    <div class="fields">${fieldHtml({ kind: 'select', key: `tpl.${slot}`, label: 'Vorlage', value: c.template in CONSTRUCTION_TEMPLATES ? c.template : 'custom', options: [...tpl, ['custom', 'eigener Aufbau']] }, 'c')}</div>
    <div class="table-wrap"><table class="layers"><thead><tr><th>Schicht (innen → außen)</th><th>Dicke</th><th class="r">R [m²K/W]</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>
    <div class="actions"><button class="btn small" data-act="layer-add" data-slot="${slot}">+ Schicht</button></div>
  </div>`;
}

/** Ereignisse des Schichteditors an Store übergeben */
export function bindConstructionEditor(root: HTMLElement, store: Store, rerender: () => void): void {
  root.addEventListener('change', (e) => {
    const el = e.target as HTMLInputElement | HTMLSelectElement;
    const key = el.dataset.layer;
    if (!key) return;
    const [slot, idx, field] = key.split('.') as [ConstructionSlot, string, string];
    store.commit((p) => {
      const c = p.building.constructions[slot];
      const l = c.layers[Number(idx)];
      if (!l) return;
      if (field === 'material') l.material = el.value;
      if (field === 'thickness') {
        const v = parseNum(el.value);
        if (v && v > 0) l.thickness = v / 100;
      }
      c.template = 'custom';
      applyConstructionUValues(p.building);
    });
    rerender();
  });
  root.addEventListener('click', (e) => {
    const t = (e.target as HTMLElement).closest('[data-act^="layer-"]') as HTMLElement | null;
    if (!t) return;
    const slot = t.dataset.slot as ConstructionSlot;
    store.commit((p) => {
      const c = p.building.constructions[slot];
      if (t.dataset.act === 'layer-add') c.layers.push({ material: 'mineralwolle', thickness: 0.1 });
      else c.layers.splice(Number(t.dataset.i), 1);
      c.template = 'custom';
      applyConstructionUValues(p.building);
    });
    rerender();
  });
}

// ---------- Gebäudedaten ----------
export function openBuildingDialog(store: Store): void {
  const modal = openModal('Gebäude, Bauteile und Klima', { wide: true });
  const render = () => {
    const p = store.project;
    const b = p.building;
    const r = p.roof;
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
          { kind: 'select', key: 'b.location', label: 'Standort', value: b.location, options: locationOptions() },
          { kind: 'num', key: 'b.thetaE', label: 'Norm-Außentemperatur θ_e', value: b.thetaE, unit: '°C', digits: 1 },
          { kind: 'num', key: 'b.thetaMeanYear', label: 'Jahresmittel θ_m,e', value: b.thetaMeanYear, unit: '°C', digits: 1 },
        ],
        'bk',
      )}<p class="note">Richtwerte zur Vorbelegung. Verbindlich sind die Werte des nationalen Anhangs (DE: DIN/TS 12831-1 nach PLZ, AT: ÖNORM H 7500-1, CH: SIA 384/2).</p></section>
      <section><h3>Baujahr und Fenster</h3>${grid(
        [
          { kind: 'num', key: 'b.yearBuilt', label: `Baujahr (Klasse: ${AGE_CLASSES.find((a) => b.yearBuilt <= a.until)?.label ?? ''})`, value: b.yearBuilt, digits: 0, hint: 'setzt alle Aufbauten und Fenster auf typische Werte der Baualtersklasse' },
          { kind: 'select', key: 'b.windowType', label: 'Fenster', value: b.windowType, options: Object.entries(WINDOW_TYPES).map(([k, w]) => [k, `${w.label} · U ${num(w.u, 2)}`] as [string, string]) },
          { kind: 'num', key: 'b.uDoor', label: 'U Außentüren', value: b.uDoor, unit: 'W/m²K', digits: 2 },
          { kind: 'num', key: 'b.deltaUTB', label: 'Wärmebrückenzuschlag ΔU_WB', value: b.deltaUTB, unit: 'W/m²K', digits: 3 },
          { kind: 'select', key: 'b.basement', label: 'Unter dem untersten Geschoss', value: b.basement, options: [['none', 'Bodenplatte auf Erdreich'], ['unheated', 'unbeheizter Keller']] },
        ],
        'by',
      )}</section>
      <section><h3>Bauteile</h3><div class="constructions">${SLOT_ORDER.map((s) => constructionEditor(p, s)).join('')}</div></section>
      <section><h3>Gelände</h3>${grid(
        [
          { kind: 'select', key: 'terrain.type', label: 'Gelände', value: p.terrain.type, options: [['flat', 'eben'], ['slope', 'Hanglage (geneigte Ebene)']] },
          { kind: 'num', key: 'terrain.gradeLow', label: p.terrain.type === 'slope' ? 'Geländehöhe Talseite' : 'Geländehöhe', value: p.terrain.gradeLow, unit: 'm', digits: 2, hint: 'relativ zu ±0,00 (OK FFB EG); negativ = unter dem Fußboden' },
          ...(p.terrain.type === 'slope'
            ? ([
                { kind: 'num', key: 'terrain.rise', label: 'Anstieg Tal → Berg über die Hausbreite', value: p.terrain.rise, unit: 'm', digits: 2 },
                { kind: 'select', key: 'terrain.uphill', label: 'Bergseite', value: p.terrain.uphill, options: [['N', 'Nord (oben im Plan)'], ['O', 'Ost (rechts)'], ['S', 'Süd (unten)'], ['W', 'West (links)']] },
              ] as FieldSpec[])
            : []),
        ],
        'tg',
      )}<p class="note">Erdberührte Wandanteile werden je Außenwand aus dem Gelände ermittelt (EN ISO 13370) und lassen sich an der Wand überschreiben. Beispiel Hanglage: Garage talseitig auf Geländeniveau, Rückwand bergseitig im Erdreich.</p></section>
      <section><h3>Dach</h3>${grid(
        [
          { kind: 'select', key: 'roof.type', label: 'Dachform', value: r.type, options: [['gable', 'Satteldach'], ['hip', 'Walmdach'], ['shed', 'Pultdach'], ['flat', 'Flachdach'], ['none', 'kein Dach (Geschoss folgt)']] },
          { kind: 'num', key: 'roof.pitch', label: 'Dachneigung', value: r.pitch, unit: '°', digits: 0 },
          { kind: 'select', key: 'roof.ridge', label: 'Firstrichtung', value: r.ridge, options: [['x', 'Ost–West (waagerecht im Plan)'], ['y', 'Nord–Süd (senkrecht im Plan)']] },
          { kind: 'num', key: 'roof.overhang', label: 'Dachüberstand', value: r.overhang, unit: 'm', digits: 2 },
          { kind: 'num', key: 'roof.kneeWall', label: 'Kniestock', value: r.kneeWall, unit: 'm', digits: 2 },
          { kind: 'select', key: 'roof.insulation', label: 'Dämmebene', value: r.insulation, options: [['topSlab', 'oberste Geschossdecke (Dachraum kalt)'], ['rafters', 'Dachfläche (Dachgeschoss beheizt)']] },
        ],
        'dr',
      )}</section>
      <section><h3>Lüftung</h3>${grid(
        [
          { kind: 'check', key: 'b.heatRecovery', label: 'Lüftungsanlage mit Wärmerückgewinnung', value: b.heatRecovery },
          { kind: 'num', key: 'b.etaHR', label: 'Rückwärmezahl η', value: b.etaHR * 100, unit: '%', digits: 0 },
          { kind: 'num', key: 'b.uInteriorWall', label: 'U Innenwand', value: b.uInteriorWall, unit: 'W/m²K', digits: 2 },
        ],
        'bl',
      )}</section>
      <section><h3>Notizen</h3>${grid([{ kind: 'textarea', key: 'b.notes', label: 'Bemerkungen', value: b.notes }], 'bn')}</section>`;
  };
  render();
  bindConstructionEditor(modal.body, store, render);
  bindFields(modal.body, (key, val, _el, live) => {
    if (live) return;
    applyBuildingField(store, key, val);
    render();
  });
}

export function applyBuildingField(store: Store, key: string, val: unknown): void {
  const [group, field] = key.split('.');
  store.commit((p) => {
    const b = p.building as unknown as Record<string, unknown>;
    if (key === 'project.name') {
      if (typeof val === 'string' && val.trim()) p.name = val.trim();
      p.isExample = false;
      return;
    }
    if (group === 'tpl') {
      const slot = field as ConstructionSlot;
      if (val !== 'custom') p.building.constructions[slot] = constructionFromTemplate(String(val));
      applyConstructionUValues(p.building);
      return;
    }
    if (group === 'terrain') {
      const t = p.terrain as unknown as Record<string, unknown>;
      if (typeof val === 'number') t[field] = field === 'rise' ? Math.max(0, val) : val;
      else if (typeof val === 'string') t[field] = val;
      return;
    }
    if (group === 'roof') {
      const r = p.roof as unknown as Record<string, unknown>;
      if (typeof r[field] === 'number' && typeof val === 'number') r[field] = field === 'pitch' ? Math.min(70, Math.max(0, val)) : Math.max(0, val);
      else if (typeof val === 'string') r[field] = val;
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
    if (field === 'yearBuilt' && typeof val === 'number' && val > 1800 && val < 2100) {
      applyYearBuilt(p.building, Math.round(val));
      return;
    }
    if (field === 'windowType') {
      p.building.windowType = String(val);
      applyConstructionUValues(p.building);
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
      }
    } else if (typeof b[field] === 'boolean') b[field] = !!val;
    else if (typeof b[field] === 'string') b[field] = String(val ?? '');
  });
}

// ---------- Auslegungsparameter ----------
export function designFields(p: Project, res: DesignResult): string {
  const d = p.design;
  const spacingBoxes = SPACINGS.map(
    (s) => `<label class="chip-check"><input type="checkbox" data-spacing="${s}"${d.allowedSpacings.some((x) => Math.abs(x - s) < 1e-9) ? ' checked' : ''}/><span>${cm(s)}</span></label>`,
  ).join('');
  return `
    <section><h3>Heizsystem</h3>${grid(
      [
        { kind: 'select', key: 'd.defaultFloorSystem', label: 'Standard für Fußbodenflächen', value: d.defaultFloorSystem, options: systemsFor('floor').map(([k, s]) => [k, s.label] as [string, string]) },
        { kind: 'select', key: 'd.pipe', label: 'Heizrohr (Nasssystem)', value: d.pipe, options: Object.entries(PIPES).map(([k, x]) => [k, x.label] as [string, string]) },
        { kind: 'num', key: 'd.maxCircuitLength', label: 'max. Kreislänge inkl. Anbindung', value: d.maxCircuitLength, unit: 'm', digits: 0 },
        { kind: 'num', key: 'd.maxPressureDrop', label: 'max. Druckverlust je Kreis', value: d.maxPressureDrop / 100, unit: 'mbar', digits: 0 },
        { kind: 'num', key: 'd.maxOutlets', label: 'Abgänge je neuem Verteiler', value: d.maxOutlets, digits: 0 },
        { kind: 'check', key: 'd.balanceLengths', label: 'Kreislängen je Verteiler angleichen', value: d.balanceLengths },
        { kind: 'num', key: 'd.wallDistance', label: 'Randabstand zur Wand', value: d.wallDistance * 100, unit: 'cm', digits: 1 },
        { kind: 'select', key: 'd.rollLength', label: 'Rollenlänge', value: String(d.rollLength), options: [['120', '120 m'], ['200', '200 m'], ['240', '240 m'], ['500', '500 m'], ['600', '600 m']] },
      ],
      'dp',
    )}<p class="note">${esc(HEATING_SYSTEMS[d.defaultFloorSystem]?.note ?? '')}</p></section>
    <section><h3>Zulässige Verlegeabstände</h3><div class="chip-row" id="spacing-boxes">${spacingBoxes}</div>
      <p class="note">Die automatische Auslegung wählt je Heizfläche den größten dieser Abstände, mit dem die Heizlast bei der Ziel-Vorlauftemperatur gedeckt ist. Von Hand gesetzte Abstände bleiben erhalten.</p></section>
    <section><h3>Temperaturen (EN 1264-3)</h3>${grid(
      [
        { kind: 'num', key: 'd.targetSupply', label: 'Ziel-Vorlauftemperatur', value: d.targetSupply, unit: '°C', digits: 1, hint: 'Wärmepumpe: 30–35 °C' },
        { kind: 'num', key: 'd.sigmaDesign', label: 'Spreizung σ Auslegungsraum', value: d.sigmaDesign, unit: 'K', digits: 1 },
        { kind: 'check', key: 'd.autoSupply', label: 'Vorlauftemperatur automatisch ermitteln', value: d.supplyTempFixed == null },
        { kind: 'num', key: 'd.supplyTempFixed', label: 'feste Vorlauftemperatur', value: d.supplyTempFixed ?? res.thetaSupply, unit: '°C', digits: 1 },
        { kind: 'readout', label: 'aktuelle Vorlauftemperatur', value: `${num(res.thetaSupply, 1)} °C${res.thetaSupplyAuto ? ' (auto)' : ' (fest)'}` },
      ],
      'dt',
    )}${res.designRoomId ? `<p class="note">Maßgebender Raum: <b>${esc(roomName(p, res.designRoomId))}</b>.</p>` : ''}</section>
    <section><h3>Fußbodenaufbau</h3>${grid(
      [
        { kind: 'select', key: 'd.screed', label: 'Estrich', value: d.screed, options: Object.entries(SCREEDS).map(([k, s]) => [k, s.label] as [string, string]) },
        { kind: 'num', key: 'd.lambdaScreed', label: 'λ Estrich', value: d.lambdaScreed, unit: 'W/(m·K)', digits: 2 },
        { kind: 'num', key: 'd.screedCover', label: 'Rohrüberdeckung Nasssystem s_ü', value: d.screedCover * 1000, unit: 'mm', digits: 0 },
        { kind: 'num', key: 'd.milledCover', label: 'Rohrüberdeckung Fräs-System', value: d.milledCover * 1000, unit: 'mm', digits: 0 },
        { kind: 'num', key: 'd.insulationThickness', label: 'Dämmung unter System', value: d.insulationThickness * 1000, unit: 'mm', digits: 0 },
        { kind: 'num', key: 'd.lambdaInsulation', label: 'λ Dämmung', value: d.lambdaInsulation, unit: 'W/(m·K)', digits: 3 },
      ],
      'df',
    )}<p class="note">Aufbauhöhe Nasssystem ca. ${num(d.insulationThickness * 1000 + d.screedCover * 1000 + 16 + 10, 0)} mm ohne Belag (Dämmung + Rohr + Überdeckung).</p></section>`;
}

export function applyDesignField(store: Store, key: string, val: unknown): void {
  const field = key.split('.')[1];
  const n = typeof val === 'number' ? val : null;
  store.commit((p) => {
    const d = p.design;
    switch (field) {
      case 'defaultFloorSystem':
        d.defaultFloorSystem = String(val);
        break;
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
      case 'maxOutlets':
        if (n && n >= 2) d.maxOutlets = Math.round(n);
        break;
      case 'balanceLengths':
        d.balanceLengths = !!val;
        break;
      case 'wallDistance':
        if (n !== null && n >= 0) d.wallDistance = n / 100;
        break;
      case 'rollLength':
        d.rollLength = Number(val);
        break;
      case 'targetSupply':
        if (n && n > 22 && n < 70) d.targetSupply = n;
        break;
      case 'sigmaDesign':
        if (n && n >= 1 && n <= 15) d.sigmaDesign = n;
        break;
      case 'autoSupply':
        d.supplyTempFixed = val ? null : Math.round(d.targetSupply);
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
      case 'milledCover':
        if (n && n >= 8) d.milledCover = n / 1000;
        break;
      case 'insulationThickness':
        if (n !== null && n >= 0) d.insulationThickness = n / 1000;
        break;
      case 'lambdaInsulation':
        if (n && n > 0.01) d.lambdaInsulation = n;
        break;
    }
  });
}

export function bindSpacingBoxes(root: HTMLElement, store: Store, after: () => void): void {
  root.addEventListener('change', (e) => {
    const el = e.target as HTMLInputElement;
    if (!el.dataset.spacing) return;
    const sp = Number(el.dataset.spacing);
    store.commit((p) => {
      const set = new Set(p.design.allowedSpacings.map((x) => Math.round(x * 1000)));
      if (el.checked) set.add(Math.round(sp * 1000));
      else set.delete(Math.round(sp * 1000));
      if (set.size === 0) set.add(Math.round(sp * 1000));
      p.design.allowedSpacings = [...set].map((x) => x / 1000).sort((a, b) => a - b);
    });
    after();
  });
}

export function openDesignDialog(store: Store, onAutoLayout: () => void): void {
  const modal = openModal('Auslegung Flächenheizung', { wide: true });
  const render = () => {
    modal.body.innerHTML = `${designFields(store.project, store.design)}
      <section><h3>Automatische Auslegung</h3><p class="note">Ordnet alle Räume den Verteilern zu (Kapazität beachtet), führt die Anbindeleitungen um Wände und durch Türen und wählt die Verlegeabstände.</p>
      <div class="actions"><button class="btn primary" data-act="auto"${store.project.floors.some((f) => f.manifolds.length) ? '' : ' disabled title="Zuerst einen Verteiler setzen"'}>Jetzt automatisch verteilen</button></div></section>`;
  };
  render();
  modal.body.addEventListener('click', (e) => {
    const t = (e.target as HTMLElement).closest('[data-act="auto"]') as HTMLButtonElement | null;
    if (!t || t.disabled) return;
    onAutoLayout();
    render();
  });
  bindSpacingBoxes(modal.body, store, render);
  bindFields(modal.body, (key, val, _el, live) => {
    if (live || !key.startsWith('d.')) return;
    applyDesignField(store, key, val);
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
export type ResultsTab = 'rooms' | 'surfaces' | 'circuits' | 'manifolds' | 'material';

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
        head: ['Geschoss', 'Raum', 'A [m²]', 'θ_int [°C]', 'Φ_T [W]', 'Φ_V [W]', 'Φ_HL [W]', 'W/m²', 'Heizflächen', 'Leistung [W]', 'Zusatz [W]', 'Hinweis'],
        align: ['l', 'l', 'r', 'r', 'r', 'r', 'r', 'r', 'l', 'r', 'r', 'l'],
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
            r.area > 0 ? n(r.heatLoad.total / r.area, 0) : '–',
            r.surfaces.map((s) => s.label).join(' + ') || '–',
            r.hasHeating ? n(r.output, 0) : '–',
            r.deficit > 5 ? n(r.deficit, 0) : '',
            r.warnings.map((w) => WARNING_TEXT[w]).join(' '),
          ];
        }),
        foot: ['Summe', '', n(rooms.reduce((a, r) => a + r.area, 0), 2), '', n(rooms.reduce((a, r) => a + r.heatLoad.transmission, 0), 0), n(rooms.reduce((a, r) => a + r.heatLoad.ventilation, 0), 0), n(d.totals.heatLoad, 0), '', '', n(d.totals.output, 0), n(d.totals.deficit, 0), ''],
      };
    case 'surfaces': {
      const list = rooms.flatMap((r) => r.surfaces.map((s) => ({ r, s })));
      return {
        head: ['Raum', 'Heizfläche', 'System', 'A [m²]', 'VA [cm]', 'Last [W]', 'q [W/m²]', 'q_G [W/m²]', 'θ_O [°C]', 'σ [K]', 'θ_R [°C]', 'ṁ [kg/h]', 'Kreise', 'Elektro [W]'],
        align: ['l', 'l', 'l', 'r', 'r', 'r', 'r', 'r', 'r', 'r', 'r', 'r', 'r', 'r'],
        rows: list.map(({ r, s }) => [
          r.name,
          SURFACE_LABEL[s.kind],
          HEATING_SYSTEMS[s.system]?.short ?? s.system,
          n(s.area, 2),
          s.medium === 'water' ? n(s.spacing * 100, 1) : '–',
          n(s.load, 0),
          n(s.qRequired, 0),
          n(s.qLimit, 0),
          n(s.surfaceTemp, 1),
          s.medium === 'water' ? n(s.sigma, 1) : '–',
          s.medium === 'water' ? n(s.thetaReturn, 1) : '–',
          s.medium === 'water' ? n(s.massFlow, 0) : '–',
          s.circuits.length,
          s.electric ? n(s.electric.installed, 0) : '',
        ]),
      };
    }
    case 'circuits': {
      const cs = rooms.flatMap((r) => r.circuits.map((c) => ({ c, r })));
      return {
        head: ['Verteiler', 'Heizkreis', 'Geschoss', 'Rohr', 'Fläche [m²]', 'im Raum [m]', 'Anbindung [m]', 'Gesamt [m]', 'ṁ [kg/h]', 'V̇ [l/min]', 'v [m/s]', 'Δp [mbar]', 'Drossel [mbar]'],
        align: ['l', 'l', 'l', 'l', 'r', 'r', 'r', 'r', 'r', 'r', 'r', 'r', 'r'],
        rows: cs
          .sort((a, b) => (a.r.manifoldId ?? '').localeCompare(b.r.manifoldId ?? ''))
          .map(({ c, r }) => [
            d.manifolds.find((m) => m.manifoldId === r.manifoldId)?.name ?? '–',
            c.label,
            floorName(p, c.floorId),
            c.pipe.replace('x', '×'),
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
        foot: ['Summe', `${cs.length} Kreise`, '', '', n(d.totals.activeArea, 2), n(d.totals.pipeInRooms), n(d.totals.pipeFeeders), n(d.totals.pipeTotal), n(d.totals.massFlow, 0), '', '', '', ''],
      };
    }
    case 'manifolds':
      return {
        head: ['Verteiler', 'Geschoss', 'Abgänge', 'Leistung [W]', 'ṁ [kg/h]', 'max. Δp [mbar]', 'Kreise min–max [m]', 'Streuung', 'Zuleitung einfach [m]', 'Vor- + Rücklauf [m]', 'Dimension', 'v [m/s]', 'Δp Zuleitung [mbar]'],
        align: ['l', 'l', 'r', 'r', 'r', 'r', 'r', 'r', 'r', 'r', 'l', 'r', 'r'],
        rows: d.manifolds.map((m) => [m.name, floorName(p, m.floorId), `${m.outlets}/${m.maxOutlets}`, n(m.heat, 0), n(m.massFlow, 0), n(m.maxPressureDrop / 100, 0), `${n(m.lengthMin, 1)}–${n(m.lengthMax, 1)}`, `${n(m.lengthSpread * 100, 0)} %`, n(m.supplyLength, 2), n(2 * m.supplyLength, 2), m.supplyPipe ?? '–', n(m.supplyVelocity, 2), n(m.supplyPressureDrop / 100, 0)]),
        foot: ['Summe', '', d.totals.circuits, n(d.totals.output, 0), n(d.totals.massFlow, 0), '', '', '', '', n(d.totals.supplyLinesTotal, 2), '', '', ''],
      };
    case 'material': {
      const rows: (string | number)[][] = [];
      for (const [k, x] of Object.entries(d.totals.pipeByType)) rows.push(['Heizrohr', PIPES[k]?.label ?? k, `${n(x.length, 0)} m`, `${x.circuits} Kreise · ${x.rolls} Rollen à ${d.totals.rollLength} m`]);
      rows.push(['davon Anbindeleitungen', 'Vor- und Rücklauf', `${n(d.totals.pipeFeeders, 0)} m`, '']);
      const surfaces = rooms.flatMap((r) => r.surfaces);
      const bySys = new Map<string, number>();
      for (const s of surfaces) bySys.set(s.system, (bySys.get(s.system) ?? 0) + s.area);
      for (const [k, a] of bySys) rows.push(['Heizfläche', HEATING_SYSTEMS[k]?.label ?? k, `${n(a, 1)} m²`, k === 'electric' ? `${n(d.totals.electricInstalled, 0)} W Anschlussleistung, ${d.totals.electricCircuits} Stromkreise` : '']);
      rows.push(['Randdämmstreifen', '', `${n(d.totals.edgeStrip, 0)} m`, 'Raumumfänge der Räume mit Fußbodenheizung']);
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
