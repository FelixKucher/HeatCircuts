// 2D-Planeditor (SVG, Weltkoordinaten in m): Zeichnen, Fangen, Auswahl, Ziehen, Zoom.

import { CATALOG_BY_KEY } from './catalog';
import { addRectRoom, addWallChain, detectRoomAt, moveSelection } from './edit';
import { newOpening, newRoom, newStair, uid, type Furniture, type Level, type OpeningType, type StairType, type Vec } from './model';
import { belowOf, dimensionSvg, esc, fmt, furnitureSvg, levelSvg, openingSymbol, PLAN_DEFS, stairSvg } from './plan-render';
import type { SelItem, Store } from './store';
import { clampOpening, endsAt, left, nearestWall, pointOnWall, projectOnWall, wallDir, wallLength, wallOutlines } from './walls';
import { add, dist, mul, norm, pointInPolygon, sub } from '../../src/geometry/geom';

export type Tool = 'select' | 'pan' | 'wall' | 'room' | 'roomRect' | 'opening' | 'furniture' | 'stair' | 'dimension' | 'label' | 'calibrate';

export interface PlanCallbacks {
  status(text: string): void;
  coords(p: Vec | null): void;
  toolChanged(t: Tool): void;
  askText(title: string, value: string): Promise<string | null>;
  askNumber(title: string, value: number, unit: string): Promise<number | null>;
  openProps(): void;
}

interface Snap {
  p: Vec;
  kind: 'end' | 'corner' | 'axis' | 'grid' | 'align' | 'free' | 'angle';
  guides?: [Vec, Vec][];
}

type Drag =
  | { type: 'pan'; start: { x: number; y: number }; view: { x: number; y: number } }
  | { type: 'move'; start: Vec; base: Level; moved: boolean }
  | { type: 'band'; start: Vec; cur: Vec; add: boolean }
  | { type: 'wallEnd'; wallId: string; end: 'a' | 'b'; base: Level; joined: { wallId: string; end: 'a' | 'b' }[] }
  | { type: 'roomVertex'; roomId: string; idx: number }
  | { type: 'furRotate'; id: string; kind: 'furniture' | 'stair' }
  | { type: 'furResize'; id: string; kind: 'furniture' | 'stair'; keepRatio: boolean }
  | { type: 'opening'; wallId: string; id: string; grab: number }
  | { type: 'openingEdge'; wallId: string; id: string; edge: 1 | 2 }
  | { type: 'dimEnd'; id: string; end: 'a' | 'b' | 'off' }
  | { type: 'rect'; start: Vec; cur: Vec }
  | { type: 'image'; start: Vec; offset: Vec };

const ANGLE_STEP = 15;

export class PlanView {
  readonly svg: SVGSVGElement;
  tool: Tool = 'select';
  openingType: OpeningType = 'door';
  catalogKey = 'sofa3';
  stairType: StairType = 'straight';
  view = { x: -2, y: -2, s: 60 };
  private drag: Drag | null = null;
  private chain: Vec[] = [];
  private hover: Vec | null = null;
  private snapInfo: Snap | null = null;
  private typed = '';
  private spaceDown = false;
  private calib: Vec[] = [];
  private dimPts: Vec[] = [];
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
    const l = this.store.level;
    const pts: Vec[] = [];
    for (const w of l.walls) pts.push(w.a, w.b);
    for (const r of l.rooms) pts.push(...r.polygon);
    for (const f of l.furniture) pts.push(f.pos);
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
    if (this.chain.length > 2 && this.tool === 'room') this.finishRoom();
    this.tool = t;
    this.chain = [];
    this.calib = [];
    this.dimPts = [];
    this.typed = '';
    this.svg.dataset.tool = t;
    this.cb.toolChanged(t);
    this.cb.status(HINTS[t]);
    this.renderOverlay();
  }

  // ---------- Darstellung ----------

  render(): void {
    const { w, h } = this.size;
    const v = this.view;
    this.svg.setAttribute('viewBox', `${v.x} ${v.y} ${w / v.s} ${h / v.s}`);
    this.svg.style.setProperty('--px', `${1 / v.s}`);
    const p = this.store.project;
    const l = this.store.level;
    const below = belowOf(p, l);
    let s = PLAN_DEFS;
    if (l.background?.visible) {
      const b = l.background;
      s += `<image href="${b.dataUrl}" x="${b.offset.x}" y="${b.offset.y}" width="${b.widthPx / b.pxPerM}" height="${b.heightPx / b.pxPerM}" opacity="${b.opacity}" preserveAspectRatio="none" class="bg-image"/>`;
    }
    if (p.settings.showGrid) s += this.gridSvg();
    s += levelSvg(p, l, { scale: v.s, sel: this.store.selection, ghost: below, showWallDims: p.settings.showWallDims, showRoomArea: p.settings.showRoomArea });
    s += `<g class="handles">${this.handlesSvg()}</g><g class="overlay"></g>`;
    this.svg.innerHTML = s;
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
    let s = '';
    const lines = (st: number, cls: string) => {
      let out = '';
      for (let x = Math.ceil(x0 / st) * st; x <= x1; x += st) out += `M${x.toFixed(3)} ${y0}V${y1}`;
      for (let y = Math.ceil(y0 / st) * st; y <= y1; y += st) out += `M${x0} ${y.toFixed(3)}H${x1}`;
      return `<path d="${out}" class="${cls}"/>`;
    };
    if ((x1 - x0) / minor < 400) s += lines(minor, 'grid-minor');
    s += lines(major, 'grid-major');
    s += `<path d="M${-0.3} 0H0.3M0 -0.3V0.3" class="origin"/>`;
    return `<g class="grid">${s}</g>`;
  }

  private handlesSvg(): string {
    const sel = this.store.selection;
    if (sel.length !== 1) return '';
    const l = this.store.level;
    const r = 5 / this.view.s;
    const c = (p: Vec, h: string, cls = '') => `<circle cx="${p.x}" cy="${p.y}" r="${r}" class="handle ${cls}" data-handle="${h}"/>`;
    const it = sel[0];
    if (it.kind === 'wall') {
      const w = l.walls.find((x) => x.id === it.id);
      return w ? c(w.a, 'wall-a') + c(w.b, 'wall-b') : '';
    }
    if (it.kind === 'room') {
      const rm = l.rooms.find((x) => x.id === it.id);
      return rm ? rm.polygon.map((p, i) => `<circle cx="${p.x}" cy="${p.y}" r="${r}" class="handle" data-handle="room-v" data-idx="${i}"/>`).join('') : '';
    }
    if (it.kind === 'furniture' || it.kind === 'stair') {
      const f = it.kind === 'furniture' ? l.furniture.find((x) => x.id === it.id) : l.stairs.find((x) => x.id === it.id);
      if (!f) return '';
      const w = 'depth' in f ? f.width : f.width;
      const d = 'depth' in f ? f.depth : f.type === 'spiral' ? f.length : f.type === 'lshape' ? f.length : f.length;
      const a = (f.angle * Math.PI) / 180;
      const T = (x: number, y: number) => ({ x: f.pos.x + x * Math.cos(a) - y * Math.sin(a), y: f.pos.y + x * Math.sin(a) + y * Math.cos(a) });
      const ww = it.kind === 'stair' && 'type' in f && f.type === 'lshape' ? f.width + f.length2 : w;
      return `<line x1="${f.pos.x}" y1="${f.pos.y}" x2="${T(0, -d / 2 - 0.35).x}" y2="${T(0, -d / 2 - 0.35).y}" class="handle-line"/>` + c(T(0, -d / 2 - 0.35), 'rotate', 'rot') + c(T(ww / 2, d / 2), 'resize', 'res');
    }
    if (it.kind === 'opening') {
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

  /** Vorschau des aktiven Werkzeugs (ohne Neuzeichnen des Plans) */
  renderOverlay(): void {
    const g = this.svg.querySelector('.overlay');
    if (!g) return;
    const l = this.store.level;
    const st = this.store.project.settings;
    let s = '';
    const h = this.hover;
    const px = 1 / this.view.s;
    const snap = this.snapInfo;
    if (snap?.guides) for (const [a, b] of snap.guides) s += `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" class="guide"/>`;
    if (h && snap && snap.kind !== 'free' && this.tool !== 'select' && this.tool !== 'pan') s += `<rect x="${h.x - 4 * px}" y="${h.y - 4 * px}" width="${8 * px}" height="${8 * px}" class="snap snap-${snap.kind}"/>`;
    if (this.tool === 'wall' && this.chain.length && h) {
      const pts = [...this.chain, h];
      const t = st.wallThickness;
      for (let i = 0; i + 1 < pts.length; i++) {
        const a = pts[i];
        const b = pts[i + 1];
        if (dist(a, b) < 1e-3) continue;
        const n = mul(left(norm(sub(b, a))), t / 2);
        s += `<polygon points="${[add(a, n), add(b, n), sub(b, n), sub(a, n)].map((p) => `${p.x},${p.y}`).join(' ')}" class="wall-preview"/>`;
      }
      const a = this.chain[this.chain.length - 1];
      s += dimensionSvg(a, h, 0.45, this.view.s, ' live');
      const ang = (Math.atan2(-(h.y - a.y), h.x - a.x) * 180) / Math.PI;
      s += this.tag(h, `${fmt(dist(a, h))} m · ${fmt((ang + 360) % 360, 0)}°${this.typed ? ` · Eingabe ${this.typed}` : ''}`);
    }
    if (this.tool === 'room' && this.chain.length && h) {
      const pts = [...this.chain, h];
      s += `<polygon points="${pts.map((p) => `${p.x},${p.y}`).join(' ')}" class="room-preview"/>`;
    }
    if (this.drag?.type === 'rect') {
      const { start: a, cur: b } = this.drag;
      const t = st.wallThickness;
      const x0 = Math.min(a.x, b.x);
      const y0 = Math.min(a.y, b.y);
      const W = Math.abs(a.x - b.x);
      const H = Math.abs(a.y - b.y);
      s += `<rect x="${x0 - t / 2}" y="${y0 - t / 2}" width="${W + t}" height="${H + t}" class="wall-preview"/><rect x="${x0 + t / 2}" y="${y0 + t / 2}" width="${Math.max(0, W - t)}" height="${Math.max(0, H - t)}" class="room-preview"/>`;
      s += this.tag(b, `${fmt(Math.max(0, W - t))} × ${fmt(Math.max(0, H - t))} m lichte Maße · ${fmt(Math.max(0, W - t) * Math.max(0, H - t))} m²`);
    }
    if (this.drag?.type === 'band') {
      const { start: a, cur: b } = this.drag;
      s += `<rect x="${Math.min(a.x, b.x)}" y="${Math.min(a.y, b.y)}" width="${Math.abs(a.x - b.x)}" height="${Math.abs(a.y - b.y)}" class="band"/>`;
    }
    if (this.tool === 'opening' && h) {
      const nw = nearestWall(l.walls, h, 0.6);
      if (nw) {
        const o = newOpening(this.openingType, 0);
        o.offset = clampOpening(nw.wall, o, nw.t);
        o.side = nw.off >= 0 ? 'left' : 'right';
        s += `<g class="preview">${openingSymbol(nw.wall, o)}</g>`;
        s += this.tag(h, `${OPENING_TYPE_LABEL(o.type)} ${fmt(o.width)} × ${fmt(o.height)} m · Abstand ${fmt(o.offset - o.width / 2)} m`);
      }
    }
    if (this.tool === 'furniture' && h) {
      const f = this.placeFurniture(this.makeFurniture(h));
      s += furnitureSvg(f, false, true);
    }
    if (this.tool === 'stair' && h) s += stairSvg({ ...newStair(this.stairType, h), id: 'preview' }, l.height, false, true);
    if (this.tool === 'dimension' && this.dimPts.length && h) {
      if (this.dimPts.length === 1) s += dimensionSvg(this.dimPts[0], h, 0, this.view.s, ' live');
      else s += dimensionSvg(this.dimPts[0], this.dimPts[1], this.dimOffset(h), this.view.s, ' live');
    }
    if (this.tool === 'calibrate' && this.calib.length && h) s += `<line x1="${this.calib[0].x}" y1="${this.calib[0].y}" x2="${h.x}" y2="${h.y}" class="calib"/>`;
    g.innerHTML = s;
  }

  private tag(p: Vec, text: string): string {
    const px = 1 / this.view.s;
    const fs = 11 * px;
    const w = text.length * fs * 0.56 + 10 * px;
    return `<g class="tag"><rect x="${p.x + 12 * px}" y="${p.y + 10 * px}" width="${w}" height="${fs * 1.7}" rx="${3 * px}"/><text x="${p.x + 17 * px}" y="${p.y + 10 * px + fs * 1.2}" style="font-size:${fs}px">${esc(text)}</text></g>`;
  }

  // ---------- Fangen ----------

  snap(p: Vec, from: Vec | null, e: { shiftKey: boolean; altKey: boolean }): Snap {
    const st = this.store.project.settings;
    const mag = st.magnetism && !e.altKey && !e.shiftKey;
    const l = this.store.level;
    const tol = 10 / this.view.s;
    // Wandenden
    let best: Snap | null = null;
    let bd = tol;
    for (const w of l.walls)
      for (const q of [w.a, w.b]) {
        const d = dist(p, q);
        if (d < bd) {
          bd = d;
          best = { p: { ...q }, kind: 'end' };
        }
      }
    for (const q of this.chain.slice(0, -1)) {
      const d = dist(p, q);
      if (d < bd) {
        bd = d;
        best = { p: { ...q }, kind: 'end' };
      }
    }
    if (best) return best;
    if (this.tool === 'room' || this.tool === 'dimension') {
      for (const o of wallOutlines(l.walls).values())
        for (const q of o.poly) {
          const d = dist(p, q);
          if (d < bd) {
            bd = d;
            best = { p: { ...q }, kind: 'corner' };
          }
        }
      if (best) return best;
    }
    if (!mag) return { p, kind: 'free' };
    let q = { ...p };
    let kind: Snap['kind'] = 'grid';
    const guides: [Vec, Vec][] = [];
    if (from) {
      // Winkel in 15°-Schritten, Länge auf cm
      const d = sub(p, from);
      const L = Math.round(Math.hypot(d.x, d.y) * 100) / 100;
      const a = Math.round((Math.atan2(d.y, d.x) * 180) / Math.PI / ANGLE_STEP) * ANGLE_STEP;
      q = add(from, { x: L * Math.cos((a * Math.PI) / 180), y: L * Math.sin((a * Math.PI) / 180) });
      kind = 'angle';
    } else {
      const g = Math.min(0.05, st.gridStep);
      q = { x: Math.round(p.x / g) * g, y: Math.round(p.y / g) * g };
    }
    // Ausrichtung an vorhandenen Wandenden (horizontal/vertikal)
    const ends: Vec[] = [];
    for (const w of l.walls) ends.push(w.a, w.b);
    ends.push(...this.chain);
    for (const ept of ends) {
      if (from && dist(ept, from) < 1e-6) continue;
      if (Math.abs(ept.x - q.x) < tol * 0.7 && (!from || Math.abs(from.y - q.y) < 1e-6 || Math.abs(from.x - q.x) > 1e-6)) {
        if (from && Math.abs(from.y - q.y) < 1e-6) q = { x: ept.x, y: q.y };
        else if (!from) q = { x: ept.x, y: q.y };
        else continue;
        guides.push([ept, q]);
        kind = 'align';
      } else if (Math.abs(ept.y - q.y) < tol * 0.7) {
        if (from && Math.abs(from.x - q.x) < 1e-6) q = { x: q.x, y: ept.y };
        else if (!from) q = { x: q.x, y: ept.y };
        else continue;
        guides.push([ept, q]);
        kind = 'align';
      }
    }
    // auf Wandachse (T-Stoß)
    if (this.tool === 'wall' || this.tool === 'roomRect') {
      for (const w of l.walls) {
        const { t, off } = projectOnWall(w, p);
        if (t > 0 && t < wallLength(w) && Math.abs(off) < Math.max(tol, w.thickness / 2)) {
          return { p: pointOnWall(w, t), kind: 'axis' };
        }
      }
    }
    return { p: q, kind, guides };
  }

  // ---------- Ereignisse ----------

  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    const f = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015));
    this.zoom(f, this.world(e));
  }

  setSpace(down: boolean): void {
    this.spaceDown = down;
    this.svg.classList.toggle('panning', down);
  }

  private hit(e: PointerEvent | MouseEvent): { kind: SelItem['kind']; id: string; wallId?: string } | null {
    let el = document.elementFromPoint(e.clientX, e.clientY) as Element | null;
    while (el && el !== this.svg) {
      const k = (el as HTMLElement).dataset?.kind as SelItem['kind'] | undefined;
      if (k) return { kind: k, id: (el as HTMLElement).dataset.id!, wallId: (el as HTMLElement).dataset.wall };
      el = el.parentElement;
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
    const l = this.store.level;
    const now = performance.now();
    const isDouble = now - this.lastClick < 320;
    this.lastClick = now;
    switch (this.tool) {
      case 'select':
        return this.downSelect(e, p);
      case 'wall': {
        const sp = this.snap(p, this.chain[this.chain.length - 1] ?? null, e).p;
        if (isDouble && this.chain.length > 1) return;
        if (this.chain.length && dist(sp, this.chain[0]) < 1e-6 && this.chain.length > 2) {
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
      case 'room': {
        const sp = this.snap(p, null, e).p;
        if (this.chain.length > 2 && dist(sp, this.chain[0]) < 12 / this.view.s) {
          this.finishRoom();
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
          this.cb.status('Keine Wand in der Nähe – Öffnungen werden in Wände gesetzt.');
          return;
        }
        const o = newOpening(this.openingType, 0);
        o.offset = clampOpening(nw.wall, o, nw.t);
        o.side = nw.off >= 0 ? 'left' : 'right';
        this.store.commit((_p, lv) => lv.walls.find((w) => w.id === nw.wall.id)?.openings.push(o));
        this.store.select([{ kind: 'opening', id: o.id, wallId: nw.wall.id }]);
        return;
      }
      case 'furniture': {
        const f = this.placeFurniture(this.makeFurniture(p));
        this.store.commit((_p, lv) => lv.furniture.push(f));
        this.store.select([{ kind: 'furniture', id: f.id }]);
        if (!e.shiftKey) this.setTool('select');
        return;
      }
      case 'stair': {
        const s = newStair(this.stairType, this.snap(p, null, e).p);
        this.store.commit((_p, lv) => lv.stairs.push(s));
        this.store.select([{ kind: 'stair', id: s.id }]);
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
        this.store.commit((_p, lv) => lv.dimensions.push({ id: uid('D'), a, b, offset: off }));
        this.dimPts = [];
        return;
      }
      case 'label': {
        void this.cb.askText('Text', '').then((t) => {
          if (!t) return;
          const id = uid('T');
          this.store.commit((_p, lv) => lv.labels.push({ id, pos: p, text: t, size: 0.25, angle: 0 }));
          this.store.select([{ kind: 'label', id }]);
        });
        return;
      }
      case 'calibrate': {
        if (!l.background) {
          this.cb.status('Zuerst ein Grundrissbild laden.');
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
            this.store.commit((_p, lv) => {
              const bg = lv.background!;
              bg.pxPerM /= f;
              bg.offset = add(a, mul(sub(bg.offset, a), f));
            });
            this.cb.status(`Maßstab gesetzt: ${fmt(this.store.level.background!.pxPerM, 1)} px/m`);
            this.setTool('select');
            this.fit();
          });
        }
        this.renderOverlay();
        return;
      }
    }
  }

  private downSelect(e: PointerEvent, p: Vec): void {
    const l = this.store.level;
    const handle = (e.target as HTMLElement).dataset?.handle;
    const sel = this.store.selection;
    if (handle && sel.length === 1) {
      const it = sel[0];
      this.store.beginLive();
      if (handle === 'wall-a' || handle === 'wall-b') {
        const w = l.walls.find((x) => x.id === it.id)!;
        const end = handle === 'wall-a' ? 'a' : 'b';
        const joined = endsAt(l.walls, w[end])
          .filter((x) => x.wall.id !== w.id)
          .map((x) => ({ wallId: x.wall.id, end: x.end }));
        this.drag = { type: 'wallEnd', wallId: w.id, end, base: JSON.parse(JSON.stringify(l)), joined: e.altKey ? [] : joined };
      } else if (handle === 'room-v') this.drag = { type: 'roomVertex', roomId: it.id, idx: Number((e.target as HTMLElement).dataset.idx) };
      else if (handle === 'rotate') this.drag = { type: 'furRotate', id: it.id, kind: it.kind as 'furniture' | 'stair' };
      else if (handle === 'resize') this.drag = { type: 'furResize', id: it.id, kind: it.kind as 'furniture' | 'stair', keepRatio: e.shiftKey };
      else if (handle === 'op-1' || handle === 'op-2') this.drag = { type: 'openingEdge', wallId: it.wallId!, id: it.id, edge: handle === 'op-1' ? 1 : 2 };
      else if (handle.startsWith('dim-')) this.drag = { type: 'dimEnd', id: it.id, end: handle === 'dim-a' ? 'a' : handle === 'dim-b' ? 'b' : 'off' };
      return;
    }
    const h = this.hit(e);
    if (!h) {
      if (e.altKey && l.background) {
        this.store.beginLive();
        this.drag = { type: 'image', start: p, offset: { ...l.background.offset } };
        return;
      }
      if (!e.shiftKey) this.store.select([]);
      this.drag = { type: 'band', start: p, cur: p, add: e.shiftKey };
      return;
    }
    const item: SelItem = { kind: h.kind, id: h.id, wallId: h.wallId };
    if (e.shiftKey) {
      const has = this.store.isSelected(item.kind, item.id);
      this.store.select(has ? sel.filter((s) => !(s.kind === item.kind && s.id === item.id)) : [...sel, item]);
    } else if (!this.store.isSelected(item.kind, item.id)) this.store.select([item]);
    if (item.kind === 'opening' && this.store.selection.length === 1) {
      const w = l.walls.find((x) => x.id === item.wallId)!;
      const o = w.openings.find((x) => x.id === item.id)!;
      this.store.beginLive();
      this.drag = { type: 'opening', wallId: w.id, id: o.id, grab: projectOnWall(w, p).t - o.offset };
      return;
    }
    this.store.beginLive();
    this.drag = { type: 'move', start: p, base: JSON.parse(JSON.stringify(l)), moved: false };
  }

  private onMove(e: PointerEvent): void {
    const p = this.world(e);
    this.cb.coords(p);
    const d = this.drag;
    if (!d) {
      if (this.tool !== 'select' && this.tool !== 'pan') {
        const from = this.tool === 'wall' ? (this.chain[this.chain.length - 1] ?? null) : this.tool === 'dimension' && this.dimPts.length === 1 ? this.dimPts[0] : null;
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
    const l = this.store.level;
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
        this.store.live((_p, lv) => {
          lv.background!.offset = add(d.offset, sub(p, d.start));
        });
        return;
      case 'move': {
        let delta = sub(p, d.start);
        if (!d.moved && Math.hypot(delta.x, delta.y) * this.view.s < 3) return;
        d.moved = true;
        const st = this.store.project.settings;
        if (st.magnetism && !e.altKey) delta = { x: Math.round(delta.x * 100) / 100, y: Math.round(delta.y * 100) / 100 };
        const sel = this.store.selection;
        this.store.live((_p, lv) => {
          moveSelection(d.base, lv, sel, delta);
          // Möbel an Wände anlegen
          if (sel.length === 1 && sel[0].kind === 'furniture' && st.magnetism && !e.altKey) {
            const f = lv.furniture.find((x) => x.id === sel[0].id);
            if (f) Object.assign(f, this.placeFurniture(f));
          }
        });
        return;
      }
      case 'wallEnd': {
        const w0 = d.base.walls.find((x) => x.id === d.wallId)!;
        const other = d.end === 'a' ? w0.b : w0.a;
        const saved = this.chain;
        this.chain = [];
        const sp = this.snapExcluding(p, other, e, d.wallId);
        this.chain = saved;
        this.store.live((_p, lv) => {
          const w = lv.walls.find((x) => x.id === d.wallId);
          if (w) w[d.end] = sp;
          for (const j of d.joined) {
            const o = lv.walls.find((x) => x.id === j.wallId);
            if (o) o[j.end] = { ...sp };
          }
        });
        this.cb.status(`Wandlänge ${fmt(dist(other, sp))} m`);
        return;
      }
      case 'roomVertex': {
        const sp = this.snap(p, null, e).p;
        this.store.live((_p, lv) => {
          const r = lv.rooms.find((x) => x.id === d.roomId);
          if (r) r.polygon[d.idx] = sp;
        });
        return;
      }
      case 'furRotate': {
        this.store.live((_p, lv) => {
          const f = d.kind === 'furniture' ? lv.furniture.find((x) => x.id === d.id) : lv.stairs.find((x) => x.id === d.id);
          if (!f) return;
          let a = (Math.atan2(p.y - f.pos.y, p.x - f.pos.x) * 180) / Math.PI + 90;
          if (!e.altKey) a = Math.round(a / 15) * 15;
          f.angle = ((a % 360) + 360) % 360;
        });
        return;
      }
      case 'furResize': {
        this.store.live((_p, lv) => {
          const f = d.kind === 'furniture' ? lv.furniture.find((x) => x.id === d.id) : lv.stairs.find((x) => x.id === d.id);
          if (!f) return;
          const a = (-f.angle * Math.PI) / 180;
          const q = sub(p, f.pos);
          const lx = q.x * Math.cos(a) - q.y * Math.sin(a);
          const ly = q.x * Math.sin(a) + q.y * Math.cos(a);
          const r = (x: number) => Math.max(0.1, Math.round(x * 2 * 100) / 100);
          if ('depth' in f) {
            const w = r(lx);
            const dd = r(ly);
            if (d.keepRatio || e.shiftKey) {
              const k = w / f.width;
              f.depth = Math.max(0.1, Math.round(f.depth * k * 100) / 100);
              f.height = Math.max(0.05, Math.round(f.height * k * 100) / 100);
              f.width = w;
            } else {
              f.width = w;
              f.depth = dd;
            }
          } else if (f.type === 'spiral') {
            f.length = r(Math.max(lx, ly));
            f.width = f.length;
          } else {
            f.width = r(lx);
            f.length = r(ly);
          }
        });
        return;
      }
      case 'opening': {
        const w0 = l.walls.find((x) => x.id === d.wallId);
        if (!w0) return;
        // auf eine andere Wand ziehen
        const nw = nearestWall(l.walls, p, 0.4);
        this.store.live((_p, lv) => {
          const w = lv.walls.find((x) => x.id === d.wallId)!;
          const idx = w.openings.findIndex((x) => x.id === d.id);
          if (idx < 0) return;
          const o = w.openings[idx];
          if (nw && nw.wall.id !== w.id) {
            w.openings.splice(idx, 1);
            const target = lv.walls.find((x) => x.id === nw.wall.id)!;
            o.offset = clampOpening(target, o, nw.t);
            target.openings.push(o);
            d.wallId = target.id;
            d.grab = 0;
            this.store.selection = [{ kind: 'opening', id: o.id, wallId: target.id }];
            return;
          }
          let t = projectOnWall(w, p).t - d.grab;
          if (!e.altKey) t = Math.round((t - o.width / 2) * 100) / 100 + o.width / 2;
          o.offset = clampOpening(w, o, t);
        });
        const w = this.store.level.walls.find((x) => x.id === d.wallId);
        const o = w?.openings.find((x) => x.id === d.id);
        if (w && o) this.cb.status(`Abstand links ${fmt(o.offset - o.width / 2)} m · rechts ${fmt(wallLength(w) - o.offset - o.width / 2)} m`);
        return;
      }
      case 'openingEdge': {
        this.store.live((_p, lv) => {
          const w = lv.walls.find((x) => x.id === d.wallId);
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
      }
      case 'dimEnd': {
        this.store.live((_p, lv) => {
          const dm = lv.dimensions.find((x) => x.id === d.id);
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
      }
    }
  }

  private snapExcluding(p: Vec, from: Vec, e: PointerEvent, wallId: string): Vec {
    const l = this.store.level;
    const tol = 10 / this.view.s;
    for (const w of l.walls) {
      if (w.id === wallId) continue;
      for (const q of [w.a, w.b]) if (dist(p, q) < tol && dist(q, from) > 0.05) return { ...q };
    }
    const saved = this.tool;
    this.tool = 'select';
    const s = this.snap(p, from, e);
    this.tool = saved;
    return s.kind === 'end' ? p : s.p;
  }

  private onUp(e: PointerEvent): void {
    const d = this.drag;
    this.drag = null;
    if (!d) return;
    const p = this.world(e);
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
      const l = this.store.level;
      const items: SelItem[] = d.add ? [...this.store.selection] : [];
      for (const w of l.walls) if (inR(w.a) && inR(w.b)) items.push({ kind: 'wall', id: w.id });
      for (const r of l.rooms) if (r.polygon.every(inR)) items.push({ kind: 'room', id: r.id });
      for (const f of l.furniture) if (inR(f.pos)) items.push({ kind: 'furniture', id: f.id });
      for (const s of l.stairs) if (inR(s.pos)) items.push({ kind: 'stair', id: s.id });
      for (const s of l.dimensions) if (inR(s.a) && inR(s.b)) items.push({ kind: 'dimension', id: s.id });
      for (const s of l.labels) if (inR(s.pos)) items.push({ kind: 'label', id: s.id });
      this.store.select(items);
      this.renderOverlay();
      return;
    }
    if (d.type === 'rect') {
      const t = this.store.project.settings.wallThickness;
      const n = this.store.level.rooms.length + 1;
      let rid: string | null = null;
      this.store.commit((_p, lv) => {
        rid = addRectRoom(lv, d.start, d.cur, t, `Raum ${n}`).roomId;
      });
      if (rid) this.store.select([{ kind: 'room', id: rid }]);
      this.renderOverlay();
      return;
    }
    if (d.type === 'pan') return;
    if (d.type === 'wallEnd') {
      // Wandende auf einer fremden Wandachse → T-Stoß
      const w = this.store.level.walls.find((x) => x.id === d.wallId);
      if (w) {
        const q = w[d.end];
        this.store.live((_p, lv) => {
          for (const o of lv.walls) {
            if (o.id === w.id) continue;
            const { t, off } = projectOnWall(o, q);
            if (Math.abs(off) < 0.01 && t > 0.02 && t < wallLength(o) - 0.02) {
              const idx = lv.walls.indexOf(o);
              const [a, b] = [
                { ...o, b: { ...q }, openings: o.openings.filter((x) => x.offset < t) },
                { ...o, id: uid('W'), a: { ...q }, openings: o.openings.filter((x) => x.offset >= t).map((x) => ({ ...x, offset: x.offset - t })) },
              ];
              lv.walls.splice(idx, 1, a, b);
              break;
            }
          }
        });
      }
    }
    void p;
    this.store.endLive();
  }

  private onDbl(e: MouseEvent): void {
    const p = this.world(e);
    if (this.tool === 'wall') {
      this.finishChain();
      return;
    }
    if (this.tool === 'room') {
      if (this.chain.length > 2) {
        this.finishRoom();
        return;
      }
      this.chain = [];
      this.detectRoom(p);
      return;
    }
    if (this.tool === 'select') {
      const h = this.hit(e);
      if (h) this.cb.openProps();
      else this.detectRoom(p);
    }
  }

  detectRoom(p: Vec): void {
    const l = this.store.level;
    if (l.rooms.some((r) => pointInPolygon(p, r.polygon))) {
      this.cb.status('Hier liegt bereits ein Raum.');
      return;
    }
    const poly = detectRoomAt(l, p);
    if (!poly) {
      this.cb.status('Kein geschlossener Bereich: Wände müssen den Raum vollständig umschließen.');
      return;
    }
    const r = newRoom(poly, `Raum ${l.rooms.length + 1}`);
    this.store.commit((_p, lv) => lv.rooms.push(r));
    this.store.select([{ kind: 'room', id: r.id }]);
  }

  private onDrop(e: DragEvent): void {
    e.preventDefault();
    const key = e.dataTransfer?.getData('text/x-hauscad');
    if (!key || !CATALOG_BY_KEY[key]) return;
    this.catalogKey = key;
    const f = this.placeFurniture(this.makeFurniture(this.world(e)));
    this.store.commit((_p, lv) => lv.furniture.push(f));
    this.store.select([{ kind: 'furniture', id: f.id }]);
  }

  // ---------- Werkzeug-Abschluss ----------

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
    this.store.commit((_p, lv) => {
      ids = addWallChain(lv, closed ? pts.slice(0, -1) : pts, t, closed).map((w) => w.id);
    });
    this.store.select(ids.map((id) => ({ kind: 'wall', id })));
    this.renderOverlay();
  }

  private finishRoom(): void {
    const pts = this.chain;
    this.chain = [];
    if (pts.length < 3) return;
    const r = newRoom(pts, `Raum ${this.store.level.rooms.length + 1}`);
    this.store.commit((_p, lv) => lv.rooms.push(r));
    this.store.select([{ kind: 'room', id: r.id }]);
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
    if (this.tool === 'room' && this.chain.length) {
      if (e.key === 'Enter') {
        this.finishRoom();
        return true;
      }
      if (e.key === 'Escape') {
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

  /** Magnetismus: Rückseite an die nächste Wand anlegen und ausrichten */
  placeFurniture(f: Furniture): Furniture {
    const it = CATALOG_BY_KEY[f.catalog];
    if (!it?.wallSide || !this.store.project.settings.magnetism || this.altKey) return f;
    const l = this.store.level;
    const reach = f.depth / 2 + 0.35;
    let best: { d: number; pos: Vec; angle: number } | null = null;
    for (const w of l.walls) {
      const L = wallLength(w);
      const { t, off } = projectOnWall(w, f.pos);
      if (t < -0.1 || t > L + 0.1) continue;
      const face = Math.abs(off) - w.thickness / 2;
      if (face < -0.05 || face > reach) continue;
      const d = Math.abs(face - f.depth / 2);
      if (best && d >= best.d) continue;
      const side = off >= 0 ? 1 : -1;
      const dir = wallDir(w);
      const n = mul(left(dir), side);
      const tt = Math.min(L - f.width / 2, Math.max(f.width / 2, t));
      const pos = add(pointOnWall(w, tt), mul(n, w.thickness / 2 + f.depth / 2 + 0.005));
      // Vorderseite (+y lokal) zeigt von der Wand weg: Drehwinkel so, dass lokales +y = n
      const angle = (Math.atan2(n.y, n.x) * 180) / Math.PI - 90;
      best = { d, pos, angle: ((angle % 360) + 360) % 360 };
    }
    return best ? { ...f, pos: best.pos, angle: Math.round(best.angle * 100) / 100 } : f;
  }

  /** Ansicht als SVG-Datei (ohne Raster und Griffe) */
  exportSvg(): string {
    const p = this.store.project;
    const l = this.store.level;
    const pts: Vec[] = [];
    for (const w of l.walls) pts.push(w.a, w.b);
    for (const r of l.rooms) pts.push(...r.polygon);
    if (!pts.length) pts.push({ x: 0, y: 0 }, { x: 5, y: 5 });
    const minX = Math.min(...pts.map((q) => q.x)) - 1;
    const minY = Math.min(...pts.map((q) => q.y)) - 1;
    const W = Math.max(...pts.map((q) => q.x)) - minX + 1;
    const H = Math.max(...pts.map((q) => q.y)) - minY + 1;
    const body = levelSvg(p, l, { scale: 50, sel: [], ghost: null, showWallDims: false, showRoomArea: p.settings.showRoomArea, forExport: true });
    return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="${minX} ${minY} ${W} ${H}" width="${(W * 100).toFixed(0)}mm" height="${(H * 100).toFixed(0)}mm"><style>${EXPORT_CSS}</style>${PLAN_DEFS}<rect x="${minX}" y="${minY}" width="${W}" height="${H}" fill="#fff"/>${body}<text x="${minX + 0.3}" y="${minY + H - 0.3}" style="font:0.25px sans-serif;fill:#333">${esc(p.name)} · ${esc(l.name)} · M 1:100</text></svg>`;
  }
}

const OPENING_TYPE_LABEL = (t: OpeningType) =>
  ({ door: 'Tür', doubleDoor: 'Doppeltür', slidingDoor: 'Schiebetür', window: 'Fenster', frenchWindow: 'Fenstertür', roofWindow: 'Oberlicht', garageDoor: 'Garagentor', passage: 'Durchgang' })[t];

const HINTS: Record<Tool, string> = {
  select: 'Klicken wählt, Ziehen verschiebt, Rahmen wählt mehrere (⇧ ergänzt). Doppelklick in einen umschlossenen Bereich legt einen Raum an.',
  pan: 'Ziehen verschiebt die Ansicht. Mausrad zoomt.',
  wall: 'Klicken setzt Wandpunkte. Länge eintippen + Enter, Doppelklick/Esc beendet. ⌥/⇧ hebt Fangen auf.',
  room: 'Punkte klicken oder Doppelklick in einen von Wänden umschlossenen Bereich.',
  roomRect: 'Rechteck aufziehen: Wände (Achse) und Raum entstehen zusammen, angrenzende Wände werden geteilt statt verdoppelt.',
  opening: 'Auf eine Wand klicken. Die Tür öffnet zur Seite des Mauszeigers.',
  furniture: 'Klicken setzt das Möbel (⇧ für mehrere). Wandmöbel legen sich an die nächste Wand an (⌥ verhindert).',
  stair: 'Klicken setzt die Treppe. Im Geschoss darüber wird die Decke ausgespart.',
  dimension: 'Zwei Punkte klicken, dann Abstand der Maßlinie wählen.',
  label: 'Klicken und Text eingeben.',
  calibrate: 'Zwei Punkte mit bekanntem Abstand im Bild anklicken.',
};

export const EXPORT_CSS = `
.wall{fill:url(#hatch);stroke:none}.hatch-bg{fill:#fff}.hatch-ln{stroke:#444;stroke-width:0.012}
.wall-edge{stroke:#111;stroke-width:0.025;stroke-linecap:square}
.room{stroke:none;opacity:.35}.room-name{font-family:sans-serif;font-weight:600;text-anchor:middle;fill:#222}.room-area{font-family:sans-serif;text-anchor:middle;fill:#555}
.op-gap{fill:#fff}.op-reveal,.op-win{stroke:#111;stroke-width:0.015}.op-glass{stroke:#111;stroke-width:0.008}.op-leaf{stroke:#111;stroke-width:0.02}.op-arc{fill:none;stroke:#111;stroke-width:0.008}.op-sill{stroke:#111;stroke-width:0.008}
.op-slide{fill:#fff;stroke:#111;stroke-width:0.008}.op-garage{stroke:#111;stroke-width:0.01}.dashed{stroke-dasharray:0.06 0.04}.hit,.hit-line{display:none}
.sym{fill:none;stroke:#333;stroke-width:0.012}.fur-bg{fill:#fff;opacity:.8}.sym-t{font:0.12px sans-serif;text-anchor:middle;fill:#333;stroke:none}.fill-dark{fill:#333}
.tread{fill:#fff;stroke:#333;stroke-width:0.01}.stair-bg{fill:#fff}.walkline{fill:none;stroke:#333;stroke-width:0.01}.walk-start{fill:#333}.arrow-head{fill:#333}
.void{fill:none;stroke:#666;stroke-width:0.01;stroke-dasharray:0.08 0.05}.void-x{stroke:#666;stroke-width:0.008}
.dim-line,.dim-ext{stroke:#333;stroke-width:0.008}.dim-tick{stroke:#333;stroke-width:0.016}.dim-text{font-family:sans-serif;text-anchor:middle;fill:#222}
.label{font-family:sans-serif;fill:#222}.ghost{display:none}`;
