import type { Floor, HeatingSurface, Opening, OpeningKind, Project, Room, SurfaceKind, Wall } from '../model/types';
import type { Store } from '../model/store';
import type { RoomResult, SurfaceResult, Warning } from '../calc/design';
import { COVERINGS, HEAT_SOURCE_TYPES, ROOM_TYPES, SPACINGS } from '../model/catalog';
import { ELECTRIC_POWERS, HEATING_SYSTEMS, SURFACE_LABEL, systemsFor } from '../model/systems';
import { applyRoomType, newSurface, uid } from '../model/factory';
import { add, centroid, cross, dist, len, mul, norm, sub } from '../geometry/geom';
import { defaultField, wallsOfRoom } from '../geometry/wallfield';
import { DEFAULT_RECOGNIZE, type RecognizeOptions } from '../geometry/recognize';
import { bindFields, fieldHtml, type FieldSpec, type FieldValue } from './forms';
import { OPENING_DEFAULTS } from './editor';
import { cm, degC, esc, K, kgh, level, lmin, m, m2, mbar, num, W, Wm2 } from './format';

export const WARNING_TEXT: Record<Warning, string> = {
  'no-manifold': 'Noch kein Heizkreisverteiler gesetzt – die Heizkreise werden erzeugt, sobald ein Verteiler platziert ist.',
  'q-exceeds-limit': 'Benötigte Wärmestromdichte liegt über der Grenzkurve (Oberflächentemperatur). Weitere Heizfläche (Wand/Decke) oder Zusatzheizkörper vorsehen.',
  undersupplied: 'Vorlauftemperatur reicht nicht aus – Verlegeabstand verringern, weitere Heizfläche ergänzen oder Zusatzheizfläche vorsehen.',
  'circuit-too-long': 'Heizkreis überschreitet die maximale Kreislänge.',
  'feeder-too-long': 'Anbindeleitung sehr lang – Verteiler näher platzieren.',
  'covering-too-high': 'Bodenbelag über R_λ,B = 0,15 m²K/W (Grenze EN 1264).',
  'pressure-high': 'Druckverlust eines Heizkreises über dem Grenzwert.',
  'no-surface': 'Beheizter Raum ohne Heizfläche – Fußboden-, Wand- oder Deckenheizung hinzufügen.',
  'wall-missing': 'Die Wand der Wandheizung existiert nicht mehr – Wand neu wählen.',
};

export interface SidebarActions {
  uploadImage(): void;
  setTool(t: 'calibrate' | 'moveImage'): void;
  addFloor(): void;
  toast(text: string, kind?: 'info' | 'warn'): void;
  autoLayout(): void;
  recognize(opts: RecognizeOptions): void;
  openWallView(wallId: string, roomId: string | null): void;
}

const FLOOR_BOUNDARY: [string, string][] = [
  ['auto', 'automatisch (aus Geschossen)'],
  ['ground', 'gegen Erdreich'],
  ['unheated', 'gegen unbeheizten Raum'],
  ['outside', 'gegen Außenluft'],
  ['heated', 'gegen beheizten Raum'],
];
const CEILING_BOUNDARY: [string, string][] = [
  ['auto', 'automatisch (aus Geschossen/Dach)'],
  ['roof', 'Dach / gegen Außenluft'],
  ['unheated', 'gegen unbeheizten Dachraum'],
  ['heated', 'gegen beheizten Raum'],
];
const OPENING_KINDS: [OpeningKind, string][] = (Object.keys(OPENING_DEFAULTS) as OpeningKind[]).map((k) => [k, OPENING_DEFAULTS[k].label]);

/** Himmelsrichtung der Wandaußenseite (Plan: oben = Norden) */
export function compass(w: Wall, room: Room | null): string {
  const dir = norm(sub(w.b, w.a));
  let n = { x: -dir.y, y: dir.x };
  if (room) {
    const c = centroid(room.polygon);
    if (cross(dir, sub(c, w.a)) > 0) n = { x: -n.x, y: -n.y };
  }
  const ang = (Math.atan2(n.x, -n.y) * 180) / Math.PI;
  const names = ['N', 'NO', 'O', 'SO', 'S', 'SW', 'W', 'NW'];
  return names[(Math.round(((ang + 360) % 360) / 45) % 8)];
}

export function wallLabel(w: Wall, room: Room | null): string {
  const kind = w.kind === 'exterior' ? 'Außenwand' : w.kind === 'interior' ? 'Innenwand' : 'Wand zu unbeheizt';
  return `${kind} ${num(dist(w.a, w.b), 2)} m${w.kind === 'exterior' ? ` (${compass(w, room)})` : ''}`;
}

export class Sidebar {
  private floorsEl: HTMLElement;
  private propsEl: HTMLElement;
  recognizeOpts: RecognizeOptions = { ...DEFAULT_RECOGNIZE };

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
    const scroll = this.propsEl.scrollTop;
    this.renderProps();
    this.propsEl.scrollTop = scroll;
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
          <span class="fl-meta">${f.rooms.length} Räume · ${num(load, 0)} W${f.background ? ' · Plan' : ''}${f.belowGrade ? ' · im Erdreich' : ''}</span>
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
      if (w) html = this.wallPanel(w);
    } else if (sel?.kind === 'opening') {
      const [wid, oid] = sel.id.split('|');
      const w = floor.walls.find((x) => x.id === wid);
      const o = w?.openings.find((x) => x.id === oid);
      if (w && o) html = this.openingPanel(w, o);
    } else if (sel?.kind === 'void') {
      const vd = floor.voids.find((x) => x.id === sel.id);
      if (vd) {
        html = `<div class="panel-head"><h2>${vd.kind === 'spiral' ? 'Spindeltreppe' : vd.kind === 'stair' ? 'Treppe' : 'Luftraum'}</h2><span class="chip">Deckenöffnung</span></div>`;
        const fields: FieldSpec[] = [{ kind: 'select', key: 'void.kind', label: 'Art', value: vd.kind, options: [['stair', 'gerade Treppe'], ['spiral', 'Spindeltreppe'], ['void', 'Luftraum / Galerie']] }];
        if (vd.kind === 'stair') fields.push({ kind: 'select', key: 'void.direction', label: 'Laufrichtung (aufwärts)', value: vd.direction ?? 'y+', options: [['y+', '↓ (nach Süden)'], ['y-', '↑ (nach Norden)'], ['x+', '→ (nach Osten)'], ['x-', '← (nach Westen)']] });
        if (vd.kind === 'spiral') fields.push({ kind: 'readout', label: 'Durchmesser', value: m(2 * (vd.radius ?? 0)) });
        html += this.section('Öffnung im Fußboden dieses Geschosses', fields, 'v');
        html += `<p class="note">Die Fläche zählt nicht zur beheizten Bodenfläche; der Raum darunter ist hier nach oben offen.</p><div class="actions"><button class="btn danger" data-act="delete" data-confirm="1">Öffnung löschen</button></div>`;
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
      html = `<div class="panel-head"><h2>Anbindeleitung</h2><span class="chip">${r?.auto ? 'automatisch' : 'manuell'}</span></div><div class="group"><div class="fields">${fieldHtml({ kind: 'readout', label: 'Raum', value: room?.name ?? '–' }, 'r')}${fieldHtml({ kind: 'readout', label: 'Länge einfach', value: rr ? m(rr.feederLength) : '–' }, 'r')}</div></div><div class="actions"><button class="btn" data-act="delete">Leitung zurücksetzen</button></div>`;
    }
    if (!html) html = this.floorPanel(floor);
    this.propsEl.innerHTML = html;
  }

  private floorPanel(floor: Floor): string {
    const s = this.store;
    const d = s.design;
    const rooms = [...d.rooms.values()].filter((r) => r.floorId === floor.id);
    const bg = floor.background;
    const o = this.recognizeOpts;
    let html = `<div class="panel-head"><h2>${esc(floor.name)}</h2><span class="chip">${level(floor.elevation)}</span></div>`;
    html += this.section(
      'Geschoss',
      [
        { kind: 'text', key: 'floor.name', label: 'Bezeichnung', value: floor.name },
        { kind: 'num', key: 'floor.elevation', label: 'Höhe OK FFB', value: floor.elevation, unit: 'm', digits: 2 },
        { kind: 'num', key: 'floor.storeyHeight', label: 'Geschosshöhe', value: floor.storeyHeight, unit: 'm', digits: 2 },
        { kind: 'num', key: 'floor.clearHeight', label: 'lichte Raumhöhe', value: floor.clearHeight, unit: 'm', digits: 2 },
        { kind: 'check', key: 'floor.belowGrade', label: 'Geschoss liegt im Erdreich (beheizter Keller)', value: floor.belowGrade },
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
      bgHtml += `<div class="actions"><button class="btn${bg.calibrated ? '' : ' primary'}" data-act="calibrate">Maßstab kalibrieren</button><button class="btn" data-act="move-image">Bild verschieben</button><button class="btn" data-act="upload">Bild ersetzen</button><button class="btn danger" data-act="remove-image" data-confirm="1">Bild entfernen</button></div>`;
      bgHtml += `<h3 class="sub">Räume und Wände erkennen</h3><div class="fields">
        ${fieldHtml({ kind: 'select', key: 'rec.outlineWalls', label: 'Wände im Plan', value: o.outlineWalls ? '1' : '0', options: [['0', 'gefüllt / schraffiert'], ['1', 'nur Umrisslinien']] }, 'rc')}
        ${fieldHtml({ kind: 'range', key: 'rec.thresholdBias', label: 'Schwellwert', value: o.thresholdBias, min: -60, max: 60, step: 5, display: o.thresholdBias > 0 ? `+${o.thresholdBias}` : `${o.thresholdBias}` }, 'rc')}
        ${fieldHtml({ kind: 'num', key: 'rec.minWall', label: 'kleinste Wanddicke', value: o.minWall, unit: 'cm', scale: 100, digits: 1 }, 'rc')}
        ${fieldHtml({ kind: 'num', key: 'rec.maxGap', label: 'größte Türbreite', value: o.maxGap, unit: 'm', digits: 2 }, 'rc')}
      </div><p class="note">Ersetzt Wände und Räume dieses Geschosses durch die erkannten. Ergebnis bitte prüfen – Räume mit Text oder Schraffur können zusammenfallen.</p>
      <div class="actions"><button class="btn primary" data-act="recognize" data-confirm="${floor.walls.length || floor.rooms.length ? '1' : ''}"${bg.calibrated ? '' : ' disabled title="Zuerst Maßstab kalibrieren"'}>Räume &amp; Wände erkennen</button></div>`;
    } else {
      bgHtml += `<p class="note">Laden Sie einen Grundriss (PNG, JPG, WebP oder SVG), kalibrieren Sie den Maßstab und lassen Sie Räume und Wände erkennen.</p><div class="actions"><button class="btn primary" data-act="upload">Grundriss laden</button></div>`;
    }
    html += `<div class="group"><h3>Grundrissbild</h3>${bgHtml}</div>`;
    const load = rooms.reduce((a, r) => a + r.heatLoad.total, 0);
    const area = rooms.filter((r) => r.hasHeating).reduce((a, r) => a + r.area, 0);
    html += `<div class="group"><h3>Übersicht</h3><div class="fields">
      ${fieldHtml({ kind: 'readout', label: 'Räume', value: `${floor.rooms.length}` }, 's')}
      ${fieldHtml({ kind: 'readout', label: 'beheizte Fläche', value: m2(area, 1) }, 's')}
      ${fieldHtml({ kind: 'readout', label: 'Heizlast', value: W(load) }, 's')}
      ${fieldHtml({ kind: 'readout', label: 'spez. Heizlast', value: area > 0 ? Wm2(load / area) : '–' }, 's')}
      ${fieldHtml({ kind: 'readout', label: 'Heizkreise', value: `${rooms.reduce((a, r) => a + r.circuits.length, 0)}` }, 's')}
      ${fieldHtml({ kind: 'readout', label: 'Fenster / Türen', value: `${floor.walls.reduce((a, w) => a + w.openings.filter((o2) => o2.kind === 'window').length, 0)} / ${floor.walls.reduce((a, w) => a + w.openings.filter((o2) => o2.kind !== 'window').length, 0)}` }, 's')}
    </div></div>`;
    html += `<div class="actions">${s.project.floors.some((f) => f.manifolds.length) ? `<button class="btn primary" data-act="auto-layout">Heizkreise automatisch verteilen</button>` : ''}${s.project.floors.length > 1 ? `<button class="btn danger" data-act="delete-floor" data-confirm="1">Geschoss löschen</button>` : ''}</div>`;
    return html;
  }

  private surfaceCard(room: Room, sf: HeatingSurface, sr: SurfaceResult | undefined): string {
    const sys = HEATING_SYSTEMS[sf.system];
    const p = `surf.${sf.id}`;
    const fields: FieldSpec[] = [{ kind: 'select', key: `${p}.system`, label: 'System', value: sf.system, options: systemsFor(sf.kind).map(([k, x]) => [k, x.label] as [string, string]) }];
    if (sys?.medium === 'water') {
      const allowed = this.store.project.design.allowedSpacings;
      const list = Array.from(new Set([...allowed, ...SPACINGS.filter((x) => Math.abs(x - sf.spacing) < 1e-9)])).sort((a, b) => a - b);
      fields.push({
        kind: 'select',
        key: `${p}.spacing`,
        label: 'Verlegeabstand VA',
        value: sf.spacingLocked ? String(sf.spacing) : 'auto',
        options: [['auto', `automatisch (${cm(sf.spacing)})`], ...list.map((x) => [String(x), cm(x)] as [string, string])],
      });
      if (sf.kind !== 'wall') fields.push({ kind: 'select', key: `${p}.pattern`, label: 'Verlegeart', value: sf.pattern, options: [['spiral', 'Schnecke (bifilar)'], ['meander', 'Mäander']] });
    }
    if (sys?.medium === 'electric') fields.push({ kind: 'select', key: `${p}.electricPower`, label: 'Heizmatte', value: String(sf.electricPower), options: ELECTRIC_POWERS.map((x) => [String(x), `${x} W/m²`] as [string, string]) });
    if (sf.kind !== 'wall') fields.push({ kind: 'num', key: `${p}.coverage`, label: 'belegter Anteil', value: sf.coverage, unit: '%', scale: 100, digits: 0 });
    let wallSel = '';
    if (sf.kind === 'wall') {
      const opts = wallsOfRoom(this.store.floor, room).map(({ wall }) => [wall.id, wallLabel(wall, room)] as [string, string]);
      fields.push({ kind: 'select', key: `${p}.wallId`, label: 'Wand', value: sf.wallId ?? '', options: [['', '– Wand wählen –'], ...opts] });
      if (sf.wallId) wallSel = `<button class="btn small" data-act="wall-view" data-wall="${sf.wallId}" data-room="${room.id}">Wandansicht öffnen</button>`;
    }
    let res = '';
    if (sr) {
      res = `<dl class="kv mini">
        <dt>Fläche</dt><dd>${m2(sr.area, 2)}</dd>
        <dt>Anteil Heizlast</dt><dd>${W(sr.load)}</dd>
        <dt>q erforderlich / Grenze</dt><dd>${num(sr.qRequired, 0)} / ${num(sr.qLimit, 0)} W/m²</dd>
        <dt>Oberfläche</dt><dd>${degC(sr.surfaceTemp)}</dd>
        ${sr.medium === 'water' ? `<dt>Spreizung · Rücklauf</dt><dd>${K(sr.sigma)} · ${degC(sr.thetaReturn)}</dd><dt>Kreise</dt><dd>${sr.circuits.length} · ${m(sr.circuits.reduce((a, c) => a + c.length, 0), 0)}</dd>` : ''}
        ${sr.electric ? `<dt>Anschlussleistung</dt><dd>${W(sr.electric.installed)} · ${sr.electric.circuits} Kreis${sr.electric.circuits > 1 ? 'e' : ''}</dd>` : ''}
      </dl>`;
    }
    return `<div class="surface-card kind-${sf.kind}">
      <div class="sc-head"><span class="sc-kind">${SURFACE_LABEL[sf.kind]}</span><button class="icon-btn small" data-act="remove-surface" data-sid="${sf.id}" aria-label="Heizfläche entfernen" title="Heizfläche entfernen"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg></button></div>
      <div class="fields">${fields.map((x) => fieldHtml(x, `sf${sf.id}`)).join('')}</div>
      ${sys ? `<p class="note">${esc(sys.note)}</p>` : ''}
      ${wallSel ? `<div class="actions">${wallSel}</div>` : ''}
      ${res}
    </div>`;
  }

  private roomPanel(room: Room, r: RoomResult | undefined): string {
    const s = this.store;
    const manifolds = s.project.floors.flatMap((f) => f.manifolds.map((mf) => [mf.id, `${mf.name} (${f.name})`] as [string, string]));
    const typeOpts = Object.entries(ROOM_TYPES).map(([k, t]) => [k, `${t.label} · ${t.thetaI} °C`] as [string, string]);
    const covOpts = Object.entries(COVERINGS).map(([k, c]) => [k, `${c.label} (${num(c.rLambdaB, 2)})`] as [string, string]);
    if (!COVERINGS[room.covering]) covOpts.push([room.covering, 'benutzerdefiniert']);
    const hl = r?.heatLoad;
    let html = `<div class="panel-head"><h2>${esc(room.name)}</h2><span class="chip">${r ? m2(r.area, 2) : ''}</span></div>`;
    if (r?.warnings.length) html += `<ul class="warnings">${r.warnings.map((w) => `<li>${esc(WARNING_TEXT[w])}</li>`).join('')}</ul>`;
    html += this.section(
      'Raum',
      [
        { kind: 'text', key: 'room.name', label: 'Bezeichnung', value: room.name },
        { kind: 'select', key: 'room.type', label: 'Raumart', value: room.type, options: typeOpts },
        { kind: 'check', key: 'room.heated', label: 'beheizt', value: room.heated },
        { kind: 'num', key: 'room.thetaI', label: 'Norm-Innentemperatur θ_int', value: room.thetaI, unit: '°C', digits: 1 },
        { kind: 'num', key: 'room.airChange', label: 'Mindestluftwechsel n_min', value: room.airChange, unit: '1/h', digits: 2 },
        { kind: 'select', key: 'room.covering', label: 'Bodenbelag (R_λ,B)', value: room.covering, options: covOpts },
      ],
      'r',
    );
    if (room.heated) {
      const rs = new Map((r?.surfaces ?? []).map((x) => [x.surfaceId, x]));
      html += `<div class="group"><h3>Heizflächen</h3>${room.surfaces.map((sf) => this.surfaceCard(room, sf, rs.get(sf.id))).join('')}
        <div class="actions"><button class="btn small" data-act="add-surface" data-skind="floor">+ Fußboden</button><button class="btn small" data-act="add-surface" data-skind="wall">+ Wand</button><button class="btn small" data-act="add-surface" data-skind="ceiling">+ Decke</button></div></div>`;
      html += this.section(
        'Anschluss',
        [
          { kind: 'select', key: 'room.manifoldId', label: 'Verteiler', value: room.manifoldLocked ? (room.manifoldId ?? '') : '', options: [['', `automatisch${r?.manifoldId ? ` (${s.project.floors.flatMap((f) => f.manifolds).find((x) => x.id === r.manifoldId)?.name ?? ''})` : ''}`], ...manifolds] },
          { kind: 'num', key: 'room.circuitsOverride', label: 'Heizkreise Fußboden', value: room.circuitsOverride, placeholder: `auto (${r?.surfaces.find((x) => x.kind === 'floor')?.circuits.length ?? 0})`, digits: 0 },
          { kind: 'num', key: 'room.excludedArea', label: 'nicht belegte Bodenfläche', value: room.excludedArea, unit: 'm²', digits: 2 },
        ],
        'r',
        room.connector || s.floor.routes.some((x) => x.roomId === room.id)
          ? `<div class="actions">${room.connector ? `<button class="btn small" data-act="reset-connector">Anschlusspunkt automatisch</button>` : ''}${s.floor.routes.some((x) => x.roomId === room.id) ? `<button class="btn small" data-act="reset-route">Leitung automatisch führen</button>` : ''}</div>`
          : '',
      );
    }
    html += this.section(
      'Hüllflächen',
      [
        { kind: 'readout', label: 'Fenster / Türen (gezeichnet)', value: hl ? `${m2(hl.windowArea - room.windowArea, 2)} / ${m2(hl.doorArea, 2)}` : '–' },
        { kind: 'num', key: 'room.windowArea', label: 'zusätzliche Fensterfläche', value: room.windowArea, unit: 'm²', digits: 2 },
        { kind: 'num', key: 'room.extWallLengthOverride', label: 'Außenwandlänge', value: room.extWallLengthOverride, unit: 'm', digits: 2, placeholder: `auto ${num(hl?.extWallLengthAuto ?? 0, 2)}` },
        { kind: 'select', key: 'room.floorBoundary', label: 'Boden', value: room.floorBoundary, options: FLOOR_BOUNDARY },
        { kind: 'select', key: 'room.ceilingBoundary', label: 'Decke', value: room.ceilingBoundary, options: CEILING_BOUNDARY },
      ],
      'r',
    );
    if (r && hl) {
      const parts = (p: Record<string, { area: number; loss: number }>) =>
        Object.entries(p)
          .filter(([, x]) => x.loss > 0.5)
          .map(([k, x]) => `<dt class="indent">${esc(k)} (${num(x.area, 1)} m²)</dt><dd>${W(x.loss)}</dd>`)
          .join('');
      html += `<div class="group results"><h3>Heizlast</h3><dl class="kv">
        <dt>Außenwand</dt><dd>${W(hl.extWall)}</dd>
        <dt>Fenster und Türen</dt><dd>${W(hl.windows)}</dd>
        ${hl.unheatedWalls ? `<dt>Wand zu unbeheizt</dt><dd>${W(hl.unheatedWalls)}</dd>` : ''}
        <dt>Boden</dt><dd>${W(hl.floor)}</dd>${parts(hl.floorParts)}
        <dt>Decke / Dach</dt><dd>${W(hl.ceiling)}</dd>${parts(hl.ceilingParts)}
        ${hl.interior ? `<dt>Nachbarräume</dt><dd>${W(hl.interior)}</dd>` : ''}
        <dt>Lüftung</dt><dd>${W(hl.ventilation)}</dd>
        <dt class="sum">Norm-Heizlast Φ_HL</dt><dd class="sum">${W(hl.total)}</dd>
        ${r.hasHeating ? `<dt>Leistung Heizflächen</dt><dd>${W(r.output)}</dd>` : ''}
        ${r.deficit > 5 ? `<dt class="warn">Zusatzheizfläche</dt><dd class="warn">${W(r.deficit)}</dd>` : ''}
      </dl>`;
      if (r.circuits.length) {
        html += `<div class="table-wrap"><table class="mini"><thead><tr><th>Kreis</th><th>Länge</th><th>Durchfluss</th><th>Δp</th></tr></thead><tbody>
          ${r.circuits.map((c) => `<tr><td>${esc(c.label)}</td><td>${m(c.length, 1)}</td><td>${lmin(c.litresPerMinute)}</td><td>${mbar(c.pressureDrop)}</td></tr>`).join('')}
        </tbody></table></div>`;
      }
      html += `</div>`;
    }
    html += `<div class="actions"><button class="btn danger" data-act="delete" data-confirm="1">Raum löschen</button></div>`;
    return html;
  }

  private wallPanel(w: Wall): string {
    const floor = this.store.floor;
    const l = dist(w.a, w.b);
    const rooms = floor.rooms.filter((r) => wallsOfRoom(floor, r).some((x) => x.wall.id === w.id));
    let html = `<div class="panel-head"><h2>${esc(wallLabel(w, rooms[0] ?? null))}</h2></div>`;
    html += this.section(
      'Wand',
      [
        { kind: 'select', key: 'wall.kind', label: 'Art', value: w.kind, options: [['exterior', 'Außenwand'], ['interior', 'Innenwand'], ['unheated', 'Wand zu unbeheiztem Raum']] },
        { kind: 'num', key: 'wall.thickness', label: 'Dicke', value: w.thickness, unit: 'cm', scale: 100, digits: 1 },
        { kind: 'num', key: 'wall.length', label: 'Länge (Achse)', value: l, unit: 'm', digits: 3 },
      ],
      'w',
    );
    html += `<div class="group"><h3>Öffnungen</h3>${
      w.openings.length
        ? `<div class="table-wrap"><table class="mini"><thead><tr><th>Art</th><th>Breite</th><th>Höhe</th><th>Brüstung</th></tr></thead><tbody>${w.openings
            .map((o) => `<tr class="clickable" data-act="select-opening" data-oid="${o.id}"><td>${esc(OPENING_DEFAULTS[o.kind].label)}</td><td>${num(o.width, 3)}</td><td>${num(o.height, 3)}</td><td>${num(o.sill, 2)}</td></tr>`)
            .join('')}</tbody></table></div>`
        : '<p class="note">Keine Öffnungen. Fenster und Türen gehen in die Heizlast ein und begrenzen Wandheizflächen.</p>'
    }<div class="actions"><button class="btn small" data-act="add-opening" data-okind="window">+ Fenster</button><button class="btn small" data-act="add-opening" data-okind="door">+ Tür</button>${w.kind === 'exterior' ? `<button class="btn small" data-act="add-opening" data-okind="entrance">+ Außentür</button><button class="btn small" data-act="add-opening" data-okind="garage">+ Garagentor</button>` : ''}</div></div>`;
    html += `<div class="group"><h3>Wandheizung</h3><p class="note">Wand in der Wandansicht öffnen, um Heizfelder für die angrenzenden Räume zu sehen und anzupassen.</p><div class="actions">${rooms
      .filter((r) => r.heated)
      .map((r) => `<button class="btn small" data-act="wall-view" data-wall="${w.id}" data-room="${r.id}">Wandansicht · ${esc(r.name)}</button>`)
      .join('')}</div></div>`;
    html += `<div class="actions"><button class="btn danger" data-act="delete" data-confirm="1">Wand löschen</button></div>`;
    return html;
  }

  private openingPanel(w: Wall, o: Opening): string {
    let html = `<div class="panel-head"><h2>${esc(OPENING_DEFAULTS[o.kind].label)}</h2><span class="chip">${num(o.width * o.height, 2)} m²</span></div>`;
    html += this.section(
      'Öffnung',
      [
        { kind: 'select', key: 'op.kind', label: 'Art', value: o.kind, options: OPENING_KINDS },
        { kind: 'num', key: 'op.width', label: 'Breite', value: o.width, unit: 'm', digits: 3 },
        { kind: 'num', key: 'op.height', label: 'Höhe', value: o.height, unit: 'm', digits: 3 },
        { kind: 'num', key: 'op.sill', label: 'Brüstungshöhe', value: o.sill, unit: 'm', digits: 2 },
        { kind: 'num', key: 'op.offset', label: 'Mitte ab Wandanfang', value: o.offset, unit: 'm', digits: 3 },
        { kind: 'readout', label: 'Wand', value: wallLabel(w, null) },
      ],
      'o',
    );
    html += `<div class="actions"><button class="btn danger" data-act="delete" data-confirm="1">Öffnung löschen</button></div>`;
    return html;
  }

  private manifoldPanel(id: string): string {
    const s = this.store;
    const mf = s.floor.manifolds.find((x) => x.id === id)!;
    const mr = s.design.manifolds.find((x) => x.manifoldId === id);
    let html = `<div class="panel-head"><h2>${esc(mf.name)}</h2><span class="chip">${mr?.outlets ?? 0}/${mf.maxOutlets} Abgänge</span></div>`;
    html += this.section(
      'Heizkreisverteiler',
      [
        { kind: 'text', key: 'mf.name', label: 'Bezeichnung', value: mf.name },
        { kind: 'num', key: 'mf.maxOutlets', label: 'max. Abgänge', value: mf.maxOutlets, digits: 0 },
        { kind: 'num', key: 'mf.supplyLengthOverride', label: 'Leitung zum Wärmeerzeuger (einfach)', value: mf.supplyLengthOverride, unit: 'm', digits: 2, placeholder: mr?.supplyLengthAuto != null ? `auto ${num(mr.supplyLengthAuto, 2)}` : 'kein Wärmeerzeuger' },
      ],
      'm',
    );
    if (mr) {
      if (mr.outlets > mr.maxOutlets) html += `<ul class="warnings"><li>Mehr Heizkreise als Abgänge – zweiten Verteiler setzen oder größeren Verteiler wählen.</li></ul>`;
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
    html += `<div class="actions"><button class="btn primary" data-act="auto-layout">Automatisch verteilen</button><button class="btn danger" data-act="delete" data-confirm="1">Verteiler löschen</button></div>`;
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
      <dt>Leistung Heizflächen</dt><dd>${W(d.totals.output)}</dd>
      <dt>Vorlauf / Spreizung</dt><dd>${degC(d.thetaSupply)} · σ ${K(d.sigmaDesign, 0)}</dd>
      <dt>Massenstrom gesamt</dt><dd>${kgh(d.totals.massFlow)}</dd>
      ${d.totals.electricInstalled ? `<dt>Elektro-Anschluss</dt><dd>${W(d.totals.electricInstalled)}</dd>` : ''}
      ${d.manifolds.map((mr) => `<dt>→ ${esc(mr.name)}</dt><dd>2 × ${m(mr.supplyLength, 1)}</dd>`).join('')}
    </dl></div>`;
    html += `<div class="actions"><button class="btn danger" data-act="delete" data-confirm="1">Wärmeerzeuger entfernen</button></div>`;
    return html;
  }

  // ---------- Ereignisse ----------
  private armed: HTMLElement | null = null;

  private onClick(e: Event): void {
    const t = (e.target as HTMLElement).closest('[data-floor],[data-act]') as HTMLElement | null;
    if (!t || (t as HTMLButtonElement).disabled) return;
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
    const selRoom = (p: Project) => (sel?.kind === 'room' ? fl(p).rooms.find((x) => x.id === sel.id) : undefined);
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
      case 'recognize':
        this.actions.recognize(this.recognizeOpts);
        break;
      case 'auto-layout':
        this.actions.autoLayout();
        break;
      case 'wall-view':
        this.actions.openWallView(t.dataset.wall!, t.dataset.room ?? null);
        break;
      case 'remove-image':
        s.commit((p) => (fl(p).background = null));
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
        s.commit((p) => {
          const r = selRoom(p);
          if (r) r.connector = null;
        });
        break;
      case 'reset-route':
        if (sel?.kind === 'room') s.commit((p) => (fl(p).routes = fl(p).routes.filter((x) => x.roomId !== sel.id)));
        break;
      case 'add-surface': {
        const kind = t.dataset.skind as SurfaceKind;
        s.commit((p) => {
          const r = selRoom(p);
          if (!r) return;
          const sys = kind === 'floor' ? p.design.defaultFloorSystem : kind === 'wall' ? 'wall_wet' : 'ceiling_wet';
          const sf = newSurface(kind, sys);
          if (kind === 'wall') {
            const ws = wallsOfRoom(fl(p), r).sort((a, b) => (b.wall.kind === 'exterior' ? 1 : 0) - (a.wall.kind === 'exterior' ? 1 : 0) || b.span.t1 - b.span.t0 - (a.span.t1 - a.span.t0));
            if (ws[0]) {
              sf.wallId = ws[0].wall.id;
              sf.field = defaultField(ws[0].wall, r, fl(p).clearHeight);
            }
          }
          r.surfaces.push(sf);
        });
        break;
      }
      case 'remove-surface':
        s.commit((p) => {
          const r = selRoom(p);
          if (r) r.surfaces = r.surfaces.filter((x) => x.id !== t.dataset.sid);
        });
        break;
      case 'add-opening': {
        if (sel?.kind !== 'wall') break;
        const kind = t.dataset.okind as OpeningKind;
        const d = OPENING_DEFAULTS[kind];
        const id = uid('o');
        s.commit((p) => {
          const w = fl(p).walls.find((x) => x.id === sel.id);
          if (!w) return;
          const L = dist(w.a, w.b);
          w.openings.push({ id, kind, offset: L / 2, width: Math.min(d.width, L - 0.2), height: d.height, sill: d.sill });
        });
        s.select({ kind: 'opening', id: `${sel.id}|${id}` });
        break;
      }
      case 'select-opening':
        if (sel?.kind === 'wall') s.select({ kind: 'opening', id: `${sel.id}|${t.dataset.oid}` });
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
    const parts = key.split('.');
    const [group, field] = parts;
    const fl = (p: Project) => p.floors.find((x) => x.id === fid)!;
    const numv = typeof val === 'number' ? val : null;

    if (group === 'rec') {
      const o = this.recognizeOpts;
      if (field === 'outlineWalls') o.outlineWalls = val === '1';
      if (field === 'thresholdBias' && numv !== null) o.thresholdBias = numv;
      if (field === 'minWall' && numv !== null && numv > 0.02) o.minWall = numv;
      if (field === 'maxGap' && numv !== null && numv > 0.4) o.maxGap = numv;
      if (!live) this.render();
      return;
    }
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
        if (field === 'belowGrade') f.belowGrade = !!val;
      });
      return;
    }
    if (group === 'void' && sel?.kind === 'void') {
      s.commit((p) => {
        const vd = fl(p).voids.find((x) => x.id === sel.id);
        if (!vd) return;
        if (field === 'kind') {
          vd.kind = val as typeof vd.kind;
          if (vd.kind === 'spiral' && !vd.center) {
            const c = centroid(vd.polygon);
            const r = Math.max(0.6, Math.min(...vd.polygon.map((q) => dist(q, c))));
            vd.center = c;
            vd.radius = Math.round(r * 100) / 100;
            vd.polygon = Array.from({ length: 24 }, (_, k) => add(c, { x: Math.cos((k / 24) * Math.PI * 2) * r, y: Math.sin((k / 24) * Math.PI * 2) * r }));
          }
        }
        if (field === 'direction') vd.direction = val as typeof vd.direction;
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
    if (group === 'op' && sel?.kind === 'opening') {
      const [wid, oid] = sel.id.split('|');
      s.commit((p) => {
        const w = fl(p).walls.find((x) => x.id === wid);
        const o = w?.openings.find((x) => x.id === oid);
        if (!w || !o) return;
        const L = dist(w.a, w.b);
        if (field === 'kind') {
          o.kind = val as OpeningKind;
          const d = OPENING_DEFAULTS[o.kind];
          o.height = d.height;
          o.sill = d.sill;
        }
        if (field === 'width' && numv !== null && numv > 0.2) o.width = Math.min(numv, L);
        if (field === 'height' && numv !== null && numv > 0.2) o.height = numv;
        if (field === 'sill' && numv !== null && numv >= 0) o.sill = numv;
        if (field === 'offset' && numv !== null) o.offset = numv;
        o.offset = Math.min(L - o.width / 2, Math.max(o.width / 2, o.offset));
      });
      return;
    }
    if (group === 'mf' && sel?.kind === 'manifold') {
      s.commit((p) => {
        const mf = fl(p).manifolds.find((x) => x.id === sel.id);
        if (!mf) return;
        if (field === 'name' && typeof val === 'string') mf.name = val.trim() || mf.name;
        if (field === 'maxOutlets' && numv !== null && numv >= 2) mf.maxOutlets = Math.round(numv);
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
    if (group === 'surf' && sel?.kind === 'room') {
      const sid = parts[1];
      const sf = parts[2];
      s.commit((p) => {
        const r = fl(p).rooms.find((x) => x.id === sel.id);
        const x = r?.surfaces.find((q) => q.id === sid);
        if (!r || !x) return;
        if (sf === 'system') {
          x.system = String(val);
          const sys = HEATING_SYSTEMS[x.system];
          if (sys?.medium === 'water' && !x.spacingLocked) x.spacing = sys.defaultSpacing;
        }
        if (sf === 'spacing') {
          if (val === 'auto') x.spacingLocked = false;
          else {
            x.spacing = Number(val);
            x.spacingLocked = true;
          }
        }
        if (sf === 'pattern') x.pattern = val === 'meander' ? 'meander' : 'spiral';
        if (sf === 'electricPower') x.electricPower = Number(val);
        if (sf === 'coverage' && numv !== null) x.coverage = Math.min(1, Math.max(0.1, numv));
        if (sf === 'wallId') {
          x.wallId = String(val) || undefined;
          const w = fl(p).walls.find((q) => q.id === x.wallId);
          x.field = w ? defaultField(w, r, fl(p).clearHeight) : undefined;
        }
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
            applyRoomType(p, r, String(val));
            break;
          case 'heated':
            r.heated = !!val;
            if (r.heated && !r.surfaces.length) r.surfaces.push(newSurface('floor', p.design.defaultFloorSystem));
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
          case 'manifoldId':
            r.manifoldId = val ? String(val) : null;
            r.manifoldLocked = !!val;
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
        p.floors.forEach((fl) =>
          fl.rooms.forEach((r) => {
            if (r.manifoldId === sel.id) {
              r.manifoldId = null;
              r.manifoldLocked = false;
            }
          }),
        );
        break;
      case 'heatSource':
        p.heatSource = null;
        break;
      case 'route':
        f.routes = f.routes.filter((r) => r.id !== sel.id);
        break;
      case 'void':
        f.voids = f.voids.filter((x) => x.id !== sel.id);
        break;
      case 'opening': {
        const [wid, oid] = sel.id.split('|');
        const w = f.walls.find((x) => x.id === wid);
        if (w) w.openings = w.openings.filter((o) => o.id !== oid);
        break;
      }
    }
  });
  s.select(null);
  return true;
}
