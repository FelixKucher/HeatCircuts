// DXF: ASCII-DXF lesen (als maßstäblicher Vektorhintergrund) und Grundriss als DXF R12 in Metern schreiben.
// Austausch mit AutoCAD, CADCraft (https://github.com/storytold/cadcraft) und anderen CAD-Programmen.

import type { BackgroundImage, Floor, Project, Vec } from '../model/types';
import { pointOnWall, wallOutlines } from '../cad/walls';
import { area, centroid } from '../geometry/geom';

// ---------- DXF lesen ----------

export interface DxfResult {
  segments: [number, number, number, number][];
  texts: { x: number; y: number; h: number; text: string }[];
  unit: number;
  layers: string[];
}

/** ASCII-DXF: LINE, LWPOLYLINE, POLYLINE/VERTEX, CIRCLE, ARC, TEXT, INSERT (eine Ebene Blöcke) */
export function parseDxf(text: string): DxfResult {
  const lines = text.split(/\r?\n/);
  const pairs: [number, string][] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) pairs.push([parseInt(lines[i].trim(), 10), lines[i + 1].trim()]);
  let unitCode = 0;
  for (let i = 0; i < pairs.length - 2; i++) if (pairs[i][0] === 9 && pairs[i][1] === '$INSUNITS') unitCode = parseInt(pairs[i + 1][1], 10);
  type Ent = { type: string; g: Map<number, string[]>; layer: string };
  const parseEntities = (from: number, endTag: string): { ents: Ent[]; end: number } => {
    const ents: Ent[] = [];
    let cur: Ent | null = null;
    let i = from;
    for (; i < pairs.length; i++) {
      const [c, v] = pairs[i];
      if (c === 0) {
        if (cur) ents.push(cur);
        cur = null;
        if (v === endTag) break;
        cur = { type: v, g: new Map(), layer: '0' };
        continue;
      }
      if (!cur) continue;
      if (c === 8) cur.layer = v;
      const arr = cur.g.get(c) ?? [];
      arr.push(v);
      cur.g.set(c, arr);
    }
    if (cur) ents.push(cur);
    return { ents, end: i };
  };
  const blocks = new Map<string, Ent[]>();
  let entities: Ent[] = [];
  for (let i = 0; i < pairs.length; i++) {
    if (pairs[i][0] === 2 && pairs[i][1] === 'BLOCKS' && pairs[i - 1]?.[1] === 'SECTION') {
      let j = i + 1;
      while (j < pairs.length && !(pairs[j][0] === 0 && pairs[j][1] === 'ENDSEC')) {
        if (pairs[j][0] === 0 && pairs[j][1] === 'BLOCK') {
          let name = '';
          let k = j + 1;
          for (; k < pairs.length && pairs[k][0] !== 0; k++) if (pairs[k][0] === 2) name = pairs[k][1];
          const { ents, end } = parseEntities(k, 'ENDBLK');
          blocks.set(name, ents);
          j = end + 1;
        } else j++;
      }
    }
    if (pairs[i][0] === 2 && pairs[i][1] === 'ENTITIES' && pairs[i - 1]?.[1] === 'SECTION') {
      entities = parseEntities(i + 1, 'ENDSEC').ents;
      break;
    }
  }
  const segs: [number, number, number, number][] = [];
  const texts: DxfResult['texts'] = [];
  const layers = new Set<string>();
  const num = (e: Ent, c: number, k = 0, d = 0) => parseFloat(e.g.get(c)?.[k] ?? `${d}`) || d;
  type Tf = (x: number, y: number) => [number, number];
  const emit = (ents: Ent[], tf: Tf, depth: number) => {
    let poly: [number, number][] | null = null;
    let polyClosed = false;
    for (const e of ents) {
      layers.add(e.layer);
      const seg = (a: [number, number], b: [number, number]) => {
        const p = tf(a[0], a[1]);
        const q = tf(b[0], b[1]);
        segs.push([p[0], p[1], q[0], q[1]]);
      };
      const arc = (cx: number, cy: number, r: number, a0: number, a1: number) => {
        let s = (a0 * Math.PI) / 180;
        let t = (a1 * Math.PI) / 180;
        if (t <= s) t += 2 * Math.PI;
        const n = Math.max(6, Math.ceil(((t - s) / (2 * Math.PI)) * 48));
        for (let i = 0; i < n; i++) {
          const u = s + ((t - s) * i) / n;
          const w = s + ((t - s) * (i + 1)) / n;
          seg([cx + r * Math.cos(u), cy + r * Math.sin(u)], [cx + r * Math.cos(w), cy + r * Math.sin(w)]);
        }
        s = t;
      };
      switch (e.type) {
        case 'LINE':
          seg([num(e, 10), num(e, 20)], [num(e, 11), num(e, 21)]);
          break;
        case 'LWPOLYLINE': {
          const xs = e.g.get(10) ?? [];
          const ys = e.g.get(20) ?? [];
          const pts = xs.map((x, k) => [parseFloat(x), parseFloat(ys[k])] as [number, number]);
          for (let k = 0; k + 1 < pts.length; k++) seg(pts[k], pts[k + 1]);
          if ((num(e, 70) & 1) === 1 && pts.length > 2) seg(pts[pts.length - 1], pts[0]);
          break;
        }
        case 'POLYLINE':
          poly = [];
          polyClosed = (num(e, 70) & 1) === 1;
          break;
        case 'VERTEX':
          poly?.push([num(e, 10), num(e, 20)]);
          break;
        case 'SEQEND':
          if (poly) {
            for (let k = 0; k + 1 < poly.length; k++) seg(poly[k], poly[k + 1]);
            if (polyClosed && poly.length > 2) seg(poly[poly.length - 1], poly[0]);
          }
          poly = null;
          break;
        case 'CIRCLE':
          arc(num(e, 10), num(e, 20), num(e, 40), 0, 360);
          break;
        case 'ARC':
          arc(num(e, 10), num(e, 20), num(e, 40), num(e, 50), num(e, 51));
          break;
        case 'TEXT':
        case 'MTEXT': {
          const [x, y] = tf(num(e, 10), num(e, 20));
          const t = (e.g.get(1)?.[0] ?? '').replace(/\\P/g, ' ').replace(/\\[A-Za-z][^;]*;/g, '').replace(/[{}]/g, '');
          if (t) texts.push({ x, y, h: num(e, 40, 0, 2.5), text: t });
          break;
        }
        case 'INSERT': {
          if (depth > 3) break;
          const b = blocks.get(e.g.get(2)?.[0] ?? '');
          if (!b) break;
          const ix = num(e, 10);
          const iy = num(e, 20);
          const sx = num(e, 41, 0, 1);
          const sy = num(e, 42, 0, 1);
          const r = (num(e, 50) * Math.PI) / 180;
          emit(b, (x, y) => tf(ix + (x * sx * Math.cos(r) - y * sy * Math.sin(r)), iy + (x * sx * Math.sin(r) + y * sy * Math.cos(r))), depth + 1);
          break;
        }
      }
    }
  };
  emit(entities, (x, y) => [x, y], 0);
  // Einheit: $INSUNITS (4 mm, 5 cm, 6 m), sonst aus der Ausdehnung schätzen
  let unit = unitCode === 4 ? 0.001 : unitCode === 5 ? 0.01 : unitCode === 6 ? 1 : 0;
  if (!unit) {
    const xs = segs.flatMap((s) => [s[0], s[2]]);
    const ext = xs.length ? Math.max(...xs) - Math.min(...xs) : 0;
    unit = ext > 400 ? 0.001 : ext > 60 ? 0.01 : 1;
  }
  return { segments: segs, texts, unit, layers: [...layers] };
}

/** DXF als maßstäblicher Vektor-Hintergrund (1 m = 100 px), Plan-y nach unten */
export function dxfBackground(d: DxfResult): { background: Omit<BackgroundImage, 'imageId'>; dataUrl: string } | null {
  if (!d.segments.length) return null;
  const u = d.unit;
  const xs = d.segments.flatMap((s) => [s[0], s[2]]).map((x) => x * u);
  const ys = d.segments.flatMap((s) => [s[1], s[3]]).map((y) => -y * u);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const W = Math.max(0.1, maxX - minX);
  const H = Math.max(0.1, maxY - minY);
  const k = 100;
  let path = '';
  for (const s of d.segments) path += `M${((s[0] * u - minX) * k).toFixed(1)} ${((-s[1] * u - minY) * k).toFixed(1)}L${((s[2] * u - minX) * k).toFixed(1)} ${((-s[3] * u - minY) * k).toFixed(1)}`;
  const txt = d.texts
    .slice(0, 2000)
    .map((t) => `<text x="${((t.x * u - minX) * k).toFixed(1)}" y="${((-t.y * u - minY) * k).toFixed(1)}" font-size="${Math.max(6, t.h * u * k).toFixed(1)}" font-family="sans-serif" fill="#334">${t.text.replace(/[&<>]/g, '')}</text>`)
    .join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${(W * k).toFixed(0)}" height="${(H * k).toFixed(0)}" viewBox="0 0 ${(W * k).toFixed(1)} ${(H * k).toFixed(1)}"><path d="${path}" fill="none" stroke="#1d3557" stroke-width="1.6" stroke-linecap="round"/>${txt}</svg>`;
  return {
    dataUrl: `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`,
    background: { widthPx: W * k, heightPx: H * k, pxPerM: k, offset: { x: minX, y: minY }, opacity: 0.6, visible: true, locked: false, calibrated: true },
  };
}

// ---------- DXF schreiben (R12, Meter) ----------

export function exportDxf(p: Project, l: Floor): string {
  const out: string[] = [];
  const g = (c: number, v: string | number) => out.push(String(c), typeof v === 'number' ? v.toFixed(4) : v);
  const Y = (y: number) => -y;
  const line = (layer: string, a: Vec, b: Vec) => {
    g(0, 'LINE');
    g(8, layer);
    g(10, a.x);
    g(20, Y(a.y));
    g(30, 0);
    g(11, b.x);
    g(21, Y(b.y));
    g(31, 0);
  };
  const polyline = (layer: string, pts: Vec[], closed = true) => {
    for (let i = 0; i + 1 < pts.length; i++) line(layer, pts[i], pts[i + 1]);
    if (closed && pts.length > 2) line(layer, pts[pts.length - 1], pts[0]);
  };
  const text = (layer: string, at: Vec, h: number, s: string) => {
    g(0, 'TEXT');
    g(8, layer);
    g(10, at.x);
    g(20, Y(at.y));
    g(30, 0);
    g(40, h);
    g(1, s);
  };
  g(0, 'SECTION');
  g(2, 'HEADER');
  g(9, '$ACADVER');
  g(1, 'AC1009');
  g(9, '$INSUNITS');
  g(70, '6');
  g(0, 'ENDSEC');
  g(0, 'SECTION');
  g(2, 'TABLES');
  g(0, 'TABLE');
  g(2, 'LAYER');
  const LAYERS: [string, number][] = [['WAENDE', 7], ['OEFFNUNGEN', 4], ['RAEUME', 3], ['MOEBEL', 8], ['TREPPEN', 6], ['MASSE', 2], ['TEXT', 7]];
  g(70, String(LAYERS.length));
  for (const [n, c] of LAYERS) {
    g(0, 'LAYER');
    g(2, n);
    g(70, '0');
    g(62, String(c));
    g(6, 'CONTINUOUS');
  }
  g(0, 'ENDTAB');
  g(0, 'ENDSEC');
  g(0, 'SECTION');
  g(2, 'ENTITIES');
  const outl = wallOutlines(l.walls);
  for (const w of l.walls) {
    const o = outl.get(w.id);
    if (o) polyline('WAENDE', o.poly);
    for (const op of w.openings) {
      const t1 = op.offset - op.width / 2;
      const t2 = op.offset + op.width / 2;
      polyline('OEFFNUNGEN', [pointOnWall(w, t1, w.thickness / 2), pointOnWall(w, t2, w.thickness / 2), pointOnWall(w, t2, -w.thickness / 2), pointOnWall(w, t1, -w.thickness / 2)]);
    }
  }
  for (const r of l.rooms) {
    polyline('RAEUME', r.polygon);
    const c = centroid(r.polygon);
    text('TEXT', c, 0.2, `${r.name} ${area(r.polygon).toFixed(2).replace('.', ',')} m2`);
  }
  for (const d of l.dimensions) {
    const dx = d.b.x - d.a.x;
    const dy = d.b.y - d.a.y;
    const L = Math.hypot(dx, dy) || 1;
    const n = { x: -dy / L, y: dx / L };
    const A = { x: d.a.x + n.x * d.offset, y: d.a.y + n.y * d.offset };
    const B = { x: d.b.x + n.x * d.offset, y: d.b.y + n.y * d.offset };
    line('MASSE', d.a, A);
    line('MASSE', d.b, B);
    line('MASSE', A, B);
    text('MASSE', { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 }, 0.15, L.toFixed(2).replace('.', ','));
  }
  for (const t of l.labels) text('TEXT', t.pos, t.size, t.text);
  g(0, 'ENDSEC');
  g(0, 'EOF');
  void p;
  return out.join('\n');
}

