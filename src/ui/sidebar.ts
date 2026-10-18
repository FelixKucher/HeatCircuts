import type { Floor, Project, Room } from '../model/types';
import type { Store } from '../model/store';
import type { RoomResult, Warning } from '../calc/design';
import { COVERINGS, HEAT_SOURCE_TYPES, ROOM_TYPES, SPACINGS } from '../model/catalog';
import { applyRoomType, boundariesFor } from '../model/factory';
import { add, dist, len, mul, norm, sub } from '../geometry/geom';
import { bindFields, fieldHtml, type FieldSpec, type FieldValue } from './forms';
import { degC, esc, K, kgh, level, lmin, m, m2, mbar, num, W, Wm2 } from './format';

export const WARNING_TEXT: Record<Warning, string> = {
  'no-manifold': 'Kein Heizkreisverteiler vorhanden – setzen Sie einen Verteiler.',
  'q-exceeds-limit': 'Benötigte Wärmestromdichte liegt über der Grenzkurve (θ_F,max). Zusatzheizfläche vorsehen.',
  undersupplied: 'Vorlauftemperatur reicht nicht aus – Verlegeabstand verringern oder Zusatzheizfläche vorsehen.',
  'circuit-too-long': 'Heizkreis überschreitet die maximale Kreislänge.',
  'feeder-too-long': 'Anbindeleitung sehr lang – Verteiler näher platzieren.',
  'covering-too-high': 'Bodenbelag über R_λ,B = 0,15 m²K/W (Grenze EN 1264).',
  'pressure-high': 'Druckverlust eines Heizkreises über dem Grenzwert.',
};

export interface SidebarActions {
  uploadImage(): void;
  setTool(t: 'calibrate' | 'moveImage'): void;
  addFloor(): void;
  toast(text: string, kind?: 'info' | 'warn'): void;
}

const FLOOR_BOUNDARY: [string, string][] = [
  ['ground', 'gegen Erdreich'],
  ['unheated', 'gegen unbeheizten Raum (Keller)'],
  ['outside', 'gegen Außenluft (auskragend)'],
  ['heated', 'gegen beheizten Raum'],
];
const CEILING_BOUNDARY: [string, string][] = [
  ['roof', 'Dach / gegen Außenluft'],
  ['unheated', 'gegen unbeheizten Dachraum'],
  ['heated', 'gegen beheizten Raum'],
];

export class Sidebar {
  private floorsEl: HTMLElement;
  private propsEl: HTMLElement;

  constructor(
    root: HTMLElement,
    private store: Store,
    private actions: SidebarActions,
  ) {
    root.innerHTML = `<section class="panel floors" aria-label="Geschosse"><div class="panel-head"><h2>Geschosse</h2><button class="btn small" data-act="add-floor" title="Neues Geschoss oberhalb anlegen">+ Geschoss</button></div><div class="floor-list"></div></section><section class="panel props" aria-label="Eigenschaften"></section>`;
    this.floorsEl = root.querySelector('.floor-list')!;
    this.propsEl = root.querySelector('.props')!;
    root.addEventListener('click', (e) => this.onClick(e));
    bindFields(this.propsEl, (k, val, el, live) => this.onField(k, val, el, live));
  }

  render(): void {
    this.renderFloors();
    const active = document.activeElement;
    if (active && this.propsEl.contains(active) && (active as HTMLElement).dataset?.kind === 'range') return;
    this.renderProps();
  }

  private renderFloors(): void {
    const s = this.store;
    const d = s.design;
    const floors = s.project.floors.slice().sort((a, b) => b.elevation - a.elevation);
    this.floorsEl.innerHTML = floors
      .map((f) => {
        const load = [...d.rooms.values()].filter((r) => r.floorId === f.id).reduce((a, r) => a + r.heatLoad.total, 0);
        const active = f.id === s.activeFloorId;
        return `<button class="floor-item${active ? ' is-active' : ''}" data-floor="${f.id}" aria-pressed="${active}">
          <span class="fl-level">${level(f.elevation)}</span>
          <span class="fl-name">${esc(f.name)}</span>
          <span class="fl-meta">${f.rooms.length} Räume · ${num(load, 0)} W${f.background ? ' · Plan' : ''}</span>
        </button>`;
      })
      .join('');
  }

  private section(title: string, fields: FieldSpec[], prefix: string, extra = ''): string {
    return `<div class="group"><h3>${esc(title)}</h3><div class="fields">${fields.map((f) => fieldHtml(f, prefix)).join('')}</div>${extra}</div>`;
  }

  private renderProps(): void {
    const s = this.store;
    const sel = s.selection;
    const floor = s.floor;
    let html = '';
    if (sel?.kind === 'room') {
      const room = floor.rooms.find((r) => r.id === sel.id);
      if (room) html = this.roomPanel(room, s.design.rooms.get(room.id));
    } else if (sel?.kind === 'wall') {
      const w = floor.walls.find((x) => x.id === sel.id);
      if (w) {
        const l = dist(w.a, w.b);
        html = `<div class="panel-head"><h2>Wand</h2><span class="chip">${w.kind === 'exterior' ? 'Außenwand' : w.kind === 'interior' ? 'Innenwand' : 'zu unbeheizt'}</span></div>`;
        html += this.section(
          'Wand',
          [
            { kind: 'select', key: 'wall.kind', label: 'Art', value: w.kind, options: [['exterior', 'Außenwand'], ['interior', 'Innenwand'], ['unheated', 'Wand zu unbeheiztem Raum']] },
            { kind: 'num', key: 'wall.thickness', label: 'Dicke', value: w.thickness, unit: 'cm', scale: 100, digits: 1 },
            { kind: 'num', key: 'wall.length', label: 'Länge (Achse)', value: l, unit: 'm', digits: 3 },
          ],
          'w',
        );
        html += `<div class="actions"><button class="btn danger" data-act="delete" data-confirm="1">Wand löschen</button></div>`;
      }
    } else if (sel?.kind === 'manifold') {
      const mf = floor.manifolds.find((x) => x.id === sel.id);
      if (mf) html = this.manifoldPanel(mf.id);
    } else if (sel?.kind === 'heatSource' && s.project.heatSource) {
      html = this.heatSourcePanel();
    } else if (sel?.kind === 'route') {
      const r = floor.routes.find((x) => x.id === sel.id);
      const room = floor.rooms.find((x) => x.id === r?.roomId);
      const rr = room ? s.design.rooms.get(room.id) : undefined;
      html = `<div class="panel-head"><h2>Anbindeleitung</h2></div><div class="group"><div class="fields">${fieldHtml({ kind: 'readout', label: 'Raum', value: room?.name ?? '–' }, 'r')}${fieldHtml({ kind: 'readout', label: 'Länge einfach', value: rr ? m(rr.feederLength) : '–' }, 'r')}</div></div><div class="actions"><button class="btn" data-act="delete">Automatisch führen</button></div>`;
    }
    if (!html) html = this.floorPanel(floor);
    this.propsEl.innerHTML = html;
  }

  private floorPanel(floor: Floor): string {
    const s = this.store;
    const d = s.design;
    const rooms = [...d.rooms.values()].filter((r) => r.floorId === floor.id);
    const bg = floor.background;
    let html = `<div class="panel-head"><h2>${esc(floor.name)}</h2><span class="chip">${level(floor.elevation)}</span></div>`;
    html += this.section(
      'Geschoss',
      [
        { kind: 'text', key: 'floor.name', label: 'Bezeichnung', value: floor.name },
        { kind: 'num', key: 'floor.elevation', label: 'Höhe OK FFB', value: floor.elevation, unit: 'm', digits: 2 },
        { kind: 'num', key: 'floor.storeyHeight', label: 'Geschosshöhe', value: floor.storeyHeight, unit: 'm', digits: 2 },
        { kind: 'num', key: 'floor.clearHeight', label: 'lichte Raumhöhe', value: floor.clearHeight, unit: 'm', digits: 2 },
      ],
      'f',
    );
    let bgHtml = '';
    if (bg) {
      bgHtml += `<div class="fields">`;
      bgHtml += fieldHtml({ kind: 'readout', label: 'Maßstab', value: `1 m = ${num(bg.pxPerM, 1)} px`, tone: bg.calibrated ? 'ok' : 'warn' }, 'b');
      bgHtml += fieldHtml({ kind: 'readout', label: 'Bildgröße', value: `${num(bg.widthPx / bg.pxPerM, 2)} × ${num(bg.heightPx / bg.pxPerM, 2)} m` }, 'b');
      bgHtml += fieldHtml({ kind: 'range', key: 'bg.opacity', label: 'Deckkraft', value: bg.opacity, min: 0.05, max: 1, step: 0.05, display: `${Math.round(bg.opacity * 100)} %` }, 'b');
      bgHtml += fieldHtml({ kind: 'check', key: 'bg.visible', label: 'Bild anzeigen', value: bg.visible }, 'b');
      bgHtml += `</div>`;
      if (!bg.calibrated) bgHtml += `<p class="note warn">Der Maßstab ist noch nicht kalibriert. Messen Sie eine bekannte Strecke im Plan.</p>`;
      bgHtml += `<div class="actions"><button class="btn primary" data-act="calibrate">Maßstab kalibrieren</button><button class="btn" data-act="move-image">Bild verschieben</button><button class="btn" data-act="upload">Bild ersetzen</button><button class="btn danger" data-act="remove-image" data-confirm="1">Bild entfernen</button></div>`;
    } else {
      bgHtml += `<p class="note">Laden Sie einen Grundriss (PNG, JPG, WebP oder SVG) und kalibrieren Sie den Maßstab, damit 1 m im Bild 1 m in der Planung entspricht.</p><div class="actions"><button class="btn primary" data-act="upload">Grundriss laden</button></div>`;
    }
    html += `<div class="group"><h3>Grundrissbild</h3>${bgHtml}</div>`;
    const load = rooms.reduce((a, r) => a + r.heatLoad.total, 0);
    const area = rooms.filter((r) => r.hasFloorHeating).reduce((a, r) => a + r.area, 0);
    html += `<div class="group"><h3>Übersicht</h3><div class="fields">
      ${fieldHtml({ kind: 'readout', label: 'Räume', value: `${floor.rooms.length}` }, 's')}
      ${fieldHtml({ kind: 'readout', label: 'beheizte Fläche', value: m2(area, 1) }, 's')}
      ${fieldHtml({ kind: 'readout', label: 'Heizlast', value: W(load) }, 's')}
      ${fieldHtml({ kind: 'readout', label: 'spez. Heizlast', value: area > 0 ? Wm2(load / area) : '–' }, 's')}
      ${fieldHtml({ kind: 'readout', label: 'Heizkreise', value: `${rooms.reduce((a, r) => a + r.circuits.length, 0)}` }, 's')}
      ${fieldHtml({ kind: 'readout', label: 'Wände', value: `${floor.walls.length}` }, 's')}
    </div></div>`;
    html += `<div class="actions"><button class="btn" data-act="reset-boundaries" title="Boden- und Deckenbegrenzung aller Räume aus der Geschosslage ableiten">Begrenzungen neu setzen</button>${s.project.floors.length > 1 ? `<button class="btn danger" data-act="delete-floor" data-confirm="1">Geschoss löschen</button>` : ''}</div>`;
    return html;
  }

  private roomPanel(room: Room, r: RoomResult | undefined): string {
    const s = this.store;
    const manifolds = s.project.floors.flatMap((f) => f.manifolds.map((mf) => [mf.id, `${mf.name} (${f.name})`] as [string, string]));
    const typeOpts = Object.entries(ROOM_TYPES).map(([k, t]) => [k, `${t.label} · ${t.thetaI} °C`] as [string, string]);
    const covOpts = Object.entries(COVERINGS).map(([k, c]) => [k, `${c.label} (${num(c.rLambdaB, 2)})`] as [string, string]);
    if (!COVERINGS[room.covering]) covOpts.push([room.covering, 'benutzerdefiniert']);
    const spacingOpts = SPACINGS.map((x) => [String(x), `${num(x * 100, 1).replace(/,0$/, '')} cm`] as [string, string]);
    if (!SPACINGS.some((x) => Math.abs(x - room.spacing) < 1e-9)) spacingOpts.push([String(room.spacing), `${num(room.spacing * 100, 1)} cm`]);
    const hl = r?.heatLoad;
    let html = `<div class="panel-head"><h2>${esc(room.name)}</h2><span class="chip">${r ? m2(r.area, 2) : ''}</span></div>`;
    if (r?.warnings.length) html += `<ul class="warnings">${r.warnings.map((w) => `<li>${esc(WARNING_TEXT[w])}</li>`).join('')}</ul>`;
    html += this.section(
      'Raum',
      [
        { kind: 'text', key: 'room.name', label: 'Bezeichnung', value: room.name },
        { kind: 'select', key: 'room.type', label: 'Raumart', value: room.type, options: typeOpts },
        { kind: 'check', key: 'room.heated', label: 'beheizt mit Fußbodenheizung', value: room.heated },
        { kind: 'num', key: 'room.thetaI', label: 'Norm-Innentemperatur θ_int', value: room.thetaI, unit: '°C', digits: 1 },
        { kind: 'num', key: 'room.airChange', label: 'Mindestluftwechsel n_min', value: room.airChange, unit: '1/h', digits: 2 },
      ],
      'r',
    );
    html += this.section(
      'Fußbodenheizung',
      [
        { kind: 'select', key: 'room.covering', label: 'Bodenbelag (R_λ,B)', value: room.covering, options: covOpts },
        { kind: 'num', key: 'room.rLambdaB', label: 'R_λ,B', value: room.rLambdaB, unit: 'm²K/W', digits: 3 },
        { kind: 'select', key: 'room.spacing', label: 'Verlegeabstand VA', value: String(room.spacing), options: spacingOpts },
        { kind: 'select', key: 'room.pattern', label: 'Verlegeart', value: room.pattern, options: [['spiral', 'Schnecke (bifilar)'], ['meander', 'Mäander']] },
        { kind: 'select', key: 'room.manifoldId', label: 'Verteiler', value: room.manifoldId ?? '', options: [['', 'automatisch (nächster)'], ...manifolds] },
        { kind: 'num', key: 'room.circuitsOverride', label: 'Heizkreise', value: room.circuitsOverride, placeholder: `auto (${r?.circuits.length ?? 0})`, digits: 0 },
        { kind: 'num', key: 'room.excludedArea', label: 'nicht belegte Fläche', value: room.excludedArea, unit: 'm²', digits: 2, hint: 'Einbauten, Küchenzeile, Dusche' },
      ],
      'r',
      room.connector || floorHasRoute(s.floor, room.id)
        ? `<div class="actions">${room.connector ? `<button class="btn small" data-act="reset-connector">Anschlusspunkt automatisch</button>` : ''}${floorHasRoute(s.floor, room.id) ? `<button class="btn small" data-act="reset-route">Leitung automatisch führen</button>` : ''}</div>`
        : '',
    );
    html += this.section(
      'Hüllflächen',
      [
        { kind: 'num', key: 'room.windowArea', label: 'Fensterfläche', value: room.windowArea, unit: 'm²', digits: 2 },
        { kind: 'num', key: 'room.extWallLengthOverride', label: 'Außenwandlänge', value: room.extWallLengthOverride, unit: 'm', digits: 2, placeholder: `auto ${num(hl?.extWallLengthAuto ?? 0, 2)}` },
        { kind: 'select', key: 'room.floorBoundary', label: 'Boden', value: room.floorBoundary, options: FLOOR_BOUNDARY },
        { kind: 'select', key: 'room.ceilingBoundary', label: 'Decke', value: room.ceilingBoundary, options: CEILING_BOUNDARY },
      ],
      'r',
    );
    if (r && hl) {
      html += `<div class="group results"><h3>Heizlast</h3><dl class="kv">
        <dt>Außenwand</dt><dd>${W(hl.extWall)}</dd>
        <dt>Fenster</dt><dd>${W(hl.windows)}</dd>
        ${hl.unheatedWalls ? `<dt>Wand zu unbeheizt</dt><dd>${W(hl.unheatedWalls)}</dd>` : ''}
        <dt>Boden</dt><dd>${W(hl.floor)}</dd>
        <dt>Decke / Dach</dt><dd>${W(hl.ceiling)}</dd>
        ${hl.interior ? `<dt>Innenwände</dt><dd>${W(hl.interior)}</dd>` : ''}
        <dt>Lüftung</dt><dd>${W(hl.ventilation)}</dd>
        <dt class="sum">Norm-Heizlast Φ_HL</dt><dd class="sum">${W(hl.total)}</dd>
      </dl></div>`;
      if (r.hasFloorHeating) {
        html += `<div class="group results"><h3>Auslegung EN 1264</h3><dl class="kv">
          <dt>q erforderlich</dt><dd>${Wm2(r.qRequired)}</dd>
          <dt>q Grenze (θ_F,max)</dt><dd>${Wm2(r.qLimit)}</dd>
          <dt>Oberflächentemp. θ_F,m</dt><dd>${degC(r.surfaceTemp)}</dd>
          <dt>Spreizung σ</dt><dd>${K(r.sigma)}</dd>
          <dt>Rücklauf θ_R</dt><dd>${degC(r.thetaReturn)}</dd>
          <dt>Leistung FBH</dt><dd>${W(r.output)}</dd>
          ${r.deficit > 5 ? `<dt class="warn">Zusatzheizfläche</dt><dd class="warn">${W(r.deficit)}</dd>` : ''}
          <dt>Massenstrom</dt><dd>${kgh(r.massFlow)}</dd>
          <dt>Anbindung (einfach)</dt><dd>${m(r.feederLength)}</dd>
        </dl>
        <div class="table-wrap"><table class="mini"><thead><tr><th>Kreis</th><th>Länge</th><th>Durchfluss</th><th>Δp</th></tr></thead><tbody>
          ${r.circuits.map((c) => `<tr><td>${esc(c.label)}</td><td>${m(c.length, 1)}</td><td>${lmin(c.litresPerMinute)}</td><td>${mbar(c.pressureDrop)}</td></tr>`).join('')}
        </tbody></table></div></div>`;
      }
    }
    html += `<div class="actions"><button class="btn danger" data-act="delete" data-confirm="1">Raum löschen</button></div>`;
    return html;
  }

  private manifoldPanel(id: string): string {
    const s = this.store;
    const mf = s.floor.manifolds.find((x) => x.id === id)!;
    const mr = s.design.manifolds.find((x) => x.manifoldId === id);
    let html = `<div class="panel-head"><h2>${esc(mf.name)}</h2><span class="chip">${mr?.outlets ?? 0} Abgänge</span></div>`;
    html += this.section(
      'Heizkreisverteiler',
      [
        { kind: 'text', key: 'mf.name', label: 'Bezeichnung', value: mf.name },
        {
          kind: 'num',
          key: 'mf.supplyLengthOverride',
          label: 'Leitung zum Wärmeerzeuger (einfach)',
          value: mf.supplyLengthOverride,
          unit: 'm',
          digits: 2,
          placeholder: mr?.supplyLengthAuto != null ? `auto ${num(mr.supplyLengthAuto, 2)}` : 'kein Wärmeerzeuger',
        },
      ],
      'm',
    );
    if (mr) {
      html += `<div class="group results"><h3>Ergebnis</h3><dl class="kv">
        <dt>Heizleistung</dt><dd>${W(mr.heat)}</dd>
        <dt>Massenstrom</dt><dd>${kgh(mr.massFlow)}</dd>
        <dt>max. Δp Heizkreis</dt><dd>${mbar(mr.maxPressureDrop)}</dd>
        <dt>Zuleitung Vor- + Rücklauf</dt><dd>${m(2 * mr.supplyLength, 1)}</dd>
        <dt>Rohrdimension</dt><dd>${esc(mr.supplyPipe ?? '–')}</dd>
        <dt>v / Δp Zuleitung</dt><dd>${num(mr.supplyVelocity, 2)} m/s · ${mbar(mr.supplyPressureDrop)}</dd>
      </dl>
      <h3>Hydraulischer Abgleich</h3>
      <div class="table-wrap"><table class="mini"><thead><tr><th>Kreis</th><th>Länge</th><th>l/min</th><th>Δp</th><th>Drossel</th></tr></thead><tbody>
      ${mr.circuits.map((c) => `<tr><td>${esc(c.label)}</td><td>${num(c.length, 1)}</td><td>${num(c.litresPerMinute, 2)}</td><td>${num(c.pressureDrop / 100, 0)}</td><td>${num(c.throttle / 100, 0)}</td></tr>`).join('')}
      </tbody></table></div><p class="note">Δp und Drossel in mbar. Die Durchflussmengen werden an den Durchflussanzeigern des Verteilers eingestellt.</p></div>`;
    }
    html += `<div class="actions"><button class="btn danger" data-act="delete" data-confirm="1">Verteiler löschen</button></div>`;
    return html;
  }

  private heatSourcePanel(): string {
    const s = this.store;
    const hs = s.project.heatSource!;
    const d = s.design;
    let html = `<div class="panel-head"><h2>${esc(hs.name)}</h2><span class="chip">Wärmeerzeuger</span></div>`;
    html += this.section(
      'Wärmeerzeuger',
      [
        { kind: 'text', key: 'hs.name', label: 'Bezeichnung', value: hs.name },
        { kind: 'select', key: 'hs.type', label: 'Art', value: hs.type, options: Object.entries(HEAT_SOURCE_TYPES) },
      ],
      'h',
    );
    html += `<div class="group results"><h3>Anlage</h3><dl class="kv">
      <dt>Norm-Heizlast gesamt</dt><dd>${W(d.totals.heatLoad)}</dd>
      <dt>Leistung FBH</dt><dd>${W(d.totals.output)}</dd>
      <dt>Vorlauf / Spreizung</dt><dd>${degC(d.thetaSupply)} · σ ${K(d.sigmaDesign, 0)}</dd>
      <dt>Massenstrom gesamt</dt><dd>${kgh(d.totals.massFlow)}</dd>
      ${d.manifolds.map((mr) => `<dt>→ ${esc(mr.name)}</dt><dd>2 × ${m(mr.supplyLength, 1)}</dd>`).join('')}
    </dl></div>`;
    html += `<div class="actions"><button class="btn danger" data-act="delete" data-confirm="1">Wärmeerzeuger entfernen</button></div>`;
    return html;
  }

  // ---------- Ereignisse ----------
  private armed: HTMLElement | null = null;

  private onClick(e: Event): void {
    const t = (e.target as HTMLElement).closest('[data-floor],[data-act]') as HTMLElement | null;
    if (!t) return;
    const s = this.store;
    if (t.dataset.floor) {
      s.setFloor(t.dataset.floor);
      return;
    }
    const act = t.dataset.act!;
    if (t.dataset.confirm && this.armed !== t) {
      this.armed?.classList.remove('armed');
      this.armed = t;
      t.dataset.label = t.textContent ?? '';
      t.textContent = 'Wirklich? Erneut klicken';
      t.classList.add('armed');
      setTimeout(() => {
        if (this.armed === t) {
          t.textContent = t.dataset.label ?? '';
          t.classList.remove('armed');
          this.armed = null;
        }
      }, 3500);
      return;
    }
    this.armed = null;
    const fid = s.activeFloorId;
    const sel = s.selection;
    const fl = (p: Project) => p.floors.find((x) => x.id === fid)!;
    switch (act) {
      case 'add-floor':
        this.actions.addFloor();
        break;
      case 'upload':
        this.actions.uploadImage();
        break;
      case 'calibrate':
        this.actions.setTool('calibrate');
        break;
      case 'move-image':
        this.actions.setTool('moveImage');
        break;
      case 'remove-image':
        s.commit((p) => (fl(p).background = null));
        break;
      case 'reset-boundaries':
        s.commit((p) => {
          const f = fl(p);
          for (const r of f.rooms) Object.assign(r, boundariesFor(p, f));
        });
        this.actions.toast('Boden- und Deckenbegrenzungen wurden aus der Geschosslage gesetzt.');
        break;
      case 'delete-floor':
        s.commit((p) => {
          p.floors = p.floors.filter((x) => x.id !== fid);
          if (p.heatSource?.floorId === fid) p.heatSource = null;
          const ids = new Set(p.floors.flatMap((f) => f.manifolds.map((m) => m.id)));
          p.floors.forEach((f) => f.rooms.forEach((r) => r.manifoldId && !ids.has(r.manifoldId) && (r.manifoldId = null)));
        });
        s.setFloor(s.project.floors[0].id);
        break;
      case 'reset-connector':
        if (sel?.kind === 'room') s.commit((p) => {
          const r = fl(p).rooms.find((x) => x.id === sel.id);
          if (r) r.connector = null;
        });
        break;
      case 'reset-route':
        if (sel?.kind === 'room') s.commit((p) => (fl(p).routes = fl(p).routes.filter((x) => x.roomId !== sel.id)));
        break;
      case 'delete':
        deleteSelection(s);
        break;
    }
  }

  private onField(key: string, val: FieldValue, _el: HTMLElement, live: boolean): void {
    const s = this.store;
    const fid = s.activeFloorId;
    const sel = s.selection;
    const [group, field] = key.split('.');
    const fl = (p: Project) => p.floors.find((x) => x.id === fid)!;
    const numv = typeof val === 'number' ? val : null;

    if (group === 'bg') {
      if (field === 'opacity') {
        if (live) {
          s.beginLive();
          s.live((p) => fl(p).background && (fl(p).background!.opacity = Number(val)));
        } else s.endLive();
        return;
      }
      s.commit((p) => {
        const bg = fl(p).background;
        if (bg && field === 'visible') bg.visible = !!val;
      });
      return;
    }
    if (live) return;

    if (group === 'floor') {
      s.commit((p) => {
        const f = fl(p);
        if (field === 'name' && typeof val === 'string') f.name = val.trim() || f.name;
        if (field === 'elevation' && numv !== null) f.elevation = numv;
        if (field === 'storeyHeight' && numv !== null && numv > 1) f.storeyHeight = numv;
        if (field === 'clearHeight' && numv !== null && numv > 1) f.clearHeight = numv;
      });
      return;
    }
    if (group === 'wall' && sel?.kind === 'wall') {
      s.commit((p) => {
        const w = fl(p).walls.find((x) => x.id === sel.id);
        if (!w) return;
        if (field === 'kind' && typeof val === 'string') w.kind = val as typeof w.kind;
        if (field === 'thickness' && numv !== null && numv > 0.01) w.thickness = numv;
        if (field === 'length' && numv !== null && numv > 0.01) {
          const dir = norm(sub(w.b, w.a));
          if (len(dir) > 0) w.b = add(w.a, mul(dir, numv));
        }
      });
      return;
    }
    if (group === 'mf' && sel?.kind === 'manifold') {
      s.commit((p) => {
        const mf = fl(p).manifolds.find((x) => x.id === sel.id);
        if (!mf) return;
        if (field === 'name' && typeof val === 'string') mf.name = val.trim() || mf.name;
        if (field === 'supplyLengthOverride') mf.supplyLengthOverride = numv !== null && numv >= 0 ? numv : null;
      });
      return;
    }
    if (group === 'hs') {
      s.commit((p) => {
        if (!p.heatSource) return;
        if (field === 'name' && typeof val === 'string') p.heatSource.name = val.trim() || p.heatSource.name;
        if (field === 'type' && typeof val === 'string') p.heatSource.type = val;
      });
      return;
    }
    if (group === 'room' && sel?.kind === 'room') {
      s.commit((p) => {
        const r = fl(p).rooms.find((x) => x.id === sel.id);
        if (!r) return;
        switch (field) {
          case 'name':
            if (typeof val === 'string' && val.trim()) r.name = val.trim();
            break;
          case 'type':
            applyRoomType(r, String(val));
            break;
          case 'heated':
            r.heated = !!val;
            break;
          case 'thetaI':
            if (numv !== null) r.thetaI = numv;
            break;
          case 'airChange':
            if (numv !== null && numv >= 0) r.airChange = numv;
            break;
          case 'covering':
            r.covering = String(val);
            if (COVERINGS[r.covering]) r.rLambdaB = COVERINGS[r.covering].rLambdaB;
            break;
          case 'rLambdaB':
            if (numv !== null && numv >= 0) r.rLambdaB = numv;
            break;
          case 'spacing':
            r.spacing = Number(val);
            break;
          case 'pattern':
            r.pattern = val === 'meander' ? 'meander' : 'spiral';
            break;
          case 'manifoldId':
            r.manifoldId = val ? String(val) : null;
            break;
          case 'circuitsOverride':
            r.circuitsOverride = numv !== null && numv >= 1 ? Math.round(numv) : null;
            break;
          case 'excludedArea':
            if (numv !== null && numv >= 0) r.excludedArea = numv;
            break;
          case 'windowArea':
            if (numv !== null && numv >= 0) r.windowArea = numv;
            break;
          case 'extWallLengthOverride':
            r.extWallLengthOverride = numv !== null && numv >= 0 ? numv : null;
            break;
          case 'floorBoundary':
            r.floorBoundary = val as Room['floorBoundary'];
            break;
          case 'ceilingBoundary':
            r.ceilingBoundary = val as Room['ceilingBoundary'];
            break;
        }
      });
    }
  }
}

function floorHasRoute(floor: Floor, roomId: string): boolean {
  return floor.routes.some((r) => r.roomId === roomId);
}

export function deleteSelection(s: Store): boolean {
  const sel = s.selection;
  if (!sel) return false;
  const fid = s.activeFloorId;
  s.commit((p) => {
    const f = p.floors.find((x) => x.id === fid)!;
    switch (sel.kind) {
      case 'wall':
        f.walls = f.walls.filter((w) => w.id !== sel.id);
        break;
      case 'room':
        f.rooms = f.rooms.filter((r) => r.id !== sel.id);
        f.routes = f.routes.filter((r) => r.roomId !== sel.id);
        break;
      case 'manifold':
        f.manifolds = f.manifolds.filter((m) => m.id !== sel.id);
        p.floors.forEach((fl) => fl.rooms.forEach((r) => r.manifoldId === sel.id && (r.manifoldId = null)));
        break;
      case 'heatSource':
        p.heatSource = null;
        break;
      case 'route':
        f.routes = f.routes.filter((r) => r.id !== sel.id);
        break;
    }
  });
  s.select(null);
  return true;
}
