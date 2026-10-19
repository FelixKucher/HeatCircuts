// Start-Assistent für ein neues Projekt: Gebäudeart → Ausrichtung und Gelände → Standort (Karte, Klima)
// → Gebäude (Baujahr, Geschosse, Dach) → Heizung (Wärmeerzeuger, System) → Einstieg in den Grundriss.

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

export type WizardEntry = 'draw' | 'image' | 'dxf' | 'sample';

export interface WizardHost {
  finish(entry: WizardEntry): void;
  toast(text: string, kind?: 'info' | 'warn'): void;
}

const STEPS = ['Gebäudeart', 'Ausrichtung', 'Standort', 'Gebäude', 'Heizung', 'Grundriss'];

const HOUSES: { id: HouseType; label: string; note: string; attached: Compass4[]; icon: string }[] = [
  { id: 'efh', label: 'Einfamilienhaus', note: 'freistehend', attached: [], icon: '<path d="M8 30V17L20 8l12 9v13z"/><path d="M17 30v-7h6v7"/>' },
  { id: 'bungalow', label: 'Bungalow', note: 'eingeschossig', attached: [], icon: '<path d="M4 30V20l16-7 16 7v10z"/><path d="M17 30v-6h6v6"/>' },
  { id: 'villa', label: 'Stadtvilla', note: 'zwei Vollgeschosse, Walmdach', attached: [], icon: '<path d="M9 30V14h22v16z"/><path d="M6 14l14-7 14 7"/><path d="M14 20h4M22 20h4M17 30v-5h6v5"/>' },
  { id: 'dhh', label: 'Doppelhaushälfte', note: 'eine Seite angebaut', attached: ['O'], icon: '<path d="M4 30V17l9-8 9 8v13z" class="dim"/><path d="M20 30V17l9-8 9 8v13z" transform="translate(-2 0)"/>' },
  { id: 'reh', label: 'Reihenendhaus', note: 'eine Seite angebaut', attached: ['O'], icon: '<path d="M2 30V16l7-6 7 6v14z"/><path d="M16 30V16l7-6 7 6v14zM30 30V16l7-6 7 6v14z" class="dim"/>' },
  { id: 'rmh', label: 'Reihenmittelhaus', note: 'zwei Seiten angebaut', attached: ['O', 'W'], icon: '<path d="M2 30V16l7-6 7 6v14zM30 30V16l7-6 7 6v14z" class="dim"/><path d="M16 30V16l7-6 7 6v14z"/>' },
  { id: 'mfh', label: 'Mehrfamilienhaus', note: 'ganzes Gebäude', attached: [], icon: '<path d="M8 32V8h24v24z"/><path d="M13 13h4M23 13h4M13 19h4M23 19h4M13 25h4M23 25h4"/>' },
  { id: 'whg', label: 'Wohnung', note: 'eine Einheit im Mehrfamilienhaus', attached: [], icon: '<path d="M8 32V8h24v24z" class="dim"/><path d="M8 20h24v6H8z"/>' },
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
        const h = HOUSES.find((x) => x.id === site.houseType)!;
        let extra = '';
        if (['dhh', 'reh', 'rmh'].includes(site.houseType))
          extra = `<section><h3>Angebaute Seite${site.houseType === 'rmh' ? 'n' : ''} (im Grundriss: oben = Norden der Zeichnung)</h3><div class="chips">${(['N', 'O', 'S', 'W'] as Compass4[])
            .map((c) => `<button class="chip-btn${site.attached.includes(c) ? ' on' : ''}" data-wz-attach="${c}">${{ N: 'oben', O: 'rechts', S: 'unten', W: 'links' }[c]}</button>`)
            .join('')}</div><p class="note">Die Außenwand auf dieser Seite wird als Haustrennwand zum beheizten Nachbarhaus behandelt (Annahme ${num(site.neighbourTemp, 0)} °C).</p></section>`;
        if (site.houseType === 'whg')
          extra = `<section><h3>Lage der Wohnung</h3><div class="chips">${(
            [
              ['ground', 'Erdgeschoss'],
              ['middle', 'Zwischengeschoss'],
              ['top', 'Dachgeschoss'],
            ] as const
          )
            .map(([k, l]) => `<button class="chip-btn${site.unitPosition === k ? ' on' : ''}" data-wz-unit="${k}">${l}</button>`)
            .join('')}</div><p class="note">Böden und Decken zu Nachbarwohnungen gehen mit der angenommenen Nachbartemperatur ein; Wohnungstrennwände legen Sie nach dem Zeichnen je Wand fest.</p></section>`;
        return `<p class="lead">Was planen Sie? Die Gebäudeart setzt sinnvolle Vorgaben für Nachbarn, Geschosse und Dach. Alles lässt sich später ändern.</p>
          <div class="house-cards">${HOUSES.map((x) => `<button class="house-card${x.id === site.houseType ? ' is-active' : ''}" data-wz-house="${x.id}" aria-pressed="${x.id === site.houseType}"><svg viewBox="0 0 40 36" aria-hidden="true">${x.icon}</svg><b>${esc(x.label)}</b><span>${esc(x.note)}</span></button>`).join('')}</div>
          ${extra}
          <section><h3>Projekt</h3>${this.grid([
            { kind: 'text', key: 'project.name', label: 'Projektname', value: p.name },
            { kind: 'text', key: 'b.client', label: 'Bauherr', value: b.client },
          ])}</section>
          <p class="note">Gewählt: ${esc(h.label)}.</p>`;
      }
      case 1: {
        const ang = site.north;
        return `<p class="lead">Wo liegt Norden in Ihrem Grundriss? Klicken oder ziehen Sie auf der Windrose. Das bestimmt Himmelsrichtungen der Wände, die Sonne in 3D und die Lage am Hang.</p>
          <div class="orient">
            <svg class="compass-dial" viewBox="-110 -110 220 220" data-wz-dial="1" role="slider" aria-label="Nordrichtung" aria-valuenow="${ang}" tabindex="0">
              <circle r="100" class="cd-ring"/>
              ${Array.from({ length: 24 }, (_, i) => `<line x1="0" y1="-100" x2="0" y2="${i % 6 === 0 ? -84 : -92}" transform="rotate(${i * 15})" class="cd-tick"/>`).join('')}
              <rect x="-34" y="-28" width="68" height="56" rx="3" class="cd-house"/><path d="M-34 -28 L0 -50 L34 -28" class="cd-house"/><text y="6" class="cd-plan">Plan</text>
              <g transform="rotate(${ang})"><path d="M0 -98 L10 -64 L0 -70 L-10 -64 Z" class="cd-north"/><text y="-104" class="cd-n">N</text></g>
            </svg>
            <div>${this.grid([
              { kind: 'num', key: 'site.north', label: 'Nordrichtung (Drehung von Plan-oben im Uhrzeigersinn)', value: ang, unit: '°', digits: 0 },
            ])}
            <div class="chips">${[0, 45, 90, 135, 180, 225, 270, 315].map((a) => `<button class="chip-btn${a === ang ? ' on' : ''}" data-wz-north="${a}">${a}°</button>`).join('')}</div>
            <section><h3>Gelände</h3>${this.grid([
              { kind: 'select', key: 'terrain.type', label: 'Gelände', value: p.terrain.type, options: [['flat', 'eben'], ['slope', 'Hanglage']] },
              { kind: 'num', key: 'terrain.gradeLow', label: p.terrain.type === 'slope' ? 'Geländehöhe Talseite (zu OK FFB EG)' : 'Geländehöhe (zu OK FFB EG)', value: p.terrain.gradeLow, unit: 'm', digits: 2 },
              ...(p.terrain.type === 'slope'
                ? ([
                    { kind: 'num', key: 'terrain.rise', label: 'Anstieg über die Hausbreite', value: p.terrain.rise, unit: 'm', digits: 2 },
                    { kind: 'select', key: 'terrain.uphill', label: 'Bergseite (im Plan)', value: p.terrain.uphill, options: [['N', 'oben'], ['O', 'rechts'], ['S', 'unten'], ['W', 'links']] },
                  ] as FieldSpec[])
                : []),
            ])}<p class="note">Bei Hanglage berechnet HeatCircuits die Erdanschüttung je Außenwand (EN ISO 13370), z. B. Garage talseitig auf Geländeniveau, Rückwand bergseitig im Erdreich.</p></section></div>
          </div>`;
      }
      case 2:
        return this.locationHtml(p);
      case 3: {
        const ac = AGE_CLASSES.find((a) => b.yearBuilt <= a.until);
        const tpl = (slot: ConstructionSlot) => Object.entries(CONSTRUCTION_TEMPLATES).filter(([, t]) => t.slot === slot).map(([k, t]) => [k, t.label] as [string, string]);
        const u = (slot: ConstructionSlot) => num(uValue(slot, b.constructions[slot].layers), 2);
        const presets: [string, string][] = site.houseType === 'whg' ? [['eg', 'eine Ebene']] : site.houseType === 'bungalow' ? [['eg', 'EG'], ['kg-eg', 'Keller + EG']] : [['eg', 'EG'], ['eg-og', 'EG + OG'], ['eg-dg', 'EG + Dachgeschoss'], ['eg-og-dg', 'EG + OG + DG'], ['kg-eg-og', 'Keller + EG + OG']];
        const floorsTxt = p.floors.slice().sort((a, c) => a.elevation - c.elevation).map((f) => f.name).join(' · ');
        return `<section><h3>Baujahr und Bauteile</h3>${this.grid([
            { kind: 'num', key: 'b.yearBuilt', label: 'Baujahr', value: b.yearBuilt, digits: 0, hint: `Baualtersklasse ${ac?.label ?? ''} – Aufbauten werden vorbelegt` },
            { kind: 'select', key: 'b.windowType', label: 'Fenster', value: b.windowType, options: Object.entries(WINDOW_TYPES).map(([k, w]) => [k, `${w.label} · U ${num(w.u, 2)}`] as [string, string]) },
            { kind: 'select', key: 'tpl.extWall', label: `Außenwand · U ${u('extWall')}`, value: b.constructions.extWall.template, options: [...tpl('extWall'), ['custom', 'eigener Aufbau']] },
            { kind: 'select', key: 'b.basement', label: 'Unter dem untersten Geschoss', value: b.basement, options: [['none', 'Bodenplatte auf Erdreich'], ['unheated', 'unbeheizter Keller']] },
          ])}<p class="note">Jedes Bauteil lässt sich nach dem Zeichnen einzeln anpassen (Phase „Bauteile“).</p></section>
          <section><h3>Geschosse</h3><div class="chips">${presets.map(([k, l]) => `<button class="chip-btn" data-wz-preset="${k}">${l}</button>`).join('')}</div><p class="note">Aktuell: ${esc(floorsTxt)}. Weitere Geschosse fügen Sie jederzeit über die Geschossleiste hinzu.</p></section>
          ${site.houseType !== 'whg' ? `<section><h3>Dach</h3>${this.grid([
            { kind: 'select', key: 'roof.type', label: 'Dachform', value: p.roof.type, options: [['gable', 'Satteldach'], ['hip', 'Walmdach'], ['shed', 'Pultdach'], ['flat', 'Flachdach'], ['none', 'kein Dach']] },
            { kind: 'num', key: 'roof.pitch', label: 'Dachneigung', value: p.roof.pitch, unit: '°', digits: 0 },
            { kind: 'select', key: 'roof.insulation', label: 'Dämmebene', value: p.roof.insulation, options: [['topSlab', 'oberste Geschossdecke (Dachraum kalt)'], ['rafters', 'Dachfläche (Dachgeschoss beheizt)']] },
          ])}</section>` : ''}`;
      }
      case 4:
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
        return `<p class="lead">Wie möchten Sie den Grundriss erstellen?</p>
          <div class="entry-cards">
            <button class="entry-card" data-wz-entry="draw"><svg viewBox="0 0 40 32"><rect x="4" y="4" width="20" height="16" class="e-wall"/><rect x="24" y="4" width="12" height="24" class="e-wall"/><path d="M8 24h12" class="e-dim"/></svg><b>Direkt zeichnen</b><span>Räume aufziehen, Wände zeichnen, Türen und Fenster setzen</span></button>
            <button class="entry-card" data-wz-entry="image"><svg viewBox="0 0 40 32"><rect x="4" y="4" width="32" height="24" rx="2" class="e-img"/><path d="M4 22l9-8 7 6 5-4 11 8" class="e-img"/></svg><b>Grundrissbild übernehmen</b><span>Bild oder Scan laden, Maßstab kalibrieren, nachzeichnen oder Räume erkennen lassen</span></button>
            <button class="entry-card" data-wz-entry="dxf"><svg viewBox="0 0 40 32"><path d="M6 26V6h20l8 8v12z" class="e-img"/><text x="11" y="22" class="e-txt">DXF</text></svg><b>DXF-Grundriss laden</b><span>CAD-Plan des Architekten maßstäblich als Vorlage (AutoCAD, CADCraft)</span></button>
            <button class="entry-card" data-wz-entry="sample"><svg viewBox="0 0 40 32"><path d="M6 28V14L20 4l14 10v14z" class="e-wall"/></svg><b>Beispielhaus ansehen</b><span>fertig geplantes Einfamilienhaus zum Ausprobieren</span></button>
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
    const dial = target.closest('[data-wz-dial]') as SVGSVGElement | null;
    if (dial) {
      const r = dial.getBoundingClientRect();
      const dx = (e as MouseEvent).clientX - (r.left + r.width / 2);
      const dy = (e as MouseEvent).clientY - (r.top + r.height / 2);
      const ang = Math.round(((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360 / 5) * 5;
      this.store.commit((p) => (p.site.north = ang % 360));
      this.render();
      return;
    }
    const t = target.closest('button') as HTMLButtonElement | null;
    if (!t || t.disabled) return;
    const ds = t.dataset;
    if (ds.wz === 'close') return this.close();
    if (ds.wz === 'prev') return this.open(this.step - 1);
    if (ds.wz === 'next') return this.open(this.step + 1);
    if (ds.wzStep) return this.open(Number(ds.wzStep));
    if (ds.wzHouse) {
      const h = HOUSES.find((x) => x.id === ds.wzHouse)!;
      this.store.commit((p) => {
        p.site.houseType = h.id;
        p.site.attached = h.attached.slice();
        if (h.id === 'villa') p.roof = { ...p.roof, type: 'hip', pitch: 22 };
        if (h.id === 'bungalow') p.roof = { ...p.roof, type: 'hip', pitch: 25 };
        if (h.id === 'whg') p.roof = { ...p.roof, type: 'none' };
        if (h.id === 'mfh') p.roof = { ...p.roof, type: 'gable', pitch: 35 };
      });
      return this.render();
    }
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
    if (ds.wzNorth) {
      this.store.commit((p) => (p.site.north = Number(ds.wzNorth)));
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
      if (f === 'north' && numv !== null) s.commit((p) => (p.site.north = ((Math.round(numv) % 360) + 360) % 360));
      return this.render();
    }
    if (g === 'terrain') {
      s.commit((p) => {
        const t = p.terrain as unknown as Record<string, unknown>;
        if (typeof val === 'number') t[f] = f === 'rise' ? Math.max(0, val) : val;
        else if (typeof val === 'string') t[f] = val;
      });
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
