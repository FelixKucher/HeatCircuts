// Planeditor (SVG, Weltkoordinaten in m): Gebäude zeichnen (Wände mit Gehrung, Räume, Öffnungen, Treppen,
// Möbel, Maße), Heizung planen (Verteiler, Wärmeerzeuger, Anbindeleitungen) und „Format übertragen“.

import { CATALOG_BY_KEY } from '../cad/furniture';
import { addRectRoom, addWallChain, detectRoomAt, moveSelection } from '../cad/edit';
import { newOpening, OPENING_STYLES } from '../cad/openings';
import { applyFormat, pickFormat, type FormatData } from '../cad/painter';
import { newStair } from '../cad/stairs';
import { clampOpening, endsAt, left, nearestWall, pointOnWall, projectOnWall, wallDir, wallLength, wallOutlines } from '../cad/walls';
import { floorShort, newRoom, uid } from '../model/factory';
import { HEAT_SOURCE_TYPES } from '../model/catalog';
import type { Floor, Furniture, OpeningStyle, Project, StairType, Vec } from '../model/types';
import type { Phase, SelItem, SelKind, Store } from '../model/store';
import { add, area, cleanPolygon, dist, isSimplePolygon, mul, norm, pointInPolygon, sub } from '../geometry/geom';
import { backgroundMarkup, renderLayers, SVG_DEFS } from './render';
import { belowOf, dimensionSvg, esc, fmt, furnitureSvg, openingSymbol, PLAN_DEFS, planBaseSvg, stairSvg } from './plan-render';

export type Tool =
  | 'select'
  | 'pan'
  | 'wall'
  | 'room'
  | 'roomRect'
  | 'opening'
  | 'furniture'
  | 'stair'
  | 'void'
  | 'dimension'
  | 'label'
  | 'calibrate'
  | 'manifold'
  | 'heatSource'
  | 'route'
  | 'painter';

export interface PlanCallbacks {
  status(text: string): void;
  coords(p: Vec | null): void;
  toolChanged(t: Tool): void;
  toast(text: string, kind?: 'info' | 'warn'): void;
  askText(title: string, value: string): Promise<string | null>;
  askNumber(title: string, value: number, unit: string): Promise<number | null>;
  openWallView(wallId: string, roomId: string | null): void;
  manifoldPlaced(): void;
}

interface Snap {
  p: Vec;
  kind: 'end' | 'corner' | 'axis' | 'grid' | 'align' | 'free' | 'angle';
  guides?: [Vec, Vec][];
}

type Drag =
  | { type: 'pan'; start: { x: number; y: number }; view: { x: number; y: number } }
  | { type: 'move'; start: Vec; base: Floor; baseProject: Project; moved: boolean }
  | { type: 'band'; start: Vec; cur: Vec; add: boolean }
  | { type: 'wallEnd'; wallId: string; end: 'a' | 'b'; base: Floor; joined: { wallId: string; end: 'a' | 'b' }[] }
  | { type: 'roomVertex'; roomId: string; idx: number }
  | { type: 'voidVertex'; voidId: string; idx: number }
  | { type: 'objRotate'; id: string; kind: 'furniture' | 'stair' }
  | { type: 'objResize'; id: string; kind: 'furniture' | 'stair'; keepRatio: boolean }
  | { type: 'opening'; wallId: string; id: string; grab: number }
  | { type: 'openingEdge'; wallId: string; id: string; edge: 1 | 2 }
  | { type: 'dimEnd'; id: string; end: 'a' | 'b' | 'off' }
  | { type: 'connector'; roomId: string }
  | { type: 'routePoint'; routeId: string; index: number }
  | { type: 'rect'; start: Vec; cur: Vec }
  | { type: 'image'; start: Vec; offset: Vec };

const ANGLE_STEP = 15;

/** welche Objekte in welcher Phase gewählt werden können */
const PICKABLE: Record<Phase, SelKind[]> = {
  build: ['wall', 'opening', 'room', 'furniture', 'stair', 'dimension', 'label', 'void', 'manifold', 'heatSource'],
  parts: ['wall', 'opening', 'room', 'void'],
  heating: ['room', 'wall', 'opening'],
  circuits: ['room', 'manifold', 'heatSource', 'route', 'wall'],
  results: ['room', 'manifold', 'heatSource'],
};

export const HINTS: Record<Tool, string> = {
  select: 'Klicken wählt, Ziehen verschiebt, Rahmen wählt mehrere (⇧ ergänzt). Doppelklick in einen umschlossenen Bereich legt einen Raum an.',
  pan: 'Ziehen verschiebt die Ansicht, Mausrad zoomt.',
  wall: 'Klicken setzt Wandpunkte. Länge eintippen + Enter. Doppelklick oder Esc beendet. ⌥/⇧ hebt das Fangen auf.',
  room: 'Punkte des Raums klicken (Enter beendet) oder Doppelklick in einen von Wänden umschlossenen Bereich.',
  roomRect: 'Rechteck aufziehen: Wände (Achse) und Raum entstehen zusammen. Angrenzende Wände werden geteilt statt verdoppelt.',
  opening: 'Auf eine Wand klicken. Türen öffnen zur Seite des Mauszeigers.',
  furniture: 'Klicken setzt das Möbel (⇧ für mehrere). Wandmöbel legen sich an die nächste Wand an (⌥ verhindert das).',
  stair: 'Klicken setzt die Treppe. Im Geschoss darüber wird die Decke automatisch ausgespart.',
  void: 'Umriss des Luftraums klicken, Enter beendet. Die Fläche zählt nicht zur beheizten Bodenfläche.',
  dimension: 'Zwei Punkte klicken, dann den Abstand der Maßlinie wählen.',
  label: 'Klicken und Text eingeben.',
  calibrate: 'Zwei Punkte mit bekanntem Abstand im Grundrissbild anklicken.',
  manifold: 'Klicken platziert einen Heizkreisverteiler. Danach werden die Heizkreise automatisch verteilt.',
  heatSource: 'Klicken platziert den Wärmeerzeuger (einer je Projekt).',
  route: 'Raum anklicken, dann Wegpunkte der Anbindeleitung setzen. Klick auf den Verteiler oder Enter beendet.',
  painter: 'Format übertragen: Quelle wählen, dann Ziele anklicken. Esc beendet.',
};

export class PlanView {
  readonly svg: SVGSVGElement;
  tool: Tool = 'select';
  openingStyle: OpeningStyle = 'door';
  catalogKey = 'sofa3';
  stairType: StairType = 'straight';
  view = { x: -2, y: -2, s: 60 };
  painter: FormatData | null = null;
  private drag: Drag | null = null;
  private chain: Vec[] = [];
  private hover: Vec | null = null;
  private snapInfo: Snap | null = null;
  private typed = '';
  private spaceDown = false;
  private calib: Vec[] = [];
  private dimPts: Vec[] = [];
  private routeRoom: string | null = null;
  private lastClick = 0;
  private altKey = false;

  constructor(
    private host: HTMLElement,
    private store: Store,
    private cb: PlanCallbacks,
  ) {
    this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.svg.classList.add('plan');
    host.appendChild(this.svg);
    this.svg.addEventListener('pointerdown', (e) => this.onDown(e));
    this.svg.addEventListener('pointermove', (e) => this.onMove(e));
    this.svg.addEventListener('pointerup', (e) => this.onUp(e));
    this.svg.addEventListener('pointerleave', () => {
      this.hover = null;
      this.cb.coords(null);
      this.renderOverlay();
    });
    this.svg.addEventListener('dblclick', (e) => this.onDbl(e));
    this.svg.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    this.svg.addEventListener('contextmenu', (e) => e.preventDefault());
    this.svg.addEventListener('dragover', (e) => e.preventDefault());
    this.svg.addEventListener('drop', (e) => this.onDrop(e));
    new ResizeObserver(() => this.render()).observe(host);
  }

  // ---------- Ansicht ----------

  private get size(): { w: number; h: number } {
    const r = this.host.getBoundingClientRect();
    return { w: Math.max(10, r.width), h: Math.max(10, r.height) };
  }

  world(e: { clientX: number; clientY: number }): Vec {
    const r = this.svg.getBoundingClientRect();
    return { x: this.view.x + (e.clientX - r.left) / this.view.s, y: this.view.y + (e.clientY - r.top) / this.view.s };
  }

  zoom(f: number, at?: Vec): void {
    const { w, h } = this.size;
    const c = at ?? { x: this.view.x + w / 2 / this.view.s, y: this.view.y + h / 2 / this.view.s };
    const s = Math.min(800, Math.max(4, this.view.s * f));
    this.view.x = c.x - ((c.x - this.view.x) * this.view.s) / s;
    this.view.y = c.y - ((c.y - this.view.y) * this.view.s) / s;
    this.view.s = s;
    this.render();
  }

  fit(): void {
    const l = this.store.floor;
    const pts: Vec[] = [];
    for (const w of l.walls) pts.push(w.a, w.b);
    for (const r of l.rooms) pts.push(...r.polygon);
    for (const f of l.furniture) pts.push(f.pos);
    for (const m of l.manifolds) pts.push(m.pos);
    if (l.background) {
      const b = l.background;
      pts.push(b.offset, add(b.offset, { x: b.widthPx / b.pxPerM, y: b.heightPx / b.pxPerM }));
    }
    const { w, h } = this.size;
    if (!pts.length) {
      this.view = { x: -2, y: -2, s: Math.min(w, h) / 14 };
      this.render();
      return;
    }
    const minX = Math.min(...pts.map((p) => p.x)) - 1.2;
    const maxX = Math.max(...pts.map((p) => p.x)) + 1.2;
    const minY = Math.min(...pts.map((p) => p.y)) - 1.2;
    const maxY = Math.max(...pts.map((p) => p.y)) + 1.2;
    const s = Math.min(w / (maxX - minX), h / (maxY - minY));
    this.view = { x: (minX + maxX) / 2 - w / 2 / s, y: (minY + maxY) / 2 - h / 2 / s, s };
    this.render();
  }

  setTool(t: Tool): void {
    if (this.chain.length > 1 && this.tool === 'wall') this.finishChain();
    if (this.chain.length > 2 && (this.tool === 'room' || this.tool === 'void')) this.finishPolygon();
    if (t === 'painter') {
      const it = this.store.sel;
      this.painter = it ? pickFormat(this.store.floor, it, this.store.phase) : null;
    } else this.painter = null;
    this.tool = t;
    this.chain = [];
    this.calib = [];
    this.dimPts = [];
    this.routeRoom = null;
    this.typed = '';
    this.svg.dataset.tool = t;
    this.cb.toolChanged(t);
    this.cb.status(t === 'painter' && this.painter ? `Format von ${this.painter.label} übernommen – Ziele anklicken, Esc beendet.` : HINTS[t]);
    this.renderOverlay();
  }

  // ---------- Darstellung ----------

  render(): void {
    const { w, h } = this.size;
    const v = this.view;
    this.svg.setAttribute('viewBox', `${v.x} ${v.y} ${w / v.s} ${h / v.s}`);
    const s = this.store;
    const p = s.project;
    const l = s.floor;
    const phase = s.phase;
    this.svg.dataset.phase = phase;
    const design = s.design;
    let out = PLAN_DEFS + SVG_DEFS;
    out += backgroundMarkup(l, s.images);
    if (p.settings.showGrid) out += this.gridSvg();
    const base = planBaseSvg({ project: p, floor: l, design, scale: v.s, sel: s.selection, phase, ghost: belowOf(p, l) });
    out += base.under;
    if (phase !== 'build') {
      const roomSel = s.sel?.kind === 'room' || s.sel?.kind === 'manifold' || s.sel?.kind === 'heatSource' ? s.sel : null;
      const L = renderLayers({ project: p, floor: l, design, images: s.images, scale: v.s, selection: roomSel, showCircuits: phase === 'circuits' || phase === 'results', showLabels: phase !== 'parts', ghost: null });
      out += `<g class="h-areas">${L.heatAreas}</g>`;
      if (phase === 'circuits' || phase === 'results') out += `<g class="layer-circuits">${L.circuits}</g><g class="layer-feeders">${L.feeders}</g>`;
      out += base.walls;
      out += `<g class="layer-wallheat">${L.wallHeat}</g>`;
      out += base.over;
      if (phase === 'circuits' || phase === 'results' || l.manifolds.length || p.heatSource?.floorId === l.id) out += `<g class="layer-objects">${L.objects}</g>`;
      if (phase !== 'parts') out += `<g class="layer-labels" stroke-width="${(3 / v.s).toFixed(4)}">${L.labels}</g>`;
      if (phase === 'circuits') out += `<g class="layer-handles">${L.roomHandles}</g>`;
    } else {
      out += base.walls + base.over;
      if (l.manifolds.length || p.heatSource?.floorId === l.id) {
        const L = renderLayers({ project: p, floor: l, design, images: s.images, scale: v.s, selection: null, showCircuits: false, showLabels: false, ghost: null });
        out += `<g class="layer-objects">${L.objects}</g>`;
      }
    }
    out += `<g class="handles">${this.handlesSvg()}</g><g class="overlay"></g>`;
    this.svg.innerHTML = out;
    this.renderOverlay();
  }

  private gridSvg(): string {
    const { w, h } = this.size;
    const v = this.view;
    const step = this.store.project.settings.gridStep;
    const x0 = v.x;
    const y0 = v.y;
    const x1 = v.x + w / v.s;
    const y1 = v.y + h / v.s;
    let minor = step;
    while (minor * v.s < 8) minor *= 2;
    let major = 1;
    while (major * v.s < 40) major *= 5;
    const lines = (st: number, cls: string) => {
      let out = '';
      for (let x = Math.ceil(x0 / st) * st; x <= x1; x += st) out += `M${x.toFixed(3)} ${y0}V${y1}`;
      for (let y = Math.ceil(y0 / st) * st; y <= y1; y += st) out += `M${x0} ${y.toFixed(3)}H${x1}`;
      return `<path d="${out}" class="${cls}"/>`;
    };
    let s = '';
    if ((x1 - x0) / minor < 400) s += lines(minor, 'grid-minor');
    s += lines(major, 'grid-major');
    s += `<path d="M-0.3 0H0.3M0 -0.3V0.3" class="grid-axis"/>`;
    return `<g class="layer-grid">${s}</g>`;
  }

  private handlesSvg(): string {
    const sel = this.store.selection;
    if (sel.length !== 1) return '';
    const l = this.store.floor;
    const r = 5 / this.view.s;
    const c = (p: Vec, h: string, cls = '', extra = '') => `<circle cx="${p.x}" cy="${p.y}" r="${r}" class="p-handle ${cls}" data-handle="${h}"${extra}/>`;
    const it = sel[0];
    const phase = this.store.phase;
    const geom = phase === 'build';
    if (it.kind === 'wall' && geom) {
      const w = l.walls.find((x) => x.id === it.id);
      return w ? c(w.a, 'wall-a') + c(w.b, 'wall-b') : '';
    }
    if (it.kind === 'room' && geom) {
      const rm = l.rooms.find((x) => x.id === it.id);
      return rm ? rm.polygon.map((p, i) => c(p, 'room-v', '', ` data-idx="${i}"`)).join('') : '';
    }
    if (it.kind === 'void' && geom) {
      const vd = l.voids.find((x) => x.id === it.id);
      return vd && !vd.stairId && vd.kind === 'void' ? vd.polygon.map((p, i) => c(p, 'void-v', '', ` data-idx="${i}"`)).join('') : '';
    }
    if ((it.kind === 'furniture' || it.kind === 'stair') && geom) {
      const f = it.kind === 'furniture' ? l.furniture.find((x) => x.id === it.id) : l.stairs.find((x) => x.id === it.id);
      if (!f) return '';
      const w = 'depth' in f ? f.width : f.type === 'lshape' ? f.width + f.length2 : f.type === 'spiral' ? f.length : f.width;
      const d = 'depth' in f ? f.depth : f.length;
      const a = (f.angle * Math.PI) / 180;
      const T = (x: number, y: number) => ({ x: f.pos.x + x * Math.cos(a) - y * Math.sin(a), y: f.pos.y + x * Math.sin(a) + y * Math.cos(a) });
      const rp = T(0, -d / 2 - 0.35);
      return `<line x1="${f.pos.x}" y1="${f.pos.y}" x2="${rp.x}" y2="${rp.y}" class="p-handle-line"/>` + c(rp, 'rotate', 'rot') + c(T(w / 2, d / 2), 'resize', 'res');
    }
    if (it.kind === 'opening' && geom) {
      const w = l.walls.find((x) => x.id === it.wallId);
      const o = w?.openings.find((x) => x.id === it.id);
      if (!w || !o) return '';
      return c(pointOnWall(w, o.offset - o.width / 2), 'op-1') + c(pointOnWall(w, o.offset + o.width / 2), 'op-2');
    }
    if (it.kind === 'dimension') {
      const d = l.dimensions.find((x) => x.id === it.id);
      if (!d) return '';
      const n = left(norm(sub(d.b, d.a)));
      return c(d.a, 'dim-a') + c(d.b, 'dim-b') + c(add(mul(add(d.a, d.b), 0.5), mul(n, d.offset)), 'dim-off', 'rot');
    }
    return '';
  }

  /** Vorschau des aktiven Werkzeugs, ohne den Plan neu aufzubauen */
  renderOverlay(): void {
    const g = this.svg.querySelector('.overlay');
    if (!g) return;
    const l = this.store.floor;
    const st = this.store.project.settings;
    let s = '';
    const h = this.hover;
    const px = 1 / this.view.s;
    const snap = this.snapInfo;
    if (snap?.guides) for (const [a, b] of snap.guides) s += `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" class="p-guide"/>`;
    if (h && snap && snap.kind !== 'free' && this.tool !== 'select' && this.tool !== 'pan') s += `<rect x="${h.x - 4 * px}" y="${h.y - 4 * px}" width="${8 * px}" height="${8 * px}" class="p-snap s-${snap.kind}"/>`;
    if (this.tool === 'wall' && this.chain.length && h) {
      const pts = [...this.chain, h];
      const t = st.wallThickness;
      for (let i = 0; i + 1 < pts.length; i++) {
        const a = pts[i];
        const b = pts[i + 1];
        if (dist(a, b) < 1e-3) continue;
        const n = mul(left(norm(sub(b, a))), t / 2);
        s += `<polygon points="${[add(a, n), add(b, n), sub(b, n), sub(a, n)].map((p) => `${p.x},${p.y}`).join(' ')}" class="p-wall-preview"/>`;
      }
      const a = this.chain[this.chain.length - 1];
      s += dimensionSvg(a, h, 0.45, this.view.s, ' live');
      const ang = (Math.atan2(-(h.y - a.y), h.x - a.x) * 180) / Math.PI;
      s += this.tag(h, `${fmt(dist(a, h))} m · ${fmt((ang + 360) % 360, 0)}°${this.typed ? ` · Eingabe ${this.typed}` : ''}`);
    }
    if ((this.tool === 'room' || this.tool === 'void') && this.chain.length && h) {
      s += `<polygon points="${[...this.chain, h].map((p) => `${p.x},${p.y}`).join(' ')}" class="p-room-preview"/>`;
    }
    if (this.tool === 'route' && this.routeRoom && h) {
      const pts = [...this.chain, h];
      s += `<polyline points="${pts.map((p) => `${p.x},${p.y}`).join(' ')}" class="draft-route"/>`;
    }
    if (this.drag?.type === 'rect') {
      const { start: a, cur: b } = this.drag;
      const t = st.wallThickness;
      const x0 = Math.min(a.x, b.x);
      const y0 = Math.min(a.y, b.y);
      const W = Math.abs(a.x - b.x);
      const H = Math.abs(a.y - b.y);
      s += `<rect x="${x0 - t / 2}" y="${y0 - t / 2}" width="${W + t}" height="${H + t}" class="p-wall-preview"/><rect x="${x0 + t / 2}" y="${y0 + t / 2}" width="${Math.max(0, W - t)}" height="${Math.max(0, H - t)}" class="p-room-preview"/>`;
      s += this.tag(b, `${fmt(Math.max(0, W - t))} × ${fmt(Math.max(0, H - t))} m lichte Maße · ${fmt(Math.max(0, W - t) * Math.max(0, H - t))} m²`);
    }
    if (this.drag?.type === 'band') {
      const { start: a, cur: b } = this.drag;
      s += `<rect x="${Math.min(a.x, b.x)}" y="${Math.min(a.y, b.y)}" width="${Math.abs(a.x - b.x)}" height="${Math.abs(a.y - b.y)}" class="p-band"/>`;
    }
    if (this.tool === 'opening' && h) {
      const nw = nearestWall(l.walls, h, 0.6);
      if (nw) {
        const o = newOpening(this.openingStyle, 0, nw.wall);
        o.offset = clampOpening(nw.wall, o, nw.t);
        o.side = nw.off >= 0 ? 'left' : 'right';
        s += `<g class="preview">${openingSymbol(nw.wall, o)}</g>`;
        s += this.tag(h, `${OPENING_STYLES[this.openingStyle].label} ${fmt(o.width)} × ${fmt(o.height)} m · Abstand ${fmt(o.offset - o.width / 2)} m`);
      }
    }
    if (this.tool === 'furniture' && h) s += furnitureSvg(this.placeFurniture(this.makeFurniture(h)), false, true);
    if (this.tool === 'stair' && h) s += stairSvg({ ...newStair(this.stairType, h), id: 'preview' }, l.storeyHeight, false, true);
    if (this.tool === 'dimension' && this.dimPts.length && h) {
      s += this.dimPts.length === 1 ? dimensionSvg(this.dimPts[0], h, 0, this.view.s, ' live') : dimensionSvg(this.dimPts[0], this.dimPts[1], this.dimOffset(h), this.view.s, ' live');
    }
    if (this.tool === 'calibrate' && this.calib.length && h) s += `<line x1="${this.calib[0].x}" y1="${this.calib[0].y}" x2="${h.x}" y2="${h.y}" class="p-calib"/>`;
    if ((this.tool === 'manifold' || this.tool === 'heatSource') && h) s += `<circle cx="${h.x}" cy="${h.y}" r="${6 * px}" class="p-snap s-end"/>`;
    g.innerHTML = s;
  }

  private tag(p: Vec, text: string): string {
    const px = 1 / this.view.s;
    const fs = 11 * px;
    const w = text.length * fs * 0.58 + 10 * px;
    return `<g class="p-tag"><rect x="${p.x + 12 * px}" y="${p.y + 10 * px}" width="${w}" height="${fs * 1.7}" rx="${3 * px}"/><text x="${p.x + 17 * px}" y="${p.y + 10 * px + fs * 1.2}" style="font-size:${fs}px">${esc(text)}</text></g>`;
  }

  // ---------- Fangen ----------

  snap(p: Vec, from: Vec | null, e: { shiftKey: boolean; altKey: boolean }): Snap {
    const st = this.store.project.settings;
    const mag = st.magnetism && !e.altKey && !e.shiftKey;
    const l = this.store.floor;
    const tol = 10 / this.view.s;
    let best: Snap | null = null;
    let bd = tol;
    const consider = (q: Vec, kind: Snap['kind']) => {
      const d = dist(p, q);
      if (d < bd) {
        bd = d;
        best = { p: { ...q }, kind };
      }
    };
    for (const w of l.walls) {
      consider(w.a, 'end');
      consider(w.b, 'end');
    }
    for (const q of this.chain.slice(0, -1)) consider(q, 'end');
    if (best) return best;
    if (this.tool === 'room' || this.tool === 'void' || this.tool === 'dimension') {
      for (const o of wallOutlines(l.walls).values()) for (const q of o.poly) consider(q, 'corner');
      if (best) return best;
    }
    if (!mag) return { p, kind: 'free' };
    let q = { ...p };
    let kind: Snap['kind'] = 'grid';
    const guides: [Vec, Vec][] = [];
    if (from) {
      const d = sub(p, from);
      const L = Math.round(Math.hypot(d.x, d.y) * 100) / 100;
      const a = Math.round((Math.atan2(d.y, d.x) * 180) / Math.PI / ANGLE_STEP) * ANGLE_STEP;
      q = add(from, { x: L * Math.cos((a * Math.PI) / 180), y: L * Math.sin((a * Math.PI) / 180) });
      kind = 'angle';
    } else {
      const g = Math.min(0.05, st.gridStep);
      q = { x: Math.round(p.x / g) * g, y: Math.round(p.y / g) * g };
    }
    const ends: Vec[] = [];
    for (const w of l.walls) ends.push(w.a, w.b);
    ends.push(...this.chain);
    for (const ept of ends) {
      if (from && dist(ept, from) < 1e-6) continue;
      const horizontalMove = from && Math.abs(from.y - q.y) < 1e-6;
      const verticalMove = from && Math.abs(from.x - q.x) < 1e-6;
      if (Math.abs(ept.x - q.x) < tol * 0.7 && (!from || horizontalMove)) {
        q = { x: ept.x, y: q.y };
        guides.push([ept, q]);
        kind = 'align';
      } else if (Math.abs(ept.y - q.y) < tol * 0.7 && (!from || verticalMove)) {
        q = { x: q.x, y: ept.y };
        guides.push([ept, q]);
        kind = 'align';
      }
    }
    if (this.tool === 'wall' || this.tool === 'roomRect') {
      for (const w of l.walls) {
        const { t, off } = projectOnWall(w, p);
        if (t > 0 && t < wallLength(w) && Math.abs(off) < Math.max(tol, w.thickness / 2)) return { p: pointOnWall(w, t), kind: 'axis' };
      }
    }
    return { p: q, kind, guides };
  }

  // ---------- Ereignisse ----------

  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    this.zoom(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)), this.world(e));
  }

  setSpace(down: boolean): void {
    this.spaceDown = down;
    this.svg.classList.toggle('panning', down);
  }

  private hit(e: { clientX: number; clientY: number }): SelItem | null {
    const allowed = PICKABLE[this.store.phase];
    const els = document.elementsFromPoint(e.clientX, e.clientY);
    for (const start of els) {
      let el: Element | null = start;
      while (el && el !== this.svg) {
        const ds = (el as HTMLElement).dataset;
        if (ds?.kind) {
          const k = ds.kind as SelKind;
          if (allowed.includes(k)) return { kind: k, id: ds.id!, wallId: ds.wall };
          break;
        }
        el = el.parentElement;
      }
      if (!this.svg.contains(start)) break;
    }
    return null;
  }

  private onDown(e: PointerEvent): void {
    this.svg.setPointerCapture(e.pointerId);
    const p = this.world(e);
    this.altKey = e.altKey;
    if (e.button === 1 || e.button === 2 || this.tool === 'pan' || this.spaceDown) {
      if (e.button === 2 && this.tool === 'wall' && this.chain.length) {
        this.finishChain();
        return;
      }
      this.drag = { type: 'pan', start: { x: e.clientX, y: e.clientY }, view: { x: this.view.x, y: this.view.y } };
      return;
    }
    const s = this.store;
    const l = s.floor;
    const now = performance.now();
    const isDouble = now - this.lastClick < 320;
    this.lastClick = now;
    switch (this.tool) {
      case 'select':
        return this.downSelect(e, p);
      case 'painter': {
        const h = this.hit(e);
        if (!h) return;
        if (!this.painter) {
          this.painter = pickFormat(l, h, s.phase);
          s.select(h);
          this.cb.status(this.painter ? `Format von ${this.painter.label} übernommen – Ziele anklicken, Esc beendet.` : 'Von diesem Objekt lässt sich kein Format übernehmen.');
          return;
        }
        const fmtData = this.painter;
        let ok = false;
        s.commit((pr, fl) => (ok = applyFormat(pr, fl, fmtData, h)));
        this.cb.status(ok ? `Format übertragen auf ${h.kind === 'room' ? 'Raum' : h.kind === 'wall' ? 'Wand' : h.kind === 'opening' ? 'Öffnung' : 'Objekt'}.` : 'Nur auf Objekte derselben Art übertragbar.');
        return;
      }
      case 'wall': {
        const sp = this.snap(p, this.chain[this.chain.length - 1] ?? null, e).p;
        if (isDouble && this.chain.length > 1) return;
        if (this.chain.length > 2 && dist(sp, this.chain[0]) < 1e-6) {
          this.chain.push(sp);
          this.finishChain();
          return;
        }
        if (this.chain.length && dist(sp, this.chain[this.chain.length - 1]) < 0.01) return;
        this.chain.push(sp);
        this.typed = '';
        this.renderOverlay();
        return;
      }
      case 'room':
      case 'void': {
        const sp = this.snap(p, null, e).p;
        if (this.chain.length > 2 && dist(sp, this.chain[0]) < 12 / this.view.s) {
          this.finishPolygon();
          return;
        }
        if (isDouble) return;
        this.chain.push(sp);
        this.renderOverlay();
        return;
      }
      case 'roomRect': {
        const sp = this.snap(p, null, e).p;
        this.drag = { type: 'rect', start: sp, cur: sp };
        return;
      }
      case 'opening': {
        const nw = nearestWall(l.walls, p, 0.6);
        if (!nw) {
          this.cb.toast('Keine Wand in der Nähe – Öffnungen werden in Wände gesetzt.', 'warn');
          return;
        }
        const o = newOpening(this.openingStyle, 0, nw.wall);
        o.offset = clampOpening(nw.wall, o, nw.t);
        o.side = nw.off >= 0 ? 'left' : 'right';
        s.commit((_p, fl) => fl.walls.find((w) => w.id === nw.wall.id)?.openings.push(o));
        s.select({ kind: 'opening', id: o.id, wallId: nw.wall.id });
        return;
      }
      case 'furniture': {
        const f = this.placeFurniture(this.makeFurniture(p));
        s.commit((_p, fl) => fl.furniture.push(f));
        s.select({ kind: 'furniture', id: f.id });
        if (!e.shiftKey) this.setTool('select');
        return;
      }
      case 'stair': {
        const st = newStair(this.stairType, this.snap(p, null, e).p);
        s.commit((_p, fl) => fl.stairs.push(st));
        s.select({ kind: 'stair', id: st.id });
        this.setTool('select');
        return;
      }
      case 'dimension': {
        const sp = this.snap(p, this.dimPts[0] ?? null, e).p;
        if (this.dimPts.length < 2) {
          this.dimPts.push(sp);
          this.renderOverlay();
          return;
        }
        const [a, b] = this.dimPts;
        const off = this.dimOffset(p);
        s.commit((_p, fl) => fl.dimensions.push({ id: uid('D'), a, b, offset: off }));
        this.dimPts = [];
        return;
      }
      case 'label':
        void this.cb.askText('Text', '').then((t) => {
          if (!t) return;
          const id = uid('T');
          s.commit((_p, fl) => fl.labels.push({ id, pos: p, text: t, size: 0.25, angle: 0 }));
          s.select({ kind: 'label', id });
        });
        return;
      case 'calibrate': {
        if (!l.background) {
          this.cb.toast('Zuerst ein Grundrissbild laden.', 'warn');
          return;
        }
        this.calib.push(p);
        if (this.calib.length === 2) {
          const [a, b] = this.calib;
          const dCur = dist(a, b);
          this.calib = [];
          void this.cb.askNumber('Tatsächlicher Abstand der beiden Punkte', Math.round(dCur * 100) / 100, 'm').then((real) => {
            if (!real || real <= 0 || dCur < 1e-6) return;
            const f = real / dCur;
            s.commit((_p, fl) => {
              const bg = fl.background!;
              bg.pxPerM /= f;
              bg.offset = add(a, mul(sub(bg.offset, a), f));
              bg.calibrated = true;
            });
            this.cb.toast(`Maßstab gesetzt: 1 m = ${fmt(s.floor.background!.pxPerM, 1)} px`);
            this.setTool('select');
            this.fit();
          });
        }
        this.renderOverlay();
        return;
      }
      case 'manifold': {
        const q = this.snap(p, null, e).p;
        let id = '';
        s.commit((pr, fl) => {
          id = uid('m');
          const n = fl.manifolds.length + 1;
          fl.manifolds.push({ id, name: `HKV ${floorShort(fl.name)}${n > 1 ? ` ${n}` : ''}`, pos: q, supplyLengthOverride: null, maxOutlets: pr.design.maxOutlets });
        });
        this.setTool('select');
        s.select({ kind: 'manifold', id });
        this.cb.manifoldPlaced();
        return;
      }
      case 'heatSource': {
        const q = this.snap(p, null, e).p;
        const fid = s.activeFloorId;
        s.commit((pr) => {
          pr.heatSource = pr.heatSource ? { ...pr.heatSource, floorId: fid, pos: q } : { floorId: fid, pos: q, name: HEAT_SOURCE_TYPES[pr.design.generator] ?? 'Wärmeerzeuger', type: pr.design.generator ?? 'wp_luft' };
        });
        this.setTool('select');
        s.select({ kind: 'heatSource', id: 'hs' });
        return;
      }
      case 'route': {
        if (!this.routeRoom) {
          const room = l.rooms.find((r) => pointInPolygon(p, r.polygon));
          if (!room) {
            this.cb.toast('Klicken Sie zuerst in den Raum, dessen Anbindeleitung Sie führen möchten.', 'warn');
            return;
          }
          const rr = s.design.rooms.get(room.id);
          if (!rr?.manifoldId || rr.manifoldFloorId !== l.id) {
            this.cb.toast('Diesem Raum ist kein Verteiler im selben Geschoss zugeordnet.', 'warn');
            return;
          }
          this.routeRoom = room.id;
          this.chain = rr.connector ? [rr.connector] : [];
          s.select({ kind: 'room', id: room.id });
          this.renderOverlay();
          return;
        }
        const rr = s.design.rooms.get(this.routeRoom);
        const man = l.manifolds.find((m) => m.id === rr?.manifoldId);
        const q = this.snap(p, this.chain[this.chain.length - 1] ?? null, e).p;
        if (man && dist(q, man.pos) < Math.max(0.3, 14 / this.view.s)) {
          this.finishRoute();
          return;
        }
        this.chain.push(q);
        this.renderOverlay();
        return;
      }
    }
  }

  private downSelect(e: PointerEvent, p: Vec): void {
    const s = this.store;
    const l = s.floor;
    const ds = (e.target as HTMLElement).dataset ?? {};
    const handle = ds.handle;
    const sel = s.selection;
    if (handle) {
      const it = sel[0];
      s.beginLive();
      if (handle === 'connector' && it?.kind === 'room') this.drag = { type: 'connector', roomId: it.id };
      else if (handle === 'route' && ds.route) this.drag = { type: 'routePoint', routeId: ds.route, index: Number(ds.index) };
      else if ((handle === 'wall-a' || handle === 'wall-b') && it) {
        const w = l.walls.find((x) => x.id === it.id)!;
        const end = handle === 'wall-a' ? 'a' : 'b';
        const joined = endsAt(l.walls, w[end])
          .filter((x) => x.wall.id !== w.id)
          .map((x) => ({ wallId: x.wall.id, end: x.end }));
        this.drag = { type: 'wallEnd', wallId: w.id, end, base: JSON.parse(JSON.stringify(l)), joined: e.altKey ? [] : joined };
      } else if (handle === 'room-v' && it) this.drag = { type: 'roomVertex', roomId: it.id, idx: Number(ds.idx) };
      else if (handle === 'void-v' && it) this.drag = { type: 'voidVertex', voidId: it.id, idx: Number(ds.idx) };
      else if (handle === 'rotate' && it) this.drag = { type: 'objRotate', id: it.id, kind: it.kind as 'furniture' | 'stair' };
      else if (handle === 'resize' && it) this.drag = { type: 'objResize', id: it.id, kind: it.kind as 'furniture' | 'stair', keepRatio: e.shiftKey };
      else if ((handle === 'op-1' || handle === 'op-2') && it) this.drag = { type: 'openingEdge', wallId: it.wallId!, id: it.id, edge: handle === 'op-1' ? 1 : 2 };
      else if (handle.startsWith('dim-') && it) this.drag = { type: 'dimEnd', id: it.id, end: handle === 'dim-a' ? 'a' : handle === 'dim-b' ? 'b' : 'off' };
      return;
    }
    const h = this.hit(e);
    if (!h) {
      if (e.altKey && l.background) {
        s.beginLive();
        this.drag = { type: 'image', start: p, offset: { ...l.background.offset } };
        return;
      }
      if (!e.shiftKey) s.select(null);
      this.drag = { type: 'band', start: p, cur: p, add: e.shiftKey };
      return;
    }
    if (e.shiftKey) {
      const has = s.isSelected(h.kind, h.id);
      s.select(has ? sel.filter((x) => !(x.kind === h.kind && x.id === h.id)) : [...sel, h]);
    } else if (!s.isSelected(h.kind, h.id)) s.select(h);
    const movable = s.phase === 'build' || h.kind === 'manifold' || h.kind === 'heatSource';
    if (!movable) return;
    if (h.kind === 'opening' && s.selection.length === 1) {
      const w = l.walls.find((x) => x.id === h.wallId)!;
      const o = w.openings.find((x) => x.id === h.id)!;
      s.beginLive();
      this.drag = { type: 'opening', wallId: w.id, id: o.id, grab: projectOnWall(w, p).t - o.offset };
      return;
    }
    s.beginLive();
    this.drag = { type: 'move', start: p, base: JSON.parse(JSON.stringify(l)), baseProject: JSON.parse(JSON.stringify(s.project)), moved: false };
  }

  private onMove(e: PointerEvent): void {
    const p = this.world(e);
    this.cb.coords(p);
    const d = this.drag;
    const s = this.store;
    if (!d) {
      if (this.tool !== 'select' && this.tool !== 'pan' && this.tool !== 'painter') {
        const from = this.tool === 'wall' || this.tool === 'route' ? (this.chain[this.chain.length - 1] ?? null) : this.tool === 'dimension' && this.dimPts.length === 1 ? this.dimPts[0] : null;
        const sn = this.tool === 'opening' || this.tool === 'furniture' || this.tool === 'calibrate' ? ({ p, kind: 'free' } as Snap) : this.snap(p, from, e);
        this.snapInfo = sn;
        this.hover = sn.p;
      } else {
        this.snapInfo = null;
        this.hover = p;
      }
      this.renderOverlay();
      return;
    }
    const l = s.floor;
    switch (d.type) {
      case 'pan':
        this.view.x = d.view.x - (e.clientX - d.start.x) / this.view.s;
        this.view.y = d.view.y - (e.clientY - d.start.y) / this.view.s;
        this.render();
        return;
      case 'band':
        d.cur = p;
        this.renderOverlay();
        return;
      case 'rect':
        d.cur = this.snap(p, null, e).p;
        this.hover = d.cur;
        this.renderOverlay();
        return;
      case 'image':
        s.live((_p, fl) => (fl.background!.offset = add(d.offset, sub(p, d.start))));
        return;
      case 'move': {
        let delta = sub(p, d.start);
        if (!d.moved && Math.hypot(delta.x, delta.y) * this.view.s < 3) return;
        d.moved = true;
        const st = s.project.settings;
        if (st.magnetism && !e.altKey) delta = { x: Math.round(delta.x * 100) / 100, y: Math.round(delta.y * 100) / 100 };
        const sel = s.selection;
        s.live((pr, fl) => {
          moveSelection(d.base, fl, sel, delta, pr, d.baseProject);
          if (sel.length === 1 && sel[0].kind === 'furniture' && st.magnetism && !e.altKey) {
            const f = fl.furniture.find((x) => x.id === sel[0].id);
            if (f) Object.assign(f, this.placeFurniture(f));
          }
        });
        return;
      }
      case 'wallEnd': {
        const w0 = d.base.walls.find((x) => x.id === d.wallId)!;
        const other = d.end === 'a' ? w0.b : w0.a;
        const sp = this.snapExcluding(p, other, e, d.wallId);
        s.live((_p, fl) => {
          const w = fl.walls.find((x) => x.id === d.wallId);
          if (w) w[d.end] = sp;
          for (const j of d.joined) {
            const o = fl.walls.find((x) => x.id === j.wallId);
            if (o) o[j.end] = { ...sp };
          }
        });
        this.cb.status(`Wandlänge ${fmt(dist(other, sp))} m`);
        return;
      }
      case 'roomVertex': {
        const sp = this.snap(p, null, e).p;
        s.live((_p, fl) => {
          const r = fl.rooms.find((x) => x.id === d.roomId);
          if (r) r.polygon[d.idx] = sp;
        });
        return;
      }
      case 'voidVertex': {
        const sp = this.snap(p, null, e).p;
        s.live((_p, fl) => {
          const v = fl.voids.find((x) => x.id === d.voidId);
          if (v) v.polygon[d.idx] = sp;
        });
        return;
      }
      case 'objRotate':
        s.live((_p, fl) => {
          const f = d.kind === 'furniture' ? fl.furniture.find((x) => x.id === d.id) : fl.stairs.find((x) => x.id === d.id);
          if (!f) return;
          let a = (Math.atan2(p.y - f.pos.y, p.x - f.pos.x) * 180) / Math.PI + 90;
          if (!e.altKey) a = Math.round(a / 15) * 15;
          f.angle = ((a % 360) + 360) % 360;
        });
        return;
      case 'objResize':
        s.live((_p, fl) => {
          const f = d.kind === 'furniture' ? fl.furniture.find((x) => x.id === d.id) : fl.stairs.find((x) => x.id === d.id);
          if (!f) return;
          const a = (-f.angle * Math.PI) / 180;
          const q = sub(p, f.pos);
          const lx = q.x * Math.cos(a) - q.y * Math.sin(a);
          const ly = q.x * Math.sin(a) + q.y * Math.cos(a);
          const r = (x: number) => Math.max(0.1, Math.round(x * 2 * 100) / 100);
          if ('depth' in f) {
            if (d.keepRatio || e.shiftKey) {
              const k = r(lx) / f.width;
              f.depth = Math.max(0.1, Math.round(f.depth * k * 100) / 100);
              f.height = Math.max(0.05, Math.round(f.height * k * 100) / 100);
              f.width = r(lx);
            } else {
              f.width = r(lx);
              f.depth = r(ly);
            }
          } else if (f.type === 'spiral') f.length = f.width = r(Math.max(lx, ly));
          else {
            f.width = r(lx);
            f.length = r(ly);
          }
        });
        return;
      case 'opening': {
        const nw = nearestWall(l.walls, p, 0.4);
        s.live((_p, fl) => {
          const w = fl.walls.find((x) => x.id === d.wallId)!;
          const idx = w.openings.findIndex((x) => x.id === d.id);
          if (idx < 0) return;
          const o = w.openings[idx];
          if (nw && nw.wall.id !== w.id) {
            w.openings.splice(idx, 1);
            const target = fl.walls.find((x) => x.id === nw.wall.id)!;
            o.offset = clampOpening(target, o, nw.t);
            target.openings.push(o);
            d.wallId = target.id;
            d.grab = 0;
            s.selection = [{ kind: 'opening', id: o.id, wallId: target.id }];
            return;
          }
          let t = projectOnWall(w, p).t - d.grab;
          if (!e.altKey) t = Math.round((t - o.width / 2) * 100) / 100 + o.width / 2;
          o.offset = clampOpening(w, o, t);
        });
        const w = s.floor.walls.find((x) => x.id === d.wallId);
        const o = w?.openings.find((x) => x.id === d.id);
        if (w && o) this.cb.status(`Abstand links ${fmt(o.offset - o.width / 2)} m · rechts ${fmt(wallLength(w) - o.offset - o.width / 2)} m`);
        return;
      }
      case 'openingEdge':
        s.live((_p, fl) => {
          const w = fl.walls.find((x) => x.id === d.wallId);
          const o = w?.openings.find((x) => x.id === d.id);
          if (!w || !o) return;
          const t = Math.round(projectOnWall(w, p).t * 100) / 100;
          const t1 = o.offset - o.width / 2;
          const t2 = o.offset + o.width / 2;
          const n1 = d.edge === 1 ? Math.min(t, t2 - 0.3) : t1;
          const n2 = d.edge === 2 ? Math.max(t, t1 + 0.3) : t2;
          o.width = Math.max(0.3, Math.min(wallLength(w), n2 - n1));
          o.offset = clampOpening(w, o, (n1 + n2) / 2);
        });
        return;
      case 'dimEnd':
        s.live((_p, fl) => {
          const dm = fl.dimensions.find((x) => x.id === d.id);
          if (!dm) return;
          if (d.end === 'off') {
            const n = left(norm(sub(dm.b, dm.a)));
            dm.offset = Math.round((p.x - dm.a.x) * n.x * 100 + (p.y - dm.a.y) * n.y * 100) / 100;
          } else {
            const saved = this.tool;
            this.tool = 'dimension';
            dm[d.end] = this.snap(p, null, e).p;
            this.tool = saved;
          }
        });
        return;
      case 'connector': {
        const q = this.snap(p, null, e).p;
        s.live((_p, fl) => {
          const room = fl.rooms.find((x) => x.id === d.roomId);
          if (room) room.connector = q;
        });
        return;
      }
      case 'routePoint': {
        const q = this.snap(p, null, e).p;
        s.live((_p, fl) => {
          const r = fl.routes.find((x) => x.id === d.routeId);
          if (r && r.points[d.index]) {
            r.points[d.index] = q;
            r.auto = false;
          }
        });
        return;
      }
    }
  }

  private snapExcluding(p: Vec, from: Vec, e: PointerEvent, wallId: string): Vec {
    const tol = 10 / this.view.s;
    for (const w of this.store.floor.walls) {
      if (w.id === wallId) continue;
      for (const q of [w.a, w.b]) if (dist(p, q) < tol && dist(q, from) > 0.05) return { ...q };
    }
    const saved = this.tool;
    this.tool = 'select';
    const sn = this.snap(p, from, e);
    this.tool = saved;
    return sn.kind === 'end' ? p : sn.p;
  }

  private onUp(e: PointerEvent): void {
    const d = this.drag;
    this.drag = null;
    if (!d) return;
    const s = this.store;
    if (d.type === 'band') {
      const x0 = Math.min(d.start.x, d.cur.x);
      const x1 = Math.max(d.start.x, d.cur.x);
      const y0 = Math.min(d.start.y, d.cur.y);
      const y1 = Math.max(d.start.y, d.cur.y);
      if ((x1 - x0) * this.view.s < 4 && (y1 - y0) * this.view.s < 4) {
        this.renderOverlay();
        return;
      }
      const inR = (q: Vec) => q.x >= x0 && q.x <= x1 && q.y >= y0 && q.y <= y1;
      const l = s.floor;
      const allowed = PICKABLE[s.phase];
      const items: SelItem[] = d.add ? [...s.selection] : [];
      const push = (kind: SelKind, id: string) => allowed.includes(kind) && items.push({ kind, id });
      for (const w of l.walls) if (inR(w.a) && inR(w.b)) push('wall', w.id);
      for (const r of l.rooms) if (r.polygon.every(inR)) push('room', r.id);
      for (const f of l.furniture) if (inR(f.pos)) push('furniture', f.id);
      for (const x of l.stairs) if (inR(x.pos)) push('stair', x.id);
      for (const x of l.dimensions) if (inR(x.a) && inR(x.b)) push('dimension', x.id);
      for (const x of l.labels) if (inR(x.pos)) push('label', x.id);
      for (const m of l.manifolds) if (inR(m.pos)) push('manifold', m.id);
      s.select(items);
      this.renderOverlay();
      return;
    }
    if (d.type === 'rect') {
      const t = s.project.settings.wallThickness;
      let rid: string | null = null;
      s.commit((pr, fl) => {
        rid = addRectRoom(pr, fl, d.start, d.cur, t, 'wohnen', `Raum ${fl.rooms.length + 1}`).roomId;
      });
      if (rid) s.select({ kind: 'room', id: rid });
      this.renderOverlay();
      return;
    }
    if (d.type === 'pan') return;
    if (d.type === 'wallEnd') {
      const w = s.floor.walls.find((x) => x.id === d.wallId);
      if (w) {
        const q = w[d.end];
        s.live((_p, fl) => {
          for (const o of fl.walls) {
            if (o.id === w.id) continue;
            const { t, off } = projectOnWall(o, q);
            if (Math.abs(off) < 0.01 && t > 0.02 && t < wallLength(o) - 0.02) {
              const idx = fl.walls.indexOf(o);
              fl.walls.splice(
                idx,
                1,
                { ...o, b: { ...q }, openings: o.openings.filter((x) => x.offset < t) },
                { ...o, id: uid('w'), a: { ...q }, openings: o.openings.filter((x) => x.offset >= t).map((x) => ({ ...x, offset: x.offset - t })) },
              );
              break;
            }
          }
        });
      }
    }
    void e;
    s.endLive();
  }

  private onDbl(e: MouseEvent): void {
    const p = this.world(e);
    const s = this.store;
    if (this.tool === 'wall') return this.finishChain();
    if (this.tool === 'room' || this.tool === 'void') {
      if (this.chain.length > 2) return this.finishPolygon();
      this.chain = [];
      if (this.tool === 'room') this.detectRoom(p);
      return;
    }
    if (this.tool !== 'select') return;
    const h = this.hit(e);
    if (h?.kind === 'wall' && s.phase !== 'build') {
      const room = s.floor.rooms.find((r) => {
        const w = s.floor.walls.find((x) => x.id === h.id)!;
        const mid = pointOnWall(w, wallLength(w) / 2);
        return dist(mid, nearestOnPoly(mid, r.polygon)) < w.thickness / 2 + 0.2;
      });
      this.cb.openWallView(h.id, room?.id ?? null);
      return;
    }
    if (!h && s.phase === 'build') this.detectRoom(p);
  }

  detectRoom(p: Vec): void {
    const l = this.store.floor;
    if (l.rooms.some((r) => pointInPolygon(p, r.polygon))) {
      this.cb.status('Hier liegt bereits ein Raum.');
      return;
    }
    const poly = detectRoomAt(l, p);
    if (!poly) {
      this.cb.toast('Kein geschlossener Bereich: Die Wände müssen den Raum vollständig umschließen.', 'warn');
      return;
    }
    let id = '';
    this.store.commit((pr, fl) => {
      const r = newRoom(pr, fl, poly, 'wohnen', `Raum ${fl.rooms.length + 1}`);
      id = r.id;
      fl.rooms.push(r);
    });
    this.store.select({ kind: 'room', id });
  }

  private onDrop(e: DragEvent): void {
    e.preventDefault();
    const key = e.dataTransfer?.getData('text/x-heatcircuits-furniture');
    if (!key || !CATALOG_BY_KEY[key]) return;
    this.catalogKey = key;
    const f = this.placeFurniture(this.makeFurniture(this.world(e)));
    this.store.commit((_p, fl) => fl.furniture.push(f));
    this.store.select({ kind: 'furniture', id: f.id });
  }

  // ---------- Abschluss von Werkzeugen ----------

  finishChain(): void {
    const pts = this.chain;
    this.chain = [];
    this.typed = '';
    if (pts.length < 2) {
      this.renderOverlay();
      return;
    }
    const closed = pts.length > 3 && dist(pts[0], pts[pts.length - 1]) < 1e-6;
    const t = this.store.project.settings.wallThickness;
    let ids: string[] = [];
    this.store.commit((_p, fl) => {
      ids = addWallChain(fl, closed ? pts.slice(0, -1) : pts, t, closed).map((w) => w.id);
    });
    this.store.select(ids.map((id) => ({ kind: 'wall' as const, id })));
    this.renderOverlay();
  }

  private finishPolygon(): void {
    const pts = cleanPolygon(this.chain);
    const tool = this.tool;
    this.chain = [];
    if (pts.length < 3 || area(pts) < 0.2 || !isSimplePolygon(pts)) {
      this.cb.toast('Der Umriss ist zu klein oder überschneidet sich.', 'warn');
      this.renderOverlay();
      return;
    }
    let id = '';
    if (tool === 'void')
      this.store.commit((_p, fl) => {
        id = uid('v');
        fl.voids.push({ id, kind: 'void', polygon: pts });
      });
    else
      this.store.commit((pr, fl) => {
        const r = newRoom(pr, fl, pts, 'wohnen', `Raum ${fl.rooms.length + 1}`);
        id = r.id;
        fl.rooms.push(r);
      });
    this.store.select({ kind: tool === 'void' ? 'void' : 'room', id });
  }

  private finishRoute(): void {
    const roomId = this.routeRoom;
    const pts = this.chain.slice(1);
    this.chain = [];
    this.routeRoom = null;
    if (!roomId) return;
    this.store.commit((_p, fl) => {
      fl.routes = fl.routes.filter((r) => r.roomId !== roomId);
      if (pts.length) fl.routes.push({ id: uid('l'), roomId, points: pts, auto: false });
    });
    this.cb.toast(pts.length ? 'Anbindeleitung gespeichert.' : 'Anbindeleitung zurückgesetzt – sie wird wieder automatisch geführt.');
    this.renderOverlay();
  }

  /** Tastatureingaben während des Zeichnens; true = verbraucht */
  key(e: KeyboardEvent): boolean {
    if (this.tool === 'wall' && this.chain.length) {
      if (/^[0-9.,]$/.test(e.key)) {
        this.typed += e.key === ',' ? '.' : e.key;
        this.renderOverlay();
        return true;
      }
      if (e.key === 'Backspace' && this.typed) {
        this.typed = this.typed.slice(0, -1);
        this.renderOverlay();
        return true;
      }
      if (e.key === 'Enter') {
        const L = parseFloat(this.typed);
        const last = this.chain[this.chain.length - 1];
        if (this.typed && L > 0 && this.hover) {
          const dir = dist(this.hover, last) > 1e-6 ? norm(sub(this.hover, last)) : { x: 1, y: 0 };
          const q = add(last, mul(dir, L));
          this.chain.push(q);
          this.hover = q;
          this.typed = '';
          this.renderOverlay();
        } else this.finishChain();
        return true;
      }
      if (e.key === 'Escape') {
        this.finishChain();
        return true;
      }
    }
    if ((this.tool === 'room' || this.tool === 'void') && this.chain.length) {
      if (e.key === 'Enter') {
        this.finishPolygon();
        return true;
      }
      if (e.key === 'Escape') {
        this.chain = [];
        this.renderOverlay();
        return true;
      }
    }
    if (this.tool === 'route' && this.routeRoom) {
      if (e.key === 'Enter') {
        this.finishRoute();
        return true;
      }
      if (e.key === 'Escape') {
        this.routeRoom = null;
        this.chain = [];
        this.renderOverlay();
        return true;
      }
    }
    if ((this.tool === 'dimension' && this.dimPts.length) || (this.tool === 'calibrate' && this.calib.length)) {
      if (e.key === 'Escape') {
        this.dimPts = [];
        this.calib = [];
        this.renderOverlay();
        return true;
      }
    }
    return false;
  }

  private dimOffset(p: Vec): number {
    const [a, b] = this.dimPts;
    const n = left(norm(sub(b, a)));
    return Math.round(((p.x - a.x) * n.x + (p.y - a.y) * n.y) * 100) / 100;
  }

  makeFurniture(p: Vec): Furniture {
    const it = CATALOG_BY_KEY[this.catalogKey];
    return { id: uid('F'), catalog: it.key, name: it.name, pos: p, angle: 0, width: it.width, depth: it.depth, height: it.height, elevation: it.elevation ?? 0, color: it.color, mirrored: false, visible: true };
  }

  /** Magnetismus: Rückseite von Wandmöbeln an die nächste Wand anlegen und ausrichten */
  placeFurniture(f: Furniture): Furniture {
    const it = CATALOG_BY_KEY[f.catalog];
    if (!it?.wallSide || !this.store.project.settings.magnetism || this.altKey) return f;
    const reach = f.depth / 2 + 0.35;
    let best: { d: number; pos: Vec; angle: number } | null = null;
    for (const w of this.store.floor.walls) {
      const L = wallLength(w);
      const { t, off } = projectOnWall(w, f.pos);
      if (t < -0.1 || t > L + 0.1) continue;
      const face = Math.abs(off) - w.thickness / 2;
      if (face < -0.05 || face > reach) continue;
      const d = Math.abs(face - f.depth / 2);
      if (best && d >= best.d) continue;
      const n = mul(left(wallDir(w)), off >= 0 ? 1 : -1);
      const tt = Math.min(L - f.width / 2, Math.max(f.width / 2, t));
      const pos = add(pointOnWall(w, tt), mul(n, w.thickness / 2 + f.depth / 2 + 0.005));
      const angle = (Math.atan2(n.y, n.x) * 180) / Math.PI - 90;
      best = { d, pos, angle: ((angle % 360) + 360) % 360 };
    }
    return best ? { ...f, pos: best.pos, angle: Math.round(best.angle * 100) / 100 } : f;
  }
}

function nearestOnPoly(p: Vec, poly: Vec[]): Vec {
  let best = poly[0];
  let bd = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const ab = sub(b, a);
    const l2 = ab.x * ab.x + ab.y * ab.y;
    const t = l2 < 1e-12 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * ab.x + (p.y - a.y) * ab.y) / l2));
    const q = { x: a.x + ab.x * t, y: a.y + ab.y * t };
    const d = dist(p, q);
    if (d < bd) {
      bd = d;
      best = q;
    }
  }
  return best;
}

