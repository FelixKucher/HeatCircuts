// Start-Assistent für ein neues Projekt: Gebäude (Art, Baujahr, Geschosse) → Standort (Karte, Klima)
// → Heizung (Wärmeerzeuger, System) → Zeichnung laden (PDF, DXF, Bild, IFC) oder ohne Vorlage beginnen.

import type { Compass4, ConstructionSlot, HouseType, Project } from '../model/types';
import type { Store } from '../model/store';
import { CLIMATE_LOCATIONS, HEAT_SOURCE_TYPES } from '../model/catalog';
import { AGE_CLASSES, CONSTRUCTION_TEMPLATES, WINDOW_TYPES, uValue } from '../model/constructions';
import { systemsFor } from '../model/systems';
import { applyYearBuilt, newFloor } from '../model/factory';
import { EUROPE_MAP } from '../model/europe-map';
import { estimateClimate, guessAltitude } from '../calc/climate';
import { bindFields, fieldHtml, type FieldSpec, type FieldValue } from './forms';
import { applyBuildingField, bindSpacingBoxes, locationOptions } from './dialogs';
import { esc, num } from './format';

export type WizardEntry = 'draw' | 'pdf' | 'image' | 'dxf' | 'ifc' | 'sample';

export interface WizardHost {
  finish(entry: WizardEntry): void;
  toast(text: string, kind?: 'info' | 'warn'): void;
}

const STEPS = ['Gebäude', 'Standort', 'Heizung', 'Zeichnung'];

const HOUSES: { id: HouseType; label: string; note: string; attached: Compass4[] }[] = [
  { id: 'efh', label: 'Einfamilienhaus', note: 'freistehend', attached: [] },
  { id: 'bungalow', label: 'Bungalow', note: 'eingeschossig', attached: [] },
  { id: 'villa', label: 'Stadtvilla', note: 'zwei Vollgeschosse, Walmdach', attached: [] },
  { id: 'dhh', label: 'Doppelhaushälfte', note: 'eine Seite angebaut', attached: ['O'] },
  { id: 'reh', label: 'Reihenendhaus', note: 'eine Seite angebaut', attached: ['O'] },
  { id: 'rmh', label: 'Reihenmittelhaus', note: 'zwei Seiten angebaut', attached: ['O', 'W'] },
  { id: 'mfh', label: 'Mehrfamilienhaus', note: 'ganzes Gebäude', attached: [] },
  { id: 'whg', label: 'Wohnung', note: 'eine Einheit im Mehrfamilienhaus', attached: [] },
];

const GENERATOR_SUPPLY: Record<string, number> = { wp_luft: 35, wp_sole: 35, gas: 40, oel: 40, pellet: 40, fernwaerme: 40, speicher: 38, sonstige: 40 };

// Kartenausschnitte (lon/lat)
const VIEWS = {
  dach: { lon0: 4.5, lon1: 18, lat0: 45.4, lat1: 55.4 },
  europa: { lon0: -11, lon1: 32, lat0: 35, lat1: 61.5 },
};
const COSLAT = Math.cos((50 * Math.PI) / 180);

export class StartWizard {
  private overlay: HTMLElement | null = null;
  private step = 0;
  private mapView: keyof typeof VIEWS = 'dach';

  constructor(
    private store: Store,
    private host: WizardHost,
  ) {}

  get isOpen(): boolean {
    return !!this.overlay;
  }

  open(step = 0): void {
    this.step = Math.max(0, Math.min(STEPS.length - 1, step));
    if (!this.overlay) {
      this.overlay = document.createElement('div');
      this.overlay.className = 'overlay wizard-overlay';
      this.overlay.innerHTML = `<div class="modal wide wizard" role="dialog" aria-modal="true" aria-label="Neues Projekt">
        <div class="modal-head"><h2>Neues Projekt</h2><button class="icon-btn" data-wz="close" aria-label="Assistent schließen"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg></button></div>
        <ol class="stepper"></ol><div class="modal-body wizard-body"></div>
        <div class="wizard-foot"><button class="btn" data-wz="prev">Zurück</button><span class="wz-count"></span><button class="btn primary" data-wz="next">Weiter</button></div></div>`;
      document.body.appendChild(this.overlay);
      const body = this.overlay.querySelector('.wizard-body') as HTMLElement;
      this.overlay.addEventListener('click', (e) => this.onClick(e));
      bindFields(body, (k, v, el, live) => this.onField(k, v, el, live));
      bindSpacingBoxes(body, this.store, () => this.render());
      document.addEventListener('keydown', this.onKey, true);
    }
    this.render();
  }

  close(): void {
    this.overlay?.remove();
    this.overlay = null;
    document.removeEventListener('keydown', this.onKey, true);
  }

  private onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && this.overlay) {
      e.stopPropagation();
      this.close();
    }
  };

  render(): void {
    if (!this.overlay) return;
    const p = this.store.project;
    this.overlay.querySelector('.stepper')!.innerHTML = STEPS.map((s, i) => `<li class="${i === this.step ? 'current' : i < this.step ? 'done' : ''}"><button data-wz-step="${i}">${i + 1}. ${s}</button></li>`).join('');
    const body = this.overlay.querySelector('.wizard-body') as HTMLElement;
    const scroll = body.scrollTop;
    body.innerHTML = this.stepHtml(p);
    body.scrollTop = scroll;
    (this.overlay.querySelector('[data-wz="prev"]') as HTMLButtonElement).disabled = this.step === 0;
    const next = this.overlay.querySelector('[data-wz="next"]') as HTMLButtonElement;
    next.hidden = this.step === STEPS.length - 1;
    this.overlay.querySelector('.wz-count')!.textContent = `Schritt ${this.step + 1} von ${STEPS.length}`;
  }

  private grid(fields: FieldSpec[]): string {
    return `<div class="fields cols">${fields.map((f) => fieldHtml(f, 'wz')).join('')}</div>`;
  }

  private stepHtml(p: Project): string {
    const site = p.site;
    const b = p.building;
    switch (this.step) {
      case 0: {
        const ac = AGE_CLASSES.find((a) => b.yearBuilt <= a.until);
        const tpl = (slot: ConstructionSlot) => Object.entries(CONSTRUCTION_TEMPLATES).filter(([, t]) => t.slot === slot).map(([k, t]) => [k, t.label] as [string, string]);
        const u = (slot: ConstructionSlot) => num(uValue(slot, b.constructions[slot].layers), 2);
        const presets: [string, string][] = site.houseType === 'whg' ? [['eg', 'eine Ebene']] : site.houseType === 'bungalow' ? [['eg', 'EG'], ['kg-eg', 'Keller + EG']] : [['eg', 'EG'], ['eg-og', 'EG + OG'], ['eg-dg', 'EG + Dachgeschoss'], ['eg-og-dg', 'EG + OG + DG'], ['kg-eg-og', 'Keller + EG + OG']];
        const floorsTxt = p.floors.slice().sort((a, c) => a.elevation - c.elevation).map((f) => f.name).join(' · ');
        let extra = '';
        if (['dhh', 'reh', 'rmh'].includes(site.houseType))
          extra = `<div class="field wide"><span class="lab">Angebaute Seite${site.houseType === 'rmh' ? 'n' : ''} (im Plan)</span><div class="chips">${(['N', 'O', 'S', 'W'] as Compass4[])
            .map((c) => `<button class="chip-btn${site.attached.includes(c) ? ' on' : ''}" data-wz-attach="${c}">${{ N: 'oben', O: 'rechts', S: 'unten', W: 'links' }[c]}</button>`)
            .join('')}</div><span class="hint">Außenwände dieser Seite gelten als Trennwand zum beheizten Nachbarn (${num(site.neighbourTemp, 0)} °C).</span></div>`;
        if (site.houseType === 'whg')
          extra = `<div class="field wide"><span class="lab">Lage der Wohnung</span><div class="chips">${(
            [
              ['ground', 'Erdgeschoss'],
              ['middle', 'Zwischengeschoss'],
              ['top', 'Dachgeschoss'],
            ] as const
          )
            .map(([k, l]) => `<button class="chip-btn${site.unitPosition === k ? ' on' : ''}" data-wz-unit="${k}">${l}</button>`)
            .join('')}</div></div>`;
        return `<p class="lead">Die wichtigsten Angaben für die Heizlast. Alles lässt sich später unter „Gebäude“ ändern.</p>
          <section><h3>Projekt</h3>${this.grid([
            { kind: 'text', key: 'project.name', label: 'Projektname', value: p.name },
            { kind: 'text', key: 'b.client', label: 'Bauherr', value: b.client },
          ])}</section>
          <section><h3>Gebäude</h3><div class="fields cols">${fieldHtml({ kind: 'select', key: 'site.houseType', label: 'Gebäudeart', value: site.houseType, options: HOUSES.map((x) => [x.id, `${x.label} · ${x.note}`] as [string, string]) }, 'wz')}${extra}</div>
          ${this.grid([
            { kind: 'num', key: 'b.yearBuilt', label: 'Baujahr', value: b.yearBuilt, digits: 0, hint: `Baualtersklasse ${ac?.label ?? ''} – Aufbauten werden vorbelegt` },
            { kind: 'select', key: 'b.windowType', label: 'Fenster', value: b.windowType, options: Object.entries(WINDOW_TYPES).map(([k, w]) => [k, `${w.label} · U ${num(w.u, 2)}`] as [string, string]) },
            { kind: 'select', key: 'tpl.extWall', label: `Außenwand · U ${u('extWall')}`, value: b.constructions.extWall.template, options: [...tpl('extWall'), ['custom', 'eigener Aufbau']] },
            { kind: 'select', key: 'b.basement', label: 'Unter dem untersten Geschoss', value: b.basement, options: [['none', 'Bodenplatte auf Erdreich'], ['unheated', 'unbeheizter Keller']] },
            ...(site.houseType !== 'whg'
              ? ([{ kind: 'select', key: 'roof.insulation', label: 'Oberer Abschluss', value: p.roof.insulation, options: [['topSlab', 'oberste Geschossdecke (Dachraum kalt)'], ['rafters', 'Dachschräge (Dachgeschoss beheizt)']] }] as FieldSpec[])
              : []),
          ])}</section>
          <section><h3>Geschosse</h3><div class="chips">${presets.map(([k, l]) => `<button class="chip-btn" data-wz-preset="${k}">${l}</button>`).join('')}</div><p class="note">Aktuell: ${esc(floorsTxt)}. Je Geschoss laden Sie später eine eigene Zeichnung.</p></section>`;
      }
      case 1:
        return this.locationHtml(p);
      case 2:
        return `<section><h3>Wärmeerzeuger</h3><div class="system-cards gen">${Object.entries(HEAT_SOURCE_TYPES)
          .filter(([k]) => k !== 'speicher')
          .map(([k, l]) => `<button class="system-card${p.design.generator === k ? ' is-active' : ''}" data-wz-gen="${k}" aria-pressed="${p.design.generator === k}"><b>${esc(l)}</b><span class="muted">Ziel-Vorlauf ${GENERATOR_SUPPLY[k] ?? 40} °C</span></button>`)
          .join('')}</div><p class="note">Der Ziel-Vorlauf ist ein Richtwert. Wärmepumpen arbeiten mit niedrigen Vorlauftemperaturen deutlich effizienter, daher werden engere Verlegeabstände gewählt.</p></section>
          <section><h3>Fußbodenheizung</h3><div class="system-cards">${systemsFor('floor')
            .map(([k, s]) => `<button class="system-card${p.design.defaultFloorSystem === k ? ' is-active' : ''}" data-wz-system="${k}" aria-pressed="${p.design.defaultFloorSystem === k}"><b>${esc(s.label)}</b><span>${esc(s.note)}</span></button>`)
            .join('')}</div></section>
          <section><h3>Auslegung</h3>${this.grid([{ kind: 'num', key: 'd.targetSupply', label: 'Ziel-Vorlauftemperatur', value: p.design.targetSupply, unit: '°C', digits: 1 }])}
          <div class="chips spacing-boxes">${[0.075, 0.1, 0.125, 0.15, 0.175, 0.2]
            .map((x) => `<label class="chip-check"><input type="checkbox" data-spacing="${x}"${p.design.allowedSpacings.some((y) => Math.abs(y - x) < 1e-9) ? ' checked' : ''}/> ${num(x * 100, 1).replace(/,0$/, '')} cm</label>`)
            .join('')}</div><p class="note">Zulässige Verlegeabstände der automatischen Auslegung. Wand- und Deckenheizung legen Sie später je Raum fest.</p></section>`;
      default:
        return `<p class="lead">Welche Zeichnung legen Sie zugrunde? Sie wird maßstäblich hinterlegt; darauf zeichnen Sie die Räume nach und planen die Heizkreise.</p>
          <div class="entry-cards">
            <button class="entry-card" data-wz-entry="pdf"><svg viewBox="0 0 40 32"><path d="M6 26V6h20l8 8v12z" class="e-img"/><text x="11" y="22" class="e-txt">PDF</text></svg><b>PDF-Plan</b><span>Plan des Architekten, Maßstab wird aus dem Plankopf erkannt</span></button>
            <button class="entry-card" data-wz-entry="dxf"><svg viewBox="0 0 40 32"><path d="M6 26V6h20l8 8v12z" class="e-img"/><text x="11" y="22" class="e-txt">DXF</text></svg><b>DXF-Plan</b><span>CAD-Zeichnung maßstäblich als Vektorvorlage (DWG vorher nach DXF wandeln)</span></button>
            <button class="entry-card" data-wz-entry="image"><svg viewBox="0 0 40 32"><rect x="4" y="4" width="32" height="24" rx="2" class="e-img"/><path d="M4 22l9-8 7 6 5-4 11 8" class="e-img"/></svg><b>Bild oder Scan</b><span>Maßstab mit zwei Punkten kalibrieren, Räume erkennen lassen</span></button>
            <button class="entry-card" data-wz-entry="ifc"><svg viewBox="0 0 40 32"><path d="M6 26V6h20l8 8v12z" class="e-img"/><text x="12" y="22" class="e-txt">IFC</text></svg><b>IFC-Modell (BIM)</b><span>Räume, Wände, Fenster und Türen werden direkt übernommen</span></button>
            <button class="entry-card" data-wz-entry="draw"><svg viewBox="0 0 40 32"><rect x="4" y="4" width="20" height="16" class="e-wall"/><rect x="24" y="4" width="12" height="24" class="e-wall"/></svg><b>Ohne Vorlage</b><span>Räume direkt aufziehen</span></button>
            <button class="entry-card" data-wz-entry="sample"><svg viewBox="0 0 40 32"><path d="M6 28V14L20 4l14 10v14z" class="e-wall"/></svg><b>Beispiel ansehen</b><span>fertig geplantes Einfamilienhaus</span></button>
          </div>`;
    }
  }

  // ---------- Standortkarte ----------

  private locationHtml(p: Project): string {
    const site = p.site;
    const v = VIEWS[this.mapView];
    const X = (lon: number) => (lon - v.lon0) * COSLAT;
    const Y = (lat: number) => v.lat1 - lat;
    const W = (v.lon1 - v.lon0) * COSLAT;
    const H = v.lat1 - v.lat0;
    const paths = EUROPE_MAP.map((c) => {
      const d = c.r.map((ring) => {
        let s = '';
        for (let i = 0; i < ring.length; i += 2) s += `${i ? 'L' : 'M'}${X(ring[i]).toFixed(2)} ${Y(ring[i + 1]).toFixed(2)}`;
        return s + 'Z';
      });
      const dach = c.n === 'Germany' || c.n === 'Austria' || c.n === 'Switzerland' || c.n === 'Liechtenstein';
      return `<path d="${d.join('')}" class="map-land${dach ? ' dach' : ''}"><title>${esc(c.n)}</title></path>`;
    }).join('');
    const st = Object.values(CLIMATE_LOCATIONS)
      .map((s) => `<circle cx="${X(s.lon).toFixed(2)}" cy="${Y(s.lat).toFixed(2)}" r="${this.mapView === 'dach' ? 0.07 : 0.14}" class="map-st"><title>${esc(s.label)} · θe ${num(s.thetaE, 0)} °C · ${s.alt} m</title></circle>`)
      .join('');
    const est = site.lat != null && site.lon != null ? estimateClimate(site.lat, site.lon, site.altitude) : null;
    const marker = site.lat != null && site.lon != null ? `<g class="map-marker" transform="translate(${X(site.lon).toFixed(3)} ${Y(site.lat).toFixed(3)})"><circle r="${this.mapView === 'dach' ? 0.16 : 0.32}"/><circle r="${this.mapView === 'dach' ? 0.05 : 0.1}" class="dot"/></g>` : '';
    const b = p.building;
    return `<p class="lead">Klicken Sie auf der Karte auf den Standort. Norm-Außentemperatur und Jahresmittel werden aus den nächsten Klimastationen interpoliert und auf die Höhe über NN umgerechnet.</p>
      <div class="map-wrap">
        <div class="map-box">
          <svg class="map" viewBox="0 0 ${W.toFixed(2)} ${H.toFixed(2)}" data-wz-map="1" data-lon0="${v.lon0}" data-lat1="${v.lat1}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Standortkarte">${paths}${st}${marker}</svg>
          <div class="map-ctl"><button class="chip-btn${this.mapView === 'dach' ? ' on' : ''}" data-wz-mapview="dach">D · A · CH</button><button class="chip-btn${this.mapView === 'europa' ? ' on' : ''}" data-wz-mapview="europa">Europa</button></div>
        </div>
        <div class="map-side">
          ${this.grid([
            { kind: 'text', key: 'site.place', label: 'Ort', value: site.place },
            { kind: 'num', key: 'site.altitude', label: 'Höhe über NN', value: site.altitude, unit: 'm', digits: 0, hint: 'Bitte prüfen – der Startwert ist aus den Nachbarstationen geschätzt.' },
            { kind: 'select', key: 'site.station', label: 'oder Station wählen', value: '', options: [{ group: '', options: [['', '–']] }, ...locationOptions().filter((g) => g.group !== 'Eigene Werte')] },
          ])}
          ${
            est
              ? `<div class="climate-card"><div><span class="k">Norm-Außentemperatur θe</span><b>${num(b.thetaE, 1)} °C</b></div><div><span class="k">Jahresmittel θm,e</span><b>${num(b.thetaMeanYear, 1)} °C</b></div>
                <p class="note">Interpoliert aus ${est.stations.map((x) => `${esc(x.label)} (${num(x.km, 0)} km, ${num(x.weight * 100, 0)} %)`).join(', ')}; Höhenkorrektur 0,5 K je 100 m. ${est.nearestKm > 150 ? '<b class="warn">Nächste Station über 150 km entfernt – Werte unsicher.</b>' : ''}</p></div>`
              : ''
          }
          ${this.grid([
            { kind: 'num', key: 'b.thetaE', label: 'θe übernehmen / überschreiben', value: b.thetaE, unit: '°C', digits: 1 },
            { kind: 'num', key: 'b.thetaMeanYear', label: 'θm,e', value: b.thetaMeanYear, unit: '°C', digits: 1 },
          ])}
          <p class="note">Verbindlich sind die Werte des nationalen Anhangs (DE: DIN/TS 12831-1 nach PLZ, AT: ÖNORM H 7500-1, CH: SIA 384/2).</p>
        </div>
      </div>`;
  }

  private setLocation(lat: number, lon: number, alt?: number, place?: string): void {
    const a = alt ?? guessAltitude(lat, lon);
    this.store.commit((p) => {
      p.site.lat = Math.round(lat * 1000) / 1000;
      p.site.lon = Math.round(lon * 1000) / 1000;
      p.site.altitude = a;
      if (place !== undefined) p.site.place = place;
      const est = estimateClimate(lat, lon, a);
      p.building.thetaE = est.thetaE;
      p.building.thetaMeanYear = est.thetaMeanYear;
      p.building.location = 'custom';
    });
    this.render();
  }

  // ---------- Ereignisse ----------

  private onClick(e: Event): void {
    const target = e.target as Element;
    const map = target.closest('[data-wz-map]') as SVGSVGElement | null;
    if (map) {
      const pt = map.createSVGPoint();
      pt.x = (e as MouseEvent).clientX;
      pt.y = (e as MouseEvent).clientY;
      const q = pt.matrixTransform(map.getScreenCTM()!.inverse());
      const lon = Number(map.dataset.lon0) + q.x / COSLAT;
      const lat = Number(map.dataset.lat1) - q.y;
      this.setLocation(lat, lon, undefined, '');
      return;
    }
    const t = target.closest('button') as HTMLButtonElement | null;
    if (!t || t.disabled) return;
    const ds = t.dataset;
    if (ds.wz === 'close') return this.close();
    if (ds.wz === 'prev') return this.open(this.step - 1);
    if (ds.wz === 'next') return this.open(this.step + 1);
    if (ds.wzStep) return this.open(Number(ds.wzStep));
    if (ds.wzAttach) {
      const c = ds.wzAttach as Compass4;
      this.store.commit((p) => {
        const set = new Set(p.site.attached);
        if (set.has(c)) set.delete(c);
        else set.add(c);
        p.site.attached = [...set];
      });
      return this.render();
    }
    if (ds.wzUnit) {
      this.store.commit((p) => (p.site.unitPosition = ds.wzUnit as Project['site']['unitPosition']));
      return this.render();
    }
    if (ds.wzMapview) {
      this.mapView = ds.wzMapview as keyof typeof VIEWS;
      return this.render();
    }
    if (ds.wzPreset) return this.applyPreset(ds.wzPreset);
    if (ds.wzGen) {
      this.store.commit((p) => {
        p.design.generator = ds.wzGen!;
        p.design.targetSupply = GENERATOR_SUPPLY[ds.wzGen!] ?? 40;
        if (p.heatSource) p.heatSource.type = ds.wzGen!;
      });
      return this.render();
    }
    if (ds.wzSystem) {
      this.store.commit((p) => {
        p.design.defaultFloorSystem = ds.wzSystem!;
        for (const f of p.floors) for (const r of f.rooms) for (const s of r.surfaces) if (s.kind === 'floor' && !s.spacingLocked) s.system = ds.wzSystem!;
      });
      return this.render();
    }
    if (ds.wzEntry) {
      this.store.commit((p) => (p.wizard = { done: true, step: STEPS.length - 1 }));
      this.close();
      this.host.finish(ds.wzEntry as WizardEntry);
    }
  }

  private applyPreset(key: string): void {
    const s = this.store;
    if (s.project.floors.some((f) => f.rooms.length || f.walls.length || f.background)) {
      this.host.toast('Geschossvorlagen ersetzen nur leere Geschosse.', 'warn');
      return;
    }
    s.commit((pr) => {
      const floors = [];
      if (key.startsWith('kg')) {
        const kg = newFloor('Kellergeschoss', -2.6, 2.6);
        kg.clearHeight = 2.3;
        kg.belowGrade = true;
        floors.push(kg);
      }
      floors.push(newFloor('Erdgeschoss', 0));
      let z = 2.9;
      if (key.includes('og')) {
        floors.push(newFloor('Obergeschoss', z));
        z += 2.9;
      }
      if (key.includes('dg')) {
        const dg = newFloor('Dachgeschoss', z);
        dg.clearHeight = 2.4;
        floors.push(dg);
        pr.roof.insulation = 'rafters';
      }
      pr.floors = floors;
    });
    s.setFloor(s.project.floors.find((f) => f.elevation === 0)?.id ?? s.project.floors[0].id);
    this.render();
  }

  private onField(key: string, val: FieldValue, _el: HTMLElement, live: boolean): void {
    if (live) return;
    const s = this.store;
    const [g, f] = key.split('.');
    const numv = typeof val === 'number' ? val : null;
    if (key === 'site.houseType') {
      const h = HOUSES.find((x) => x.id === val);
      if (!h) return;
      s.commit((p) => {
        p.site.houseType = h.id;
        p.site.attached = h.attached.slice();
        if (h.id === 'villa') p.roof = { ...p.roof, type: 'hip', pitch: 22 };
        if (h.id === 'bungalow') p.roof = { ...p.roof, type: 'hip', pitch: 25 };
        if (h.id === 'whg') p.roof = { ...p.roof, type: 'none' };
        if (h.id === 'mfh') p.roof = { ...p.roof, type: 'gable', pitch: 35 };
      });
      return this.render();
    }
    if (g === 'site') {
      if (f === 'station' && val) {
        const st = CLIMATE_LOCATIONS[String(val)];
        if (st) {
          this.setLocation(st.lat, st.lon, st.alt, st.label);
          s.commit((p) => {
            p.building.thetaE = st.thetaE;
            p.building.thetaMeanYear = st.thetaMeanYear;
            p.building.location = String(val);
          });
          this.render();
        }
        return;
      }
      if (f === 'altitude' && numv !== null) {
        const site = s.project.site;
        if (site.lat != null && site.lon != null) this.setLocation(site.lat, site.lon, Math.round(numv));
        else s.commit((p) => (p.site.altitude = Math.round(numv)));
        return;
      }
      if (f === 'place') s.commit((p) => (p.site.place = String(val ?? '')));
      return this.render();
    }
    if (g === 'd') {
      if (f === 'targetSupply' && numv !== null && numv > 20 && numv < 70) s.commit((p) => (p.design.targetSupply = numv));
      return this.render();
    }
    if (key === 'b.yearBuilt' && numv !== null && numv > 1800 && numv < 2100) {
      s.commit((p) => applyYearBuilt(p.building, Math.round(numv)));
      return this.render();
    }
    applyBuildingField(s, key, val);
    this.render();
  }
}
