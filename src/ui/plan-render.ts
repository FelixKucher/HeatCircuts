// Planinhalt als SVG: Wände mit Gehrung und Öffnungen, Räume, Möbel, Treppen, Maße, Texte.
// Die Heizungsebenen (Kreise, Leitungen, Verteiler) kommen aus render.ts. Klassen mit Präfix „p-“.

import { CATALOG_BY_KEY } from '../cad/furniture';
import { OPENING_STYLES, styleOf } from '../cad/openings';
import { stairGeometry } from '../cad/stairs';
import { endsAt, left, pointOnWall, wallDir, wallLength, wallOutlines, type WallOutline } from '../cad/walls';
import { COVERINGS } from '../model/catalog';
import type { Floor, FloorFinish, Furniture, Opening, Project, Room, Stair, Vec, Wall } from '../model/types';
import type { Phase, SelItem } from '../model/store';
import type { DesignResult } from '../calc/design';
import { add, area, centroid, dist, mul, norm, sub } from '../geometry/geom';

export const fmt = (x: number, d = 2): string => x.toFixed(d).replace('.', ',');
export const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const P = (p: Vec) => `${p.x.toFixed(4)},${p.y.toFixed(4)}`;
const poly = (pts: Vec[]) => pts.map(P).join(' ');
const ln = (a: Vec, b: Vec, cls = '') => `<line x1="${a.x.toFixed(4)}" y1="${a.y.toFixed(4)}" x2="${b.x.toFixed(4)}" y2="${b.y.toFixed(4)}"${cls ? ` class="${cls}"` : ''}/>`;
const pl = (pts: Vec[], cls = '') => `<polyline points="${poly(pts)}"${cls ? ` class="${cls}"` : ''}/>`;

export const FINISH_COLORS: Record<FloorFinish, { label: string; color: string }> = {
  parkett: { label: 'Parkett', color: '#c9a072' },
  laminat: { label: 'Laminat', color: '#d4b48a' },
  fliesen: { label: 'Fliesen', color: '#e3e1dc' },
  naturstein: { label: 'Naturstein', color: '#bdb6aa' },
  teppich: { label: 'Teppich', color: '#9aa3ad' },
  beton: { label: 'Estrich / Beton', color: '#a9aaa6' },
  farbe: { label: 'einfarbig', color: '#e8e4dc' },
};

/** Oberfläche des Bodens aus dem Bodenbelag der Heizlast (eine Angabe für beides) */
export function finishOf(room: Room): FloorFinish {
  if (room.floorFinish) return room.floorFinish;
  const c = room.covering;
  if (c.startsWith('parkett')) return 'parkett';
  if (c === 'laminat') return 'laminat';
  if (c === 'naturstein') return 'naturstein';
  if (c.startsWith('teppich')) return 'teppich';
  if (c === 'none') return 'beton';
  if (c === 'fliesen' || c === 'vinyl') return 'fliesen';
  return COVERINGS[c] ? 'farbe' : 'fliesen';
}
export const floorColorOf = (room: Room): string => room.floorColor ?? FINISH_COLORS[finishOf(room)].color;

export const PLAN_DEFS = `<defs>
<pattern id="p-hatch" patternUnits="userSpaceOnUse" width="0.08" height="0.08" patternTransform="rotate(45)"><rect width="0.08" height="0.08" class="p-hatch-bg"/><line x1="0" y1="0" x2="0" y2="0.08" class="p-hatch-ln"/></pattern>
<marker id="p-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="0.22" markerHeight="0.22" orient="auto-start-reverse" markerUnits="userSpaceOnUse"><path d="M0,0 L10,5 L0,10 z" class="p-arrow-head"/></marker>
</defs>`;

export interface PlanRenderOpts {
  project: Project;
  floor: Floor;
  design: DesignResult;
  scale: number;
  sel: SelItem[];
  phase: Phase;
  ghost: Floor | null;
}

const isSel = (o: { sel: SelItem[] }, kind: SelItem['kind'], id: string) => o.sel.some((s) => s.kind === kind && s.id === id);

// ---------- Öffnungen ----------

function arcPts(c: Vec, r: number, a0: Vec, a1: Vec, n = 14): Vec[] {
  const t0 = Math.atan2(a0.y - c.y, a0.x - c.x);
  let d = Math.atan2(a1.y - c.y, a1.x - c.x) - t0;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return Array.from({ length: n + 1 }, (_, i) => ({ x: c.x + Math.cos(t0 + (d * i) / n) * r, y: c.y + Math.sin(t0 + (d * i) / n) * r }));
}

export function openingSymbol(w: Wall, o: Opening, extraCls = ''): string {
  const th = w.thickness / 2;
  const t1 = o.offset - o.width / 2;
  const t2 = o.offset + o.width / 2;
  const sgn = (o.side ?? 'left') === 'left' ? 1 : -1;
  const hinge = o.hinge ?? 'a';
  const face = th * sgn;
  const Q = (t: number, off: number) => pointOnWall(w, t, off);
  let s = `<polygon points="${poly([Q(t1, th), Q(t2, th), Q(t2, -th), Q(t1, -th)])}" class="p-op-gap"/>`;
  s += ln(Q(t1, th), Q(t1, -th), 'p-op-reveal') + ln(Q(t2, th), Q(t2, -th), 'p-op-reveal');
  const leaf = (th0: number, tOther: number, width: number, dashed = false) => {
    const h = Q(th0, face);
    const tip = add(h, mul(left(wallDir(w)), sgn * width));
    const closed = Q(tOther, face);
    return ln(h, tip, `p-op-leaf${dashed ? ' p-dashed' : ''}`) + pl(arcPts(h, width, tip, closed), `p-op-arc${dashed ? ' p-dashed' : ''}`);
  };
  switch (styleOf(o)) {
    case 'door':
      s += hinge === 'a' ? leaf(t1, t2, o.width) : leaf(t2, t1, o.width);
      break;
    case 'doubleDoor':
      s += leaf(t1, o.offset, o.width / 2) + leaf(t2, o.offset, o.width / 2);
      break;
    case 'slidingDoor': {
      const off1 = th * 0.35;
      s += ln(Q(t1, th), Q(t2, th), 'p-op-win') + ln(Q(t1, -th), Q(t2, -th), 'p-op-win');
      s += `<polygon points="${poly([Q(t1, off1 + 0.02), Q(o.offset + 0.03, off1 + 0.02), Q(o.offset + 0.03, off1 - 0.02), Q(t1, off1 - 0.02)])}" class="p-op-slide"/>`;
      s += `<polygon points="${poly([Q(o.offset - 0.03, -off1 + 0.02), Q(t2, -off1 + 0.02), Q(t2, -off1 - 0.02), Q(o.offset - 0.03, -off1 - 0.02)])}" class="p-op-slide"/>`;
      break;
    }
    case 'window':
    case 'frenchWindow':
    case 'roofWindow': {
      const dash = styleOf(o) === 'roofWindow' ? ' p-dashed' : '';
      s += ln(Q(t1, th), Q(t2, th), `p-op-win${dash}`) + ln(Q(t1, -th), Q(t2, -th), `p-op-win${dash}`);
      s += ln(Q(t1, 0.02), Q(t2, 0.02), `p-op-glass${dash}`) + ln(Q(t1, -0.02), Q(t2, -0.02), `p-op-glass${dash}`);
      if (styleOf(o) === 'frenchWindow') s += hinge === 'a' ? leaf(t1, t2, o.width, true) : leaf(t2, t1, o.width, true);
      else s += ln(Q(t1, -th - 0.04 * sgn), Q(t2, -th - 0.04 * sgn), 'p-op-sill');
      break;
    }
    case 'garageDoor':
      s += ln(Q(t1, 0), Q(t2, 0), 'p-op-garage p-dashed');
      s += `<polygon points="${poly([Q(t1, face), Q(t2, face), Q(t2, face + sgn * 0.08), Q(t1, face + sgn * 0.08)])}" class="p-op-slide"/>`;
      break;
    case 'passage':
      break;
  }
  return `<g class="p-opening${extraCls}" data-kind="opening" data-id="${o.id}" data-wall="${w.id}">${s}<polygon points="${poly([Q(t1, th + 0.05), Q(t2, th + 0.05), Q(t2, -th - 0.05), Q(t1, -th - 0.05)])}" class="p-hit"/></g>`;
}

// ---------- Wände ----------

function subtractIntervals(lo: number, hi: number, cuts: [number, number][]): [number, number][] {
  const out: [number, number][] = [];
  let cur = lo;
  for (const [a, b] of cuts.slice().sort((x, y) => x[0] - y[0])) {
    if (b <= cur) continue;
    if (a > cur) out.push([cur, Math.min(a, hi)]);
    cur = Math.max(cur, b);
    if (cur >= hi) break;
  }
  if (cur < hi) out.push([cur, hi]);
  return out.filter(([a, b]) => b - a > 1e-4);
}

function wallEdges(floor: Floor, w: Wall, ol: WallOutline): string {
  const L = wallLength(w);
  const th = w.thickness / 2;
  const cuts: [number, number][] = w.openings.map((op) => [op.offset - op.width / 2, op.offset + op.width / 2]);
  let s = '';
  for (const [a, b] of subtractIntervals(ol.ta.l, L + ol.tb.l, cuts)) s += ln(pointOnWall(w, a, th), pointOnWall(w, b, th), 'p-edge');
  for (const [a, b] of subtractIntervals(ol.ta.r, L + ol.tb.r, cuts)) s += ln(pointOnWall(w, a, -th), pointOnWall(w, b, -th), 'p-edge');
  if (endsAt(floor.walls, w.a).length < 2) s += ln(ol.poly[0], ol.poly[3], 'p-edge');
  if (endsAt(floor.walls, w.b).length < 2) s += ln(ol.poly[1], ol.poly[2], 'p-edge');
  return s;
}

export function wallsSvg(floor: Floor, o: { sel: SelItem[]; phase: Phase }): { fill: string; edges: string; openings: string } {
  const outl = wallOutlines(floor.walls);
  let fill = '';
  let edges = '';
  let ops = '';
  const kindCls = o.phase === 'parts' || o.phase === 'heating';
  for (const w of floor.walls) {
    const ol = outl.get(w.id);
    if (!ol) continue;
    const sel = isSel(o, 'wall', w.id);
    fill += `<polygon points="${poly(ol.poly)}" class="p-wall${kindCls ? ` k-${w.kind}` : ''}${w.construction ? ' own' : ''}${sel ? ' sel' : ''}" data-kind="wall" data-id="${w.id}"/>`;
    edges += wallEdges(floor, w, ol);
    for (const op of w.openings) ops += openingSymbol(w, op, `${isSel(o, 'opening', op.id) ? ' sel' : ''}${op.uValue != null ? ' own' : ''}`);
  }
  return { fill, edges, openings: ops };
}

// ---------- Bemaßung ----------

export function dimensionSvg(a: Vec, b: Vec, offset: number, scale: number, cls = '', attrs = ''): string {
  const L = dist(a, b);
  if (L < 1e-3) return '';
  const u = norm(sub(b, a));
  const n = left(u);
  const A = add(a, mul(n, offset));
  const B = add(b, mul(n, offset));
  const ext = 0.06 * Math.sign(offset || 1);
  const tick = 0.07;
  const tk = (p: Vec) => ln(add(p, mul(add(u, n), -tick / 1.41)), add(p, mul(add(u, n), tick / 1.41)), 'p-dim-tick');
  let ang = (Math.atan2(u.y, u.x) * 180) / Math.PI;
  if (ang > 90.01 || ang < -89.99) ang += 180;
  const fs = Math.max(0.12, 11 / scale);
  const m = mul(add(A, B), 0.5);
  return `<g class="p-dim${cls}" ${attrs}>${ln(a, add(A, mul(n, ext)), 'p-dim-ext')}${ln(b, add(B, mul(n, ext)), 'p-dim-ext')}${ln(A, B, 'p-dim-line')}${tk(A)}${tk(B)}<text x="${m.x.toFixed(4)}" y="${m.y.toFixed(4)}" transform="rotate(${ang.toFixed(2)} ${m.x.toFixed(4)} ${m.y.toFixed(4)}) translate(0 ${(-fs * 0.35).toFixed(4)})" class="p-dim-text" style="font-size:${fs.toFixed(4)}px;stroke-width:${(3 / scale).toFixed(4)}px">${fmt(L)}</text>${ln(A, B, 'p-hit-line')}</g>`;
}

function wallDimsSvg(floor: Floor, o: PlanRenderOpts): string {
  if (!o.project.settings.showWallDims) return '';
  const outl = wallOutlines(floor.walls);
  let s = '';
  for (const w of floor.walls) {
    if (!isSel(o, 'wall', w.id)) continue;
    const ol = outl.get(w.id)!;
    s += dimensionSvg(ol.poly[0], ol.poly[1], 0.35, o.scale, ' auto');
    s += dimensionSvg(ol.poly[2], ol.poly[3], 0.35, o.scale, ' auto');
  }
  return s;
}

// ---------- Räume ----------

function roomClass(o: PlanRenderOpts, r: Room): string {
  if (o.phase === 'build') return `p-room fin-${finishOf(r)}`;
  if (!r.heated) return `p-room unheated${r.type === 'garage' ? ' garage' : ''}`;
  if (o.phase === 'parts') return 'p-room heated';
  const rr = o.design.rooms.get(r.id);
  const warn = rr && (rr.warnings.includes('undersupplied') || rr.warnings.includes('q-exceeds-limit') || rr.warnings.includes('no-surface'));
  return `p-room heated${r.surfaces.length ? ' has-heat' : ''}${warn ? ' warn' : ''}`;
}

function roomsSvg(o: PlanRenderOpts): { fill: string; labels: string } {
  const { floor, phase } = o;
  let fill = '';
  let labels = '';
  const fs = Math.max(0.14, 12 / o.scale);
  for (const r of floor.rooms) {
    if (r.polygon.length < 3) continue;
    const sel = isSel(o, 'room', r.id);
    const style = phase === 'build' ? ` style="fill:${floorColorOf(r)}"` : '';
    fill += `<polygon points="${poly(r.polygon)}" class="${roomClass(o, r)}${sel ? ' sel' : ''}"${style} data-kind="room" data-id="${r.id}"/>`;
    if (phase !== 'build' && phase !== 'parts') continue;
    const c = add(centroid(r.polygon), r.labelOffset ?? { x: 0, y: 0 });
    labels += `<text x="${c.x.toFixed(3)}" y="${c.y.toFixed(3)}" class="p-room-name" style="font-size:${fs.toFixed(4)}px">${esc(r.name)}</text>`;
    const sub2 = phase === 'parts' ? `${r.heated ? `${fmt(r.thetaI, 0)} °C` : 'unbeheizt'}${r.floorConstruction || r.ceilingConstruction ? ' · eigener Aufbau' : ''}` : o.project.settings.showRoomArea ? `${fmt(area(r.polygon))} m²` : '';
    if (sub2) labels += `<text x="${c.x.toFixed(3)}" y="${(c.y + fs * 1.25).toFixed(3)}" class="p-room-area" style="font-size:${(fs * 0.85).toFixed(4)}px">${esc(sub2)}</text>`;
  }
  return { fill, labels };
}

// ---------- Möbel, Treppen ----------

export function furnitureSvg(f: Furniture, sel: boolean, ghost = false): string {
  const item = CATALOG_BY_KEY[f.catalog];
  const sym = item ? item.plan(f.width, f.depth) : `<rect x="${-f.width / 2}" y="${-f.depth / 2}" width="${f.width}" height="${f.depth}"/>`;
  const tr = `translate(${f.pos.x.toFixed(4)} ${f.pos.y.toFixed(4)}) rotate(${f.angle.toFixed(2)})${f.mirrored ? ' scale(-1 1)' : ''}`;
  return `<g class="p-fur${sel ? ' sel' : ''}${ghost ? ' preview' : ''}${f.visible ? '' : ' off'}" transform="${tr}" data-kind="furniture" data-id="${f.id}"><rect x="${-f.width / 2}" y="${-f.depth / 2}" width="${f.width}" height="${f.depth}" class="p-fur-bg"/><g class="p-sym">${sym}</g></g>`;
}

export function stairSvg(s: Stair, rise: number, sel: boolean, ghost = false): string {
  const g = stairGeometry(s, rise);
  const treads = g.treads.map((t) => `<polygon points="${poly(t.poly)}" class="p-tread"/>`).join('');
  return `<g class="p-stair${sel ? ' sel' : ''}${ghost ? ' preview' : ''}" data-kind="stair" data-id="${s.id}"><polygon points="${poly(g.outline)}" class="p-stair-bg"/>${treads}<polyline points="${poly(g.walkline)}" class="p-walkline" marker-end="url(#p-arrow)"/><circle cx="${g.walkline[0].x}" cy="${g.walkline[0].y}" r="0.05" class="p-walk-start"/></g>`;
}

export function belowOf(project: Project, floor: Floor): Floor | null {
  const sorted = project.floors.slice().sort((a, b) => a.elevation - b.elevation);
  const i = sorted.findIndex((l) => l.id === floor.id);
  return i > 0 ? sorted[i - 1] : null;
}

export function aboveOf(project: Project, floor: Floor): Floor | null {
  const sorted = project.floors.slice().sort((a, b) => a.elevation - b.elevation);
  const i = sorted.findIndex((l) => l.id === floor.id);
  return i >= 0 && i < sorted.length - 1 ? sorted[i + 1] : null;
}

/** Grundebenen des Plans; die Heizungsebenen werden zwischen Räume und Wände eingefügt */
export function planBaseSvg(o: PlanRenderOpts): { under: string; walls: string; over: string } {
  const { floor } = o;
  let under = '';
  if (o.ghost) {
    const outl = wallOutlines(o.ghost.walls);
    under += `<g class="p-ghost">${[...outl.values()].map((x) => `<polygon points="${poly(x.poly)}"/>`).join('')}</g>`;
  }
  const rooms = roomsSvg(o);
  const walls = wallsSvg(floor, o);
  under += `<g class="p-l-rooms">${rooms.fill}</g>`;
  under += `<g class="p-l-voids">${floor.voids
    .map((v) => `<g class="p-void${isSel(o, 'void', v.id) ? ' sel' : ''}${v.stairId ? ' auto' : ''}"${v.stairId ? '' : ` data-kind="void" data-id="${v.id}"`}><polygon points="${poly(v.polygon)}"/>${ln(v.polygon[0], v.polygon[Math.floor(v.polygon.length / 2)])}</g>`)
    .join('')}</g>`;
  under += `<g class="p-l-stairs">${floor.stairs.map((x) => stairSvg(x, floor.storeyHeight, isSel(o, 'stair', x.id))).join('')}</g>`;
  const wallsSvgStr = `<g class="p-l-walls">${walls.fill}${walls.edges}</g><g class="p-l-openings">${walls.openings}</g>`;
  let over = `<g class="p-l-furniture${o.phase === 'build' ? '' : ' faded'}">${floor.furniture.map((f) => furnitureSvg(f, isSel(o, 'furniture', f.id))).join('')}</g>`;
  over += `<g class="p-l-labels">${rooms.labels}${floor.labels
    .map((t) => `<text x="${t.pos.x}" y="${t.pos.y}" transform="rotate(${t.angle} ${t.pos.x} ${t.pos.y})" class="p-label${isSel(o, 'label', t.id) ? ' sel' : ''}" style="font-size:${t.size}px" data-kind="label" data-id="${t.id}">${esc(t.text)}</text>`)
    .join('')}</g>`;
  over += `<g class="p-l-dims">${floor.dimensions.map((d) => dimensionSvg(d.a, d.b, d.offset, o.scale, isSel(o, 'dimension', d.id) ? ' sel' : '', `data-kind="dimension" data-id="${d.id}"`)).join('')}${wallDimsSvg(floor, o)}</g>`;
  return { under, walls: wallsSvgStr, over };
}

export { OPENING_STYLES };
