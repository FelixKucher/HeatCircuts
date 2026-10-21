// Rohrverlauf mit Biegeradien: Ecken als Kreisbögen, enge 180°-Umlenkungen als Omega-Bogen.

import type { Vec } from '../model/types';
import { add, cross, dist, dot, mul, norm, sub } from './geom';

const f = (x: number) => (Math.round(x * 1000) / 1000).toString();

export interface PipePathStats {
  /** Anzahl Omega-Bögen (Umlenkung enger als 2 · Biegeradius) */
  omegas: number;
}

/**
 * SVG-Pfad eines Rohrzugs. `radius` ist der Mindestbiegeradius; an kurzen Segmenten wird er
 * so weit reduziert, dass sich benachbarte Bögen nicht überschneiden.
 */
export function pipePathD(points: Vec[], radius: number, stats?: PipePathStats): string {
  const p = points.filter((q, i) => i === 0 || dist(q, points[i - 1]) > 1e-6);
  if (p.length < 2) return '';
  if (p.length === 2 || radius <= 0) return `M${f(p[0].x)} ${f(p[0].y)}` + p.slice(1).map((q) => `L${f(q.x)} ${f(q.y)}`).join('');
  let d = `M${f(p[0].x)} ${f(p[0].y)}`;
  // verfügbare Länge je Segment für Bögen an beiden Enden
  const segLen = p.slice(1).map((q, i) => dist(p[i], q));
  let i = 1;
  while (i < p.length - 1) {
    const A = p[i - 1];
    const B = p[i];
    const C = p[i + 1];
    const d1 = norm(sub(B, A));
    const d2 = norm(sub(C, B));
    const turn = cross(d1, d2);
    // Omega-Bogen: zwei gleichsinnige 90°-Ecken mit kurzem Zwischenstück, Rohr läuft zurück
    if (i + 2 < p.length) {
      const D = p[i + 2];
      const d3 = norm(sub(D, C));
      const bc = dist(B, C);
      const turn2 = cross(d2, d3);
      if (dot(d1, d3) < -0.98 && Math.sign(turn) === Math.sign(turn2) && Math.abs(turn) > 0.9 && bc < 2 * radius - 1e-6) {
        const h = Math.sqrt(Math.max(0, radius * radius - (bc / 2) * (bc / 2)));
        const back = radius + h;
        if (segLen[i - 1] > back + 0.01 && segLen[i + 1] > back + 0.01) {
          const B2 = sub(B, mul(d1, back));
          const C2 = add(C, mul(d3, back));
          const sweep = turn > 0 ? 1 : 0;
          d += `L${f(B2.x)} ${f(B2.y)}A${f(radius)} ${f(radius)} 0 1 ${sweep} ${f(C2.x)} ${f(C2.y)}`;
          segLen[i + 1] -= back;
          if (stats) stats.omegas++;
          i += 2;
          continue;
        }
      }
    }
    const cosT = Math.max(-1, Math.min(1, dot(d1, d2)));
    const theta = Math.acos(cosT);
    if (theta < 1e-3) {
      d += `L${f(B.x)} ${f(B.y)}`;
      i++;
      continue;
    }
    const tanHalf = Math.tan(theta / 2);
    let t = radius * tanHalf;
    const lim = Math.min(segLen[i - 1], segLen[i]) / 2;
    if (t > lim) t = lim;
    const r = t / tanHalf;
    const P = sub(B, mul(d1, t));
    const Q = add(B, mul(d2, t));
    d += `L${f(P.x)} ${f(P.y)}A${f(r)} ${f(r)} 0 0 ${turn > 0 ? 1 : 0} ${f(Q.x)} ${f(Q.y)}`;
    segLen[i] -= t;
    i++;
  }
  // restliche Punkte
  for (; i < p.length; i++) d += `L${f(p[i].x)} ${f(p[i].y)}`;
  return d;
}
