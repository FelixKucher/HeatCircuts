// Geführter Planungsablauf: Projekt → Gebäude → Geschosse → Heizsystem → Grundrisse → Räume → Verteiler → Ergebnis.

import type { ConstructionSlot, Project } from '../model/types';
import type { Store } from '../model/store';
import { HEAT_SOURCE_TYPES, ROOM_TYPES } from '../model/catalog';
import { AGE_CLASSES, CONSTRUCTION_TEMPLATES, MATERIALS, WINDOW_TYPES, uValue } from '../model/constructions';
import { HEATING_SYSTEMS, systemsFor } from '../model/systems';
import { applyConstructionUValues, applyRoomType, newFloor, newWall } from '../model/factory';
import { bindFields, fieldHtml, type FieldSpec, type FieldValue } from './forms';
import { applyBuildingField, applyDesignField, bindSpacingBoxes, designFields, locationOptions } from './dialogs';
import { esc, level, num } from './format';

export interface WizardHost {
  uploadImage(floorId: string): void;
  startCalibrate(floorId: string): void;
  recognize(floorId: string): void;
  placeManifold(floorId: string): void;
  autoLayout(): void;
  showResults(): void;
  show3D(): void;
  toast(text: string, kind?: 'info' | 'warn'): void;
}

const STEPS = ['Projekt', 'Gebäude', 'Geschosse', 'Heizsystem', 'Grundrisse', 'Räume', 'Verteiler', 'Ergebnis'];

export class Wizard {
  private overlay: HTMLElement | null = null;
  private banner: HTMLElement;
  step = 0;

  constructor(
    private store: Store,
    private host: WizardHost,
    bannerHost: HTMLElement,
  ) {
    this.banner = document.createElement('div');
    this.banner.className = 'wizard-banner';
    this.banner.hidden = true;
    bannerHost.appendChild(this.banner);
    this.banner.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest('[data-wb]') as HTMLElement | null;
      if (!t) return;
      if (t.dataset.wb === 'back') this.open(this.step);
      if (t.dataset.wb === 'next') this.open(this.step + 1);
      if (t.dataset.wb === 'close') this.hideBanner();
    });
  }

  get isOpen(): boolean {
    return !!this.overlay;
  }

  open(step = this.store.project.wizard.step ?? 0): void {
    this.step = Math.max(0, Math.min(STEPS.length - 1, step));
    this.hideBanner();
    if (!this.overlay) {
      this.overlay = document.createElement('div');
      this.overlay.className = 'overlay wizard-overlay';
      this.overlay.innerHTML = `<div class="modal wide wizard" role="dialog" aria-modal="true" aria-label="Planungsassistent">
        <div class="modal-head"><h2>Planungsassistent</h2><button class="icon-btn" data-wz="close" aria-label="Assistent schließen"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg></button></div>
        <ol class="stepper"></ol><div class="modal-body wizard-body"></div>
        <div class="wizard-foot"><button class="btn" data-wz="prev">Zurück</button><span class="wz-count"></span><button class="btn primary" data-wz="next">Weiter</button></div></div>`;
      document.body.appendChild(this.overlay);
      this.overlay.addEventListener('click', (e) => this.onClick(e));
      bindFields(this.overlay.querySelector('.wizard-body') as HTMLElement, (k, v, el, live) => this.onField(k, v, el, live));
      bindSpacingBoxes(this.overlay.querySelector('.wizard-body') as HTMLElement, this.store, () => this.render());
      this.overlay.querySelector('.wizard-body')!.addEventListener('change', (e) => this.onLayerChange(e));
      document.addEventListener('keydown', this.onKey, true);
    }
    this.store.project.wizard.step = this.step;
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

  /** Assistent für einen Arbeitsschritt im Plan ausblenden und Hinweisleiste zeigen */
  showBanner(text: string, nextLabel = 'Weiter im Assistenten'): void {
    this.close();
    this.banner.innerHTML = `<span class="wb-step">Schritt ${this.step + 1} / ${STEPS.length} · ${STEPS[this.step]}</span><span class="wb-text">${esc(text)}</span><button class="btn small" data-wb="back">Assistent öffnen</button><button class="btn small primary" data-wb="next">${esc(nextLabel)}</button><button class="icon-btn small" data-wb="close" aria-label="Hinweis schließen"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg></button>`;
    this.banner.hidden = false;
  }

  hideBanner(): void {
    this.banner.hidden = true;
  }

  render(): void {
    if (!this.overlay) return;
    const p = this.store.project;
    const stepper = this.overlay.querySelector('.stepper')!;
    stepper.innerHTML = STEPS.map((s, i) => `<li class="${i === this.step ? 'current' : i < this.step ? 'done' : ''}"><button data-wz-step="${i}">${i + 1}. ${s}</button></li>`).join('');
    const body = this.overlay.querySelector('.wizard-body') as HTMLElement;
    const scroll = body.scrollTop;
    body.innerHTML = this.stepHtml(p);
    body.scrollTop = scroll;
    (this.overlay.querySelector('[data-wz="prev"]') as HTMLButtonElement).disabled = this.step === 0;
    (this.overlay.querySelector('[data-wz="next"]') as HTMLButtonElement).textContent = this.step === STEPS.length - 1 ? 'Fertig' : 'Weiter';
    this.overlay.querySelector('.wz-count')!.textContent = `Schritt ${this.step + 1} von ${STEPS.length}`;
  }

  private grid(fields: FieldSpec[]): string {
    return `<div class="fields cols">${fields.map((f) => fieldHtml(f, 'wz')).join('')}</div>`;
  }

  private stepHtml(p: Project): string {
    const b = p.building;
    switch (this.step) {
      case 0:
        return `<p class="lead">Der Assistent führt Sie vom Gebäude über den Grundriss bis zur fertigen Auslegung. Alle Angaben lassen sich später ändern.</p>
          <section><h3>Projekt</h3>${this.grid([
            { kind: 'text', key: 'project.name', label: 'Projektname', value: p.name },
            { kind: 'text', key: 'b.client', label: 'Bauherr', value: b.client },
            { kind: 'text', key: 'b.address', label: 'Adresse', value: b.address },
            { kind: 'text', key: 'b.planner', label: 'Planer', value: b.planner },
          ])}</section>
          <section><h3>Standort und Klima</h3>${this.grid([
            { kind: 'select', key: 'b.location', label: 'Standort', value: b.location, options: locationOptions() },
            { kind: 'num', key: 'b.thetaE', label: 'Norm-Außentemperatur θ_e', value: b.thetaE, unit: '°C', digits: 1 },
            { kind: 'num', key: 'b.thetaMeanYear', label: 'Jahresmittel θ_m,e', value: b.thetaMeanYear, unit: '°C', digits: 1 },
          ])}<p class="note">Für Deutschland gilt verbindlich die Norm-Außentemperatur nach PLZ aus DIN/TS 12831-1.</p></section>`;
      case 1: {
        const ac = AGE_CLASSES.find((a) => b.yearBuilt <= a.until);
        const ins = (slot: ConstructionSlot) => {
          const c = b.constructions[slot];
          const i = c.layers.findIndex((l) => MATERIALS[l.material]?.group === 'insulation');
          if (i < 0) return '';
          return `<label class="field" for="wz-ins-${slot}"><span class="lab">Dämmung (${esc(MATERIALS[c.layers[i].material].label)})</span><span class="inp-wrap"><input id="wz-ins-${slot}" type="text" inputmode="decimal" data-ins="${slot}.${i}" value="${num(c.layers[i].thickness * 100, 0)}"/><span class="unit">cm</span></span></label>`;
        };
        const tpl = (slot: ConstructionSlot) => Object.entries(CONSTRUCTION_TEMPLATES).filter(([, t]) => t.slot === slot).map(([k, t]) => [k, t.label] as [string, string]);
        const u = (slot: ConstructionSlot) => num(uValue(slot, b.constructions[slot].layers), 2);
        const roofSlot: ConstructionSlot = p.roof.insulation === 'rafters' ? 'roof' : 'topSlab';
        const groundSlot: ConstructionSlot = b.basement === 'unheated' ? 'basementSlab' : 'groundSlab';
        return `<section><h3>Baujahr</h3>${this.grid([
            { kind: 'num', key: 'b.yearBuilt', label: 'Baujahr des Gebäudes', value: b.yearBuilt, digits: 0, hint: `Baualtersklasse ${ac?.label ?? ''} – Aufbauten werden vorbelegt` },
            { kind: 'select', key: 'b.windowType', label: 'Fenster', value: b.windowType, options: Object.entries(WINDOW_TYPES).map(([k, w]) => [k, `${w.label} · U ${num(w.u, 2)}`] as [string, string]) },
          ])}</section>
          <section><h3>Wände</h3><div class="fields cols">
            ${fieldHtml({ kind: 'select', key: 'tpl.extWall', label: `Außenwand · U ${u('extWall')} W/m²K`, value: b.constructions.extWall.template, options: [...tpl('extWall'), ['custom', 'eigener Aufbau']] }, 'wz')}
            ${ins('extWall')}
          </div></section>
          <section><h3>Boden</h3><div class="fields cols">
            ${fieldHtml({ kind: 'select', key: 'b.basement', label: 'Unter dem untersten Geschoss', value: b.basement, options: [['none', 'Bodenplatte auf Erdreich'], ['unheated', 'unbeheizter Keller']] }, 'wz')}
            ${fieldHtml({ kind: 'select', key: `tpl.${groundSlot}`, label: `${groundSlot === 'groundSlab' ? 'Bodenplatte' : 'Kellerdecke'} · U ${u(groundSlot)} W/m²K`, value: b.constructions[groundSlot].template, options: [...tpl(groundSlot), ['custom', 'eigener Aufbau']] }, 'wz')}
            ${ins(groundSlot)}
          </div></section>
          <section><h3>Dach</h3><div class="fields cols">
            ${fieldHtml({ kind: 'select', key: 'roof.type', label: 'Dachform', value: p.roof.type, options: [['gable', 'Satteldach'], ['hip', 'Walmdach'], ['shed', 'Pultdach'], ['flat', 'Flachdach']] }, 'wz')}
            ${fieldHtml({ kind: 'num', key: 'roof.pitch', label: 'Dachneigung', value: p.roof.pitch, unit: '°', digits: 0 }, 'wz')}
            ${fieldHtml({ kind: 'select', key: 'roof.insulation', label: 'Dämmebene', value: p.roof.insulation, options: [['topSlab', 'oberste Geschossdecke (Dachraum kalt)'], ['rafters', 'Dachfläche (Dachgeschoss beheizt)']] }, 'wz')}
            ${fieldHtml({ kind: 'select', key: `tpl.${roofSlot}`, label: `${roofSlot === 'roof' ? 'Dachaufbau' : 'oberste Geschossdecke'} · U ${u(roofSlot)} W/m²K`, value: b.constructions[roofSlot].template, options: [...tpl(roofSlot), ['custom', 'eigener Aufbau']] }, 'wz')}
            ${ins(roofSlot)}
          </div><p class="note">Schichtaufbauten im Detail bearbeiten Sie jederzeit unter „Gebäude“.</p></section>`;
      }
      case 2: {
        const floors = p.floors.slice().sort((a, b2) => b2.elevation - a.elevation);
        return `<p class="lead">Legen Sie die Geschosse an. Für jedes Geschoss laden Sie im nächsten Schritt einen Grundriss.</p>
          <div class="actions"><button class="btn small" data-wz-preset="eg">EG</button><button class="btn small" data-wz-preset="eg-og">EG + OG</button><button class="btn small" data-wz-preset="eg-dg">EG + Dachgeschoss</button><button class="btn small" data-wz-preset="kg-eg-og">Keller + EG + OG</button></div>
          <div class="table-wrap"><table class="wz-table"><thead><tr><th>Geschoss</th><th>OK FFB [m]</th><th>Geschosshöhe [m]</th><th>lichte Höhe [m]</th><th>im Erdreich</th><th></th></tr></thead><tbody>
          ${floors
            .map(
              (f) => `<tr><td><input type="text" data-fl="${f.id}.name" value="${esc(f.name)}" aria-label="Bezeichnung"/></td>
              <td><input type="text" inputmode="decimal" data-fl="${f.id}.elevation" value="${num(f.elevation, 2)}" aria-label="Höhe"/></td>
              <td><input type="text" inputmode="decimal" data-fl="${f.id}.storeyHeight" value="${num(f.storeyHeight, 2)}" aria-label="Geschosshöhe"/></td>
              <td><input type="text" inputmode="decimal" data-fl="${f.id}.clearHeight" value="${num(f.clearHeight, 2)}" aria-label="lichte Höhe"/></td>
              <td><input type="checkbox" data-fl="${f.id}.belowGrade"${f.belowGrade ? ' checked' : ''} aria-label="im Erdreich"/></td>
              <td>${p.floors.length > 1 ? `<button class="icon-btn small" data-wz-delfloor="${f.id}" aria-label="Geschoss löschen"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg></button>` : ''}</td></tr>`,
            )
            .join('')}</tbody></table></div>
          <div class="actions"><button class="btn small" data-wz-addfloor="top">+ Geschoss oben</button><button class="btn small" data-wz-addfloor="bottom">+ Geschoss unten</button></div>`;
      }
      case 3:
        return `<section><h3>Heizsystem für Fußböden</h3><div class="system-cards">${systemsFor('floor')
          .map(
            ([k, s]) => `<button class="system-card${p.design.defaultFloorSystem === k ? ' is-active' : ''}" data-wz-system="${k}" aria-pressed="${p.design.defaultFloorSystem === k}">
              <b>${esc(s.label)}</b><span>${esc(s.note)}</span><span class="muted">${s.medium === 'electric' ? 'ohne Verteiler' : `Aufbauhöhe ca. ${s.buildHeight} mm · Standard-VA ${num(s.defaultSpacing * 100, 1).replace(/,0$/, '')} cm`}</span></button>`,
          )
          .join('')}</div><p class="note">Wand- und Deckenheizungen sowie andere Systeme legen Sie später je Raum fest – auch mehrere Heizflächen pro Raum.</p></section>
          ${designFields(p, this.store.design)}
          <section><h3>Wärmeerzeuger</h3>${this.grid([{ kind: 'select', key: 'hs.type', label: 'Art', value: p.heatSource?.type ?? 'wp_luft', options: Object.entries(HEAT_SOURCE_TYPES) }])}</section>`;
      case 4: {
        const floors = p.floors.slice().sort((a, b2) => b2.elevation - a.elevation);
        return `<p class="lead">Laden Sie je Geschoss einen Grundriss, kalibrieren Sie den Maßstab an einer bekannten Strecke und lassen Sie Räume, Wände, Türen und Fenster erkennen.</p>
          <div class="floor-steps">${floors
            .map((f) => {
              const bg = f.background;
              const st = (ok: boolean, t: string) => `<span class="st ${ok ? 'ok' : ''}">${ok ? '✓' : '○'} ${t}</span>`;
              return `<div class="floor-step"><div><b>${esc(f.name)}</b> <span class="muted">${level(f.elevation)}</span></div>
                <div class="st-row">${st(!!bg, 'Grundriss')}${st(!!bg?.calibrated, 'Maßstab')}${st(f.rooms.length > 0, `${f.rooms.length} Räume`)}${st(f.walls.length > 0, `${f.walls.length} Wände`)}</div>
                <div class="actions"><button class="btn small" data-wz-upload="${f.id}">${bg ? 'Bild ersetzen' : 'Grundriss laden'}</button>
                <button class="btn small${bg && !bg.calibrated ? ' primary' : ''}" data-wz-calib="${f.id}"${bg ? '' : ' disabled'}>Maßstab kalibrieren</button>
                <button class="btn small${bg?.calibrated && !f.rooms.length ? ' primary' : ''}" data-wz-recog="${f.id}"${bg?.calibrated ? '' : ' disabled'}>Räume erkennen</button></div></div>`;
            })
            .join('')}</div>
          <p class="note">Ohne Grundrissbild zeichnen Sie Wände (W) und Räume (E/R) direkt im Plan. Türen als Öffnung in durchgehenden Wänden setzen (Werkzeug „Öffnung“).</p>`;
      }
      case 5: {
        const rows = p.floors
          .slice()
          .sort((a, b2) => a.elevation - b2.elevation)
          .flatMap((f) =>
            f.rooms.map(
              (r) => `<tr><td>${esc(f.name)}</td><td><input type="text" data-rm="${f.id}.${r.id}.name" value="${esc(r.name)}" aria-label="Raumname"/></td>
              <td><select data-rm="${f.id}.${r.id}.type" aria-label="Raumart">${Object.entries(ROOM_TYPES)
                .map(([k, t]) => `<option value="${k}"${k === r.type ? ' selected' : ''}>${esc(t.label)} · ${t.thetaI} °C</option>`)
                .join('')}</select></td>
              <td class="r">${num(this.store.design.rooms.get(r.id)?.area ?? 0, 1)} m²</td>
              <td><select data-rm="${f.id}.${r.id}.system" aria-label="Heizsystem"${r.heated ? '' : ' disabled'}><option value="">—</option>${systemsFor('floor')
                .map(([k, s]) => `<option value="${k}"${r.surfaces.find((x) => x.kind === 'floor')?.system === k ? ' selected' : ''}>${esc(s.short)}</option>`)
                .join('')}</select></td>
              <td>${r.surfaces.filter((s) => s.kind !== 'floor').map((s) => esc(HEATING_SYSTEMS[s.system]?.short ?? '')).join(', ')}</td></tr>`,
            ),
          );
        return `<p class="lead">Prüfen Sie Bezeichnung, Raumart und Heizsystem. Die Raumart setzt Innentemperatur, Luftwechsel, Belag und Verlegeabstand.</p>
          ${rows.length ? `<div class="table-wrap"><table class="wz-table"><thead><tr><th>Geschoss</th><th>Raum</th><th>Raumart</th><th class="r">Fläche</th><th>Fußboden</th><th>weitere Flächen</th></tr></thead><tbody>${rows.join('')}</tbody></table></div>` : '<p class="note warn">Noch keine Räume vorhanden. Gehen Sie zurück zu „Grundrisse“ oder zeichnen Sie Räume im Plan.</p>'}
          <p class="note">Wand- oder Deckenheizung ergänzen Sie in der Seitenleiste des Raums. Garagen im Haus als Raumart „Garage“ anlegen – sie gehen mit undichtem Tor als nahezu außenluftkalt in die Heizlast ein.</p>`;
      }
      case 6: {
        const floors = p.floors.slice().sort((a, b2) => b2.elevation - a.elevation);
        const total = p.floors.reduce((a, f) => a + f.manifolds.length, 0);
        return `<p class="lead">Setzen Sie einen oder mehrere Heizkreisverteiler. Danach erzeugt HeatCircuits die Heizkreise automatisch: Raumzuordnung, Leitungsführung um Wände und durch Türen und die Verlegeabstände aus Ihrer Auswahl.</p>
          <div class="floor-steps">${floors
            .map((f) => `<div class="floor-step"><div><b>${esc(f.name)}</b> <span class="muted">${f.manifolds.length ? f.manifolds.map((m) => esc(m.name)).join(', ') : 'kein Verteiler'}</span></div>
              <div class="actions"><button class="btn small${f.manifolds.length ? '' : ' primary'}" data-wz-manifold="${f.id}">Verteiler im ${esc(f.name)} setzen</button></div></div>`)
            .join('')}</div>
          ${total ? `<div class="actions"><button class="btn primary" data-wz-auto="1">Heizkreise neu verteilen</button></div>` : ''}
          <p class="note">Faustregel: ein Verteiler je Geschoss, zentral gelegen (Flur), mit höchstens ${p.design.maxOutlets} Abgängen.</p>`;
      }
      default: {
        const d = this.store.design;
        return `<p class="lead">Die Auslegung ist erstellt. Prüfen Sie Warnhinweise in den Räumen und passen Sie Verlegeabstände oder Heizflächen bei Bedarf an.</p>
          <div class="kpi-grid">
            <div><span class="k">Norm-Heizlast</span><b>${num(d.totals.heatLoad / 1000, 2)} kW</b></div>
            <div><span class="k">Vorlauftemperatur</span><b>${num(d.thetaSupply, 1)} °C</b></div>
            <div><span class="k">Heizkreise</span><b>${d.totals.circuits}</b></div>
            <div><span class="k">Rohr gesamt</span><b>${num(d.totals.pipeTotal, 0)} m</b></div>
            <div><span class="k">Zusatzheizfläche</span><b class="${d.totals.deficit > 5 ? 'warn' : ''}">${num(d.totals.deficit, 0)} W</b></div>
            <div><span class="k">Elektro</span><b>${num(d.totals.electricInstalled, 0)} W</b></div>
          </div>
          <div class="actions"><button class="btn primary" data-wz-results="1">Ergebnistabellen</button><button class="btn" data-wz-3d="1">3D-Ansicht</button></div>`;
      }
    }
  }

  private onClick(e: Event): void {
    const t = (e.target as HTMLElement).closest('button') as HTMLButtonElement | null;
    if (!t || t.disabled) return;
    const ds = t.dataset;
    const p = this.store.project;
    if (ds.wz === 'close') return this.close();
    if (ds.wz === 'prev') return this.open(this.step - 1);
    if (ds.wz === 'next') {
      if (this.step === STEPS.length - 1) {
        this.store.commit((pr) => (pr.wizard = { done: true, step: this.step }));
        return this.close();
      }
      return this.open(this.step + 1);
    }
    if (ds.wzStep) return this.open(Number(ds.wzStep));
    if (ds.wzPreset) return this.applyPreset(ds.wzPreset);
    if (ds.wzAddfloor) {
      const sorted = p.floors.slice().sort((a, b) => a.elevation - b.elevation);
      this.store.commit((pr) => {
        if (ds.wzAddfloor === 'top') {
          const top = sorted[sorted.length - 1];
          const f = newFloor('Obergeschoss', Math.round((top.elevation + top.storeyHeight) * 100) / 100);
          f.walls = top.walls.filter((w) => w.kind === 'exterior').map((w) => newWall({ ...w.a }, { ...w.b }, w.kind, w.thickness));
          pr.floors.push(f);
        } else {
          const low = sorted[0];
          const f = newFloor('Kellergeschoss', Math.round((low.elevation - 2.6) * 100) / 100);
          f.storeyHeight = 2.6;
          f.clearHeight = 2.3;
          f.belowGrade = true;
          pr.floors.push(f);
        }
      });
      return this.render();
    }
    if (ds.wzDelfloor) {
      this.store.commit((pr) => (pr.floors = pr.floors.filter((f) => f.id !== ds.wzDelfloor)));
      if (!this.store.project.floors.some((f) => f.id === this.store.activeFloorId)) this.store.setFloor(this.store.project.floors[0].id);
      return this.render();
    }
    if (ds.wzSystem) {
      this.store.commit((pr) => {
        pr.design.defaultFloorSystem = ds.wzSystem!;
        for (const f of pr.floors) for (const r of f.rooms) for (const s of r.surfaces) if (s.kind === 'floor' && !s.spacingLocked) s.system = ds.wzSystem!;
      });
      return this.render();
    }
    if (ds.wzUpload) return this.host.uploadImage(ds.wzUpload);
    if (ds.wzCalib) {
      this.showBanner('Klicken Sie zwei Punkte mit bekanntem Abstand im Grundriss an (z. B. eine Maßkette) und geben Sie den echten Abstand ein.');
      return this.host.startCalibrate(ds.wzCalib);
    }
    if (ds.wzRecog) {
      this.host.recognize(ds.wzRecog);
      return this.render();
    }
    if (ds.wzManifold) {
      this.showBanner('Klicken Sie im Plan an die Stelle des Heizkreisverteilers (z. B. im Flur). Die Heizkreise werden danach automatisch erzeugt.', 'Weiter zum Ergebnis');
      return this.host.placeManifold(ds.wzManifold);
    }
    if (ds.wzAuto) {
      this.host.autoLayout();
      return this.render();
    }
    if (ds.wzResults) {
      this.close();
      return this.host.showResults();
    }
    if (ds.wz3d) {
      this.close();
      return this.host.show3D();
    }
  }

  private applyPreset(key: string): void {
    this.store.commit((pr) => {
      const keep = pr.floors.filter((f) => f.rooms.length || f.walls.length || f.background);
      if (keep.length) return;
      const floors = [];
      if (key.startsWith('kg')) {
        const kg = newFloor('Kellergeschoss', -2.6);
        kg.storeyHeight = 2.6;
        kg.clearHeight = 2.3;
        kg.belowGrade = true;
        floors.push(kg);
      }
      floors.push(newFloor('Erdgeschoss', 0));
      if (key.includes('og')) floors.push(newFloor('Obergeschoss', 2.9));
      if (key.includes('dg')) {
        const dg = newFloor('Dachgeschoss', 2.9);
        dg.clearHeight = 2.4;
        floors.push(dg);
        pr.roof.insulation = 'rafters';
      }
      pr.floors = floors;
    });
    if (this.store.project.floors.some((f) => f.rooms.length || f.walls.length || f.background) && this.store.project.floors.length) {
      this.host.toast('Vorlagen ersetzen nur leere Geschosse. Fügen Sie weitere Geschosse über die Schaltflächen unten hinzu.', 'warn');
    }
    this.store.setFloor(this.store.project.floors.find((f) => f.elevation === 0)?.id ?? this.store.project.floors[0].id);
    this.render();
  }

  private onLayerChange(e: Event): void {
    const el = e.target as HTMLInputElement | HTMLSelectElement;
    const ins = el.dataset.ins;
    const fl = el.dataset.fl;
    const rm = el.dataset.rm;
    if (ins) {
      const [slot, i] = ins.split('.') as [ConstructionSlot, string];
      const v = Number(el.value.replace(',', '.'));
      if (!(v >= 0)) return;
      this.store.commit((p) => {
        const l = p.building.constructions[slot].layers[Number(i)];
        if (l) l.thickness = v / 100;
        p.building.constructions[slot].template = 'custom';
        applyConstructionUValues(p.building);
      });
      this.render();
    } else if (fl) {
      const [fid, field] = fl.split('.');
      this.store.commit((p) => {
        const f = p.floors.find((x) => x.id === fid);
        if (!f) return;
        if (field === 'name') f.name = el.value.trim() || f.name;
        else if (field === 'belowGrade') f.belowGrade = (el as HTMLInputElement).checked;
        else {
          const v = Number(el.value.replace(',', '.'));
          if (Number.isFinite(v)) (f as unknown as Record<string, number>)[field] = v;
        }
      });
      this.render();
    } else if (rm) {
      const [fid, rid, field] = rm.split('.');
      this.store.commit((p) => {
        const r = p.floors.find((x) => x.id === fid)?.rooms.find((x) => x.id === rid);
        if (!r) return;
        if (field === 'name') r.name = el.value.trim() || r.name;
        if (field === 'type') applyRoomType(p, r, el.value);
        if (field === 'system') {
          const s = r.surfaces.find((x) => x.kind === 'floor');
          if (s && el.value) s.system = el.value;
        }
      });
      this.render();
    }
  }

  private onField(key: string, val: FieldValue, _el: HTMLElement, live: boolean): void {
    if (live) return;
    if (key.startsWith('d.')) applyDesignField(this.store, key, val);
    else if (key === 'hs.type') {
      this.store.commit((p) => {
        if (p.heatSource) p.heatSource.type = String(val);
      });
    } else applyBuildingField(this.store, key, val);
    this.render();
  }
}
