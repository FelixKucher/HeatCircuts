// SVG-Darstellung eines Geschosses: Wände mit Öffnungen, Räume, Möbel, Treppen, Maße, Texte.

import { CATALOG_BY_KEY } from './catalog';
import { OPENING_TYPES, type Dimension, type Furniture, type Level, type Opening, type Project, type Stair, type Vec, type Wall } from './model';
import type { SelItem } from './store';
import { stairGeometry } from './stairs';
import { endsAt, left, pointOnWall, wallDir, wallLength, wallOutlines, type WallOutline } from './walls';
import { add, area, centroid, dist, mul, norm, sub } from '../../src/geometry/geom';

export const fmt = (x: number, d = 2): string => x.toFixed(d).replace('.', ',');
export const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const P = (p: Vec) => `${p.x.toFixed(4)},${p.y.toFixed(4)}`;
const poly = (pts: Vec[]) => pts.map(P).join(' ');
const ln = (a: Vec, b: Vec, cls = '') => `<line x1="${a.x.toFixed(4)}" y1="${a.y.toFixed(4)}" x2="${b.x.toFixed(4)}" y2="${b.y.toFixed(4)}"${cls ? ` class="${cls}"` : ''}/>`;
const pl = (pts: Vec[], cls = '') => `<polyline points="${poly(pts)}"${cls ? ` class="${cls}"` : ''}/>`;

export const PLAN_DEFS = `<defs>
<pattern id="hatch" patternUnits="userSpaceOnUse" width="0.08" height="0.08" patternTransform="rotate(45)"><rect width="0.08" height="0.08" class="hatch-bg"/><line x1="0" y1="0" x2="0" y2="0.08" class="hatch-ln"/></pattern>
<marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="0.22" markerHeight="0.22" orient="auto-start-reverse" markerUnits="userSpaceOnUse"><path d="M0,0 L10,5 L0,10 z" class="arrow-head"/></marker>
</defs>`;

export interface RenderOpts {
  scale: number;
  sel: SelItem[];
  ghost: Level | null;
  /** Wand-Ids ohne Gehrungsberechnung zu zeichnen (Vorschau) */
  showWallDims: boolean;
  showRoomArea: boolean;
  forExport?: boolean;
}

const isSel = (o: RenderOpts, kind: SelItem['kind'], id: string) => o.sel.some((s) => s.kind === kind && s.id === id);

// ---------- Öffnungen ----------

function arcPts(c: Vec, r: number, a0: Vec, a1: Vec, n = 14): Vec[] {
  const t0 = Math.atan2(a0.y - c.y, a0.x - c.x);
  let t1 = Math.atan2(a1.y - c.y, a1.x - c.x);
  let d = t1 - t0;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  t1 = t0 + d;
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = t0 + (d * i) / n;
    return { x: c.x + Math.cos(t) * r, y: c.y + Math.sin(t) * r };
  });
}

export function openingSymbol(w: Wall, o: Opening, extraCls = ''): string {
  const th = w.thickness / 2;
  const t1 = o.offset - o.width / 2;
  const t2 = o.offset + o.width / 2;
  const sgn = o.side === 'left' ? 1 : -1;
  const face = th * sgn;
  const P2 = (t: number, off: number) => pointOnWall(w, t, off);
  let s = `<polygon points="${poly([P2(t1, th), P2(t2, th), P2(t2, -th), P2(t1, -th)])}" class="op-gap"/>`;
  s += ln(P2(t1, th), P2(t1, -th), 'op-reveal') + ln(P2(t2, th), P2(t2, -th), 'op-reveal');
  const leaf = (th0: number, tOther: number, width: number, dashed = false) => {
    const h = P2(th0, face);
    const tip = add(h, mul(left(wallDir(w)), sgn * width));
    const closed = P2(tOther, face);
    return ln(h, tip, `op-leaf${dashed ? ' dashed' : ''}`) + pl(arcPts(h, width, tip, closed), `op-arc${dashed ? ' dashed' : ''}`);
  };
  switch (o.type) {
    case 'door':
      s += o.hinge === 'a' ? leaf(t1, t2, o.width) : leaf(t2, t1, o.width);
      break;
    case 'doubleDoor':
      s += leaf(t1, o.offset, o.width / 2) + leaf(t2, o.offset, o.width / 2);
      break;
    case 'slidingDoor': {
      const off1 = th * 0.35;
      s += `<polygon points="${poly([P2(t1, off1 + 0.02), P2(o.offset + 0.03, off1 + 0.02), P2(o.offset + 0.03, off1 - 0.02), P2(t1, off1 - 0.02)])}" class="op-slide"/>`;
      s += `<polygon points="${poly([P2(o.offset - 0.03, -off1 + 0.02), P2(t2, -off1 + 0.02), P2(t2, -off1 - 0.02), P2(o.offset - 0.03, -off1 - 0.02)])}" class="op-slide"/>`;
      break;
    }
    case 'window':
    case 'frenchWindow':
    case 'roofWindow': {
      const dash = o.type === 'roofWindow' ? ' dashed' : '';
      s += ln(P2(t1, th), P2(t2, th), `op-win${dash}`) + ln(P2(t1, -th), P2(t2, -th), `op-win${dash}`);
      s += ln(P2(t1, 0.02), P2(t2, 0.02), `op-glass${dash}`) + ln(P2(t1, -0.02), P2(t2, -0.02), `op-glass${dash}`);
      if (o.type === 'frenchWindow') s += o.hinge === 'a' ? leaf(t1, t2, o.width, true) : leaf(t2, t1, o.width, true);
      else s += ln(P2(t1, -th - 0.04 * sgn), P2(t2, -th - 0.04 * sgn), 'op-sill');
      break;
    }
    case 'garageDoor':
      s += ln(P2(t1, 0), P2(t2, 0), 'op-garage dashed');
      s += `<polygon points="${poly([P2(t1, face), P2(t2, face), P2(t2, face + sgn * 0.08), P2(t1, face + sgn * 0.08)])}" class="op-slide"/>`;
      break;
    case 'passage':
      break;
  }
  return `<g class="opening${extraCls}" data-kind="opening" data-id="${o.id}" data-wall="${w.id}">${s}<polygon points="${poly([P2(t1, th + 0.05), P2(t2, th + 0.05), P2(t2, -th - 0.05), P2(t1, -th - 0.05)])}" class="hit"/></g>`;
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

export function wallsSvg(level: Level, o: RenderOpts): { fill: string; edges: string; openings: string } {
  const outl = wallOutlines(level.walls);
  let fill = '';
  let edges = '';
  let ops = '';
  for (const w of level.walls) {
    const ol = outl.get(w.id);
    if (!ol) continue;
    const sel = isSel(o, 'wall', w.id);
    fill += `<polygon points="${poly(ol.poly)}" class="wall${sel ? ' sel' : ''}" data-kind="wall" data-id="${w.id}"/>`;
    edges += wallEdges(level, w, ol);
    for (const op of w.openings) ops += openingSymbol(w, op, isSel(o, 'opening', op.id) ? ' sel' : '');
  }
  return { fill, edges, openings: ops };
}

function wallEdges(level: Level, w: Wall, ol: WallOutline): string {
  const L = wallLength(w);
  const th = w.thickness / 2;
  const cuts: [number, number][] = w.openings.map((op) => [op.offset - op.width / 2, op.offset + op.width / 2]);
  let s = '';
  for (const [a, b] of subtractIntervals(ol.ta.l, L + ol.tb.l, cuts)) s += ln(pointOnWall(w, a, th), pointOnWall(w, b, th), 'wall-edge');
  for (const [a, b] of subtractIntervals(ol.ta.r, L + ol.tb.r, cuts)) s += ln(pointOnWall(w, a, -th), pointOnWall(w, b, -th), 'wall-edge');
  if (endsAt(level.walls, w.a).length < 2) s += ln(ol.poly[0], ol.poly[3], 'wall-edge');
  if (endsAt(level.walls, w.b).length < 2) s += ln(ol.poly[1], ol.poly[2], 'wall-edge');
  return s;
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
  const tk = (p: Vec) => ln(add(p, mul(add(u, n), -tick / 1.41)), add(p, mul(add(u, n), tick / 1.41)), 'dim-tick');
  let ang = (Math.atan2(u.y, u.x) * 180) / Math.PI;
  if (ang > 90.01 || ang < -89.99) ang += 180;
  const fs = Math.max(0.12, 11 / scale);
  const mid = mul(add(A, B), 0.5);
  const tp = mid;
  return `<g class="dim${cls}" ${attrs}>${ln(a, add(A, mul(n, ext)), 'dim-ext')}${ln(b, add(B, mul(n, ext)), 'dim-ext')}${ln(A, B, 'dim-line')}${tk(A)}${tk(B)}<text x="${tp.x.toFixed(4)}" y="${tp.y.toFixed(4)}" transform="rotate(${ang.toFixed(2)} ${tp.x.toFixed(4)} ${tp.y.toFixed(4)}) translate(0 ${(-fs * 0.35).toFixed(4)})" class="dim-text" style="font-size:${fs.toFixed(4)}px">${fmt(L)}</text>${ln(A, B, 'hit-line')}</g>`;
}

function dimensionsSvg(level: Level, o: RenderOpts): string {
  return level.dimensions.map((d: Dimension) => dimensionSvg(d.a, d.b, d.offset, o.scale, isSel(o, 'dimension', d.id) ? ' sel' : '', `data-kind="dimension" data-id="${d.id}"`)).join('');
}

/** Wandlängen (Außenseite bzw. beide Seiten) der gewählten Wände */
function wallDimsSvg(level: Level, o: RenderOpts): string {
  const outl = wallOutlines(level.walls);
  let s = '';
  for (const w of level.walls) {
    if (!isSel(o, 'wall', w.id)) continue;
    const ol = outl.get(w.id)!;
    s += dimensionSvg(ol.poly[0], ol.poly[1], 0.35, o.scale, ' auto');
    s += dimensionSvg(ol.poly[2], ol.poly[3], 0.35, o.scale, ' auto');
  }
  return s;
}

// ---------- Räume ----------

function roomsSvg(level: Level, o: RenderOpts): { fill: string; labels: string } {
  let fill = '';
  let labels = '';
  const fs = Math.max(0.14, 12 / o.scale);
  for (const r of level.rooms) {
    if (r.polygon.length < 3) continue;
    const sel = isSel(o, 'room', r.id);
    fill += `<polygon points="${poly(r.polygon)}" class="room fin-${r.floorFinish}${sel ? ' sel' : ''}" style="fill:${r.floorColor}" data-kind="room" data-id="${r.id}"/>`;
    const c = add(centroid(r.polygon), r.labelOffset);
    labels += `<text x="${c.x.toFixed(3)}" y="${c.y.toFixed(3)}" class="room-name" style="font-size:${fs.toFixed(4)}px">${esc(r.name)}</text>`;
    if (o.showRoomArea) labels += `<text x="${c.x.toFixed(3)}" y="${(c.y + fs * 1.25).toFixed(3)}" class="room-area" style="font-size:${(fs * 0.85).toFixed(4)}px">${fmt(area(r.polygon))} m²</text>`;
  }
  return { fill, labels };
}

// ---------- Möbel, Treppen, Texte ----------

export function furnitureSvg(f: Furniture, sel: boolean, ghost = false): string {
  const item = CATALOG_BY_KEY[f.catalog];
  const sym = item ? item.plan(f.width, f.depth) : `<rect x="${-f.width / 2}" y="${-f.depth / 2}" width="${f.width}" height="${f.depth}"/>`;
  const tr = `translate(${f.pos.x.toFixed(4)} ${f.pos.y.toFixed(4)}) rotate(${f.angle.toFixed(2)})${f.mirrored ? ' scale(-1 1)' : ''}`;
  return `<g class="furniture${sel ? ' sel' : ''}${ghost ? ' preview' : ''}${f.visible ? '' : ' hidden-f'}" transform="${tr}" data-kind="furniture" data-id="${f.id}"><rect x="${-f.width / 2}" y="${-f.depth / 2}" width="${f.width}" height="${f.depth}" class="fur-bg"/><g class="sym">${sym}</g></g>`;
}

export function stairSvg(s: Stair, rise: number, sel: boolean, ghost = false): string {
  const g = stairGeometry(s, rise);
  const treads = g.treads.map((t) => `<polygon points="${poly(t.poly)}" class="tread"/>`).join('');
  return `<g class="stair${sel ? ' sel' : ''}${ghost ? ' preview' : ''}" data-kind="stair" data-id="${s.id}"><polygon points="${poly(g.outline)}" class="stair-bg"/>${treads}<polyline points="${poly(g.walkline)}" class="walkline" marker-end="url(#arrow)"/><circle cx="${g.walkline[0].x}" cy="${g.walkline[0].y}" r="0.05" class="walk-start"/></g>`;
}

/** Deckenausschnitte der Treppen aus dem Geschoss darunter */
export function stairCutsFrom(below: Level | null): Vec[][] {
  if (!below) return [];
  return below.stairs.filter((s) => s.cutCeiling).map((s) => stairGeometry(s, below.height).outline);
}

// ---------- Gesamtes Geschoss ----------

export function levelSvg(project: Project, level: Level, o: RenderOpts): string {
  const below = belowOf(project, level);
  let s = '';
  if (o.ghost) {
    const outl = wallOutlines(o.ghost.walls);
    s += `<g class="ghost">${[...outl.values()].map((x) => `<polygon points="${poly(x.poly)}"/>`).join('')}</g>`;
  }
  const rooms = roomsSvg(level, o);
  const walls = wallsSvg(level, o);
  s += `<g class="l-rooms">${rooms.fill}</g>`;
  const cuts = stairCutsFrom(below);
  if (cuts.length) s += `<g class="l-voids">${cuts.map((c) => `<polygon points="${poly(c)}" class="void"/>${ln(c[0], c[Math.floor(c.length / 2)], 'void-x')}`).join('')}</g>`;
  s += `<g class="l-stairs">${level.stairs.map((x) => stairSvg(x, level.height, isSel(o, 'stair', x.id))).join('')}</g>`;
  s += `<g class="l-walls">${walls.fill}${walls.edges}</g>`;
  s += `<g class="l-openings">${walls.openings}</g>`;
  s += `<g class="l-furniture">${level.furniture.map((f) => furnitureSvg(f, isSel(o, 'furniture', f.id))).join('')}</g>`;
  s += `<g class="l-labels">${rooms.labels}${level.labels
    .map((t) => `<text x="${t.pos.x}" y="${t.pos.y}" transform="rotate(${t.angle} ${t.pos.x} ${t.pos.y})" class="label${isSel(o, 'label', t.id) ? ' sel' : ''}" style="font-size:${t.size}px" data-kind="label" data-id="${t.id}">${esc(t.text)}</text>`)
    .join('')}</g>`;
  s += `<g class="l-dims">${dimensionsSvg(level, o)}${o.showWallDims ? wallDimsSvg(level, o) : ''}</g>`;
  return s;
}

export function belowOf(project: Project, level: Level): Level | null {
  const sorted = project.levels.slice().sort((a, b) => a.elevation - b.elevation);
  const i = sorted.findIndex((l) => l.id === level.id);
  return i > 0 ? sorted[i - 1] : null;
}

export function aboveOf(project: Project, level: Level): Level | null {
  const sorted = project.levels.slice().sort((a, b) => a.elevation - b.elevation);
  const i = sorted.findIndex((l) => l.id === level.id);
  return i >= 0 && i < sorted.length - 1 ? sorted[i + 1] : null;
}

export { OPENING_TYPES };
