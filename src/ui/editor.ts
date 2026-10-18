import type { Floor, Room, Vec } from '../model/types';
import type { Store } from '../model/store';
import { WALL_PRESETS } from '../model/catalog';
import { floorShort, newRoom, newWall, uid } from '../model/factory';
import { add, dist, len, mul, norm, orthoSnap, pointInPolygon, snapToGrid, sub, v, area, isSimplePolygon, cleanPolygon } from '../geometry/geom';
import { detectRoom } from '../geometry/detect';
import { backgroundMarkup, floorBounds, renderLayers } from './render';
import { esc, num, parseNum } from './format';

export type Tool = 'select' | 'pan' | 'wall' | 'room' | 'rect' | 'detect' | 'manifold' | 'heatSource' | 'route' | 'calibrate' | 'moveImage' | 'measure';

export interface EditorOptions {
  grid: boolean;
  gridStep: number;
  snap: boolean;
  ortho: boolean;
  showCircuits: boolean;
  showLabels: boolean;
  ghost: boolean;
  wallPreset: number;
  roomType: string;
}

export interface EditorCallbacks {
  status(cursor: Vec | null): void;
  hint(text: string): void;
  toast(text: string, kind?: 'info' | 'warn'): void;
  calibrate(measured: number, a: Vec, b: Vec): void;
  toolChanged(tool: Tool): void;
}

type Drag =
  | { type: 'pan'; sx: number; sy: number; tx: number; ty: number }
  | { type: 'vertex'; roomId: string; index: number }
  | { type: 'connector'; roomId: string }
  | { type: 'routePoint'; routeId: string; index: number }
  | { type: 'wallEnd'; wallId: string; end: 'a' | 'b'; joined: { id: string; end: 'a' | 'b' }[] }
  | { type: 'move'; kind: 'room' | 'wall' | 'manifold' | 'heatSource'; id: string; last: Vec }
  | { type: 'image'; last: Vec }
  | { type: 'rect'; start: Vec };

const SVGNS = 'http://www.w3.org/2000/svg';

export const TOOL_HINTS: Record<Tool, string> = {
  select: 'Objekt anklicken zum Bearbeiten · Eckpunkte ziehen · Mittelpunkte ziehen fügt Ecken ein · leere Fläche ziehen verschiebt die Ansicht',
  pan: 'Ziehen verschiebt die Ansicht · Mausrad zoomt',
  wall: 'Klick setzt Wandpunkte entlang der Wandachse · Länge eintippen + Enter · Shift hebt Ortho auf · Esc/Doppelklick beendet',
  room: 'Eckpunkte anklicken · ersten Punkt anklicken, Enter oder Doppelklick schließt den Raum · Länge eintippen + Enter',
  rect: 'Rechteck aufziehen: Ecke zu Ecke',
  detect: 'In einen von Wänden umschlossenen Bereich klicken – der Raum wird an der Wandinnenkante erkannt (Türöffnungen mit Wänden schließen)',
  manifold: 'Klick platziert einen Heizkreisverteiler',
  heatSource: 'Klick platziert den Wärmeerzeuger (einer je Projekt)',
  route: 'Raum anklicken, dann Wegpunkte der Anbindeleitung setzen · Klick auf den Verteiler oder Enter beendet',
  calibrate: 'Zwei Punkte mit bekanntem Abstand im Grundriss anklicken (z. B. Maßkette) – danach den echten Abstand eingeben',
  moveImage: 'Grundrissbild ziehen, um es an den Zeichnungsinhalt oder andere Geschosse anzupassen',
  measure: 'Zwei Punkte anklicken, um einen Abstand zu messen',
};

export class Editor {
  readonly svg: SVGSVGElement;
  private world: SVGGElement;
  private g: Record<string, SVGGElement> = {};
  view = { scale: 42, tx: 80, ty: 70 };
  tool: Tool = 'select';
  options: EditorOptions = {
    grid: true,
    gridStep: 0.05,
    snap: true,
    ortho: true,
    showCircuits: true,
    showLabels: true,
    ghost: true,
    wallPreset: 0,
    roomType: 'wohnen',
  };
  private draft: Vec[] = [];
  private draftRoomId: string | null = null;
  private cursor: Vec | null = null;
  private snapKind: 'vertex' | 'grid' | 'none' = 'none';
  private typed = '';
  private drag: Drag | null = null;
  private shift = false;
  private space = false;
  private measureResult: [Vec, Vec] | null = null;
  private lastBgKey = '';
  private raf = 0;

  constructor(
    container: HTMLElement,
    private store: Store,
    private cb: EditorCallbacks,
  ) {
    this.svg = document.createElementNS(SVGNS, 'svg');
    this.svg.setAttribute('class', 'plan');
    this.svg.setAttribute('role', 'application');
    this.svg.setAttribute('aria-label', 'Zeichenfläche');
    this.world = document.createElementNS(SVGNS, 'g');
    for (const name of ['bg', 'grid', 'ghost', 'rooms', 'circuits', 'feeders', 'walls', 'objects', 'labels', 'handles', 'preview']) {
      const el = document.createElementNS(SVGNS, 'g');
      el.setAttribute('class', `layer-${name}`);
      this.g[name] = el;
      this.world.appendChild(el);
    }
    this.svg.appendChild(this.world);
    container.appendChild(this.svg);
    this.bind();
    new ResizeObserver(() => this.requestRender()).observe(container);
  }

  // ---------- Koordinaten ----------
  toWorld(clientX: number, clientY: number): Vec {
    const r = this.svg.getBoundingClientRect();
    return v((clientX - r.left - this.view.tx) / this.view.scale, (clientY - r.top - this.view.ty) / this.view.scale);
  }
  private px(n: number) {
    return n / this.view.scale;
  }

  setTool(t: Tool): void {
    this.cancelDraft();
    this.tool = t;
    this.measureResult = null;
    this.svg.dataset.tool = t;
    this.cb.toolChanged(t);
    this.cb.hint(TOOL_HINTS[t]);
    this.requestRender();
  }

  cancelDraft(): boolean {
    const had = this.draft.length > 0 || this.typed !== '' || this.drag?.type === 'rect';
    this.draft = [];
    this.draftRoomId = null;
    this.typed = '';
    if (this.drag?.type === 'rect') this.drag = null;
    this.renderPreview();
    return had;
  }

  get isDrawing(): boolean {
    return this.draft.length > 0;
  }

  zoomBy(factor: number, at?: { x: number; y: number }): void {
    const r = this.svg.getBoundingClientRect();
    const cx = at ? at.x - r.left : r.width / 2;
    const cy = at ? at.y - r.top : r.height / 2;
    const s0 = this.view.scale;
    const s1 = Math.min(600, Math.max(4, s0 * factor));
    this.view.tx = cx - ((cx - this.view.tx) * s1) / s0;
    this.view.ty = cy - ((cy - this.view.ty) * s1) / s0;
    this.view.scale = s1;
    this.requestRender();
  }

  fit(): void {
    const b = floorBounds(this.store.floor, this.store.project);
    const r = this.svg.getBoundingClientRect();
    if (!b || r.width < 10) return;
    const pad = 1.2;
    const w = b.max.x - b.min.x + 2 * pad;
    const h = b.max.y - b.min.y + 2 * pad;
    const s = Math.min(r.width / Math.max(w, 1), r.height / Math.max(h, 1));
    this.view.scale = Math.min(200, Math.max(6, s));
    this.view.tx = (r.width - (b.max.x + b.min.x) * this.view.scale) / 2;
    this.view.ty = (r.height - (b.max.y + b.min.y) * this.view.scale) / 2;
    this.requestRender();
  }

  // ---------- Fangen ----------
  private snapCandidates(floor: Floor): Vec[] {
    const c: Vec[] = [];
    floor.walls.forEach((w) => c.push(w.a, w.b));
    floor.rooms.forEach((r) => c.push(...r.polygon));
    floor.manifolds.forEach((m) => c.push(m.pos));
    return c;
  }

  private snap(p: Vec, from: Vec | null, mode: 'full' | 'none' = 'full'): Vec {
    this.snapKind = 'none';
    if (mode === 'none') return p;
    const tol = this.px(10);
    if (this.options.snap) {
      let best: Vec | null = null;
      let bd = tol;
      for (const q of this.snapCandidates(this.store.floor)) {
        const d = dist(p, q);
        if (d < bd) {
          bd = d;
          best = q;
        }
      }
      if (best) {
        this.snapKind = 'vertex';
        return { ...best };
      }
    }
    const ortho = this.options.ortho !== this.shift;
    if (from && ortho) {
      const q = orthoSnap(from, p);
      const dir = norm(sub(q, from));
      let l = len(sub(q, from));
      if (this.options.grid) l = Math.round(l / this.options.gridStep) * this.options.gridStep;
      this.snapKind = this.options.grid ? 'grid' : 'none';
      return add(from, mul(dir, l));
    }
    if (this.options.grid) {
      this.snapKind = 'grid';
      return snapToGrid(p, this.options.gridStep);
    }
    return p;
  }

  // ---------- Ereignisse ----------
  private bind(): void {
    const s = this.svg;
    s.addEventListener('pointerdown', (e) => this.onDown(e));
    s.addEventListener('pointermove', (e) => this.onMove(e));
    s.addEventListener('pointerup', (e) => this.onUp(e));
    s.addEventListener('pointercancel', () => this.endDrag());
    s.addEventListener('pointerleave', () => {
      this.cursor = null;
      this.cb.status(null);
      this.renderPreview();
    });
    s.addEventListener('dblclick', (e) => {
      e.preventDefault();
      this.confirm();
    });
    s.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (!this.confirm()) this.cancelDraft();
    });
    s.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        if (e.ctrlKey || Math.abs(e.deltaY) > 0 || !e.deltaX) {
          const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015));
          this.zoomBy(factor, { x: e.clientX, y: e.clientY });
        }
        if (!e.ctrlKey && e.deltaX && Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
          this.view.tx -= e.deltaX;
          this.requestRender();
        }
      },
      { passive: false },
    );
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Shift') this.shift = true;
      if (e.key === ' ' && !isTyping(e)) this.space = true;
    });
    window.addEventListener('keyup', (e) => {
      if (e.key === 'Shift') this.shift = false;
      if (e.key === ' ') this.space = false;
    });
  }

  private onDown(e: PointerEvent): void {
    if (e.button === 2) return;
    this.svg.setPointerCapture(e.pointerId);
    const p = this.toWorld(e.clientX, e.clientY);
    const store = this.store;
    const floor = store.floor;
    if (e.button === 1 || this.space || this.tool === 'pan') {
      this.drag = { type: 'pan', sx: e.clientX, sy: e.clientY, tx: this.view.tx, ty: this.view.ty };
      return;
    }
    const target = (e.target as Element).closest('[data-handle],[data-kind]') as HTMLElement | SVGElement | null;
    const ds = (target as SVGElement | null)?.dataset;
    const last = this.draft.length ? this.draft[this.draft.length - 1] : null;

    switch (this.tool) {
      case 'select': {
        if (ds?.handle) {
          const sel = store.selection;
          store.beginLive();
          if (ds.handle === 'vertex' && sel?.kind === 'room') this.drag = { type: 'vertex', roomId: sel.id, index: Number(ds.index) };
          else if (ds.handle === 'mid' && sel?.kind === 'room') {
            const idx = Number(ds.index);
            store.live((pr) => {
              const room = findRoom(pr.floors, sel.id);
              if (!room) return;
              const a = room.polygon[idx];
              const b = room.polygon[(idx + 1) % room.polygon.length];
              room.polygon.splice(idx + 1, 0, mul(add(a, b), 0.5));
            });
            this.drag = { type: 'vertex', roomId: sel.id, index: idx + 1 };
          } else if (ds.handle === 'connector' && sel?.kind === 'room') this.drag = { type: 'connector', roomId: sel.id };
          else if (ds.handle === 'route' && ds.route) this.drag = { type: 'routePoint', routeId: ds.route, index: Number(ds.index) };
          else if ((ds.handle === 'wall-a' || ds.handle === 'wall-b') && sel?.kind === 'wall') {
            const end = ds.handle === 'wall-a' ? 'a' : 'b';
            const w = floor.walls.find((x) => x.id === sel.id);
            const joined: { id: string; end: 'a' | 'b' }[] = [];
            if (w) {
              const pt = w[end];
              for (const o of floor.walls) {
                if (o.id === w.id) continue;
                if (dist(o.a, pt) < 1e-3) joined.push({ id: o.id, end: 'a' });
                if (dist(o.b, pt) < 1e-3) joined.push({ id: o.id, end: 'b' });
              }
            }
            this.drag = { type: 'wallEnd', wallId: sel.id, end, joined };
          }
          return;
        }
        if (ds?.kind && ds.id) {
          const kind = ds.kind as 'room' | 'wall' | 'manifold' | 'heatSource' | 'route';
          store.select({ kind, id: ds.id });
          if (kind !== 'route') {
            store.beginLive();
            this.drag = { type: 'move', kind, id: ds.id, last: p };
          }
          return;
        }
        store.select(null);
        this.drag = { type: 'pan', sx: e.clientX, sy: e.clientY, tx: this.view.tx, ty: this.view.ty };
        return;
      }
      case 'wall': {
        const q = this.snap(p, last);
        if (!last) {
          this.draft = [q];
        } else if (dist(q, last) > 0.02) {
          this.addWall(last, q);
          // Kette schließt sich am Startpunkt
          if (this.draft.length > 1 && dist(q, this.draft[0]) < 1e-6) this.draft = [];
          else this.draft.push(q);
        }
        this.typed = '';
        this.renderPreview();
        return;
      }
      case 'room': {
        const q = this.snap(p, last);
        if (this.draft.length >= 3 && dist(q, this.draft[0]) < this.px(10)) {
          this.finishRoomPolygon();
          return;
        }
        if (!last || dist(q, last) > 0.02) this.draft.push(q);
        this.typed = '';
        this.renderPreview();
        return;
      }
      case 'rect': {
        this.drag = { type: 'rect', start: this.snap(p, null) };
        return;
      }
      case 'detect': {
        const res = detectRoom(p, floor.walls);
        if (!res.ok) {
          this.cb.toast(
            res.reason === 'no-walls'
              ? 'Zeichnen Sie zuerst Wände – oder legen Sie den Raum mit dem Polygon-Werkzeug an.'
              : res.reason === 'in-wall'
                ? 'Der Klick liegt in einer Wand. Klicken Sie in die Raumfläche.'
                : 'Der Bereich ist nicht geschlossen. Schließen Sie Türöffnungen und Lücken mit Wänden.',
            'warn',
          );
          return;
        }
        if (floor.rooms.some((r) => pointInPolygon(p, r.polygon))) {
          this.cb.toast('An dieser Stelle gibt es bereits einen Raum.', 'warn');
          return;
        }
        let id = '';
        store.commit((pr) => {
          const fl = pr.floors.find((x) => x.id === floor.id)!;
          const room = newRoom(pr, fl, res.polygon, this.options.roomType);
          id = room.id;
          fl.rooms.push(room);
        });
        store.select({ kind: 'room', id });
        return;
      }
      case 'manifold': {
        const q = this.snap(p, null);
        const id = uid('m');
        store.commit((pr) => {
          const fl = pr.floors.find((x) => x.id === floor.id)!;
          const n = fl.manifolds.length + 1;
          fl.manifolds.push({ id, name: `HKV ${floorShort(fl.name)}${n > 1 ? ` ${n}` : ''}`, pos: q, supplyLengthOverride: null });
        });
        this.setTool('select');
        store.select({ kind: 'manifold', id });
        return;
      }
      case 'heatSource': {
        const q = this.snap(p, null);
        store.commit((pr) => {
          pr.heatSource = pr.heatSource
            ? { ...pr.heatSource, floorId: floor.id, pos: q }
            : { floorId: floor.id, pos: q, name: 'Wärmeerzeuger', type: 'wp_luft' };
        });
        this.setTool('select');
        store.select({ kind: 'heatSource', id: 'hs' });
        return;
      }
      case 'route': {
        if (!this.draftRoomId) {
          const room = floor.rooms.find((r) => pointInPolygon(p, r.polygon));
          if (!room) {
            this.cb.toast('Klicken Sie zuerst in den Raum, dessen Anbindeleitung Sie führen möchten.', 'warn');
            return;
          }
          const rr = store.design.rooms.get(room.id);
          if (!rr?.manifoldId || rr.manifoldFloorId !== floor.id) {
            this.cb.toast('Diesem Raum ist kein Verteiler im selben Geschoss zugeordnet.', 'warn');
            return;
          }
          this.draftRoomId = room.id;
          this.draft = rr.connector ? [rr.connector] : [];
          store.select({ kind: 'room', id: room.id });
          this.renderPreview();
          return;
        }
        const rr = store.design.rooms.get(this.draftRoomId);
        const man = floor.manifolds.find((m) => m.id === rr?.manifoldId);
        const q = this.snap(p, last);
        if (man && dist(q, man.pos) < Math.max(0.3, this.px(14))) {
          this.finishRoute();
          return;
        }
        this.draft.push(q);
        this.renderPreview();
        return;
      }
      case 'calibrate': {
        if (!floor.background) {
          this.cb.toast('Laden Sie zuerst ein Grundrissbild für dieses Geschoss.', 'warn');
          return;
        }
        const q = this.draft.length ? this.snap(p, this.draft[0]) : p;
        this.draft.push(this.draft.length ? q : p);
        if (this.draft.length === 2) {
          const [a, b] = this.draft;
          const d = dist(a, b);
          this.draft = [];
          if (d < 0.01) return;
          this.cb.calibrate(d, a, b);
          this.measureResult = [a, b];
        }
        this.renderPreview();
        return;
      }
      case 'measure': {
        const q = this.snap(p, this.draft[0] ?? null);
        if (this.draft.length === 0) {
          this.measureResult = null;
          this.draft = [q];
        } else {
          this.measureResult = [this.draft[0], q];
          this.draft = [];
        }
        this.renderPreview();
        return;
      }
      case 'moveImage': {
        if (!floor.background) {
          this.cb.toast('Für dieses Geschoss ist kein Grundrissbild geladen.', 'warn');
          return;
        }
        store.beginLive();
        this.drag = { type: 'image', last: p };
        return;
      }
    }
  }

  private onMove(e: PointerEvent): void {
    const p = this.toWorld(e.clientX, e.clientY);
    this.cursor = p;
    this.cb.status(p);
    const d = this.drag;
    const store = this.store;
    if (!d) {
      this.renderPreview();
      return;
    }
    switch (d.type) {
      case 'pan':
        this.view.tx = d.tx + (e.clientX - d.sx);
        this.view.ty = d.ty + (e.clientY - d.sy);
        this.requestRender();
        return;
      case 'vertex': {
        const q = this.snapExcluding(p, d.roomId, d.index);
        store.live((pr) => {
          const room = findRoom(pr.floors, d.roomId);
          if (room) room.polygon[d.index] = q;
        });
        return;
      }
      case 'connector': {
        const q = this.snap(p, null);
        store.live((pr) => {
          const room = findRoom(pr.floors, d.roomId);
          if (room) room.connector = q;
        });
        return;
      }
      case 'routePoint': {
        const q = this.snap(p, null);
        store.live((pr) => {
          const fl = pr.floors.find((x) => x.id === store.activeFloorId);
          const r = fl?.routes.find((x) => x.id === d.routeId);
          if (r) r.points[d.index] = q;
        });
        return;
      }
      case 'wallEnd': {
        const w0 = store.floor.walls.find((x) => x.id === d.wallId);
        const other = w0 ? (d.end === 'a' ? w0.b : w0.a) : null;
        const q = this.snapExcludingWall(p, other, d.wallId);
        store.live((pr) => {
          const fl = pr.floors.find((x) => x.id === store.activeFloorId)!;
          const w = fl.walls.find((x) => x.id === d.wallId);
          if (w) w[d.end] = q;
          for (const j of d.joined) {
            const o = fl.walls.find((x) => x.id === j.id);
            if (o) o[j.end] = { ...q };
          }
        });
        return;
      }
      case 'move': {
        let delta = sub(p, d.last);
        if (this.options.grid) delta = snapToGrid(delta, this.options.gridStep);
        if (Math.abs(delta.x) < 1e-9 && Math.abs(delta.y) < 1e-9) return;
        d.last = add(d.last, delta);
        store.live((pr) => {
          const fl = pr.floors.find((x) => x.id === store.activeFloorId)!;
          if (d.kind === 'room') {
            const room = fl.rooms.find((x) => x.id === d.id);
            if (room) {
              room.polygon = room.polygon.map((q) => add(q, delta));
              if (room.connector) room.connector = add(room.connector, delta);
            }
          } else if (d.kind === 'wall') {
            const w = fl.walls.find((x) => x.id === d.id);
            if (w) {
              w.a = add(w.a, delta);
              w.b = add(w.b, delta);
            }
          } else if (d.kind === 'manifold') {
            const m = fl.manifolds.find((x) => x.id === d.id);
            if (m) m.pos = add(m.pos, delta);
          } else if (d.kind === 'heatSource' && pr.heatSource) pr.heatSource.pos = add(pr.heatSource.pos, delta);
        });
        return;
      }
      case 'image': {
        const delta = sub(p, d.last);
        d.last = p;
        store.live((pr) => {
          const fl = pr.floors.find((x) => x.id === store.activeFloorId)!;
          if (fl.background) fl.background.offset = add(fl.background.offset, delta);
        });
        return;
      }
      case 'rect':
        this.renderPreview();
        return;
    }
  }

  private onUp(e: PointerEvent): void {
    const d = this.drag;
    if (d?.type === 'rect') {
      const a = d.start;
      const b = this.snap(this.toWorld(e.clientX, e.clientY), null);
      this.drag = null;
      if (Math.abs(b.x - a.x) > 0.3 && Math.abs(b.y - a.y) > 0.3) {
        const poly = [a, v(b.x, a.y), b, v(a.x, b.y)];
        this.createRoom(poly);
      }
      this.renderPreview();
      return;
    }
    this.endDrag();
  }

  private endDrag(): void {
    if (this.drag && this.drag.type !== 'pan') this.store.endLive();
    this.drag = null;
  }

  private snapExcluding(p: Vec, roomId: string, index: number): Vec {
    const room = this.store.floor.rooms.find((r) => r.id === roomId);
    const saved = room ? room.polygon[index] : null;
    if (room) room.polygon[index] = v(NaN, NaN);
    const prev = room ? room.polygon[(index - 1 + room.polygon.length) % room.polygon.length] : null;
    const q = this.snap(p, prev);
    if (room && saved) room.polygon[index] = saved;
    return q;
  }

  private snapExcludingWall(p: Vec, from: Vec | null, wallId: string): Vec {
    const w = this.store.floor.walls.find((x) => x.id === wallId);
    if (!w) return this.snap(p, from);
    const sa = w.a;
    const sb = w.b;
    w.a = v(NaN, NaN);
    w.b = v(NaN, NaN);
    const q = this.snap(p, from);
    w.a = sa;
    w.b = sb;
    return q;
  }

  // ---------- Bestätigen / Tastatur ----------
  /** Enter / Doppelklick: aktuelle Zeichnung abschließen. */
  confirm(): boolean {
    if (this.typed && this.draft.length && (this.tool === 'wall' || this.tool === 'room')) {
      const l = parseNum(this.typed);
      const last = this.draft[this.draft.length - 1];
      if (l && l > 0) {
        let dir = this.cursor ? norm(sub(this.cursor, last)) : v(1, 0);
        if (this.options.ortho !== this.shift && this.cursor) dir = norm(sub(orthoSnap(last, this.cursor), last));
        if (len(dir) < 0.5) dir = v(1, 0);
        const q = add(last, mul(dir, l));
        if (this.tool === 'wall') this.addWall(last, q);
        this.draft.push(q);
        this.typed = '';
        this.renderPreview();
        return true;
      }
    }
    if (this.tool === 'wall' && this.draft.length) {
      this.draft = [];
      this.renderPreview();
      return true;
    }
    if (this.tool === 'room' && this.draft.length >= 3) {
      this.finishRoomPolygon();
      return true;
    }
    if (this.tool === 'route' && this.draftRoomId) {
      this.finishRoute();
      return true;
    }
    return false;
  }

  typeChar(ch: string): boolean {
    if (!(this.tool === 'wall' || this.tool === 'room') || !this.draft.length) return false;
    if (ch === 'Backspace') {
      if (this.typed) this.typed = this.typed.slice(0, -1);
      else if (this.draft.length > 1 && this.tool === 'room') this.draft.pop();
      else return false;
      this.renderPreview();
      return true;
    }
    if (!/^[0-9.,]$/.test(ch)) return false;
    this.typed += ch;
    this.renderPreview();
    return true;
  }

  private addWall(a: Vec, b: Vec): void {
    const preset = WALL_PRESETS[this.options.wallPreset] ?? WALL_PRESETS[0];
    const fid = this.store.activeFloorId;
    this.store.commit((pr) => {
      pr.floors.find((x) => x.id === fid)!.walls.push(newWall({ ...a }, { ...b }, preset.kind, preset.thickness));
    });
  }

  private createRoom(poly: Vec[]): void {
    const clean = cleanPolygon(poly);
    if (clean.length < 3 || area(clean) < 0.2) {
      this.cb.toast('Der Raum ist zu klein.', 'warn');
      return;
    }
    if (!isSimplePolygon(clean)) {
      this.cb.toast('Die Raumkontur überschneidet sich selbst.', 'warn');
      return;
    }
    const fid = this.store.activeFloorId;
    let id = '';
    this.store.commit((pr) => {
      const fl = pr.floors.find((x) => x.id === fid)!;
      const room = newRoom(pr, fl, clean, this.options.roomType);
      id = room.id;
      fl.rooms.push(room);
    });
    this.store.select({ kind: 'room', id });
  }

  private finishRoomPolygon(): void {
    const poly = this.draft.slice();
    this.draft = [];
    this.typed = '';
    this.createRoom(poly);
    this.renderPreview();
  }

  private finishRoute(): void {
    const roomId = this.draftRoomId;
    const pts = this.draft.slice(1);
    this.draft = [];
    this.draftRoomId = null;
    if (!roomId) return;
    const fid = this.store.activeFloorId;
    this.store.commit((pr) => {
      const fl = pr.floors.find((x) => x.id === fid)!;
      fl.routes = fl.routes.filter((r) => r.roomId !== roomId);
      if (pts.length) fl.routes.push({ id: uid('l'), roomId, points: pts });
    });
    this.cb.toast(pts.length ? 'Anbindeleitung gespeichert.' : 'Anbindeleitung zurückgesetzt – sie wird wieder automatisch geführt.');
    this.renderPreview();
  }

  // ---------- Darstellung ----------
  requestRender(): void {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      this.render();
    });
  }

  render(): void {
    const { scale, tx, ty } = this.view;
    this.world.setAttribute('transform', `translate(${tx} ${ty}) scale(${scale})`);
    const store = this.store;
    const floor = store.floor;
    const bgKey = JSON.stringify(floor.background) + floor.id;
    if (bgKey !== this.lastBgKey) {
      this.g.bg.innerHTML = backgroundMarkup(floor, store.images);
      this.lastBgKey = bgKey;
    }
    this.renderGrid();
    const ghost = this.options.ghost ? ghostFloor(store.project.floors, floor) : null;
    const L = renderLayers({
      project: store.project,
      floor,
      design: store.design,
      images: store.images,
      scale,
      selection: store.selection,
      showCircuits: this.options.showCircuits,
      showLabels: this.options.showLabels,
      ghost,
    });
    this.g.ghost.innerHTML = L.ghost;
    this.g.rooms.innerHTML = L.rooms;
    this.g.circuits.innerHTML = L.circuits;
    this.g.feeders.innerHTML = L.feeders;
    this.g.walls.innerHTML = L.walls;
    this.g.objects.innerHTML = L.objects;
    this.g.labels.innerHTML = L.labels;
    this.g.labels.setAttribute('stroke-width', String(3 / scale));
    this.g.handles.innerHTML = L.handles;
    this.renderPreview();
  }

  private renderGrid(): void {
    const r = this.svg.getBoundingClientRect();
    const s = this.view.scale;
    const x0 = -this.view.tx / s;
    const y0 = -this.view.ty / s;
    const x1 = x0 + r.width / s;
    const y1 = y0 + r.height / s;
    const major = s < 12 ? 10 : s < 30 ? 5 : 1;
    const minor = s > 90 ? 0.1 : s > 45 ? 0.5 : 0;
    let h = '';
    const line = (xa: number, ya: number, xb: number, yb: number, cls: string) =>
      `<line x1="${xa}" y1="${ya}" x2="${xb}" y2="${yb}" class="${cls}"/>`;
    if (minor) {
      for (let x = Math.ceil(x0 / minor) * minor; x <= x1; x += minor) if (Math.abs(x / major - Math.round(x / major)) > 1e-6) h += line(x, y0, x, y1, 'grid-minor');
      for (let y = Math.ceil(y0 / minor) * minor; y <= y1; y += minor) if (Math.abs(y / major - Math.round(y / major)) > 1e-6) h += line(x0, y, x1, y, 'grid-minor');
    }
    for (let x = Math.ceil(x0 / major) * major; x <= x1; x += major) h += line(x, y0, x, y1, Math.abs(x) < 1e-9 ? 'grid-axis' : 'grid-major');
    for (let y = Math.ceil(y0 / major) * major; y <= y1; y += major) h += line(x0, y, x1, y, Math.abs(y) < 1e-9 ? 'grid-axis' : 'grid-major');
    this.g.grid.innerHTML = h;
  }

  renderPreview(): void {
    const px = (n: number) => this.px(n);
    const c = this.cursor;
    let h = '';
    const f = (x: number) => Math.round(x * 1000) / 1000;
    const fs = px(11.5);
    const tag = (p: Vec, text: string) =>
      `<g class="tag"><rect x="${f(p.x + px(10))}" y="${f(p.y + px(8))}" width="${f(px(8 + text.length * 6.6))}" height="${f(px(18))}" rx="${f(px(3))}"/><text x="${f(p.x + px(14))}" y="${f(p.y + px(21))}" font-size="${f(fs)}">${esc(text)}</text></g>`;

    if (this.draft.length) {
      const last = this.draft[this.draft.length - 1];
      const ptsArr = this.draft.map((p) => `${f(p.x)},${f(p.y)}`).join(' ');
      const preset = WALL_PRESETS[this.options.wallPreset] ?? WALL_PRESETS[0];
      if (this.tool === 'wall') {
        if (c) {
          const q = this.snap(c, last);
          h += `<line x1="${f(last.x)}" y1="${f(last.y)}" x2="${f(q.x)}" y2="${f(q.y)}" stroke-width="${preset.thickness}" class="draft-wall"/>`;
          h += tag(q, this.typed ? `${this.typed} m ↵` : `${num(dist(last, q), 2)} m`);
        }
      } else if (this.tool === 'route') {
        if (c) {
          const q = this.snap(c, last);
          h += `<polyline points="${ptsArr} ${f(q.x)},${f(q.y)}" class="draft-route"/>`;
        } else h += `<polyline points="${ptsArr}" class="draft-route"/>`;
      } else {
        const q = c ? (this.tool === 'calibrate' ? c : this.snap(c, last)) : null;
        h += `<polyline points="${ptsArr}${q ? ` ${f(q.x)},${f(q.y)}` : ''}" class="draft-line"/>`;
        if (this.tool === 'room' && q && this.draft.length >= 2) h += `<polygon points="${ptsArr} ${f(q.x)},${f(q.y)}" class="draft-fill"/>`;
        if (q) h += tag(q, this.typed ? `${this.typed} m ↵` : `${num(dist(last, q), 2)} m`);
      }
      for (const p of this.draft) h += `<circle cx="${f(p.x)}" cy="${f(p.y)}" r="${f(px(3.5))}" class="draft-pt"/>`;
    }
    if (this.drag?.type === 'rect' && c) {
      const a = this.drag.start;
      const b = this.snap(c, null);
      h += `<rect x="${f(Math.min(a.x, b.x))}" y="${f(Math.min(a.y, b.y))}" width="${f(Math.abs(b.x - a.x))}" height="${f(Math.abs(b.y - a.y))}" class="draft-fill draft-line"/>`;
      h += tag(b, `${num(Math.abs(b.x - a.x), 2)} × ${num(Math.abs(b.y - a.y), 2)} m`);
    }
    if (this.measureResult) {
      const [a, b] = this.measureResult;
      h += `<line x1="${f(a.x)}" y1="${f(a.y)}" x2="${f(b.x)}" y2="${f(b.y)}" class="measure"/>`;
      h += tag(b, `${num(dist(a, b), 3)} m`);
    }
    // Fangsymbol
    const drawingTools: Tool[] = ['wall', 'room', 'rect', 'manifold', 'heatSource', 'route', 'measure'];
    if (c && drawingTools.includes(this.tool) && !this.drag) {
      const last = this.draft.length ? this.draft[this.draft.length - 1] : null;
      const q = this.snap(c, last);
      const s = px(5);
      if (this.snapKind === 'vertex') h += `<rect x="${f(q.x - s)}" y="${f(q.y - s)}" width="${f(2 * s)}" height="${f(2 * s)}" class="snap-vertex"/>`;
      else h += `<path d="M${f(q.x - s)} ${f(q.y)}H${f(q.x + s)}M${f(q.x)} ${f(q.y - s)}V${f(q.y + s)}" class="snap-cross"/>`;
    }
    this.g.preview.innerHTML = h;
  }
}

function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
}

export function findRoom(floors: Floor[], id: string): Room | undefined {
  for (const f of floors) {
    const r = f.rooms.find((x) => x.id === id);
    if (r) return r;
  }
  return undefined;
}

/** Geschoss unterhalb (sonst oberhalb) zum Durchpausen */
export function ghostFloor(floors: Floor[], active: Floor): Floor | null {
  const sorted = floors.slice().sort((a, b) => a.elevation - b.elevation);
  const i = sorted.findIndex((f) => f.id === active.id);
  return sorted[i - 1] ?? sorted[i + 1] ?? null;
}
