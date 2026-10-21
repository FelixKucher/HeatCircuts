// Automatische Verteilung: Zuordnung der Räume zu Verteilern, Leitungsführung, Verlegeabstände.
//
// Zuordnung: Regret-Heuristik (Räume mit dem größten Nachteil bei Zweitwahl zuerst) unter Beachtung
// der maximalen Abgänge je Verteiler. Leitungsführung: A* auf einem 10-cm-Raster mit Kosten für
// Wanddurchbrüche (Türöffnungen sind frei), fremde Räume und Richtungswechsel.

import type { Floor, Project, Room, Vec } from '../model/types';
import { PIPES } from '../model/catalog';
import { area, closestPointOnPolygon, distToSegment, norm, pointInPolygon, sub, add, mul, v } from '../geometry/geom';
import { computeDesign, optimizeSpacings, allManifolds } from './design';
import { systemOf } from './surfaces';
import { uid } from '../model/factory';

const RES = 0.1;
const COST_WALL = 18;
const COST_FOREIGN_ROOM = 1.6;
const COST_TURN = 0.6;

export interface AutoLayoutReport {
  rooms: number;
  assigned: number;
  routed: number;
  spacingChanges: number;
  overCapacity: string[];
  thetaSupply: number;
}

interface Grid {
  W: number;
  H: number;
  minX: number;
  minY: number;
  cost: Float32Array;
  roomIdx: Int16Array;
}

function buildGrid(floor: Floor): Grid | null {
  const pts: Vec[] = [];
  floor.walls.forEach((w) => pts.push(w.a, w.b));
  floor.rooms.forEach((r) => pts.push(...r.polygon));
  floor.manifolds.forEach((m) => pts.push(m.pos));
  if (!pts.length) return null;
  const minX = Math.min(...pts.map((p) => p.x)) - 1;
  const minY = Math.min(...pts.map((p) => p.y)) - 1;
  const maxX = Math.max(...pts.map((p) => p.x)) + 1;
  const maxY = Math.max(...pts.map((p) => p.y)) + 1;
  const W = Math.ceil((maxX - minX) / RES);
  const H = Math.ceil((maxY - minY) / RES);
  if (W * H > 1.5e6) return null;
  const cost = new Float32Array(W * H).fill(1);
  const roomIdx = new Int16Array(W * H).fill(-1);
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const c = v(minX + (i + 0.5) * RES, minY + (j + 0.5) * RES);
      const k = j * W + i;
      const ri = floor.rooms.findIndex((r) => pointInPolygon(c, r.polygon));
      roomIdx[k] = ri;
      if (ri < 0) {
        // außerhalb der Räume: Wand oder außen
        let inWall = false;
        for (const w of floor.walls) {
          if (distToSegment(c, w.a, w.b) > w.thickness / 2 + 0.01) continue;
          inWall = true;
          // Türöffnungen sind frei passierbar
          const dir = norm(sub(w.b, w.a));
          const t = (c.x - w.a.x) * dir.x + (c.y - w.a.y) * dir.y;
          const door = w.openings.some((o) => (o.kind === 'door' || o.kind === 'entrance') && Math.abs(t - o.offset) < o.width / 2 - 0.05);
          cost[k] = door ? 1 : w.kind === 'exterior' ? 1e6 : COST_WALL;
          break;
        }
        if (!inWall) cost[k] = 6; // außerhalb des Gebäudes oder in nicht erfassten Flächen
      }
    }
  }
  return { W, H, minX, minY, cost, roomIdx };
}

class Heap {
  private a: number[] = [];
  private p: number[] = [];
  push(item: number, prio: number) {
    const a = this.a;
    const p = this.p;
    a.push(item);
    p.push(prio);
    let i = a.length - 1;
    while (i > 0) {
      const par = (i - 1) >> 1;
      if (p[par] <= p[i]) break;
      [a[i], a[par]] = [a[par], a[i]];
      [p[i], p[par]] = [p[par], p[i]];
      i = par;
    }
  }
  pop(): number | undefined {
    const a = this.a;
    const p = this.p;
    if (!a.length) return undefined;
    const top = a[0];
    const la = a.pop()!;
    const lp = p.pop()!;
    if (a.length) {
      a[0] = la;
      p[0] = lp;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && p[l] < p[m]) m = l;
        if (r < a.length && p[r] < p[m]) m = r;
        if (m === i) break;
        [a[i], a[m]] = [a[m], a[i]];
        [p[i], p[m]] = [p[m], p[i]];
        i = m;
      }
    }
    return top;
  }
  get size() {
    return this.a.length;
  }
}

/** A* vom Verteiler in den Zielraum; liefert Rasterpfad (Weltkoordinaten) und Kosten. */
function route(g: Grid, from: Vec, targetRoom: number, target: Vec): { path: Vec[]; cost: number } | null {
  const { W, H, minX, minY, cost, roomIdx } = g;
  const si = Math.min(W - 1, Math.max(0, Math.floor((from.x - minX) / RES)));
  const sj = Math.min(H - 1, Math.max(0, Math.floor((from.y - minY) / RES)));
  const ti = Math.floor((target.x - minX) / RES);
  const tj = Math.floor((target.y - minY) / RES);
  const N = W * H * 4;
  const gs = new Float32Array(N).fill(Infinity);
  const prev = new Int32Array(N).fill(-1);
  const heap = new Heap();
  const DX = [1, 0, -1, 0];
  const DY = [0, 1, 0, -1];
  const h = (i: number, j: number) => (Math.abs(i - ti) + Math.abs(j - tj)) * 0.999;
  for (let d = 0; d < 4; d++) {
    const s = (sj * W + si) * 4 + d;
    gs[s] = 0;
    heap.push(s, h(si, sj));
  }
  let goal = -1;
  let iter = 0;
  while (heap.size && iter++ < 600000) {
    const s = heap.pop()!;
    const d = s & 3;
    const k = s >> 2;
    const i = k % W;
    const j = (k - i) / W;
    if (roomIdx[k] === targetRoom) {
      goal = s;
      break;
    }
    const base = gs[s];
    for (let nd = 0; nd < 4; nd++) {
      if (nd === ((d + 2) & 3)) continue;
      const ni = i + DX[nd];
      const nj = j + DY[nd];
      if (ni < 0 || nj < 0 || ni >= W || nj >= H) continue;
      const nk = nj * W + ni;
      let c = cost[nk];
      if (c >= 1e6) continue;
      const ri = roomIdx[nk];
      if (ri >= 0 && ri !== targetRoom) c *= COST_FOREIGN_ROOM;
      const ng = base + c + (nd !== d ? COST_TURN : 0);
      const ns = nk * 4 + nd;
      if (ng < gs[ns]) {
        gs[ns] = ng;
        prev[ns] = s;
        heap.push(ns, ng + h(ni, nj));
      }
    }
  }
  if (goal < 0) return null;
  const cells: Vec[] = [];
  for (let s = goal; s >= 0; s = prev[s]) {
    const k = s >> 2;
    const i = k % W;
    const j = (k - i) / W;
    cells.push(v(minX + (i + 0.5) * RES, minY + (j + 0.5) * RES));
  }
  cells.reverse();
  // auf Knickpunkte reduzieren
  const out: Vec[] = [cells[0]];
  for (let i = 1; i < cells.length - 1; i++) {
    const a = out[out.length - 1];
    const b = cells[i];
    const c = cells[i + 1];
    const d1 = norm(sub(b, a));
    const d2 = norm(sub(c, b));
    if (Math.abs(d1.x - d2.x) > 1e-6 || Math.abs(d1.y - d2.y) > 1e-6) out.push(b);
  }
  out.push(cells[cells.length - 1]);
  return { path: out, cost: gs[goal] * RES };
}

function estimateCircuits(project: Project, room: Room, feeder: number): number {
  let n = 0;
  for (const s of room.surfaces) {
    const sys = systemOf(s);
    if (sys.medium !== 'water') continue;
    const a = s.kind === 'floor' ? Math.max(0, area(room.polygon) * s.coverage - room.excludedArea) : s.kind === 'ceiling' ? area(room.polygon) * s.coverage : 4;
    const lMax = sys.pipe ? (PIPES[sys.pipe]?.maxLength ?? 100) : project.design.maxCircuitLength;
    n += Math.max(1, Math.ceil(a / s.spacing / Math.max(10, lMax - 2 * feeder)));
  }
  return n;
}

export function autoLayout(project: Project): AutoLayoutReport {
  const report: AutoLayoutReport = { rooms: 0, assigned: 0, routed: 0, spacingChanges: 0, overCapacity: [], thetaSupply: 0 };
  const manifolds = allManifolds(project);
  if (!manifolds.length) return report;
  const load = new Map<string, number>(manifolds.map((x) => [x.m.id, 0]));

  for (const floor of project.floors) {
    const grid = buildGrid(floor);
    const local = manifolds.filter((x) => x.floor.id === floor.id);
    const rooms = floor.rooms.filter((r) => r.heated && r.surfaces.some((s) => systemOf(s).medium === 'water'));
    report.rooms += rooms.length;
    // Kosten je Raum und Verteiler
    type Option = { mid: string; cost: number; path: Vec[] | null; floorId: string };
    const options = new Map<string, Option[]>();
    for (const room of rooms) {
      const opts: Option[] = [];
      const ri = floor.rooms.indexOf(room);
      for (const x of local) {
        const tgt = closestPointOnPolygon(x.m.pos, room.polygon);
        const r = grid ? route(grid, x.m.pos, ri, tgt) : null;
        opts.push({ mid: x.m.id, cost: r ? r.cost : Math.abs(tgt.x - x.m.pos.x) + Math.abs(tgt.y - x.m.pos.y), path: r?.path ?? null, floorId: floor.id });
      }
      if (!opts.length) {
        for (const x of manifolds) {
          const tgt = closestPointOnPolygon(x.m.pos, room.polygon);
          opts.push({ mid: x.m.id, cost: Math.abs(tgt.x - x.m.pos.x) + Math.abs(tgt.y - x.m.pos.y) + 2 * Math.abs(x.floor.elevation - floor.elevation) + 3, path: null, floorId: x.floor.id });
        }
      }
      opts.sort((a, b) => a.cost - b.cost);
      options.set(room.id, opts);
    }
    const order = rooms.slice().sort((a, b) => {
      const oa = options.get(a.id)!;
      const ob = options.get(b.id)!;
      const ra = (oa[1]?.cost ?? oa[0].cost + 50) - oa[0].cost;
      const rb = (ob[1]?.cost ?? ob[0].cost + 50) - ob[0].cost;
      return rb - ra;
    });
    for (const room of order) {
      const opts = options.get(room.id)!;
      let chosen: Option | undefined;
      if (room.manifoldLocked && room.manifoldId) chosen = opts.find((o) => o.mid === room.manifoldId);
      if (!chosen) {
        for (const o of opts) {
          const m = manifolds.find((x) => x.m.id === o.mid)!.m;
          const need = estimateCircuits(project, room, o.cost);
          if ((load.get(o.mid) ?? 0) + need <= m.maxOutlets) {
            chosen = o;
            break;
          }
        }
      }
      if (!chosen) {
        chosen = opts[0];
        const m = manifolds.find((x) => x.m.id === chosen!.mid)!.m;
        if (!report.overCapacity.includes(m.name)) report.overCapacity.push(m.name);
      }
      load.set(chosen.mid, (load.get(chosen.mid) ?? 0) + estimateCircuits(project, room, chosen.cost));
      room.manifoldId = chosen.mid;
      report.assigned++;
      // Leitung übernehmen: Anschlusspunkt an der Raumkante, Zwischenpunkte aus dem A*-Pfad
      floor.routes = floor.routes.filter((r) => !(r.roomId === room.id && r.auto));
      if (chosen.path && chosen.path.length >= 2 && !floor.routes.some((r) => r.roomId === room.id)) {
        const entry = chosen.path[chosen.path.length - 1];
        const conn = closestPointOnPolygon(entry, room.polygon);
        room.connector = snapInside(conn, room);
        const pts = chosen.path.slice(1, -1).reverse();
        // letzten Punkt orthogonal an den Anschlusspunkt anbinden
        if (pts.length) {
          const first = pts[0];
          if (Math.abs(first.x - conn.x) > 0.02 && Math.abs(first.y - conn.y) > 0.02) pts.unshift(Math.abs(first.x - conn.x) < Math.abs(first.y - conn.y) ? v(conn.x, first.y) : v(first.x, conn.y));
        }
        floor.routes.push({ id: uid('l'), roomId: room.id, points: pts, auto: true });
        report.routed++;
      } else if (!floor.routes.some((r) => r.roomId === room.id)) room.connector = null;
    }
  }

  // Verlegeabstände an die Ziel-Vorlauftemperatur anpassen (gesperrte Flächen bleiben)
  const changes = optimizeSpacings(project, project.design.targetSupply);
  for (const f of project.floors)
    for (const r of f.rooms)
      for (const s of r.surfaces) {
        if (s.spacingLocked || !changes.has(s.id)) continue;
        s.spacing = changes.get(s.id)!;
        report.spacingChanges++;
      }
  if (project.design.balanceLengths) report.spacingChanges += densifyShortCircuits(project);
  report.thetaSupply = computeDesign(project).thetaSupply;
  return report;
}

/**
 * Kreise, die deutlich kürzer als das Mittel ihres Verteilers (gleiches Rohr) sind, erhalten einen
 * engeren Verlegeabstand aus der zulässigen Liste, damit sich die Längen angleichen. Nur Verdichtung:
 * mehr Rohr erhöht die Leistungsreserve, die Spreizung wird größer. Gesperrte Abstände bleiben.
 */
function densifyShortCircuits(project: Project): number {
  const design = computeDesign(project);
  let changes = 0;
  const allowed = project.design.allowedSpacings.slice().sort((a, b) => a - b);
  for (const mr of design.manifolds) {
    const groups = new Map<string, typeof mr.circuits>();
    for (const c of mr.circuits) groups.set(c.pipe, [...(groups.get(c.pipe) ?? []), c]);
    for (const [pipeKey, cs] of groups) {
      if (cs.length < 3) continue;
      const mean = cs.reduce((a, c) => a + c.length, 0) / cs.length;
      const lMax = PIPES[pipeKey]?.maxLength ?? project.design.maxCircuitLength;
      const bySurface = new Map<string, typeof cs>();
      for (const c of cs) bySurface.set(c.surfaceId, [...(bySurface.get(c.surfaceId) ?? []), c]);
      for (const [sid, list] of bySurface) {
        const c0 = list[0];
        if (c0.length >= 0.8 * mean || c0.kind !== 'floor') continue;
        const room = project.floors.flatMap((f) => f.rooms).find((r) => r.id === c0.roomId);
        const s = room?.surfaces.find((x) => x.id === sid);
        if (!room || !s || s.spacingLocked) continue;
        const n = list.length;
        const area = c0.area * n;
        let best = s.spacing;
        let bestDiff = Math.abs(c0.length - mean);
        for (const sp of allowed) {
          if (sp >= s.spacing - 1e-9) continue;
          const L = area / (n * sp) + c0.lengthFeeder;
          if (L > Math.min(lMax, project.design.maxCircuitLength) + 1e-6) continue;
          const diff = Math.abs(L - mean);
          if (diff < bestDiff - 0.5) {
            bestDiff = diff;
            best = sp;
          }
        }
        if (best !== s.spacing) {
          s.spacing = best;
          changes++;
        }
      }
    }
  }
  return changes;
}

function snapInside(p: Vec, room: Room): Vec {
  // Anschlusspunkt minimal ins Rauminnere versetzen, damit er sicher dem Raum zugeordnet ist
  const c = room.polygon.reduce((a, q) => add(a, q), v(0, 0));
  const ctr = mul(c, 1 / room.polygon.length);
  const d = norm(sub(ctr, p));
  return add(p, mul(d, 0.02));
}
