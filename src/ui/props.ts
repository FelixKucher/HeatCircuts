// Eigenschaften (rechte Seitenleiste), abhängig von Arbeitsphase und Auswahl:
// Grundriss = Geometrie und Darstellung, Bauteile = Hülle und Aufbauten, Heizflächen = Heizung je Raum,
// Heizkreise = Verteiler, Wärmeerzeuger, Anschlüsse, Ergebnisse = Kennzahlen.

import type { Floor, HeatingSurface, Opening, OpeningStyle, Project, Room, StairType, SurfaceKind, Wall } from '../model/types';
import { PHASES, type Phase, type SelItem, type Store } from '../model/store';
import type { RoomResult, SurfaceResult, Warning } from '../calc/design';
import { COVERINGS, HEAT_SOURCE_TYPES, ROOM_TYPES, SPACINGS } from '../model/catalog';
import { WINDOW_TYPES, SURFACE_RESISTANCE } from '../model/constructions';
import { ELECTRIC_POWERS, HEATING_SYSTEMS, SURFACE_LABEL, systemsFor } from '../model/systems';
import { applyRoomType, newSurface, uid } from '../model/factory';
import { add, area, centroid, cross, dist, mul, norm, perimeter, sub } from '../geometry/geom';
import { defaultField, wallsOfRoom } from '../geometry/wallfield';
import { DEFAULT_RECOGNIZE, type RecognizeOptions } from '../geometry/recognize';
import { buildingBounds, buriedHeight } from '../geometry/terrain';
import { CATALOG_BY_KEY } from '../cad/furniture';
import { kindForStyle, OPENING_STYLES, styleOf } from '../cad/openings';
import { stairGeometry, stepCount } from '../cad/stairs';
import { clampOpening, splitWall, wallLength } from '../cad/walls';
import { addWallChain, refitRooms } from '../cad/edit';
import { bindFields, fieldHtml, type FieldSpec, type FieldValue } from './forms';
import { bindElementConstructions, elementConstructionHtml } from './construction';
import { FINISH_COLORS, floorColorOf } from './plan-render';
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
  'circuit-short': 'Heizkreis deutlich kürzer als die übrigen am Verteiler – stark drosseln, engeren Verlegeabstand wählen oder Verteiler näher setzen.',
};

export interface PropsActions {
  uploadImage(): void;
  calibrate(): void;
  recognize(opts: RecognizeOptions): void;
  autoLayout(): void;
  openWallView(wallId: string, roomId: string | null): void;
  openBuilding(): void;
  openDesign(): void;
  deleteSelection(): void;
  rotateSelection(): void;
  setPhase(p: Phase): void;
  setTool(t: 'painter' | 'manifold' | 'heatSource' | 'roomRect' | 'wall'): void;
  toast(text: string, kind?: 'info' | 'warn'): void;
}

const WALL_KINDS: [string, string][] = [
  ['auto', 'automatisch (aus den Räumen)'],
  ['exterior', 'Außenwand'],
  ['interior', 'Innenwand'],
  ['unheated', 'Wand zu unbeheiztem Bereich'],
  ['party', 'Haus-/Wohnungstrennwand (beheizter Nachbar)'],
];
const FLOOR_BOUNDARY: [string, string][] = [
  ['auto', 'automatisch (aus Geschossen und Gebäudeart)'],
  ['ground', 'gegen Erdreich'],
  ['unheated', 'gegen unbeheizten Raum'],
  ['outside', 'gegen Außenluft'],
  ['heated', 'gegen beheizten Raum'],
  ['neighbor', 'über Nachbarwohnung'],
];
const CEILING_BOUNDARY: [string, string][] = [
  ['auto', 'automatisch (aus Geschossen, Dach und Gebäudeart)'],
  ['roof', 'Dach / gegen Außenluft'],
  ['unheated', 'gegen unbeheizten Dachraum'],
  ['heated', 'gegen beheizten Raum'],
  ['neighbor', 'unter Nachbarwohnung'],
];
const KIND_LABEL: Record<Wall['kind'], string> = { exterior: 'Außenwand', interior: 'Innenwand', unheated: 'Wand zu unbeheizt', party: 'Trennwand zum Nachbarn' };
const CMF = { unit: 'cm', scale: 100, digits: 1 } as const;

/** Himmelsrichtung der Wandaußenseite unter Berücksichtigung der Nordrichtung */
export function compass(w: Wall, room: Room | null, north = 0): string {
  const dir = norm(sub(w.b, w.a));
  let n = { x: -dir.y, y: dir.x };
  if (room && cross(dir, sub(centroid(room.polygon), w.a)) > 0) n = { x: -n.x, y: -n.y };
  const ang = (Math.atan2(n.x, -n.y) * 180) / Math.PI - north;
  const names = ['N', 'NO', 'O', 'SO', 'S', 'SW', 'W', 'NW'];
  return names[Math.round((((ang % 360) + 360) % 360) / 45) % 8];
}

export function wallLabel(w: Wall, room: Room | null, north = 0): string {
  return `${KIND_LABEL[w.kind]} ${num(dist(w.a, w.b), 2)} m${w.kind === 'exterior' ? ` (${compass(w, room, north)})` : ''}`;
}

export class PropsPanel {
  recognizeOpts: RecognizeOptions = { ...DEFAULT_RECOGNIZE };
  private armed: HTMLElement | null = null;

  constructor(
    private root: HTMLElement,
    private store: Store,
    private actions: PropsActions,
  ) {
    root.addEventListener('click', (e) => this.onClick(e));
    bindFields(root, (k, val, el, live) => this.onField(k, val, el, live));
    bindElementConstructions(root, store);
  }

  render(): void {
    const active = document.activeElement as HTMLElement | null;
    if (active && this.root.contains(active) && (active.dataset?.kind === 'range' || active.dataset?.kind === 'color')) return;
    const focusKey = active && this.root.contains(active) ? active.dataset?.key : null;
    const scroll = this.root.scrollTop;
    this.root.innerHTML = this.html();
    this.root.scrollTop = scroll;
    if (focusKey) this.root.querySelector<HTMLElement>(`[data-key="${focusKey}"]`)?.focus();
  }

  private section(title: string, fields: FieldSpec[], prefix: string, extra = ''): string {
    return `<div class="group"><h3>${esc(title)}</h3><div class="fields">${fields.map((f) => fieldHtml(f, prefix)).join('')}</div>${extra}</div>`;
  }

  private html(): string {
    const s = this.store;
    const sel = s.selection;
    const f = s.floor;
    if (!sel.length) return this.guide() + this.floorPanel(f);
    const kinds = [...new Set(sel.map((x) => x.kind))];
    let html = '';
    if (sel.length > 1) html += `<div class="panel-head"><h2>${sel.length} Objekte</h2><span class="chip">${kinds.map(kindLabel).join(', ')}</span></div>`;
    if (kinds.length === 1) {
      const it = sel[0];
      const room = it.kind === 'room' ? f.rooms.find((r) => r.id === it.id) : undefined;
      const wall = it.kind === 'wall' ? f.walls.find((w) => w.id === it.id) : undefined;
      if (room) html += this.roomPanel(room, s.design.rooms.get(room.id), sel.length);
      else if (wall) html += this.wallPanel(wall, sel.length);
      else if (it.kind === 'opening') {
        const w = f.walls.find((x) => x.id === it.wallId);
        const o = w?.openings.find((x) => x.id === it.id);
        if (w && o) html += this.openingPanel(w, o);
      } else if (it.kind === 'furniture') html += this.furniturePanel(it.id, sel.length);
      else if (it.kind === 'stair') html += this.stairPanel(it.id);
      else if (it.kind === 'dimension') html += this.dimPanel(it.id);
      else if (it.kind === 'label') html += this.labelPanel(it.id);
      else if (it.kind === 'void') html += this.voidPanel(it.id);
      else if (it.kind === 'manifold') html += this.manifoldPanel(it.id);
      else if (it.kind === 'heatSource' && s.project.heatSource) html += this.heatSourcePanel();
      else if (it.kind === 'route') html += this.routePanel(it.id);
    }
    const canPaint = ['wall', 'opening', 'room', 'furniture'].includes(sel[0].kind) && s.phase !== 'circuits' && s.phase !== 'results';
    const geom = s.phase === 'build';
    html += `<div class="actions sticky">${canPaint ? `<button class="btn small" data-act="painter" title="Eigenschaften auf andere Objekte übertragen">Format übertragen</button>` : ''}${geom ? `<button class="btn small" data-act="rotate">Drehen 90°</button>` : ''}${geom || ['manifold', 'heatSource', 'route', 'void'].includes(sel[0].kind) ? `<button class="btn small danger" data-act="delete" data-confirm="1">Löschen</button>` : ''}</div>`;
    return html;
  }

  // ---------- Leitfaden je Phase ----------

  private guide(): string {
    const s = this.store;
    const p = s.project;
    const d = s.design;
    const rooms = p.floors.flatMap((f) => f.rooms);
    const walls = p.floors.flatMap((f) => f.walls);
    const ops = walls.flatMap((w) => w.openings);
    const idx = PHASES.findIndex((x) => x.id === s.phase);
    const next = PHASES[idx + 1];
    const item = (ok: boolean, text: string) => `<li class="${ok ? 'ok' : 'todo'}">${esc(text)}</li>`;
    let list = '';
    let intro = '';
    switch (s.phase) {
      case 'build':
        intro = 'Grundriss zeichnen: Räume aufziehen (R) oder Wände zeichnen (W), dann Türen und Fenster setzen (O). Ein Grundrissbild kann als Vorlage dienen.';
        list = item(walls.length > 0, `${walls.length} Wände`) + item(rooms.length > 0, `${rooms.length} Räume`) + item(ops.some((o) => o.kind === 'window'), `${ops.filter((o) => o.kind === 'window').length} Fenster, ${ops.filter((o) => o.kind !== 'window').length} Türen`) + item(p.floors.length > 1 || rooms.length > 0, `${p.floors.length} Geschoss${p.floors.length > 1 ? 'e' : ''}`);
        break;
      case 'parts': {
        const ext = walls.filter((w) => w.kind === 'exterior').length;
        const own = walls.filter((w) => w.construction).length + rooms.filter((r) => r.floorConstruction || r.ceilingConstruction).length;
        intro = 'Bauteile prüfen: Wand anklicken für Art und Aufbau, Fenster und Türen für den U-Wert, Raum für Raumart, Boden und Decke. „Format übertragen“ kopiert Angaben auf weitere Bauteile.';
        list = item(ext > 0, `${ext} Außenwände, ${walls.filter((w) => w.kind === 'party').length} Trennwände`) + item(true, `${own} Bauteile mit eigenem Aufbau`) + item(rooms.every((r) => r.type !== 'sonstiges'), `${rooms.filter((r) => r.type === 'sonstiges').length} Räume ohne Raumart`) + item(true, `Heizlast gesamt ${num(d.totals.heatLoad, 0)} W`);
        break;
      }
      case 'heating': {
        const missing = rooms.filter((r) => r.heated && !r.surfaces.length).length;
        intro = 'Heizflächen festlegen: Raum anklicken und Fußboden-, Wand- oder Deckenheizung wählen. Wandheizung per Doppelklick auf die Wand in der Wandansicht anpassen.';
        list = item(missing === 0, `${missing} beheizte Räume ohne Heizfläche`) + item(true, `${rooms.filter((r) => r.surfaces.some((x) => x.kind === 'wall')).length} Räume mit Wandheizung`) + item(true, `${rooms.filter((r) => r.surfaces.some((x) => x.kind === 'ceiling')).length} Räume mit Deckenheizung`);
        break;
      }
      case 'circuits': {
        const mf = p.floors.reduce((a, f) => a + f.manifolds.length, 0);
        intro = 'Heizkreise: Verteiler setzen (M) – die Kreise werden automatisch verteilt. Wärmeerzeuger setzen (G), Anbindeleitungen bei Bedarf von Hand führen (L).';
        list = item(mf > 0, `${mf} Heizkreisverteiler`) + item(!!p.heatSource, p.heatSource ? `Wärmeerzeuger: ${HEAT_SOURCE_TYPES[p.heatSource.type] ?? p.heatSource.type}` : 'kein Wärmeerzeuger gesetzt') + item(d.totals.circuits > 0, `${d.totals.circuits} Heizkreise, Vorlauf ${num(d.thetaSupply, 1)} °C`);
        break;
      }
      case 'results':
        intro = 'Ergebnisse: Tabellen unten öffnen, als CSV oder SVG exportieren. Zurück in jede Phase ist jederzeit möglich.';
        list = item(true, `Heizlast ${num(d.totals.heatLoad, 0)} W`) + item(d.totals.deficit < 5, d.totals.deficit > 5 ? `${num(d.totals.deficit, 0)} W ohne ausreichende Heizfläche` : 'alle Räume ausreichend versorgt') + item(true, `${d.totals.circuits} Heizkreise · ${num(d.totals.pipeTotal, 0)} m Rohr`);
        break;
    }
    return `<div class="phase-guide"><div class="pg-head"><span class="pg-step">${idx + 1}/5</span><b>${esc(PHASES[idx].label)}</b></div><p>${esc(intro)}</p><ul class="pg-list">${list}</ul>${next ? `<button class="btn primary small" data-act="next-phase" data-phase="${next.id}">Weiter: ${esc(next.label)} →</button>` : ''}</div>`;
  }

  // ---------- Geschoss und Projekt ----------

  private floorPanel(floor: Floor): string {
    const s = this.store;
    const p = s.project;
    const phase = s.phase;
    let html = `<div class="panel-head"><h2>${esc(floor.name)}</h2><span class="chip">${level(floor.elevation)}</span></div>`;
    if (phase === 'build') {
      html += this.section(
        'Geschoss',
        [
          { kind: 'text', key: 'floor.name', label: 'Bezeichnung', value: floor.name },
          { kind: 'num', key: 'floor.elevation', label: 'Höhe OK FFB', value: floor.elevation, unit: 'm', digits: 3 },
          { kind: 'num', key: 'floor.storeyHeight', label: 'Geschosshöhe', value: floor.storeyHeight, unit: 'm', digits: 3 },
          { kind: 'num', key: 'floor.clearHeight', label: 'lichte Raumhöhe', value: floor.clearHeight, unit: 'm', digits: 2 },
          { kind: 'num', key: 'floor.floorThickness', label: 'Deckenstärke darunter', value: floor.floorThickness, ...CMF },
          { kind: 'check', key: 'floor.belowGrade', label: 'Geschoss liegt im Erdreich (Keller)', value: floor.belowGrade },
          { kind: 'check', key: 'floor.visible', label: 'in 3D anzeigen', value: floor.visible },
          { kind: 'readout', label: 'Fläche Räume', value: m2(floor.rooms.reduce((a, r) => a + area(r.polygon), 0), 2) },
        ],
        'f',
      );
      html += this.backgroundSection(floor);
      const st = p.settings;
      html += this.section(
        'Zeichnen',
        [
          { kind: 'num', key: 'set.wallThickness', label: 'Wanddicke neu', value: st.wallThickness, ...CMF },
          { kind: 'num', key: 'set.gridStep', label: 'Rasterweite', value: st.gridStep, ...CMF },
          { kind: 'check', key: 'set.showGrid', label: 'Raster anzeigen', value: st.showGrid },
          { kind: 'check', key: 'set.magnetism', label: 'Magnetismus (Fangen, 15°, cm)', value: st.magnetism },
          { kind: 'check', key: 'set.showRoomArea', label: 'Raumflächen anzeigen', value: st.showRoomArea },
          { kind: 'check', key: 'set.showWallDims', label: 'Wandmaße der Auswahl', value: st.showWallDims },
          { kind: 'num', key: 'site.north', label: 'Nordrichtung (Drehung)', value: p.site.north, unit: '°', digits: 0 },
        ],
        'st',
      );
    } else if (phase === 'parts') {
      const b = p.building;
      const slots: [keyof typeof SURFACE_RESISTANCE, number][] = [
        ['extWall', b.uExtWall],
        ['roof', b.uRoof],
        ['topSlab', b.uTopSlab],
        ['groundSlab', b.uGroundFloor],
        ['basementSlab', b.uUnheatedSlab],
        ['unheatedWall', b.uUnheatedWall],
      ];
      html += `<div class="group"><h3>Gebäudeaufbauten (Vorgabe für alle Bauteile)</h3><dl class="kv">${slots.map(([k, u]) => `<dt>${esc(SURFACE_RESISTANCE[k].label)}</dt><dd>U ${num(u, 3)}</dd>`).join('')}<dt>Fenster (${esc(WINDOW_TYPES[b.windowType]?.label ?? '')})</dt><dd>U ${num(b.uWindow, 2)}</dd><dt>Außentüren</dt><dd>U ${num(b.uDoor, 2)}</dd><dt>Haus-/Wohnungstrennwand</dt><dd>U ${num(b.uPartyWall, 2)}</dd><dt>Wärmebrückenzuschlag</dt><dd>${num(b.deltaUTB, 3)}</dd></dl><div class="actions"><button class="btn small" data-act="building">Gebäude und Aufbauten bearbeiten …</button></div></div>`;
      html += this.section(
        'Gebäudeart und Nachbarn',
        [
          { kind: 'select', key: 'site.houseType', label: 'Gebäudeart', value: p.site.houseType, options: HOUSE_TYPE_OPTIONS },
          ...(p.site.houseType === 'whg' ? ([{ kind: 'select', key: 'site.unitPosition', label: 'Lage der Wohnung', value: p.site.unitPosition, options: [['ground', 'Erdgeschoss (Boden gegen Erdreich/Keller)'], ['middle', 'Zwischengeschoss'], ['top', 'Dachgeschoss (Decke gegen Dach)']] }] as FieldSpec[]) : []),
          { kind: 'num', key: 'site.neighbourTemp', label: 'Temperatur beheizter Nachbarn (Annahme)', value: p.site.neighbourTemp, unit: '°C', digits: 1 },
        ],
        'site',
        `<p class="note">Trennwände zum Nachbarn werden über die angebauten Seiten oder von Hand je Wand festgelegt. Die Nachbartemperatur ist eine Annahme; maßgeblich ist der nationale Anhang.</p>`,
      );
    } else if (phase === 'heating') {
      html += `<div class="group"><h3>Vorgaben</h3><dl class="kv"><dt>Standardsystem Fußboden</dt><dd>${esc(HEATING_SYSTEMS[p.design.defaultFloorSystem]?.label ?? '')}</dd><dt>zulässige Verlegeabstände</dt><dd>${p.design.allowedSpacings.map((x) => cm(x)).join(' · ')}</dd><dt>Ziel-Vorlauf</dt><dd>${degC(p.design.targetSupply)}</dd></dl><div class="actions"><button class="btn small" data-act="design">Auslegung bearbeiten …</button><button class="btn small" data-act="floor-heating-all">Alle beheizten Räume: Fußbodenheizung</button></div></div>`;
    } else {
      html += this.overview(floor);
      html += `<div class="actions">${p.floors.some((x) => x.manifolds.length) ? `<button class="btn primary" data-act="auto-layout">Heizkreise automatisch verteilen</button>` : `<button class="btn primary" data-act="tool-manifold">Verteiler setzen</button>`}${p.heatSource ? '' : `<button class="btn" data-act="tool-heatSource">Wärmeerzeuger setzen</button>`}</div>`;
    }
    if (p.floors.length > 1 && phase === 'build') html += `<div class="actions"><button class="btn danger small" data-act="delete-floor" data-confirm="1">Geschoss löschen</button></div>`;
    return html;
  }

  private overview(floor: Floor): string {
    const d = this.store.design;
    const rooms = [...d.rooms.values()].filter((r) => r.floorId === floor.id);
    const load = rooms.reduce((a, r) => a + r.heatLoad.total, 0);
    const ar = rooms.filter((r) => r.hasHeating).reduce((a, r) => a + r.area, 0);
    return `<div class="group"><h3>Übersicht ${esc(floor.name)}</h3><div class="fields">
      ${fieldHtml({ kind: 'readout', label: 'Räume', value: `${floor.rooms.length}` }, 's')}
      ${fieldHtml({ kind: 'readout', label: 'beheizte Fläche', value: m2(ar, 1) }, 's')}
      ${fieldHtml({ kind: 'readout', label: 'Heizlast', value: W(load) }, 's')}
      ${fieldHtml({ kind: 'readout', label: 'spez. Heizlast', value: ar > 0 ? Wm2(load / ar) : '–' }, 's')}
      ${fieldHtml({ kind: 'readout', label: 'Heizkreise', value: `${rooms.reduce((a, r) => a + r.circuits.length, 0)}` }, 's')}
      ${fieldHtml({ kind: 'readout', label: 'Vorlauf', value: degC(d.thetaSupply) }, 's')}
    </div></div>`;
  }

  private backgroundSection(floor: Floor): string {
    const bg = floor.background;
    const o = this.recognizeOpts;
    let h = '';
    if (bg) {
      h += `<div class="fields">`;
      h += fieldHtml({ kind: 'readout', label: 'Maßstab', value: `1 m = ${num(bg.pxPerM, 1)} px`, tone: bg.calibrated ? 'ok' : 'warn' }, 'b');
      h += fieldHtml({ kind: 'range', key: 'bg.opacity', label: 'Deckkraft', value: bg.opacity, min: 0.05, max: 1, step: 0.05, display: `${Math.round(bg.opacity * 100)} %` }, 'b');
      h += fieldHtml({ kind: 'check', key: 'bg.visible', label: 'Bild anzeigen', value: bg.visible }, 'b');
      h += `</div>`;
      if (!bg.calibrated) h += `<p class="note warn">Der Maßstab ist noch nicht kalibriert. Zwei Punkte mit bekanntem Abstand anklicken.</p>`;
      h += `<div class="actions"><button class="btn small${bg.calibrated ? '' : ' primary'}" data-act="calibrate">Maßstab kalibrieren</button><button class="btn small" data-act="upload">Bild ersetzen</button><button class="btn small danger" data-act="remove-image" data-confirm="1">Entfernen</button></div><p class="note">⌥/Alt + Ziehen auf freier Fläche verschiebt das Bild.</p>`;
      h += `<h3 class="sub">Räume und Wände erkennen</h3><div class="fields">
        ${fieldHtml({ kind: 'select', key: 'rec.outlineWalls', label: 'Wände im Plan', value: o.outlineWalls ? '1' : '0', options: [['0', 'gefüllt / schraffiert'], ['1', 'nur Umrisslinien']] }, 'rc')}
        ${fieldHtml({ kind: 'range', key: 'rec.thresholdBias', label: 'Schwellwert', value: o.thresholdBias, min: -60, max: 60, step: 5, display: o.thresholdBias > 0 ? `+${o.thresholdBias}` : `${o.thresholdBias}` }, 'rc')}
        ${fieldHtml({ kind: 'num', key: 'rec.minWall', label: 'kleinste Wanddicke', value: o.minWall, ...CMF }, 'rc')}
        ${fieldHtml({ kind: 'num', key: 'rec.maxGap', label: 'größte Türbreite', value: o.maxGap, unit: 'm', digits: 2 }, 'rc')}
      </div><div class="actions"><button class="btn small primary" data-act="recognize" data-confirm="${floor.walls.length || floor.rooms.length ? '1' : ''}"${bg.calibrated ? '' : ' disabled title="Zuerst Maßstab kalibrieren"'}>Räume &amp; Wände erkennen</button></div>`;
    } else h += `<p class="note">Grundriss (PNG, JPG, SVG oder DXF) laden, Maßstab kalibrieren und nachzeichnen oder Räume erkennen lassen.</p><div class="actions"><button class="btn small primary" data-act="upload">Grundriss laden</button></div>`;
    return `<div class="group"><h3>Grundrissvorlage</h3>${h}</div>`;
  }

  // ---------- Wand ----------

  private wallPanel(w: Wall, n: number): string {
    const s = this.store;
    const p = s.project;
    const floor = s.floor;
    const rooms = floor.rooms.filter((r) => wallsOfRoom(floor, r).some((x) => x.wall.id === w.id));
    const multi = n > 1 ? ' (alle gewählten)' : '';
    let html = `<div class="panel-head"><h2>${esc(wallLabel(w, rooms[0] ?? null, p.site.north))}</h2><span class="chip">${cm(w.thickness)}</span></div>`;
    if (s.phase === 'build') {
      html += this.section('Maße' + multi, [
        { kind: 'num', key: 'wall.length', label: 'Länge (Achse)', value: wallLength(w), ...CMF },
        { kind: 'num', key: 'wall.thickness', label: 'Dicke', value: w.thickness, ...CMF },
        { kind: 'num', key: 'wall.height', label: 'Höhe', value: w.height ?? null, ...CMF, placeholder: `Geschoss ${num(floor.storeyHeight * 100, 0)}` },
      ], 'w');
      html += this.section('Lage', [
        { kind: 'num', key: 'wall.ax', label: 'Anfang X', value: w.a.x, ...CMF },
        { kind: 'num', key: 'wall.ay', label: 'Anfang Y', value: w.a.y, ...CMF },
        { kind: 'num', key: 'wall.bx', label: 'Ende X', value: w.b.x, ...CMF },
        { kind: 'num', key: 'wall.by', label: 'Ende Y', value: w.b.y, ...CMF },
      ], 'w');
      html += this.section('Oberflächen' + multi, [
        { kind: 'color', key: 'wall.colorLeft', label: 'Farbe links', value: w.colorLeft ?? '#f2efe9' },
        { kind: 'color', key: 'wall.colorRight', label: 'Farbe rechts', value: w.colorRight ?? (w.kind === 'exterior' ? '#e9e2d6' : '#f2efe9') },
      ], 'w', `<div class="actions"><button class="btn small" data-act="wall-split">In der Mitte teilen</button><button class="btn small" data-act="wall-reverse">Richtung umkehren</button></div>`);
      html += this.openingsList(w);
    } else if (s.phase === 'parts') {
      const fields: FieldSpec[] = [{ kind: 'select', key: 'wall.kind', label: 'Art' + multi, value: w.kindAuto ? 'auto' : w.kind, options: WALL_KINDS.map(([k, l]) => [k, k === 'auto' ? `${l}: ${KIND_LABEL[w.kind]}` : l] as [string, string]) }];
      fields.push({ kind: 'num', key: 'wall.thickness', label: 'Dicke', value: w.thickness, ...CMF });
      if (w.kind === 'exterior')
        fields.push({ kind: 'num', key: 'wall.earthHeight', label: 'Erdanschüttung über OK FFB', value: w.earthHeight ?? null, unit: 'm', digits: 2, placeholder: `auto ${num(buriedHeight(p, floor, w, buildingBounds(p)), 2)}`, hint: 'leer = aus dem Gelände (Hanglage)' });
      html += this.section('Wand', fields, 'w');
      if (w.kind !== 'interior') html += `<div class="group">${elementConstructionHtml(p, floor, `wall:${w.id}`, w.kind === 'party' ? 'Aufbau Trennwand' : 'Aufbau dieser Wand')}</div>`;
      else html += `<p class="note">Innenwände zwischen beheizten Räumen gehen nur bei unterschiedlichen Raumtemperaturen in die Heizlast ein (U Innenwand ${num(p.building.uInteriorWall, 2)}).</p>`;
      html += this.openingsList(w);
    } else {
      html += `<div class="group"><h3>Wandheizung</h3><p class="note">Die Wandansicht zeigt die Heizfelder der angrenzenden Räume mit Fenstern und Türen.</p><div class="actions">${rooms
        .filter((r) => r.heated)
        .map((r) => `<button class="btn small" data-act="wall-view" data-wall="${w.id}" data-room="${r.id}">Wandansicht · ${esc(r.name)}</button>`)
        .join('')}</div></div>`;
      for (const r of rooms.filter((x) => x.heated))
        if (!r.surfaces.some((x) => x.kind === 'wall' && x.wallId === w.id)) html += `<div class="actions"><button class="btn small" data-act="add-wall-heat" data-wall="${w.id}" data-room="${r.id}">+ Wandheizung für ${esc(r.name)}</button></div>`;
    }
    return html;
  }

  private openingsList(w: Wall): string {
    const p = this.store.project;
    return `<div class="group"><h3>Öffnungen</h3>${
      w.openings.length
        ? `<div class="table-wrap"><table class="mini"><thead><tr><th>Art</th><th>B × H</th><th>U</th></tr></thead><tbody>${w.openings
            .map((o) => `<tr class="clickable" data-act="select-opening" data-oid="${o.id}" data-wall="${w.id}"><td>${esc(OPENING_STYLES[styleOf(o)].label)}</td><td>${num(o.width * 100, 1)} × ${num(o.height * 100, 1)}</td><td>${num(o.uValue ?? (o.kind === 'window' ? p.building.uWindow : p.building.uDoor), 2)}</td></tr>`)
            .join('')}</tbody></table></div>`
        : '<p class="note">Keine Öffnungen. Mit dem Werkzeug „Tür / Fenster“ (O) auf die Wand klicken.</p>'
    }</div>`;
  }

  // ---------- Öffnung ----------

  private openingPanel(w: Wall, o: Opening): string {
    const s = this.store;
    const p = s.project;
    const L = wallLength(w);
    const st = styleOf(o);
    let html = `<div class="panel-head"><h2>${esc(OPENING_STYLES[st].label)}</h2><span class="chip">${m2(o.width * o.height, 2)}</span></div>`;
    if (s.phase === 'build') {
      html += this.section('Art und Maße', [
        { kind: 'select', key: 'op.style', label: 'Art', value: st, options: Object.entries(OPENING_STYLES).map(([k, d]) => [k, d.label] as [string, string]) },
        { kind: 'num', key: 'op.width', label: 'Breite (Rohbau)', value: o.width, ...CMF },
        { kind: 'num', key: 'op.height', label: 'Höhe', value: o.height, ...CMF },
        { kind: 'num', key: 'op.sill', label: 'Brüstung', value: o.sill, ...CMF },
        { kind: 'num', key: 'op.left', label: 'Abstand zum Wandanfang', value: o.offset - o.width / 2, ...CMF },
        { kind: 'readout', label: 'Abstand zum Wandende', value: cm(L - o.offset - o.width / 2) },
        { kind: 'color', key: 'op.color', label: 'Farbe', value: o.color ?? OPENING_STYLES[st].color },
      ], 'o', `<div class="actions"><button class="btn small" data-act="op-side">Öffnungsseite wechseln</button><button class="btn small" data-act="op-hinge">Anschlag links/rechts</button></div>`);
    } else {
      const isWin = o.kind === 'window';
      const def = isWin ? p.building.uWindow : p.building.uDoor;
      html += this.section('Bauteil', [
        { kind: 'readout', label: 'bauphysikalisch', value: { window: 'Fenster', door: 'Innentür', entrance: 'Außentür', garage: 'Garagentor' }[o.kind] },
        { kind: 'readout', label: 'Fläche', value: m2(o.width * o.height, 2) },
        ...(isWin ? ([{ kind: 'select', key: 'op.windowType', label: 'Verglasung (setzt U)', value: Object.entries(WINDOW_TYPES).find(([, t]) => Math.abs(t.u - (o.uValue ?? -1)) < 1e-6)?.[0] ?? '', options: [['', 'Gebäudewert / eigener Wert'], ...Object.entries(WINDOW_TYPES).map(([k, t]) => [k, `${t.label} · U ${num(t.u, 2)}`] as [string, string])] }] as FieldSpec[]) : []),
        { kind: 'num', key: 'op.uValue', label: 'U-Wert dieser Öffnung', value: o.uValue ?? null, unit: 'W/m²K', digits: 2, placeholder: `Gebäude ${num(def, 2)}` },
        { kind: 'num', key: 'op.width', label: 'Breite', value: o.width, ...CMF },
        { kind: 'num', key: 'op.height', label: 'Höhe', value: o.height, ...CMF },
        { kind: 'num', key: 'op.sill', label: 'Brüstung', value: o.sill, ...CMF },
      ], 'o', o.kind === 'door' ? `<p class="note">Innentüren gehen nicht in die Transmission ein.</p>` : '');
    }
    return html;
  }

  // ---------- Raum ----------

  private roomPanel(room: Room, r: RoomResult | undefined, n: number): string {
    const s = this.store;
    const p = s.project;
    const phase = s.phase;
    const multi = n > 1 ? ' (alle gewählten)' : '';
    const typeOpts = Object.entries(ROOM_TYPES).map(([k, t]) => [k, `${t.label} · ${t.thetaI} °C`] as [string, string]);
    const covOpts = Object.entries(COVERINGS).map(([k, c]) => [k, `${c.label} (R ${num(c.rLambdaB, 2)})`] as [string, string]);
    if (!COVERINGS[room.covering]) covOpts.push([room.covering, 'benutzerdefiniert']);
    let html = `<div class="panel-head"><h2>${esc(room.name)}</h2><span class="chip">${m2(area(room.polygon), 2)}</span></div>`;
    if (phase !== 'build' && r?.warnings.length) html += `<ul class="warnings">${r.warnings.map((w) => `<li>${esc(WARNING_TEXT[w])}</li>`).join('')}</ul>`;
    if (phase === 'build') {
      html += this.section('Raum' + multi, [
        { kind: 'text', key: 'room.name', label: 'Bezeichnung', value: room.name },
        { kind: 'select', key: 'room.type', label: 'Raumart', value: room.type, options: typeOpts },
        { kind: 'select', key: 'room.covering', label: 'Bodenbelag', value: room.covering, options: covOpts },
        { kind: 'color', key: 'room.floorColor', label: 'Bodenfarbe', value: floorColorOf(room) },
        { kind: 'color', key: 'room.ceilingColor', label: 'Deckenfarbe', value: room.ceilingColor ?? '#fbfaf7' },
        { kind: 'check', key: 'room.showFloor', label: 'Boden in 3D', value: room.showFloor ?? true },
        { kind: 'check', key: 'room.showCeiling', label: 'Decke in 3D', value: room.showCeiling ?? true },
        { kind: 'readout', label: 'Fläche', value: m2(area(room.polygon), 2) },
        { kind: 'readout', label: 'Umfang', value: m(perimeter(room.polygon), 2) },
      ], 'r', `<div class="actions"><button class="btn small" data-act="room-walls">Wände um den Raum erzeugen</button><button class="btn small" data-act="room-refit">An Wände anpassen</button></div>`);
      return html;
    }
    if (phase === 'parts') {
      html += this.section('Nutzung' + multi, [
        { kind: 'text', key: 'room.name', label: 'Bezeichnung', value: room.name },
        { kind: 'select', key: 'room.type', label: 'Raumart', value: room.type, options: typeOpts },
        { kind: 'check', key: 'room.heated', label: 'beheizt', value: room.heated },
        { kind: 'num', key: 'room.thetaI', label: 'Norm-Innentemperatur θ_int', value: room.thetaI, unit: '°C', digits: 1 },
        { kind: 'num', key: 'room.airChange', label: 'Mindestluftwechsel n_min', value: room.airChange, unit: '1/h', digits: 2 },
      ], 'r');
      html += this.section('Boden und Decke' + multi, [
        { kind: 'select', key: 'room.floorBoundary', label: 'Boden grenzt an', value: room.floorBoundary, options: FLOOR_BOUNDARY },
        { kind: 'select', key: 'room.ceilingBoundary', label: 'Decke grenzt an', value: room.ceilingBoundary, options: CEILING_BOUNDARY },
        { kind: 'num', key: 'room.windowArea', label: 'zusätzliche Fensterfläche', value: room.windowArea, unit: 'm²', digits: 2 },
      ], 'r', `${elementConstructionHtml(p, s.floor, `floor:${room.id}`, 'Bodenaufbau dieses Raums')}${elementConstructionHtml(p, s.floor, `ceil:${room.id}`, 'Deckenaufbau dieses Raums')}`);
      html += this.heatLoadHtml(room, r);
      return html;
    }
    if (phase === 'heating') {
      if (!room.heated) return html + `<p class="note">Unbeheizter Raum. In der Phase „Bauteile“ auf beheizt umstellen.</p>`;
      const rs = new Map((r?.surfaces ?? []).map((x) => [x.surfaceId, x]));
      html += this.section('Bodenbelag', [
        { kind: 'select', key: 'room.covering', label: 'Bodenbelag (R_λ,B)', value: room.covering, options: covOpts },
        { kind: 'num', key: 'room.excludedArea', label: 'nicht belegte Bodenfläche', value: room.excludedArea, unit: 'm²', digits: 2 },
      ], 'r');
      html += `<div class="group"><h3>Heizflächen</h3>${room.surfaces.map((sf) => this.surfaceCard(room, sf, rs.get(sf.id))).join('')}
        <div class="actions"><button class="btn small" data-act="add-surface" data-skind="floor">+ Fußboden</button><button class="btn small" data-act="add-surface" data-skind="wall">+ Wand</button><button class="btn small" data-act="add-surface" data-skind="ceiling">+ Decke</button></div></div>`;
      if (r) html += `<div class="group results"><h3>Bilanz</h3><dl class="kv"><dt>Norm-Heizlast</dt><dd>${W(r.heatLoad.total)}</dd><dt>Leistung Heizflächen</dt><dd>${W(r.output)}</dd>${r.deficit > 5 ? `<dt class="warn">fehlt</dt><dd class="warn">${W(r.deficit)}</dd>` : ''}</dl></div>`;
      return html;
    }
    // Heizkreise / Ergebnisse
    if (room.heated) {
      const manifolds = p.floors.flatMap((f) => f.manifolds.map((mf) => [mf.id, `${mf.name} (${f.name})`] as [string, string]));
      html += this.section('Anschluss', [
        { kind: 'select', key: 'room.manifoldId', label: 'Verteiler', value: room.manifoldLocked ? (room.manifoldId ?? '') : '', options: [['', `automatisch${r?.manifoldId ? ` (${p.floors.flatMap((f) => f.manifolds).find((x) => x.id === r.manifoldId)?.name ?? ''})` : ''}`], ...manifolds] },
        { kind: 'num', key: 'room.circuitsOverride', label: 'Heizkreise Fußboden', value: room.circuitsOverride, placeholder: `auto (${r?.surfaces.find((x) => x.kind === 'floor')?.circuits.length ?? 0})`, digits: 0 },
      ], 'r', `<div class="actions">${room.connector ? `<button class="btn small" data-act="reset-connector">Anschlusspunkt automatisch</button>` : ''}${s.floor.routes.some((x) => x.roomId === room.id) ? `<button class="btn small" data-act="reset-route">Leitung automatisch führen</button>` : ''}</div><p class="note">Raute im Plan ziehen: Anschlusspunkt. Werkzeug „Leitung“ (L): Anbindeleitung von Hand führen.</p>`);
    }
    html += this.heatLoadHtml(room, r, true);
    return html;
  }

  private heatLoadHtml(room: Room, r: RoomResult | undefined, circuits = false): string {
    const hl = r?.heatLoad;
    if (!r || !hl) return '';
    const parts = (p: Record<string, { area: number; loss: number }>) =>
      Object.entries(p)
        .filter(([, x]) => x.loss > 0.5)
        .map(([k, x]) => `<dt class="indent">${esc(k)} (${num(x.area, 1)} m²)</dt><dd>${W(x.loss)}</dd>`)
        .join('');
    let html = `<div class="group results"><h3>Heizlast</h3><dl class="kv">
      <dt>Außenwand</dt><dd>${W(hl.extWall)}</dd>
      ${hl.earthWall > 0.5 ? `<dt class="indent">davon erdberührt (${num(hl.earthWallArea, 1)} m²)</dt><dd>${W(hl.earthWall)}</dd>` : ''}
      ${hl.partyWalls > 0.5 ? `<dt>Trennwände zum Nachbarn</dt><dd>${W(hl.partyWalls)}</dd>` : ''}
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
    if (circuits && r.circuits.length)
      html += `<div class="table-wrap"><table class="mini"><thead><tr><th>Kreis</th><th>Länge</th><th>Durchfluss</th><th>Δp</th></tr></thead><tbody>${r.circuits.map((c) => `<tr><td>${esc(c.label)}</td><td>${m(c.length, 1)}</td><td>${lmin(c.litresPerMinute)}</td><td>${mbar(c.pressureDrop)}</td></tr>`).join('')}</tbody></table></div>`;
    void room;
    return html + `</div>`;
  }

  private surfaceCard(room: Room, sf: HeatingSurface, sr: SurfaceResult | undefined): string {
    const sys = HEATING_SYSTEMS[sf.system];
    const p = `surf.${sf.id}`;
    const fields: FieldSpec[] = [{ kind: 'select', key: `${p}.system`, label: 'System', value: sf.system, options: systemsFor(sf.kind).map(([k, x]) => [k, x.label] as [string, string]) }];
    if (sys?.medium === 'water') {
      const allowed = this.store.project.design.allowedSpacings;
      const list = Array.from(new Set([...allowed, ...SPACINGS.filter((x) => Math.abs(x - sf.spacing) < 1e-9)])).sort((a, b) => a - b);
      fields.push({ kind: 'select', key: `${p}.spacing`, label: 'Verlegeabstand VA', value: sf.spacingLocked ? String(sf.spacing) : 'auto', options: [['auto', `automatisch (${cm(sf.spacing)})`], ...list.map((x) => [String(x), cm(x)] as [string, string])] });
      if (sf.kind !== 'wall') fields.push({ kind: 'select', key: `${p}.pattern`, label: 'Verlegeart', value: sf.pattern, options: [['spiral', 'Schnecke (bifilar)'], ['meander', 'Mäander']] });
    }
    if (sys?.medium === 'electric') fields.push({ kind: 'select', key: `${p}.electricPower`, label: 'Heizmatte', value: String(sf.electricPower), options: ELECTRIC_POWERS.map((x) => [String(x), `${x} W/m²`] as [string, string]) });
    if (sf.kind !== 'wall') fields.push({ kind: 'num', key: `${p}.coverage`, label: 'belegter Anteil', value: sf.coverage, unit: '%', scale: 100, digits: 0 });
    let wallSel = '';
    if (sf.kind === 'wall') {
      const opts = wallsOfRoom(this.store.floor, room).map(({ wall }) => [wall.id, wallLabel(wall, room, this.store.project.site.north)] as [string, string]);
      fields.push({ kind: 'select', key: `${p}.wallId`, label: 'Wand', value: sf.wallId ?? '', options: [['', '– Wand wählen –'], ...opts] });
      if (sf.wallId) wallSel = `<button class="btn small" data-act="wall-view" data-wall="${sf.wallId}" data-room="${room.id}">Wandansicht öffnen</button>`;
    }
    let res = '';
    if (sr)
      res = `<dl class="kv mini">
        <dt>Fläche</dt><dd>${m2(sr.area, 2)}</dd>
        <dt>Anteil Heizlast</dt><dd>${W(sr.load)}</dd>
        <dt>q erforderlich / Grenze</dt><dd>${num(sr.qRequired, 0)} / ${num(sr.qLimit, 0)} W/m²</dd>
        <dt>Oberfläche</dt><dd>${degC(sr.surfaceTemp)}</dd>
        ${sr.medium === 'water' ? `<dt>Spreizung · Rücklauf</dt><dd>${K(sr.sigma)} · ${degC(sr.thetaReturn)}</dd><dt>Kreise</dt><dd>${sr.circuits.length} · ${m(sr.circuits.reduce((a, c) => a + c.length, 0), 0)}</dd>` : ''}
        ${sr.electric ? `<dt>Anschlussleistung</dt><dd>${W(sr.electric.installed)} · ${sr.electric.circuits} Kreis${sr.electric.circuits > 1 ? 'e' : ''}</dd>` : ''}
      </dl>`;
    return `<div class="surface-card kind-${sf.kind}">
      <div class="sc-head"><span class="sc-kind">${SURFACE_LABEL[sf.kind]}</span><button class="icon-btn small" data-act="remove-surface" data-sid="${sf.id}" aria-label="Heizfläche entfernen" title="Heizfläche entfernen"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg></button></div>
      <div class="fields">${fields.map((x) => fieldHtml(x, `sf${sf.id}`)).join('')}</div>
      ${sys ? `<p class="note">${esc(sys.note)}</p>` : ''}
      ${wallSel ? `<div class="actions">${wallSel}</div>` : ''}
      ${res}
    </div>`;
  }

  // ---------- Möbel, Treppe, Maß, Text, Luftraum ----------

  private furniturePanel(id: string, n: number): string {
    const f = this.store.floor.furniture.find((x) => x.id === id);
    if (!f) return '';
    const multi = n > 1 ? ' (alle gewählten)' : '';
    return (
      `<div class="panel-head"><h2>${esc(f.name)}</h2><span class="chip">${esc(CATALOG_BY_KEY[f.catalog]?.category ?? '')}</span></div>` +
      this.section('Maße' + multi, [
        { kind: 'text', key: 'fur.name', label: 'Name', value: f.name },
        { kind: 'num', key: 'fur.width', label: 'Breite', value: f.width, ...CMF },
        { kind: 'num', key: 'fur.depth', label: 'Tiefe', value: f.depth, ...CMF },
        { kind: 'num', key: 'fur.height', label: 'Höhe', value: f.height, ...CMF },
        { kind: 'num', key: 'fur.elevation', label: 'Höhe über Boden', value: f.elevation, ...CMF },
      ], 'fu') +
      this.section('Lage und Aussehen' + multi, [
        { kind: 'num', key: 'fur.x', label: 'X', value: f.pos.x, ...CMF },
        { kind: 'num', key: 'fur.y', label: 'Y', value: f.pos.y, ...CMF },
        { kind: 'num', key: 'fur.angle', label: 'Winkel', value: f.angle, unit: '°', digits: 0 },
        { kind: 'color', key: 'fur.color', label: 'Farbe', value: f.color },
        { kind: 'check', key: 'fur.mirrored', label: 'gespiegelt', value: f.mirrored },
        { kind: 'check', key: 'fur.visible', label: 'sichtbar', value: f.visible },
      ], 'fu')
    );
  }

  private stairPanel(id: string): string {
    const l = this.store.floor;
    const st = l.stairs.find((x) => x.id === id);
    if (!st) return '';
    const g = stairGeometry(st, l.storeyHeight);
    const going = st.type === 'spiral' ? (Math.min(2 * Math.PI, (g.steps * 22.5 * Math.PI) / 180) * (st.length / 2) * 0.6) / g.steps : st.type === 'lshape' ? (st.length - st.width + st.length2) / (g.steps - 1) : st.length / g.steps;
    const rule = 2 * g.riser + going;
    const ok = g.riser >= 0.14 && g.riser <= 0.2 && going >= 0.23 && rule >= 0.59 && rule <= 0.65;
    return (
      `<div class="panel-head"><h2>Treppe</h2><span class="chip">${g.steps} Steigungen</span></div>` +
      this.section('Treppe', [
        { kind: 'select', key: 'st.type', label: 'Art', value: st.type, options: [['straight', 'gerade'], ['lshape', 'viertelgewendelt (L, mit Podest)'], ['spiral', 'Spindeltreppe']] },
        { kind: 'num', key: 'st.width', label: st.type === 'spiral' ? 'Durchmesser' : 'Laufbreite', value: st.type === 'spiral' ? st.length : st.width, ...CMF },
        ...(st.type !== 'spiral' ? ([{ kind: 'num', key: 'st.length', label: st.type === 'lshape' ? 'Länge Lauf 1 inkl. Podest' : 'Lauflänge', value: st.length, ...CMF }] as FieldSpec[]) : []),
        ...(st.type === 'lshape' ? ([{ kind: 'num', key: 'st.length2', label: 'Länge Lauf 2', value: st.length2, ...CMF }] as FieldSpec[]) : []),
        { kind: 'num', key: 'st.steps', label: 'Steigungen', value: st.steps, digits: 0, placeholder: `auto ${stepCount({ ...st, steps: null }, l.storeyHeight)}` },
        ...(st.type === 'spiral' ? ([{ kind: 'check', key: 'st.clockwise', label: 'im Uhrzeigersinn', value: st.clockwise }] as FieldSpec[]) : []),
        { kind: 'num', key: 'st.angle', label: 'Winkel', value: st.angle, unit: '°', digits: 0 },
        { kind: 'color', key: 'st.color', label: 'Farbe', value: st.color },
        { kind: 'check', key: 'st.cutCeiling', label: 'Decke darüber aussparen', value: st.cutCeiling },
      ], 'sta') +
      this.section('Steigungsverhältnis (DIN 18065, Wohngebäude)', [
        { kind: 'readout', label: 'Steigung s', value: cm(g.riser), tone: g.riser >= 0.14 && g.riser <= 0.2 ? 'ok' : 'warn' },
        { kind: 'readout', label: st.type === 'spiral' ? 'Auftritt a (Lauflinie)' : 'Auftritt a', value: cm(going), tone: going >= 0.23 ? 'ok' : 'warn' },
        { kind: 'readout', label: 'Schrittmaß 2s + a', value: cm(rule), tone: ok ? 'ok' : 'warn' },
      ], 'stb', `<p class="note">Richtwerte für notwendige Treppen in Wohngebäuden bis zwei Wohnungen: s 14–20 cm, a ≥ 23 cm, 2s + a = 59–65 cm. Verbindlich sind DIN 18065 und die Landesbauordnung.</p>`)
    );
  }

  private dimPanel(id: string): string {
    const d = this.store.floor.dimensions.find((x) => x.id === id);
    return d ? `<div class="panel-head"><h2>Maßlinie</h2><span class="chip">${m(dist(d.a, d.b), 2)}</span></div>` + this.section('Maßlinie', [{ kind: 'num', key: 'dim.offset', label: 'Abstand', value: d.offset, ...CMF }], 'd') : '';
  }

  private labelPanel(id: string): string {
    const t = this.store.floor.labels.find((x) => x.id === id);
    return t
      ? `<div class="panel-head"><h2>Text</h2></div>` +
          this.section('Text', [
            { kind: 'text', key: 'lab.text', label: 'Text', value: t.text },
            { kind: 'num', key: 'lab.size', label: 'Schriftgröße', value: t.size, ...CMF },
            { kind: 'num', key: 'lab.angle', label: 'Winkel', value: t.angle, unit: '°', digits: 0 },
          ], 't')
      : '';
  }

  private voidPanel(id: string): string {
    const vd = this.store.floor.voids.find((x) => x.id === id);
    if (!vd) return '';
    return `<div class="panel-head"><h2>Luftraum</h2><span class="chip">${m2(area(vd.polygon), 2)}</span></div><p class="note">Öffnung im Fußboden dieses Geschosses (Galerie, Luftraum). Sie zählt nicht zur beheizten Fläche; der Raum darunter ist hier nach oben offen. Treppenlöcher entstehen automatisch aus den Treppen.</p>`;
  }

  // ---------- Verteiler, Wärmeerzeuger, Leitung ----------

  private manifoldPanel(id: string): string {
    const s = this.store;
    const mf = s.floor.manifolds.find((x) => x.id === id);
    if (!mf) return '';
    const mr = s.design.manifolds.find((x) => x.manifoldId === id);
    let html = `<div class="panel-head"><h2>${esc(mf.name)}</h2><span class="chip">${mr?.outlets ?? 0}/${mf.maxOutlets} Abgänge</span></div>`;
    html += this.section('Heizkreisverteiler', [
      { kind: 'text', key: 'mf.name', label: 'Bezeichnung', value: mf.name },
      { kind: 'num', key: 'mf.maxOutlets', label: 'max. Abgänge', value: mf.maxOutlets, digits: 0 },
      { kind: 'num', key: 'mf.supplyLengthOverride', label: 'Leitung zum Wärmeerzeuger (einfach)', value: mf.supplyLengthOverride, unit: 'm', digits: 2, placeholder: mr?.supplyLengthAuto != null ? `auto ${num(mr.supplyLengthAuto, 2)}` : 'kein Wärmeerzeuger' },
    ], 'm');
    if (mr) {
      if (mr.outlets > mr.maxOutlets) html += `<ul class="warnings"><li>Mehr Heizkreise als Abgänge – zweiten Verteiler setzen oder größeren Verteiler wählen.</li></ul>`;
      html += `<div class="group results"><h3>Ergebnis</h3><dl class="kv">
        <dt>Heizleistung</dt><dd>${W(mr.heat)}</dd>
        <dt>Massenstrom</dt><dd>${kgh(mr.massFlow)}</dd>
        <dt>max. Δp Heizkreis</dt><dd>${mbar(mr.maxPressureDrop)}</dd>
        <dt>Kreislängen min – max</dt><dd class="${mr.lengthSpread > 0.35 ? 'warn' : ''}">${num(mr.lengthMin, 1)} – ${num(mr.lengthMax, 1)} m</dd>
        <dt>Streuung (max − min) / Mittel</dt><dd class="${mr.lengthSpread > 0.35 ? 'warn' : ''}">${num(mr.lengthSpread * 100, 0)} %</dd>
        <dt>Zuleitung Vor- + Rücklauf</dt><dd>${m(2 * mr.supplyLength, 1)}</dd>
        <dt>Rohrdimension</dt><dd>${esc(mr.supplyPipe ?? '–')}</dd>
        <dt>v / Δp Zuleitung</dt><dd>${num(mr.supplyVelocity, 2)} m/s · ${mbar(mr.supplyPressureDrop)}</dd>
      </dl>
      <h3>Hydraulischer Abgleich</h3>
      <div class="table-wrap"><table class="mini"><thead><tr><th>Kreis</th><th>Länge</th><th>l/min</th><th>Δp</th><th>Drossel</th></tr></thead><tbody>
      ${mr.circuits.map((c) => `<tr><td>${esc(c.label)}</td><td>${num(c.length, 1)}</td><td>${num(c.litresPerMinute, 2)}</td><td>${num(c.pressureDrop / 100, 0)}</td><td>${num(c.throttle / 100, 0)}</td></tr>`).join('')}
      </tbody></table></div><p class="note">Δp und Drossel in mbar.</p></div>`;
    }
    html += `<div class="actions"><button class="btn primary small" data-act="auto-layout">Automatisch verteilen</button></div>`;
    return html;
  }

  private heatSourcePanel(): string {
    const s = this.store;
    const hs = s.project.heatSource!;
    const d = s.design;
    let html = `<div class="panel-head"><h2>${esc(hs.name)}</h2><span class="chip">Wärmeerzeuger</span></div>`;
    html += this.section('Wärmeerzeuger', [
      { kind: 'text', key: 'hs.name', label: 'Bezeichnung', value: hs.name },
      { kind: 'select', key: 'hs.type', label: 'Art', value: hs.type, options: Object.entries(HEAT_SOURCE_TYPES) },
    ], 'h');
    html += `<div class="group results"><h3>Anlage</h3><dl class="kv">
      <dt>Norm-Heizlast gesamt</dt><dd>${W(d.totals.heatLoad)}</dd>
      <dt>Leistung Heizflächen</dt><dd>${W(d.totals.output)}</dd>
      <dt>Vorlauf / Spreizung</dt><dd>${degC(d.thetaSupply)} · σ ${K(d.sigmaDesign, 0)}</dd>
      <dt>Massenstrom gesamt</dt><dd>${kgh(d.totals.massFlow)}</dd>
      ${d.totals.electricInstalled ? `<dt>Elektro-Anschluss</dt><dd>${W(d.totals.electricInstalled)}</dd>` : ''}
      ${d.manifolds.map((mr) => `<dt>→ ${esc(mr.name)}</dt><dd>2 × ${m(mr.supplyLength, 1)}</dd>`).join('')}
    </dl></div>`;
    return html;
  }

  private routePanel(id: string): string {
    const s = this.store;
    const r = s.floor.routes.find((x) => x.id === id);
    const room = s.floor.rooms.find((x) => x.id === r?.roomId);
    const rr = room ? s.design.rooms.get(room.id) : undefined;
    return `<div class="panel-head"><h2>Anbindeleitung</h2><span class="chip">${r?.auto ? 'automatisch' : 'manuell'}</span></div><div class="group"><div class="fields">${fieldHtml({ kind: 'readout', label: 'Raum', value: room?.name ?? '–' }, 'rt')}${fieldHtml({ kind: 'readout', label: 'Länge einfach', value: rr ? m(rr.feederLength) : '–' }, 'rt')}</div></div>`;
  }

  // ---------- Ereignisse ----------

  private onClick(e: Event): void {
    const t = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
    if (!t || (t as HTMLButtonElement).disabled || t.dataset.act?.startsWith('el-')) return;
    const s = this.store;
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
    const sel = s.selection;
    const it = sel[0];
    const selRoom = (f: Floor) => (it?.kind === 'room' ? f.rooms.find((x) => x.id === it.id) : undefined);
    switch (act) {
      case 'next-phase':
        return this.actions.setPhase(t.dataset.phase as Phase);
      case 'painter':
        return this.actions.setTool('painter');
      case 'tool-manifold':
        return this.actions.setTool('manifold');
      case 'tool-heatSource':
        return this.actions.setTool('heatSource');
      case 'delete':
        return this.actions.deleteSelection();
      case 'rotate':
        return this.actions.rotateSelection();
      case 'upload':
        return this.actions.uploadImage();
      case 'calibrate':
        return this.actions.calibrate();
      case 'recognize':
        return this.actions.recognize(this.recognizeOpts);
      case 'auto-layout':
        return this.actions.autoLayout();
      case 'building':
        return this.actions.openBuilding();
      case 'design':
        return this.actions.openDesign();
      case 'wall-view':
        return this.actions.openWallView(t.dataset.wall!, t.dataset.room ?? null);
      case 'remove-image':
        return s.commit((_p, f) => (f.background = null));
      case 'delete-floor': {
        const fid = s.activeFloorId;
        s.commit((p) => {
          p.floors = p.floors.filter((x) => x.id !== fid);
          if (p.heatSource?.floorId === fid) p.heatSource = null;
          const ids = new Set(p.floors.flatMap((f) => f.manifolds.map((m2_) => m2_.id)));
          p.floors.forEach((f) => f.rooms.forEach((r) => r.manifoldId && !ids.has(r.manifoldId) && (r.manifoldId = null)));
        });
        s.setFloor(s.project.floors[0].id);
        return;
      }
      case 'select-opening':
        return s.select({ kind: 'opening', id: t.dataset.oid!, wallId: t.dataset.wall });
      case 'wall-split':
        return s.commit((_p, f) => {
          const w = f.walls.find((x) => x.id === it.id);
          if (!w) return;
          const [w1, w2] = splitWall(w, wallLength(w) / 2, () => uid('w'));
          f.walls.splice(f.walls.indexOf(w), 1, w1, w2);
        });
      case 'wall-reverse':
        return s.commit((_p, f) => {
          for (const x of sel) {
            const w = f.walls.find((y) => y.id === x.id);
            if (!w) continue;
            const L = wallLength(w);
            [w.a, w.b] = [w.b, w.a];
            [w.colorLeft, w.colorRight] = [w.colorRight, w.colorLeft];
            for (const o of w.openings) {
              o.offset = L - o.offset;
              o.side = (o.side ?? 'left') === 'left' ? 'right' : 'left';
              o.hinge = (o.hinge ?? 'a') === 'a' ? 'b' : 'a';
            }
          }
        });
      case 'op-side':
      case 'op-hinge':
        return s.commit((_p, f) => {
          const o = f.walls.find((w) => w.id === it.wallId)?.openings.find((x) => x.id === it.id);
          if (!o) return;
          if (act === 'op-side') o.side = (o.side ?? 'left') === 'left' ? 'right' : 'left';
          else o.hinge = (o.hinge ?? 'a') === 'a' ? 'b' : 'a';
        });
      case 'room-walls':
        return s.commit((p, f) => {
          const r = selRoom(f);
          if (!r) return;
          const t2 = p.settings.wallThickness;
          const poly = r.polygon;
          const ccw = poly.reduce((acc, q, i) => acc + (q.x * poly[(i + 1) % poly.length].y - poly[(i + 1) % poly.length].x * q.y), 0) > 0;
          const off = poly.map((q, i) => {
            const prev = poly[(i - 1 + poly.length) % poly.length];
            const next = poly[(i + 1) % poly.length];
            const n1 = norm(sub(q, prev));
            const n2 = norm(sub(next, q));
            const o1 = ccw ? { x: n1.y, y: -n1.x } : { x: -n1.y, y: n1.x };
            const o2 = ccw ? { x: n2.y, y: -n2.x } : { x: -n2.y, y: n2.x };
            const bis = norm(add(o1, o2));
            const cos = Math.max(0.3, bis.x * o1.x + bis.y * o1.y);
            return add(q, mul(bis, t2 / 2 / cos));
          });
          addWallChain(f, off, t2, true);
        });
      case 'room-refit':
        return s.commit((_p, f) => refitRooms(f));
      case 'floor-heating-all':
        return s.commit((p) => {
          for (const f of p.floors) for (const r of f.rooms) if (r.heated && !r.surfaces.some((x) => x.kind === 'floor')) r.surfaces.push(newSurface('floor', p.design.defaultFloorSystem));
        });
      case 'reset-connector':
        return s.commit((_p, f) => {
          const r = selRoom(f);
          if (r) r.connector = null;
        });
      case 'reset-route':
        return s.commit((_p, f) => (f.routes = f.routes.filter((x) => x.roomId !== it?.id)));
      case 'add-wall-heat':
        return s.commit((_p, f) => {
          const r = f.rooms.find((x) => x.id === t.dataset.room);
          const w = f.walls.find((x) => x.id === t.dataset.wall);
          if (!r || !w) return;
          const sf = newSurface('wall', 'wall_wet');
          sf.wallId = w.id;
          sf.field = defaultField(w, r, f.clearHeight);
          r.surfaces.push(sf);
        });
      case 'add-surface': {
        const kind = t.dataset.skind as SurfaceKind;
        return s.commit((p, f) => {
          const r = selRoom(f);
          if (!r) return;
          const sys = kind === 'floor' ? p.design.defaultFloorSystem : kind === 'wall' ? 'wall_wet' : 'ceiling_wet';
          const sf = newSurface(kind, sys);
          if (kind === 'wall') {
            const ws = wallsOfRoom(f, r).sort((a, b) => (b.wall.kind === 'exterior' ? 1 : 0) - (a.wall.kind === 'exterior' ? 1 : 0) || b.span.t1 - b.span.t0 - (a.span.t1 - a.span.t0));
            if (ws[0]) {
              sf.wallId = ws[0].wall.id;
              sf.field = defaultField(ws[0].wall, r, f.clearHeight);
            }
          }
          r.surfaces.push(sf);
        });
      }
      case 'remove-surface':
        return s.commit((_p, f) => {
          const r = selRoom(f);
          if (r) r.surfaces = r.surfaces.filter((x) => x.id !== t.dataset.sid);
        });
    }
  }

  private onField(key: string, val: FieldValue, _el: HTMLElement, live: boolean): void {
    const s = this.store;
    const sel = s.selection;
    const parts = key.split('.');
    const [group, field] = parts;
    const numv = typeof val === 'number' ? val : null;
    const ids = (kind: SelItem['kind']) => new Set(sel.filter((x) => x.kind === kind).map((x) => x.id));
    const run = (fn: (p: Project, f: Floor) => void) => (live ? s.live(fn) : s.commit(fn));

    if (group === 'rec') {
      const o = this.recognizeOpts;
      if (field === 'outlineWalls') o.outlineWalls = val === '1';
      if (field === 'thresholdBias' && numv !== null) o.thresholdBias = numv;
      if (field === 'minWall' && numv !== null && numv > 0.02) o.minWall = numv;
      if (field === 'maxGap' && numv !== null && numv > 0.4) o.maxGap = numv;
      if (!live) this.render();
      return;
    }
    if (live && !(group === 'bg' && field === 'opacity') && _el.dataset.kind !== 'color') return;
    if (!live && _el.dataset.kind === 'color' && s.selection.length) {
      // Farbwahl: der letzte Live-Schritt wird zum Undo-Schritt
    }
    switch (group) {
      case 'bg':
        return run((_p, f) => {
          if (!f.background) return;
          if (field === 'opacity' && numv !== null) f.background.opacity = numv;
          if (field === 'visible') f.background.visible = !!val;
        });
      case 'floor':
        return run((_p, f) => {
          if (field === 'name' && typeof val === 'string' && val.trim()) f.name = val.trim();
          if (field === 'elevation' && numv !== null) f.elevation = numv;
          if (field === 'storeyHeight' && numv !== null && numv > 1) f.storeyHeight = numv;
          if (field === 'clearHeight' && numv !== null && numv > 1) f.clearHeight = numv;
          if (field === 'floorThickness' && numv !== null && numv >= 0) f.floorThickness = numv;
          if (field === 'belowGrade') f.belowGrade = !!val;
          if (field === 'visible') f.visible = !!val;
        });
      case 'set':
        return run((p) => {
          const st = p.settings as unknown as Record<string, unknown>;
          if (typeof st[field] === 'boolean') st[field] = !!val;
          else if (numv !== null && numv > 0) st[field] = numv;
        });
      case 'site':
        return run((p) => {
          if (field === 'north' && numv !== null) p.site.north = ((numv % 360) + 360) % 360;
          if (field === 'neighbourTemp' && numv !== null) p.site.neighbourTemp = numv;
          if (field === 'houseType') p.site.houseType = val as Project['site']['houseType'];
          if (field === 'unitPosition') p.site.unitPosition = val as Project['site']['unitPosition'];
        });
      case 'wall':
        return run((_p, f) => {
          for (const w of f.walls.filter((x) => ids('wall').has(x.id))) {
            if (field === 'length' && numv && numv > 0.01) w.b = add(w.a, mul(norm(sub(w.b, w.a)), numv));
            if (field === 'thickness' && numv && numv > 0.01) w.thickness = numv;
            if (field === 'height') w.height = numv && numv > 0.1 ? numv : null;
            if ((field === 'ax' || field === 'ay' || field === 'bx' || field === 'by') && numv !== null) (field[0] === 'a' ? w.a : w.b)[field[1] as 'x' | 'y'] = numv;
            if (field === 'colorLeft' || field === 'colorRight') w[field] = String(val);
            if (field === 'earthHeight') w.earthHeight = numv === null ? null : Math.max(0, numv);
            if (field === 'kind') {
              w.kindAuto = val === 'auto';
              if (val !== 'auto') w.kind = val as Wall['kind'];
            }
            for (const o of w.openings) o.offset = clampOpening(w, o, o.offset);
          }
        });
      case 'op':
        return run((p, f) => {
          const it = sel[0];
          const w = f.walls.find((x) => x.id === it.wallId);
          const o = w?.openings.find((x) => x.id === it.id);
          if (!w || !o) return;
          if (field === 'style') {
            const d = OPENING_STYLES[val as OpeningStyle];
            o.style = val as OpeningStyle;
            Object.assign(o, { width: d.width, height: d.height, sill: d.sill, color: d.color });
            o.kind = kindForStyle(o.style, w);
          }
          if (field === 'width' && numv && numv > 0.2) o.width = Math.min(wallLength(w) - 0.02, numv);
          if (field === 'height' && numv && numv > 0.2) o.height = numv;
          if (field === 'sill' && numv !== null) o.sill = Math.max(0, numv);
          if (field === 'left' && numv !== null) o.offset = numv + o.width / 2;
          if (field === 'color') o.color = String(val);
          if (field === 'uValue') o.uValue = numv !== null && numv > 0 ? numv : null;
          if (field === 'windowType') o.uValue = val ? (WINDOW_TYPES[String(val)]?.u ?? null) : null;
          o.offset = clampOpening(w, o, o.offset);
          void p;
        });
      case 'room':
        return run((p, f) => {
          for (const r of f.rooms.filter((x) => ids('room').has(x.id))) {
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
                r.floorColor = undefined;
                r.floorFinish = undefined;
                break;
              case 'floorColor':
                r.floorColor = String(val);
                break;
              case 'ceilingColor':
                r.ceilingColor = String(val);
                break;
              case 'showFloor':
              case 'showCeiling':
                r[field] = !!val;
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
              case 'floorBoundary':
                r.floorBoundary = val as Room['floorBoundary'];
                break;
              case 'ceilingBoundary':
                r.ceilingBoundary = val as Room['ceilingBoundary'];
                break;
            }
          }
        });
      case 'surf': {
        const sid = parts[1];
        const sf = parts[2];
        return run((_p, f) => {
          const r = f.rooms.find((x) => x.id === sel[0]?.id);
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
            const w = f.walls.find((q) => q.id === x.wallId);
            x.field = w ? defaultField(w, r, f.clearHeight) : undefined;
          }
        });
      }
      case 'fur':
        return run((_p, f) => {
          for (const x of f.furniture.filter((y) => ids('furniture').has(y.id))) {
            if (field === 'name' && typeof val === 'string' && val.trim()) x.name = val.trim();
            if ((field === 'width' || field === 'depth' || field === 'height') && numv && numv > 0.005) x[field] = numv;
            if (field === 'elevation' && numv !== null) x.elevation = numv;
            if (field === 'x' && numv !== null) x.pos.x = numv;
            if (field === 'y' && numv !== null) x.pos.y = numv;
            if (field === 'angle' && numv !== null) x.angle = ((numv % 360) + 360) % 360;
            if (field === 'color') x.color = String(val);
            if (field === 'mirrored' || field === 'visible') x[field] = !!val;
          }
        });
      case 'st':
        return run((_p, f) => {
          const x = f.stairs.find((y) => y.id === sel[0]?.id);
          if (!x) return;
          if (field === 'type') {
            x.type = val as StairType;
            if (x.type === 'spiral') x.length = x.width = 1.6;
            else if (x.type === 'lshape') Object.assign(x, { width: 1, length: 2.5, length2: 1.8 });
            else Object.assign(x, { width: 1, length: 3.6 });
          }
          if (field === 'width' && numv && numv > 0.5) {
            if (x.type === 'spiral') x.length = x.width = numv;
            else x.width = numv;
          }
          if (field === 'length' && numv && numv > 0.5) x.length = numv;
          if (field === 'length2' && numv && numv > 0.3) x.length2 = numv;
          if (field === 'steps') x.steps = numv && numv >= 3 ? Math.round(numv) : null;
          if (field === 'angle' && numv !== null) x.angle = ((numv % 360) + 360) % 360;
          if (field === 'color') x.color = String(val);
          if (field === 'clockwise' || field === 'cutCeiling') x[field] = !!val;
        });
      case 'dim':
        return run((_p, f) => {
          const d = f.dimensions.find((y) => y.id === sel[0]?.id);
          if (d && numv !== null) d.offset = numv;
        });
      case 'lab':
        return run((_p, f) => {
          const t = f.labels.find((y) => y.id === sel[0]?.id);
          if (!t) return;
          if (field === 'text' && typeof val === 'string' && val.trim()) t.text = val;
          if (field === 'size' && numv && numv > 0.02) t.size = numv;
          if (field === 'angle' && numv !== null) t.angle = numv;
        });
      case 'mf':
        return run((_p, f) => {
          const mf = f.manifolds.find((x) => x.id === sel[0]?.id);
          if (!mf) return;
          if (field === 'name' && typeof val === 'string') mf.name = val.trim() || mf.name;
          if (field === 'maxOutlets' && numv !== null && numv >= 2) mf.maxOutlets = Math.round(numv);
          if (field === 'supplyLengthOverride') mf.supplyLengthOverride = numv !== null && numv >= 0 ? numv : null;
        });
      case 'hs':
        return run((p) => {
          if (!p.heatSource) return;
          if (field === 'name' && typeof val === 'string') p.heatSource.name = val.trim() || p.heatSource.name;
          if (field === 'type' && typeof val === 'string') p.heatSource.type = val;
        });
    }
  }
}

export const HOUSE_TYPE_OPTIONS: [string, string][] = [
  ['efh', 'Einfamilienhaus, freistehend'],
  ['bungalow', 'Bungalow'],
  ['villa', 'Stadtvilla'],
  ['dhh', 'Doppelhaushälfte'],
  ['reh', 'Reihenendhaus'],
  ['rmh', 'Reihenmittelhaus'],
  ['mfh', 'Mehrfamilienhaus (ganzes Gebäude)'],
  ['whg', 'Wohnung in einem Mehrfamilienhaus'],
];

const kindLabel = (k: SelItem['kind']) =>
  ({ wall: 'Wände', opening: 'Öffnungen', room: 'Räume', furniture: 'Möbel', stair: 'Treppen', dimension: 'Maße', label: 'Texte', void: 'Lufträume', manifold: 'Verteiler', heatSource: 'Wärmeerzeuger', route: 'Leitungen' })[k];

export { FINISH_COLORS };
