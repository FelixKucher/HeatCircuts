// Raumfläche ohne Deckenöffnungen als Polygon (für die Verlegung): Rasterung, Abzug der Öffnungen,
// Kontur der größten verbleibenden Teilfläche.

import type { FloorVoid, Vec } from '../model/types';
import { bbox, cleanPolygon, pointInPolygon, simplifyPolygon, v } from './geom';
import { components, traceContour } from './raster';
import { orthogonalize } from './recognize';

const cache = new Map<string, Vec[]>();

export function subtractVoids(poly: Vec[], voids: FloorVoid[], res = 0.05): Vec[] {
  if (!voids.length) return poly;
  const b = bbox(poly);
  const hits = voids.filter((vd) => {
    const vb = bbox(vd.polygon);
    return vb.max.x > b.min.x && vb.min.x < b.max.x && vb.max.y > b.min.y && vb.min.y < b.max.y;
  });
  if (!hits.length) return poly;
  const key = JSON.stringify([poly, hits.map((h) => h.polygon)]);
  const c = cache.get(key);
  if (c) return c;
  const W = Math.ceil((b.max.x - b.min.x) / res) + 2;
  const H = Math.ceil((b.max.y - b.min.y) / res) + 2;
  const ox = b.min.x - res;
  const oy = b.min.y - res;
  const inside = new Uint8Array(W * H);
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const p = v(ox + (i + 0.5) * res, oy + (j + 0.5) * res);
      if (pointInPolygon(p, poly) && !hits.some((h) => pointInPolygon(p, h.polygon))) inside[j * W + i] = 1;
    }
  }
  const { labels, sizes } = components(W, H, (k) => inside[k] === 1);
  if (!sizes.length) return poly;
  const best = sizes.indexOf(Math.max(...sizes));
  let start = -1;
  for (let k = 0; k < W * H; k++) if (labels[k] === best) { start = k; break; }
  const pts = traceContour(W, H, (i, j) => labels[j * W + i] === best, start).map((p) => v(ox + p.x * res, oy + p.y * res));
  const out = orthogonalize(cleanPolygon(simplifyPolygon(pts, res * 1.2), 1e-3));
  if (cache.size > 200) cache.clear();
  cache.set(key, out.length >= 3 ? out : poly);
  return cache.get(key)!;
}
