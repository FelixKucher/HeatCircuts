import type { Floor, FloorVoid, HeatingSurface, ImageStore, Opening, Project, Room, Vec, Wall } from '../model/types';
import type { DesignResult, RoomResult } from '../calc/design';
import type { Selection } from '../model/store';
import { BEND_RADIUS_FACTOR, PIPES } from '../model/catalog';
import { add, centroid, cross, dist, mul, norm, sub, v } from '../geometry/geom';
import { generateLayout, splitPolygon, type CircuitDrawing } from '../geometry/layout';
import { pipePathD } from '../geometry/pipepath';
import { subtractVoids } from '../geometry/subtract';
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
  voids: string;
  circuits: string;
  feeders: string;
  walls: string;
  openings: string;
  objects: string;
  labels: string;
  handles: string;
}

const f = (x: number) => (Math.round(x * 1000) / 1000).toString();
const pts = (p: Vec[]) => p.map((q) => `${f(q.x)},${f(q.y)}`).join(' ');
const pathD = (p: Vec[], close = false) => (p.length ? `M${p.map((q) => `${f(q.x)} ${f(q.y)}`).join('L')}${close ? 'Z' : ''}` : '');

/** SVG-Definitionen (Schraffur der Elektro-Heizmatte), einmal je Dokument */
export const SVG_DEFS = `<defs>
  <pattern id="hc-elmat" patternUnits="userSpaceOnUse" width="0.16" height="0.16" patternTransform="rotate(45)">
    <line x1="0" y1="0" x2="0" y2="0.16" class="elmat-line" stroke-width="0.025"/>
  </pattern>
  <pattern id="hc-ceil" patternUnits="userSpaceOnUse" width="0.3" height="0.3">
    <circle cx="0.15" cy="0.15" r="0.025" class="ceil-dot"/>
  </pattern>
</defs>`;

const circuitCache = new Map<string, CircuitDrawing[]>();

export function circuitDrawings(poly: Vec[], n: number, spacing: number, pattern: HeatingSurface['pattern'], wallDistance: number, connector: Vec | null): CircuitDrawing[] {
  const key = JSON.stringify([poly, spacing, pattern, n, wallDistance, connector]);
  const hit = circuitCache.get(key);
  if (hit) return hit;
  const entry = connector ?? poly[0];
  const parts = splitPolygon(poly, Math.max(1, n));
  const res = parts.map((part) => generateLayout(part, spacing, wallDistance, pattern, entry));
  if (circuitCache.size > 400) circuitCache.clear();
  circuitCache.set(key, res);
  return res;
}

function offsetPolyline(p: Vec[], d: number): Vec[] {
  if (p.length < 2) return p;
  return p.map((q, i) => {
    const a = p[Math.max(0, i - 1)];
    const b = p[Math.min(p.length - 1, i + 1)];
    const t = norm(sub(b, a));
    return add(q, mul(v(-t.y, t.x), d));
  });
}

function roomFillClass(r: RoomResult | undefined, room: Room): string {
  if (!room.heated) return room.type === 'garage' ? 'room-unheated garage' : 'room-unheated';
  if (!r) return 'room';
  if (r.warnings.includes('undersupplied') || r.warnings.includes('q-exceeds-limit')) return 'room room-warn';
  return 'room';
}

/** Lage einer Öffnung auf der Wandachse */
export function openingSegment(w: Wall, o: Opening): [Vec, Vec] {
  const dir = norm(sub(w.b, w.a));
  return [add(w.a, mul(dir, o.offset - o.width / 2)), add(w.a, mul(dir, o.offset + o.width / 2))];
}

function openingMarkup(w: Wall, o: Opening, selected: boolean, px: (n: number) => number): string {
  const [p1, p2] = openingSegment(w, o);
  const dir = norm(sub(w.b, w.a));
  const n = v(-dir.y, dir.x);
  const t = w.thickness / 2;
  const corner = (p: Vec, s: number) => add(p, mul(n, s * (t + 0.005)));
  const rect = [corner(p1, 1), corner(p2, 1), corner(p2, -1), corner(p1, -1)];
  let h = `<polygon points="${pts(rect)}" class="opening-cut${selected ? ' is-selected' : ''}" data-kind="opening" data-id="${w.id}|${o.id}"/>`;
  if (o.kind === 'window') {
    for (const s of [-0.5, 0, 0.5]) h += `<line x1="${f(add(p1, mul(n, s * t)).x)}" y1="${f(add(p1, mul(n, s * t)).y)}" x2="${f(add(p2, mul(n, s * t)).x)}" y2="${f(add(p2, mul(n, s * t)).y)}" class="window-line"/>`;
  } else if (o.kind === 'garage') {
    h += `<line x1="${f(p1.x)}" y1="${f(p1.y)}" x2="${f(p2.x)}" y2="${f(p2.y)}" class="garage-line"/>`;
  } else {
    // Türblatt und Öffnungsbogen
    const r = o.width;
    const leafEnd = add(p1, mul(n, r));
    h += `<line x1="${f(p1.x)}" y1="${f(p1.y)}" x2="${f(leafEnd.x)}" y2="${f(leafEnd.y)}" class="door-leaf${o.kind === 'entrance' ? ' entrance' : ''}"/>`;
    const sweep = cross(dir, n) > 0 ? 0 : 1;
    h += `<path d="M${f(leafEnd.x)} ${f(leafEnd.y)}A${f(r)} ${f(r)} 0 0 ${sweep} ${f(p2.x)} ${f(p2.y)}" class="door-arc"/>`;
  }
  void px;
  return h;
}

function voidMarkup(vd: FloorVoid, selected: boolean): string {
  const sel = selected ? ' is-selected' : '';
  let h = `<polygon points="${pts(vd.polygon)}" class="void void-${vd.kind}${sel}" data-kind="void" data-id="${vd.id}"/>`;
  if (vd.kind === 'spiral' && vd.center && vd.radius) {
    const c = vd.center;
    for (let k = 0; k < 14; k++) {
      const a = (k / 14) * Math.PI * 2;
      const p = add(c, v(Math.cos(a) * vd.radius, Math.sin(a) * vd.radius));
      const q = add(c, v(Math.cos(a) * 0.1, Math.sin(a) * 0.1));
      h += `<line x1="${f(q.x)}" y1="${f(q.y)}" x2="${f(p.x)}" y2="${f(p.y)}" class="stair-line"/>`;
    }
    h += `<circle cx="${f(c.x)}" cy="${f(c.y)}" r="0.1" class="stair-post"/>`;
  } else if (vd.kind === 'stair') {
    const xs = vd.polygon.map((p) => p.x);
    const ys = vd.polygon.map((p) => p.y);
    const x0 = Math.min(...xs);
    const x1 = Math.max(...xs);
    const y0 = Math.min(...ys);
    const y1 = Math.max(...ys);
    const alongY = vd.direction ? vd.direction.startsWith('y') : y1 - y0 >= x1 - x0;
    const len = alongY ? y1 - y0 : x1 - x0;
    const steps = Math.max(3, Math.round(len / 0.27));
    for (let k = 1; k < steps; k++) {
      const t = (k / steps) * len;
      h += alongY
        ? `<line x1="${f(x0)}" y1="${f(y0 + t)}" x2="${f(x1)}" y2="${f(y0 + t)}" class="stair-line"/>`
        : `<line x1="${f(x0 + t)}" y1="${f(y0)}" x2="${f(x0 + t)}" y2="${f(y1)}" class="stair-line"/>`;
    }
    const up = vd.direction === 'y-' || vd.direction === 'x-' ? -1 : 1;
    const cx = (x0 + x1) / 2;
    const cy = (y0 + y1) / 2;
    const a = alongY ? v(cx, cy - (up * len) / 2.6) : v(cx - (up * len) / 2.6, cy);
    const b = alongY ? v(cx, cy + (up * len) / 2.6) : v(cx + (up * len) / 2.6, cy);
    const dirv = norm(sub(b, a));
    const nv = v(-dirv.y, dirv.x);
    const head1 = add(sub(b, mul(dirv, 0.18)), mul(nv, 0.1));
    const head2 = sub(sub(b, mul(dirv, 0.18)), mul(nv, 0.1));
    h += `<path d="M${f(a.x)} ${f(a.y)}L${f(b.x)} ${f(b.y)}M${f(head1.x)} ${f(head1.y)}L${f(b.x)} ${f(b.y)}L${f(head2.x)} ${f(head2.y)}" class="stair-arrow"/>`;
  } else {
    const xs = vd.polygon.map((p) => p.x);
    const ys = vd.polygon.map((p) => p.y);
    h += `<path d="M${f(Math.min(...xs))} ${f(Math.min(...ys))}L${f(Math.max(...xs))} ${f(Math.max(...ys))}M${f(Math.max(...xs))} ${f(Math.min(...ys))}L${f(Math.min(...xs))} ${f(Math.max(...ys))}" class="void-cross"/>`;
  }
  return h;
}

/** Heizband einer Wandheizung im Grundriss (Raumseite der Wand) */
export function wallHeatSegment(w: Wall, room: Room, s: HeatingSurface): [Vec, Vec, Vec] | null {
  if (!s.field) return null;
  const dir = norm(sub(w.b, w.a));
  const n = v(-dir.y, dir.x);
  const c = centroid(room.polygon);
  const side = cross(dir, sub(c, w.a)) > 0 ? 1 : -1;
  const off = mul(n, side * (w.thickness / 2 + 0.06));
  return [add(add(w.a, mul(dir, s.field.x0)), off), add(add(w.a, mul(dir, s.field.x1)), off), mul(n, side)];
}

export function renderLayers(o: RenderInput): RenderLayers {
  const { floor, design, project, scale } = o;
  const px = (n: number) => n / scale;
  const sel = o.selection;
  const L: RenderLayers = { ghost: '', rooms: '', voids: '', circuits: '', feeders: '', walls: '', openings: '', objects: '', labels: '', handles: '' };

  if (o.ghost) {
    L.ghost = o.ghost.walls
      .map((w) => `<line x1="${f(w.a.x)}" y1="${f(w.a.y)}" x2="${f(w.b.x)}" y2="${f(w.b.y)}" stroke-width="${f(w.thickness)}" class="ghost-wall"/>`)
      .join('');
    L.ghost += o.ghost.voids.map((vd) => `<polygon points="${pts(vd.polygon)}" class="ghost-void"/>`).join('');
  }

  // Räume und Elektro-/Deckenflächen
  for (const room of floor.rooms) {
    const r = design.rooms.get(room.id);
    const isSel = sel?.kind === 'room' && sel.id === room.id;
    L.rooms += `<polygon points="${pts(room.polygon)}" class="${roomFillClass(r, room)}${isSel ? ' is-selected' : ''}" data-kind="room" data-id="${room.id}"/>`;
    if (!room.heated) continue;
    for (const s of room.surfaces) {
      if (s.kind === 'floor' && s.system === 'electric') L.rooms += `<polygon points="${pts(subtractVoids(room.polygon, floor.voids))}" class="elmat" fill="url(#hc-elmat)"/>`;
      if (s.kind === 'ceiling') L.rooms += `<polygon points="${pts(room.polygon)}" class="ceil-area" fill="url(#hc-ceil)"/>`;
    }
  }

  for (const vd of floor.voids) L.voids += voidMarkup(vd, sel?.kind === 'void' && sel.id === vd.id);

  // Heizkreise (nur Wasser-Fußbodenflächen mit zugeordnetem Verteiler)
  if (o.showCircuits) {
    for (const room of floor.rooms) {
      const r = design.rooms.get(room.id);
      if (!r) continue;
      for (const sr of r.surfaces) {
        if (sr.kind !== 'floor' || sr.medium !== 'water' || sr.circuits.length === 0) continue;
        const s = room.surfaces.find((x) => x.id === sr.surfaceId)!;
        const poly = subtractVoids(room.polygon, floor.voids);
        const pipe = PIPES[sr.pipe] ?? PIPES['16x2'];
        const radius = BEND_RADIUS_FACTOR * pipe.outer;
        const drawings = circuitDrawings(poly, sr.circuits.length, s.spacing, s.pattern, project.design.wallDistance, r.connector);
        drawings.forEach((dw, i) => {
          const alt = i % 2 === 0 ? '' : ' alt';
          for (const line of dw.supply) L.circuits += `<path d="${pipePathD(line, radius)}" class="pipe-supply${alt}"/>`;
          for (const line of dw.ret) L.circuits += `<path d="${pipePathD(line, radius)}" class="pipe-return${alt}"/>`;
          if (r.connector && dw.inlet) L.circuits += `<path d="${pathD([r.connector, dw.inlet])}" class="pipe-supply link"/>`;
          if (r.connector && dw.outlet) L.circuits += `<path d="${pathD([dw.outlet, r.connector])}" class="pipe-return link"/>`;
        });
      }
    }
  }

  // Anbindeleitungen Raum → Verteiler
  for (const room of floor.rooms) {
    const r = design.rooms.get(room.id);
    if (!r || r.circuits.length === 0 || r.feederPath.length < 2) continue;
    const sameFloor = r.manifoldFloorId === floor.id;
    const off = Math.max(0.03, px(2.5));
    const isSel = sel?.kind === 'room' && sel.id === room.id;
    const cls = `${sameFloor ? '' : ' other-floor'}${isSel ? ' is-selected' : ''}`;
    L.feeders += `<path d="${pipePathD(offsetPolyline(r.feederPath, off), 0.1)}" class="feeder-supply${cls}"/>`;
    L.feeders += `<path d="${pipePathD(offsetPolyline(r.feederPath, -off), 0.1)}" class="feeder-return${cls}"/>`;
    const route = floor.routes.find((x) => x.roomId === room.id);
    if (route) L.feeders += `<path d="${pathD(r.feederPath)}" class="route-hit" data-kind="route" data-id="${route.id}"/>`;
  }

  const hs = project.heatSource;
  for (const m of floor.manifolds) {
    const mr = design.manifolds.find((x) => x.manifoldId === m.id);
    if (!hs || !mr || hs.floorId !== floor.id) continue;
    const path = Math.abs(hs.pos.x - m.pos.x) < 1e-6 || Math.abs(hs.pos.y - m.pos.y) < 1e-6 ? [m.pos, hs.pos] : [m.pos, v(hs.pos.x, m.pos.y), hs.pos];
    L.feeders += `<path d="${pipePathD(path, 0.2)}" class="main-line"/>`;
  }

  // Wände, Wandheizflächen, Öffnungen
  for (const w of floor.walls) {
    const isSel = sel?.kind === 'wall' && sel.id === w.id;
    L.walls += `<line x1="${f(w.a.x)}" y1="${f(w.a.y)}" x2="${f(w.b.x)}" y2="${f(w.b.y)}" stroke-width="${f(w.thickness)}" class="wall wall-${w.kind}${isSel ? ' is-selected' : ''}"/>`;
    L.walls += `<line x1="${f(w.a.x)}" y1="${f(w.a.y)}" x2="${f(w.b.x)}" y2="${f(w.b.y)}" stroke-width="${f(Math.max(w.thickness, px(10)))}" class="hit" data-kind="wall" data-id="${w.id}"/>`;
    for (const op of w.openings) L.openings += openingMarkup(w, op, sel?.kind === 'opening' && sel.id === `${w.id}|${op.id}`, px);
  }
  for (const room of floor.rooms) {
    if (!room.heated) continue;
    for (const s of room.surfaces) {
      if (s.kind !== 'wall') continue;
      const w = floor.walls.find((x) => x.id === s.wallId);
      if (!w) continue;
      const seg = wallHeatSegment(w, room, s);
      if (!seg) continue;
      L.openings += `<line x1="${f(seg[0].x)}" y1="${f(seg[0].y)}" x2="${f(seg[1].x)}" y2="${f(seg[1].y)}" class="wall-heat${s.system === 'wall_dry' ? ' dry' : ''}" data-kind="wallheat" data-id="${room.id}|${s.id}"/>`;
    }
  }

  // Verteiler und Wärmeerzeuger
  for (const m of floor.manifolds) {
    const isSel = sel?.kind === 'manifold' && sel.id === m.id;
    const mr = design.manifolds.find((x) => x.manifoldId === m.id);
    const wdt = Math.max(0.35, 0.06 * Math.max(2, mr?.outlets ?? 2) + 0.2);
    const full = mr && mr.outlets > mr.maxOutlets ? ' over' : '';
    L.objects += `<g class="manifold${isSel ? ' is-selected' : ''}${full}" data-kind="manifold" data-id="${m.id}">
      <rect x="${f(m.pos.x - wdt / 2)}" y="${f(m.pos.y - 0.08)}" width="${f(wdt)}" height="0.16" rx="0.02"/>
      <line x1="${f(m.pos.x - wdt / 2 + 0.04)}" y1="${f(m.pos.y - 0.03)}" x2="${f(m.pos.x + wdt / 2 - 0.04)}" y2="${f(m.pos.y - 0.03)}" class="bar-s"/>
      <line x1="${f(m.pos.x - wdt / 2 + 0.04)}" y1="${f(m.pos.y + 0.03)}" x2="${f(m.pos.x + wdt / 2 - 0.04)}" y2="${f(m.pos.y + 0.03)}" class="bar-r"/>
      <circle cx="${f(m.pos.x)}" cy="${f(m.pos.y)}" r="${f(Math.max(0.25, px(12)))}" class="hit"/>
    </g>`;
    if (hs && hs.floorId !== floor.id) L.objects += `<g class="riser"><circle cx="${f(m.pos.x + wdt / 2 + 0.15)}" cy="${f(m.pos.y)}" r="0.09"/><path d="M${f(m.pos.x + wdt / 2 + 0.15)} ${f(m.pos.y - 0.05)}v0.1"/></g>`;
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
        if (r.hasHeating) {
          const parts = r.surfaces
            .filter((s) => s.area > 0.3)
            .map((s) => (s.medium === 'electric' ? 'Elektro' : `${s.kind === 'floor' ? '' : s.kind === 'wall' ? 'Wand ' : 'Decke '}VA ${num(s.spacing * 100, 1).replace(/,0$/, '')}`));
          lines.push([`${num(r.heatLoad.total, 0)} W · ${parts.join(' + ')}${r.circuits.length ? ` · ${r.circuits.length} HK` : ''}`, 'lbl']);
          if (r.deficit > 5) lines.push([`fehlt ${num(r.deficit, 0)} W`, 'lbl lbl-warn']);
        } else if (!room.heated) lines.push([room.type === 'garage' ? 'Garage, unbeheizt' : 'unbeheizt', 'lbl lbl-muted']);
      }
      const lh = fs * 1.3;
      const y0 = c.y - ((lines.length - 1) * lh) / 2;
      L.labels += `<g class="room-label">${lines
        .map(([t, cls], i) => `<text x="${f(c.x)}" y="${f(y0 + i * lh)}" font-size="${f(i === 0 ? fs * 1.08 : fsSmall)}" class="${cls}">${esc(t)}</text>`)
        .join('')}</g>`;
    }
    for (const m of floor.manifolds) {
      const mr = design.manifolds.find((x) => x.manifoldId === m.id);
      const sub2 = mr ? `${mr.outlets}/${mr.maxOutlets} HK · ${num(mr.massFlow, 0)} kg/h` : '';
      L.labels += `<text x="${f(m.pos.x)}" y="${f(m.pos.y - 0.16 - px(4))}" font-size="${f(fs)}" class="lbl-title obj">${esc(m.name)}</text>`;
      if (sub2) L.labels += `<text x="${f(m.pos.x)}" y="${f(m.pos.y + 0.16 + px(11))}" font-size="${f(fsSmall)}" class="lbl obj${mr && mr.outlets > mr.maxOutlets ? ' lbl-warn' : ''}">${sub2}</text>`;
      if (mr && hs) {
        const where = hs.floorId === floor.id ? '' : ' (Steigleitung)';
        L.labels += `<text x="${f(m.pos.x)}" y="${f(m.pos.y + 0.16 + px(23))}" font-size="${f(fsSmall)}" class="lbl obj">→ WE ${num(mr.supplyLength, 1)} m${where}</text>`;
      }
    }
    if (hs && hs.floorId === floor.id) L.labels += `<text x="${f(hs.pos.x)}" y="${f(hs.pos.y - 0.3 - px(4))}" font-size="${f(fs)}" class="lbl-title obj">${esc(hs.name)}</text>`;
    for (const room of floor.rooms) {
      const r = design.rooms.get(room.id);
      if (!r || r.circuits.length === 0 || r.feederPath.length < 2 || r.feederLength < 0.3) continue;
      const mid = midpointOfPath(r.feederPath);
      L.labels += `<text x="${f(mid.x)}" y="${f(mid.y - px(5))}" font-size="${f(fsSmall)}" class="lbl lbl-feeder">${r.circuits.length > 1 ? `${r.circuits.length}× ` : ''}2 × ${num(r.feederLength, 1)} m</text>`;
    }
    for (const vd of floor.voids) {
      const c = centroid(vd.polygon);
      const label = vd.kind === 'spiral' ? 'Spindeltreppe' : vd.kind === 'stair' ? 'Treppe' : 'Luftraum';
      L.labels += `<text x="${f(c.x)}" y="${f(c.y)}" font-size="${f(fsSmall)}" class="lbl lbl-muted">${label}</text>`;
    }
  }

  // Griffe
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
      if (r?.connector && r.circuits.length) {
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
  } else if (sel?.kind === 'void') {
    const vd = floor.voids.find((x) => x.id === sel.id);
    if (vd && vd.kind !== 'spiral') {
      const h = px(5);
      vd.polygon.forEach((p, i) => (L.handles += `<rect x="${f(p.x - h)}" y="${f(p.y - h)}" width="${f(2 * h)}" height="${f(2 * h)}" class="handle" data-handle="void-vertex" data-index="${i}"/>`));
    }
  }
  return L;
}

function midpointOfPath(p: Vec[]): Vec {
  let total = 0;
  for (let i = 1; i < p.length; i++) total += dist(p[i], p[i - 1]);
  let acc = 0;
  for (let i = 1; i < p.length; i++) {
    const l = dist(p[i], p[i - 1]);
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
  return {
    min: v(Math.min(...P.map((p) => p.x)), Math.min(...P.map((p) => p.y))),
    max: v(Math.max(...P.map((p) => p.x)), Math.max(...P.map((p) => p.y))),
  };
}
