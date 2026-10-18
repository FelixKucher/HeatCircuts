import type { Floor, ImageStore, Project, Room, Vec } from '../model/types';
import type { DesignResult, RoomResult } from '../calc/design';
import type { Selection } from '../model/store';
import { add, centroid, mul, norm, sub, v } from '../geometry/geom';
import { generateLayout, splitPolygon, type CircuitDrawing } from '../geometry/layout';
import { esc, num } from './format';

export interface RenderInput {
  project: Project;
  floor: Floor;
  design: DesignResult;
  images: ImageStore;
  /** Pixel pro Meter */
  scale: number;
  selection: Selection | null;
  showCircuits: boolean;
  showLabels: boolean;
  ghost: Floor | null;
}

export interface RenderLayers {
  ghost: string;
  rooms: string;
  circuits: string;
  feeders: string;
  walls: string;
  objects: string;
  labels: string;
  handles: string;
}

const f = (x: number) => (Math.round(x * 1000) / 1000).toString();
const pts = (p: Vec[]) => p.map((q) => `${f(q.x)},${f(q.y)}`).join(' ');
const pathD = (p: Vec[], close = false) => (p.length ? `M${p.map((q) => `${f(q.x)} ${f(q.y)}`).join('L')}${close ? 'Z' : ''}` : '');

const circuitCache = new Map<string, CircuitDrawing[]>();

export function circuitDrawings(room: Room, n: number, wallDistance: number, connector: Vec | null): CircuitDrawing[] {
  const key = JSON.stringify([room.polygon, room.spacing, room.pattern, n, wallDistance, connector]);
  const hit = circuitCache.get(key);
  if (hit) return hit;
  const entry = connector ?? room.polygon[0];
  const parts = splitPolygon(room.polygon, Math.max(1, n));
  const res = parts.map((part) => generateLayout(part, room.spacing, wallDistance, room.pattern, entry));
  if (circuitCache.size > 400) circuitCache.clear();
  circuitCache.set(key, res);
  return res;
}

function offsetPolyline(p: Vec[], d: number): Vec[] {
  if (p.length < 2) return p;
  const out: Vec[] = [];
  for (let i = 0; i < p.length; i++) {
    const a = p[Math.max(0, i - 1)];
    const b = p[Math.min(p.length - 1, i + 1)];
    const t = norm(sub(b, a));
    out.push(add(p[i], mul(v(-t.y, t.x), d)));
  }
  return out;
}

function roomFillClass(r: RoomResult | undefined, room: Room): string {
  if (!room.heated) return 'room-unheated';
  if (!r) return 'room';
  if (r.warnings.includes('undersupplied') || r.warnings.includes('q-exceeds-limit')) return 'room room-warn';
  return 'room';
}

export function renderLayers(o: RenderInput): RenderLayers {
  const { floor, design, project, scale } = o;
  const px = (n: number) => n / scale; // Bildschirmpixel → Meter
  const sel = o.selection;
  const L: RenderLayers = { ghost: '', rooms: '', circuits: '', feeders: '', walls: '', objects: '', labels: '', handles: '' };

  if (o.ghost) {
    L.ghost = o.ghost.walls
      .map((w) => `<line x1="${f(w.a.x)}" y1="${f(w.a.y)}" x2="${f(w.b.x)}" y2="${f(w.b.y)}" stroke-width="${f(w.thickness)}" class="ghost-wall"/>`)
      .join('');
  }

  // Räume
  for (const room of floor.rooms) {
    const r = design.rooms.get(room.id);
    const isSel = sel?.kind === 'room' && sel.id === room.id;
    L.rooms += `<polygon points="${pts(room.polygon)}" class="${roomFillClass(r, room)}${isSel ? ' is-selected' : ''}" data-kind="room" data-id="${room.id}"/>`;
  }

  // Heizkreise
  if (o.showCircuits) {
    for (const room of floor.rooms) {
      const r = design.rooms.get(room.id);
      if (!r || !r.hasFloorHeating || r.circuits.length === 0) continue;
      const drawings = circuitDrawings(room, r.circuits.length, project.design.wallDistance, r.connector);
      drawings.forEach((dw, i) => {
        const hue = i % 2 === 0 ? '' : ' alt';
        for (const s of dw.supply) L.circuits += `<path d="${pathD(s)}" class="pipe-supply${hue}"/>`;
        for (const s of dw.ret) L.circuits += `<path d="${pathD(s)}" class="pipe-return${hue}"/>`;
        if (r.connector && dw.inlet) L.circuits += `<path d="${pathD([r.connector, dw.inlet])}" class="pipe-supply link"/>`;
        if (r.connector && dw.outlet) L.circuits += `<path d="${pathD([dw.outlet, r.connector])}" class="pipe-return link"/>`;
      });
    }
  }

  // Anbindeleitungen Raum → Verteiler
  for (const room of floor.rooms) {
    const r = design.rooms.get(room.id);
    if (!r || !r.hasFloorHeating || r.feederPath.length < 2) continue;
    const sameFloor = r.manifoldFloorId === floor.id;
    const off = Math.max(0.03, px(2.5));
    const isSel = sel?.kind === 'room' && sel.id === room.id;
    L.feeders += `<path d="${pathD(offsetPolyline(r.feederPath, off))}" class="feeder-supply${sameFloor ? '' : ' other-floor'}${isSel ? ' is-selected' : ''}"/>`;
    L.feeders += `<path d="${pathD(offsetPolyline(r.feederPath, -off))}" class="feeder-return${sameFloor ? '' : ' other-floor'}${isSel ? ' is-selected' : ''}"/>`;
    const route = floor.routes.find((x) => x.roomId === room.id);
    if (route) L.feeders += `<path d="${pathD(r.feederPath)}" class="route-hit" data-kind="route" data-id="${route.id}"/>`;
  }

  // Leitung Verteiler → Wärmeerzeuger
  const hs = project.heatSource;
  for (const m of floor.manifolds) {
    const mr = design.manifolds.find((x) => x.manifoldId === m.id);
    if (!hs || !mr) continue;
    if (hs.floorId === floor.id) {
      const path = Math.abs(hs.pos.x - m.pos.x) < 1e-6 || Math.abs(hs.pos.y - m.pos.y) < 1e-6 ? [m.pos, hs.pos] : [m.pos, v(hs.pos.x, m.pos.y), hs.pos];
      L.feeders += `<path d="${pathD(path)}" class="main-line"/>`;
    }
  }

  // Wände
  for (const w of floor.walls) {
    const isSel = sel?.kind === 'wall' && sel.id === w.id;
    L.walls += `<line x1="${f(w.a.x)}" y1="${f(w.a.y)}" x2="${f(w.b.x)}" y2="${f(w.b.y)}" stroke-width="${f(w.thickness)}" class="wall wall-${w.kind}${isSel ? ' is-selected' : ''}"/>`;
    L.walls += `<line x1="${f(w.a.x)}" y1="${f(w.a.y)}" x2="${f(w.b.x)}" y2="${f(w.b.y)}" stroke-width="${f(Math.max(w.thickness, px(10)))}" class="hit" data-kind="wall" data-id="${w.id}"/>`;
  }

  // Verteiler (maßstäblich ca. 0,6 × 0,12 m) und Wärmeerzeuger (0,6 × 0,6 m)
  for (const m of floor.manifolds) {
    const isSel = sel?.kind === 'manifold' && sel.id === m.id;
    const mr = design.manifolds.find((x) => x.manifoldId === m.id);
    const wdt = Math.max(0.35, 0.06 * Math.max(2, mr?.outlets ?? 2) + 0.2);
    L.objects += `<g class="manifold${isSel ? ' is-selected' : ''}" data-kind="manifold" data-id="${m.id}">
      <rect x="${f(m.pos.x - wdt / 2)}" y="${f(m.pos.y - 0.08)}" width="${f(wdt)}" height="0.16" rx="0.02"/>
      <line x1="${f(m.pos.x - wdt / 2 + 0.04)}" y1="${f(m.pos.y - 0.03)}" x2="${f(m.pos.x + wdt / 2 - 0.04)}" y2="${f(m.pos.y - 0.03)}" class="bar-s"/>
      <line x1="${f(m.pos.x - wdt / 2 + 0.04)}" y1="${f(m.pos.y + 0.03)}" x2="${f(m.pos.x + wdt / 2 - 0.04)}" y2="${f(m.pos.y + 0.03)}" class="bar-r"/>
      <circle cx="${f(m.pos.x)}" cy="${f(m.pos.y)}" r="${f(Math.max(0.25, px(12)))}" class="hit"/>
    </g>`;
    if (hs && hs.floorId !== floor.id) {
      L.objects += `<g class="riser"><circle cx="${f(m.pos.x + wdt / 2 + 0.15)}" cy="${f(m.pos.y)}" r="0.09"/><path d="M${f(m.pos.x + wdt / 2 + 0.15)} ${f(m.pos.y - 0.05)}v0.1"/></g>`;
    }
  }
  if (hs && hs.floorId === floor.id) {
    const isSel = sel?.kind === 'heatSource';
    const s = 0.6;
    L.objects += `<g class="heat-source${isSel ? ' is-selected' : ''}" data-kind="heatSource" data-id="hs">
      <rect x="${f(hs.pos.x - s / 2)}" y="${f(hs.pos.y - s / 2)}" width="${s}" height="${s}" rx="0.04"/>
      <path d="M${f(hs.pos.x - 0.16)} ${f(hs.pos.y + 0.12)} Q${f(hs.pos.x - 0.05)} ${f(hs.pos.y - 0.05)} ${f(hs.pos.x)} ${f(hs.pos.y + 0.02)} T${f(hs.pos.x + 0.16)} ${f(hs.pos.y - 0.12)}" class="flame"/>
      <circle cx="${f(hs.pos.x)}" cy="${f(hs.pos.y)}" r="${f(Math.max(0.35, px(14)))}" class="hit"/>
    </g>`;
  }

  // Beschriftungen
  if (o.showLabels) {
    const fs = px(11.5);
    const fsSmall = px(10.5);
    for (const room of floor.rooms) {
      const r = design.rooms.get(room.id);
      const c = centroid(room.polygon);
      const lines: [string, string][] = [[room.name, 'lbl-title']];
      if (r) {
        lines.push([`${num(r.area, 2)} m² · ${num(room.thetaI, 0)} °C`, 'lbl']);
        if (r.hasFloorHeating) {
          lines.push([`${num(r.heatLoad.total, 0)} W · VA ${num(room.spacing * 100, 1).replace(/,0$/, '')} · ${r.circuits.length} HK`, 'lbl']);
          if (r.deficit > 5) lines.push([`fehlt ${num(r.deficit, 0)} W`, 'lbl lbl-warn']);
        } else if (!room.heated) lines.push(['unbeheizt', 'lbl lbl-muted']);
      }
      const lh = fs * 1.3;
      const y0 = c.y - ((lines.length - 1) * lh) / 2;
      L.labels += `<g class="room-label">${lines
        .map(([t, cls], i) => `<text x="${f(c.x)}" y="${f(y0 + i * lh)}" font-size="${f(i === 0 ? fs * 1.08 : fsSmall)}" class="${cls}">${esc(t)}</text>`)
        .join('')}</g>`;
    }
    for (const m of floor.manifolds) {
      const mr = design.manifolds.find((x) => x.manifoldId === m.id);
      const sub2 = mr ? `${mr.outlets} HK · ${num(mr.massFlow, 0)} kg/h` : '';
      L.labels += `<text x="${f(m.pos.x)}" y="${f(m.pos.y - 0.16 - px(4))}" font-size="${f(fs)}" class="lbl-title obj">${esc(m.name)}</text>`;
      if (sub2) L.labels += `<text x="${f(m.pos.x)}" y="${f(m.pos.y + 0.16 + px(11))}" font-size="${f(fsSmall)}" class="lbl obj">${sub2}</text>`;
      if (mr && hs) {
        const where = hs.floorId === floor.id ? '' : ' (Steigleitung)';
        L.labels += `<text x="${f(m.pos.x)}" y="${f(m.pos.y + 0.16 + px(23))}" font-size="${f(fsSmall)}" class="lbl obj">→ WE ${num(mr.supplyLength, 1)} m${where}</text>`;
      }
    }
    if (hs && hs.floorId === floor.id) {
      L.labels += `<text x="${f(hs.pos.x)}" y="${f(hs.pos.y - 0.3 - px(4))}" font-size="${f(fs)}" class="lbl-title obj">${esc(hs.name)}</text>`;
    }
    // Anbindelängen
    for (const room of floor.rooms) {
      const r = design.rooms.get(room.id);
      if (!r || !r.hasFloorHeating || r.feederPath.length < 2 || r.feederLength < 0.3) continue;
      const mid = midpointOfPath(r.feederPath);
      L.labels += `<text x="${f(mid.x)}" y="${f(mid.y - px(5))}" font-size="${f(fsSmall)}" class="lbl lbl-feeder">${r.circuits.length > 1 ? `${r.circuits.length}× ` : ''}2 × ${num(r.feederLength, 1)} m</text>`;
    }
  }

  // Griffe der Auswahl
  if (sel?.kind === 'room') {
    const room = floor.rooms.find((x) => x.id === sel.id);
    const r = design.rooms.get(sel.id);
    if (room) {
      const h = px(5);
      room.polygon.forEach((p, i) => {
        L.handles += `<rect x="${f(p.x - h)}" y="${f(p.y - h)}" width="${f(2 * h)}" height="${f(2 * h)}" class="handle" data-handle="vertex" data-index="${i}"/>`;
      });
      room.polygon.forEach((p, i) => {
        const q = room.polygon[(i + 1) % room.polygon.length];
        const mid = mul(add(p, q), 0.5);
        L.handles += `<circle cx="${f(mid.x)}" cy="${f(mid.y)}" r="${f(px(3.5))}" class="handle-mid" data-handle="mid" data-index="${i}"/>`;
      });
      if (r?.connector) {
        const c = r.connector;
        const s = px(7);
        L.handles += `<path d="M${f(c.x)} ${f(c.y - s)}L${f(c.x + s)} ${f(c.y)}L${f(c.x)} ${f(c.y + s)}L${f(c.x - s)} ${f(c.y)}Z" class="handle-connector" data-handle="connector"/>`;
      }
      const route = floor.routes.find((x) => x.roomId === room.id);
      route?.points.forEach((p, i) => {
        L.handles += `<circle cx="${f(p.x)}" cy="${f(p.y)}" r="${f(px(5))}" class="handle" data-handle="route" data-index="${i}" data-route="${route.id}"/>`;
      });
    }
  } else if (sel?.kind === 'wall') {
    const w = floor.walls.find((x) => x.id === sel.id);
    if (w) {
      const r = px(6);
      L.handles += `<circle cx="${f(w.a.x)}" cy="${f(w.a.y)}" r="${f(r)}" class="handle" data-handle="wall-a"/>`;
      L.handles += `<circle cx="${f(w.b.x)}" cy="${f(w.b.y)}" r="${f(r)}" class="handle" data-handle="wall-b"/>`;
    }
  }
  return L;
}

function midpointOfPath(p: Vec[]): Vec {
  let total = 0;
  for (let i = 1; i < p.length; i++) total += Math.hypot(p[i].x - p[i - 1].x, p[i].y - p[i - 1].y);
  let acc = 0;
  for (let i = 1; i < p.length; i++) {
    const l = Math.hypot(p[i].x - p[i - 1].x, p[i].y - p[i - 1].y);
    if (acc + l >= total / 2) {
      const t = (total / 2 - acc) / Math.max(l, 1e-9);
      return v(p[i - 1].x + (p[i].x - p[i - 1].x) * t, p[i - 1].y + (p[i].y - p[i - 1].y) * t);
    }
    acc += l;
  }
  return p[0];
}

export function backgroundMarkup(floor: Floor, images: ImageStore): string {
  const bg = floor.background;
  if (!bg || !bg.visible || !images[bg.imageId]) return '';
  const w = bg.widthPx / bg.pxPerM;
  const h = bg.heightPx / bg.pxPerM;
  return `<image href="${images[bg.imageId]}" x="${f(bg.offset.x)}" y="${f(bg.offset.y)}" width="${f(w)}" height="${f(h)}" opacity="${bg.opacity}" preserveAspectRatio="none" class="bg-image"/>`;
}

/** Inhaltsgrenzen eines Geschosses (Wände, Räume, Verteiler, Hintergrund) */
export function floorBounds(floor: Floor, project: Project): { min: Vec; max: Vec } | null {
  const P: Vec[] = [];
  floor.walls.forEach((w) => P.push(w.a, w.b));
  floor.rooms.forEach((r) => P.push(...r.polygon));
  floor.manifolds.forEach((m) => P.push(m.pos));
  if (project.heatSource?.floorId === floor.id) P.push(project.heatSource.pos);
  if (!P.length && floor.background) {
    const bg = floor.background;
    P.push(bg.offset, v(bg.offset.x + bg.widthPx / bg.pxPerM, bg.offset.y + bg.heightPx / bg.pxPerM));
  }
  if (!P.length) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of P) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { min: v(minX, minY), max: v(maxX, maxY) };
}
