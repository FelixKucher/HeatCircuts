// Projektweite Auslegung: Heizlast → Aufteilung auf Heizflächen → Vorlauftemperatur (EN 1264-3)
// → Spreizung, Massenstrom → Kreisaufteilung → Druckverlust und Abgleich.

import type { Floor, HeatingSurface, Manifold, Project, Room, Vec } from '../model/types';
import { BATHROOM_TYPES, PIPES, SUPPLY_PIPES } from '../model/catalog';
import { area, closestPointOnPolygon, manhattanPath, perimeter, polylineLength } from '../geometry/geom';
import { defaultField, fieldArea } from '../geometry/wallfield';
import { buildContext, roomHeatLoad, type BuildingContext, type HeatLoadBreakdown } from './heatload';
import { logMeanExcess, massFlow, sigmaFor, supplyExcess } from './en1264';
import { pipeFlow, toLitresPerMinute } from './hydraulics';
import { fluxFromSurfaceTemp, pipeOf, resistanceToRoom, surfaceKH, surfaceLimitTemp, surfaceTempFromFlux, systemOf } from './surfaces';
import { layersResistance } from '../model/constructions';

export type Warning =
  | 'no-manifold'
  | 'q-exceeds-limit'
  | 'undersupplied'
  | 'circuit-too-long'
  | 'feeder-too-long'
  | 'covering-too-high'
  | 'pressure-high'
  | 'no-surface'
  | 'wall-missing'
  | 'circuit-short';

export interface CircuitResult {
  key: string;
  roomId: string;
  floorId: string;
  surfaceId: string;
  kind: HeatingSurface['kind'];
  pipe: string;
  index: number;
  label: string;
  area: number;
  lengthInRoom: number;
  lengthFeeder: number;
  length: number;
  massFlow: number;
  litresPerMinute: number;
  velocity: number;
  pressureDrop: number;
  throttle: number;
}

export interface SurfaceResult {
  surfaceId: string;
  kind: HeatingSurface['kind'];
  system: string;
  medium: 'water' | 'electric';
  label: string;
  area: number;
  /** zugeteilter Anteil der Raumheizlast in W */
  load: number;
  qRequired: number;
  qLimit: number;
  qEffective: number;
  kH: number;
  dThetaH: number;
  sigma: number;
  thetaReturn: number;
  surfaceTemp: number;
  output: number;
  massFlow: number;
  pipe: string;
  spacing: number;
  electric: { installed: number; circuits: number } | null;
  circuits: CircuitResult[];
  warnings: Warning[];
}

export interface RoomResult {
  roomId: string;
  floorId: string;
  name: string;
  area: number;
  /** belegte Fußbodenfläche (Wasser) */
  activeArea: number;
  perimeter: number;
  heatLoad: HeatLoadBreakdown;
  hasHeating: boolean;
  hasWater: boolean;
  surfaces: SurfaceResult[];
  output: number;
  deficit: number;
  massFlow: number;
  circuits: CircuitResult[];
  manifoldId: string | null;
  manifoldFloorId: string | null;
  connector: Vec | null;
  feederPath: Vec[];
  feederLength: number;
  warnings: Warning[];
}

export interface ManifoldResult {
  manifoldId: string;
  floorId: string;
  name: string;
  circuits: CircuitResult[];
  outlets: number;
  maxOutlets: number;
  massFlow: number;
  heat: number;
  maxPressureDrop: number;
  supplyLength: number;
  supplyLengthAuto: number | null;
  supplyPipe: string | null;
  supplyVelocity: number;
  supplyPressureDrop: number;
  /** kürzester / längster / mittlerer Kreis in m */
  lengthMin: number;
  lengthMax: number;
  lengthMean: number;
  /** Streuung (max − min) / Mittel */
  lengthSpread: number;
}

export interface DesignResult {
  thetaSupply: number;
  thetaSupplyAuto: boolean;
  designRoomId: string | null;
  sigmaDesign: number;
  hasManifold: boolean;
  rooms: Map<string, RoomResult>;
  manifolds: ManifoldResult[];
  ground: BuildingContext['ground'];
  totals: {
    heatLoad: number;
    output: number;
    deficit: number;
    heatedArea: number;
    activeArea: number;
    pipeInRooms: number;
    pipeFeeders: number;
    pipeTotal: number;
    pipeByType: Record<string, { length: number; rolls: number; circuits: number }>;
    circuits: number;
    massFlow: number;
    edgeStrip: number;
    rolls: number;
    rollLength: number;
    supplyLinesTotal: number;
    electricInstalled: number;
    electricCircuits: number;
  };
}

const MIN_SIGMA = 3;
const MAX_CIRCUITS_PER_SURFACE = 12;
/** maximale Leistung je elektrischem Heizkreis (16 A · 230 V) in W */
const ELECTRIC_CIRCUIT_MAX = 3680;

interface CircuitJob {
  manifoldId: string;
  r: Room;
  f: Floor;
  s: SurfaceResult;
  pipeKey: string;
  pipeInner: number;
  lMax: number;
  lPipeTotal: number;
  lFeed2: number;
  mTotal: number;
  nMin: number;
  fixed: number | null;
  n: number;
}

const lengthOf = (j: CircuitJob, n: number) => j.lPipeTotal / n + j.lFeed2;

/**
 * Längenausgleich: Für eine Ziellänge T erhält jede Fläche n = round(L_Rohr / (T − 2·l_A)) Kreise
 * (mindestens so viele, wie L_max und Δp_max verlangen). Gewählt wird die Ziellänge mit dem kleinsten
 * Variationskoeffizienten der Kreislängen, mit Aufschlag je Kreis und für überschrittene Abgänge.
 */
export function balanceCircuitCounts(list: CircuitJob[], maxOutlets: number): void {
  if (list.length < 2) return;
  const candidates = new Set<number>();
  for (const j of list) {
    for (let n = j.nMin; n <= Math.min(MAX_CIRCUITS_PER_SURFACE, j.nMin + 3); n++) {
      const L = lengthOf(j, n);
      if (L <= j.lMax + 1e-6) candidates.add(Math.round(L * 10) / 10);
    }
  }
  let best: number[] | null = null;
  let bestCost = Infinity;
  for (const T of candidates) {
    const ns = list.map((j) => {
      if (j.fixed) return j.fixed;
      const free = T - j.lFeed2;
      const n = free > 1 ? Math.round(j.lPipeTotal / free) : j.nMin;
      return Math.min(MAX_CIRCUITS_PER_SURFACE, Math.max(j.nMin, n));
    });
    const lengths = list.flatMap((j, i) => Array.from({ length: ns[i] }, () => lengthOf(j, ns[i])));
    const mean = lengths.reduce((a, x) => a + x, 0) / lengths.length;
    const sd = Math.sqrt(lengths.reduce((a, x) => a + (x - mean) * (x - mean), 0) / lengths.length);
    const total = ns.reduce((a, x) => a + x, 0);
    const cost = sd / mean + 0.02 * total + 2 * Math.max(0, total - maxOutlets);
    if (cost < bestCost - 1e-9) {
      bestCost = cost;
      best = ns;
    }
  }
  if (best) list.forEach((j, i) => (j.n = best![i]));
}

function emitCircuits(j: CircuitJob, maxDp: number): void {
  const { r, f, s, n } = j;
  for (let i = 0; i < n; i++) {
    const lr = j.lPipeTotal / n;
    const L = lr + j.lFeed2;
    const m = j.mTotal / n;
    const pf = pipeFlow(m, j.pipeInner, L);
    if (L > j.lMax + 0.5 && !s.warnings.includes('circuit-too-long')) s.warnings.push('circuit-too-long');
    if (pf.pressureDrop > maxDp * 1.01 && !s.warnings.includes('pressure-high')) s.warnings.push('pressure-high');
    const tag = s.kind === 'floor' ? '' : ` ${SURFACE_NAMES[s.kind]}`;
    s.circuits.push({
      key: `${r.id}:${s.surfaceId}:${i}`,
      roomId: r.id,
      floorId: f.id,
      surfaceId: s.surfaceId,
      kind: s.kind,
      pipe: j.pipeKey,
      index: i,
      label: `${r.name}${tag}${n > 1 ? ` ${i + 1}/${n}` : ''}`,
      area: s.area / n,
      lengthInRoom: lr,
      lengthFeeder: j.lFeed2,
      length: L,
      massFlow: m,
      litresPerMinute: toLitresPerMinute(m),
      velocity: pf.velocity,
      pressureDrop: pf.pressureDrop,
      throttle: 0,
    });
  }
}

/** Längenkennwerte der Kreise mit dem am Verteiler vorherrschenden Rohr */
export function lengthStats(circuits: CircuitResult[]): { lengthMin: number; lengthMax: number; lengthMean: number; lengthSpread: number } {
  if (!circuits.length) return { lengthMin: 0, lengthMax: 0, lengthMean: 0, lengthSpread: 0 };
  const counts = new Map<string, number>();
  for (const c of circuits) counts.set(c.pipe, (counts.get(c.pipe) ?? 0) + 1);
  const main = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const ls = circuits.filter((c) => c.pipe === main).map((c) => c.length);
  const mean = ls.reduce((a, x) => a + x, 0) / ls.length;
  const min = Math.min(...ls);
  const max = Math.max(...ls);
  return { lengthMin: min, lengthMax: max, lengthMean: mean, lengthSpread: (max - min) / mean };
}

export function allManifolds(project: Project): { m: Manifold; floor: Floor }[] {
  return project.floors.flatMap((floor) => floor.manifolds.map((m) => ({ m, floor })));
}

export function resolveManifold(project: Project, room: Room, floor: Floor): { m: Manifold; floor: Floor } | null {
  const all = allManifolds(project);
  if (room.manifoldId) {
    const hit = all.find((x) => x.m.id === room.manifoldId);
    if (hit) return hit;
  }
  const sameFloor = all.filter((x) => x.floor.id === floor.id);
  const pool = sameFloor.length ? sameFloor : all;
  let best: { m: Manifold; floor: Floor } | null = null;
  let bd = Infinity;
  for (const x of pool) {
    const p = room.polygon.length ? closestPointOnPolygon(x.m.pos, room.polygon) : x.m.pos;
    const dd = Math.abs(p.x - x.m.pos.x) + Math.abs(p.y - x.m.pos.y) + Math.abs(x.floor.elevation - floor.elevation) * 2;
    if (dd < bd) {
      bd = dd;
      best = x;
    }
  }
  return best;
}

export function connectorFor(room: Room, manifoldPos: Vec | null): Vec | null {
  if (room.connector) return room.connector;
  if (!room.polygon.length) return null;
  if (!manifoldPos) return room.polygon[0];
  return closestPointOnPolygon(manifoldPos, room.polygon);
}

export function feederPathFor(floor: Floor, room: Room, connector: Vec, manifoldPos: Vec, sameFloor: boolean): Vec[] {
  const route = floor.routes.find((r) => r.roomId === room.id);
  if (route && route.points.length && sameFloor) return [connector, ...route.points, manifoldPos];
  return manhattanPath(connector, manifoldPos);
}

function firstFitDecreasing(lengths: number[], roll: number): number {
  const bins: number[] = [];
  for (const l of lengths.slice().sort((a, b) => b - a)) {
    if (l > roll) {
      bins.push(0);
      continue;
    }
    const i = bins.findIndex((free) => free >= l);
    if (i >= 0) bins[i] -= l;
    else bins.push(roll - l);
  }
  return bins.length;
}

function thetaBelow(project: Project, floor: Floor, ctx: BuildingContext): number {
  return ctx.below(floor) ? 20 : project.building.thetaMeanYear;
}

/** Fläche einer Heizfläche in m² */
export function surfaceArea(s: HeatingSurface, room: Room, floor: Floor, voidArea: number): number {
  const A = area(room.polygon);
  if (s.kind === 'floor') return Math.max(0, (A - voidArea) * s.coverage - room.excludedArea);
  if (s.kind === 'ceiling') return Math.max(0, A * s.coverage);
  const wall = floor.walls.find((w) => w.id === s.wallId);
  if (!wall) return 0;
  const field = s.field ?? defaultField(wall, room, floor.clearHeight)!;
  return fieldArea(field, wall.openings);
}

const SURFACE_NAMES: Record<HeatingSurface['kind'], string> = { floor: 'Boden', ceiling: 'Decke', wall: 'Wand' };

export function computeDesign(project: Project): DesignResult {
  const d = project.design;
  const ctx = buildContext(project);
  const rDownFloor = d.insulationThickness / Math.max(0.01, d.lambdaInsulation) + 0.17;
  const rooms = new Map<string, RoomResult>();
  const hasManifold = project.floors.some((f) => f.manifolds.length > 0);

  // 1. Heizlast, Heizflächen und Aufteilung der Last
  for (const floor of project.floors) {
    for (const room of floor.rooms) {
      const hl = roomHeatLoad(project, room, floor, ctx);
      const A = area(room.polygon);
      const target = hasManifold ? resolveManifold(project, room, floor) : null;
      const sameFloor = !!target && target.floor.id === floor.id;
      const connector = connectorFor(room, target ? target.m.pos : null);
      let feederPath: Vec[] = [];
      let feederLength = 0;
      if (target && connector) {
        feederPath = feederPathFor(floor, room, connector, target.m.pos, sameFloor);
        feederLength = polylineLength(feederPath) + Math.abs(target.floor.elevation - floor.elevation);
      }
      const warnings: Warning[] = [];
      const surfaces: SurfaceResult[] = [];
      const active = room.heated ? room.surfaces : [];
      for (const s of active) {
        const sys = systemOf(s);
        const As = surfaceArea(s, room, floor, hl.voidArea);
        const lim = surfaceLimitTemp(s.kind, room);
        let qLim = fluxFromSurfaceTemp(s.kind, lim, room.thetaI);
        if (sys.medium === 'electric') qLim = Math.min(qLim, s.electricPower);
        const sw: Warning[] = [];
        if (s.kind === 'wall' && !floor.walls.some((w) => w.id === s.wallId)) sw.push('wall-missing');
        if (s.kind === 'floor' && room.rLambdaB > 0.15) sw.push('covering-too-high');
        surfaces.push({
          surfaceId: s.id,
          kind: s.kind,
          system: s.system,
          medium: sys.medium,
          label: `${SURFACE_NAMES[s.kind]} · ${sys.short}`,
          area: As,
          load: 0,
          qRequired: 0,
          qLimit: qLim,
          qEffective: 0,
          kH: sys.medium === 'water' ? surfaceKH(s, room, d) : 0,
          dThetaH: 0,
          sigma: 0,
          thetaReturn: 0,
          surfaceTemp: room.thetaI,
          output: 0,
          massFlow: 0,
          pipe: pipeOf(s, d),
          spacing: s.spacing,
          electric: null,
          circuits: [],
          warnings: sw,
        });
      }
      // Lastaufteilung proportional zur Leistungsfähigkeit an der Grenztemperatur
      const caps = surfaces.map((x) => x.qLimit * x.area);
      const capSum = caps.reduce((a, c) => a + c, 0);
      surfaces.forEach((x, i) => {
        x.load = capSum > 0 ? (hl.total <= capSum ? (hl.total * caps[i]) / capSum : caps[i]) : 0;
        x.qRequired = x.area > 0 ? (capSum > 0 ? (hl.total * caps[i]) / capSum : 0) / x.area : 0;
        if (capSum > 0 && hl.total > capSum + 1) x.warnings.push('q-exceeds-limit');
        x.qEffective = Math.min(x.qRequired, x.qLimit);
      });
      if (room.heated && hl.total > 0 && surfaces.length === 0) warnings.push('no-surface');
      const hasWater = surfaces.some((x) => x.medium === 'water' && x.area > 0.3);
      if (hasWater && !target) warnings.push('no-manifold');
      rooms.set(room.id, {
        roomId: room.id,
        floorId: floor.id,
        name: room.name,
        area: A,
        activeArea: surfaces.filter((x) => x.kind === 'floor' && x.medium === 'water').reduce((a, x) => a + x.area, 0),
        perimeter: perimeter(room.polygon),
        heatLoad: hl,
        hasHeating: surfaces.some((x) => x.area > 0.3),
        hasWater,
        surfaces,
        output: 0,
        deficit: 0,
        massFlow: 0,
        circuits: [],
        manifoldId: target?.m.id ?? null,
        manifoldFloorId: target?.floor.id ?? null,
        connector,
        feederPath,
        feederLength,
        warnings,
      });
    }
  }

  // 2. Vorlauftemperatur: höchster Bedarf aller Wasserflächen (Fußböden von Bädern ausgenommen)
  const all = project.floors.flatMap((f) => f.rooms.map((r) => ({ r, f })));
  let designRoomId: string | null = null;
  const auto = d.supplyTempFixed == null;
  let thetaV = 35;
  if (!auto) thetaV = d.supplyTempFixed!;
  else {
    let best = -Infinity;
    for (const pass of [true, false]) {
      for (const { r } of all) {
        const res = rooms.get(r.id)!;
        for (const s of res.surfaces) {
          if (s.medium !== 'water' || s.qEffective <= 0 || s.kH <= 0) continue;
          if (pass && s.kind === 'floor' && BATHROOM_TYPES.has(r.type)) continue;
          const tv = r.thetaI + supplyExcess(s.qEffective / s.kH, d.sigmaDesign);
          if (tv > best) {
            best = tv;
            designRoomId = r.id;
          }
        }
      }
      if (designRoomId) break;
    }
    if (designRoomId) thetaV = Math.ceil(best * 10) / 10;
  }

  // 3. Spreizung, Massenstrom, Kreise je Heizfläche
  const jobs: CircuitJob[] = [];
  for (const { r, f } of all) {
    const res = rooms.get(r.id)!;
    for (const s of res.surfaces) {
      const surf = r.surfaces.find((x) => x.id === s.surfaceId)!;
      if (s.medium === 'electric') {
        const q = s.qEffective;
        s.surfaceTemp = surfaceTempFromFlux(s.kind, q, r.thetaI);
        s.output = q * s.area;
        const installed = surf.electricPower * s.area;
        s.electric = { installed, circuits: Math.max(1, Math.ceil(installed / ELECTRIC_CIRCUIT_MAX)) };
        continue;
      }
      if (s.area <= 0.3) continue;
      let q = s.qEffective;
      let dh = s.kH > 0 ? q / s.kH : 0;
      let sigma = sigmaFor(thetaV, r.thetaI, dh);
      if (sigma === null || sigma < MIN_SIGMA) {
        // Vorlauf reicht nicht oder nur mit unwirtschaftlich kleiner Spreizung: Mindestspreizung, Rest als Zusatzheizfläche
        sigma = MIN_SIGMA;
        dh = Math.min(dh, logMeanExcess(thetaV, thetaV - sigma, r.thetaI));
        const qMax = Math.max(0, s.kH * dh);
        if (qMax < q - 1) s.warnings.push('undersupplied');
        q = Math.min(q, qMax);
      }
      s.dThetaH = dh;
      s.sigma = sigma;
      s.thetaReturn = thetaV - sigma;
      s.surfaceTemp = surfaceTempFromFlux(s.kind, q, r.thetaI);
      s.output = q * s.area;
      // Wärmeabgabe zur Rückseite (Boden nach unten, Außenwand nach außen)
      const rUp = resistanceToRoom(surf, r, d);
      let rBack = rDownFloor;
      let thetaBack = thetaBelow(project, f, ctx);
      if (s.kind === 'wall') {
        const wall = f.walls.find((w) => w.id === surf.wallId);
        const ext = wall?.kind === 'exterior';
        rBack = ext ? layersResistance(project.building.constructions.extWall.layers) + 0.04 : 0.5;
        thetaBack = ext ? project.building.thetaE : r.thetaI;
      } else if (s.kind === 'ceiling') {
        rBack = ctx.above(f) ? 0.35 : 1 / Math.max(0.05, project.building.uTopSlab);
        thetaBack = ctx.above(f) ? 20 : project.building.thetaE;
      }
      const mTotal = q > 0 ? massFlow(s.area, q, sigma, rUp, rBack, r.thetaI, thetaBack) : 0;
      s.massFlow = mTotal;

      if (!hasManifold || !res.manifoldId) continue;
      const pipeKey = s.pipe;
      const pipe = PIPES[pipeKey] ?? PIPES['16x2'];
      const lMax = systemOf(surf).pipe ? pipe.maxLength : d.maxCircuitLength;
      const lPipeTotal = s.area / surf.spacing;
      const vertical = s.kind === 'ceiling' ? f.clearHeight : s.kind === 'wall' ? (surf.field?.z0 ?? 0.2) + 0.3 : 0;
      const lFeed2 = 2 * (res.feederLength + vertical);
      let nMin: number;
      const fixed = s.kind === 'floor' && r.circuitsOverride && r.circuitsOverride > 0 ? Math.round(r.circuitsOverride) : null;
      const free = lMax - lFeed2;
      if (free <= 5) {
        nMin = Math.max(1, Math.ceil(lPipeTotal / Math.max(5, lMax * 0.5)));
        s.warnings.push('feeder-too-long');
      } else nMin = Math.max(1, Math.ceil(lPipeTotal / free));
      while (nMin < MAX_CIRCUITS_PER_SURFACE && pipeFlow(mTotal / nMin, pipe.inner, lPipeTotal / nMin + lFeed2).pressureDrop > d.maxPressureDrop) nMin++;
      jobs.push({ manifoldId: res.manifoldId, r, f, s, pipeKey, pipeInner: pipe.inner, lMax, lPipeTotal, lFeed2, mTotal, nMin: fixed ?? nMin, fixed, n: fixed ?? nMin });
    }
    res.output = res.surfaces.reduce((a, s) => a + s.output, 0);
    res.deficit = Math.max(0, res.heatLoad.total - res.output);
    res.massFlow = res.surfaces.reduce((a, s) => a + s.massFlow, 0);
  }

  // 3b. Kreisanzahl je Verteiler so wählen, dass die Kreislängen möglichst gleich sind
  // Gruppen je Verteiler und Rohrtyp: Längen sind nur bei gleichem Rohr hydraulisch vergleichbar
  const byManifold = new Map<string, CircuitJob[]>();
  for (const j of jobs) {
    const key = `${j.manifoldId}|${j.pipeKey}`;
    const list = byManifold.get(key) ?? [];
    list.push(j);
    byManifold.set(key, list);
  }
  for (const [key, list] of byManifold) {
    const mid = key.split('|')[0];
    const cap = allManifolds(project).find((x) => x.m.id === mid)?.m.maxOutlets ?? d.maxOutlets;
    // Abgänge, die andere Rohrgruppen am selben Verteiler bereits belegen
    const others = jobs.filter((j) => j.manifoldId === mid && j.pipeKey !== list[0].pipeKey).reduce((a, j) => a + j.n, 0);
    if (d.balanceLengths) balanceCircuitCounts(list, Math.max(1, cap - others));
    for (const j of list) emitCircuits(j, d.maxPressureDrop);
  }
  for (const res of rooms.values()) {
    res.circuits = res.surfaces.flatMap((s) => s.circuits);
  }
  // kurze Kreise markieren (deutlich unter dem Mittel des Verteilers)
  for (const list of byManifold.values()) {
    const all = list.flatMap((j) => j.s.circuits);
    if (all.length < 3) continue;
    const mean = all.reduce((a, c) => a + c.length, 0) / all.length;
    for (const j of list) if (j.s.circuits.some((c) => c.length < 0.5 * mean) && !j.s.warnings.includes('circuit-short')) j.s.warnings.push('circuit-short');
  }
  for (const res of rooms.values()) for (const s of res.surfaces) for (const w of s.warnings) if (!res.warnings.includes(w)) res.warnings.push(w);

  // 4. Verteiler
  const manifolds: ManifoldResult[] = [];
  const hs = project.heatSource;
  const hsFloor = hs ? project.floors.find((f) => f.id === hs.floorId) : undefined;
  for (const { m, floor } of allManifolds(project)) {
    const assigned = [...rooms.values()].filter((r) => r.manifoldId === m.id);
    const circuits = assigned.flatMap((r) => r.circuits);
    const maxDp = circuits.reduce((a, c) => Math.max(a, c.pressureDrop), 0);
    circuits.forEach((c) => (c.throttle = maxDp - c.pressureDrop));
    const mf = circuits.reduce((a, c) => a + c.massFlow, 0);
    const heat = assigned.reduce((a, r) => a + r.surfaces.filter((s) => s.medium === 'water').reduce((b, s) => b + s.output, 0), 0);
    let autoLen: number | null = null;
    if (hs && hsFloor) autoLen = Math.abs(hs.pos.x - m.pos.x) + Math.abs(hs.pos.y - m.pos.y) + Math.abs(hsFloor.elevation - floor.elevation);
    const supplyLength = m.supplyLengthOverride ?? autoLen ?? 0;
    let supplyPipe: string | null = null;
    let supplyVelocity = 0;
    let supplyPressureDrop = 0;
    if (mf > 0) {
      const pick =
        SUPPLY_PIPES.find((sp) => {
          const pf = pipeFlow(mf, sp.inner, 2 * supplyLength);
          return pf.velocity <= 0.7 && pf.gradient <= 150;
        }) ?? SUPPLY_PIPES[SUPPLY_PIPES.length - 1];
      const pf = pipeFlow(mf, pick.inner, 2 * supplyLength);
      supplyPipe = pick.label;
      supplyVelocity = pf.velocity;
      supplyPressureDrop = pf.pressureDrop;
    }
    manifolds.push({
      manifoldId: m.id,
      floorId: floor.id,
      name: m.name,
      circuits,
      outlets: circuits.length,
      maxOutlets: m.maxOutlets,
      massFlow: mf,
      heat,
      maxPressureDrop: maxDp,
      supplyLength,
      supplyLengthAuto: autoLen,
      supplyPipe,
      supplyVelocity,
      supplyPressureDrop,
      ...lengthStats(circuits),
    });
  }

  // 5. Summen und Material
  const rr = [...rooms.values()];
  const circuitsAll = rr.flatMap((r) => r.circuits);
  const pipeByType: Record<string, { length: number; rolls: number; circuits: number }> = {};
  for (const c of circuitsAll) {
    const e = (pipeByType[c.pipe] ??= { length: 0, rolls: 0, circuits: 0 });
    e.length += c.length;
    e.circuits += 1;
  }
  for (const k of Object.keys(pipeByType)) pipeByType[k].rolls = firstFitDecreasing(circuitsAll.filter((c) => c.pipe === k).map((c) => c.length), d.rollLength);
  const surfacesAll = rr.flatMap((r) => r.surfaces);
  const totals = {
    heatLoad: rr.reduce((a, r) => a + r.heatLoad.total, 0),
    output: rr.reduce((a, r) => a + r.output, 0),
    deficit: rr.reduce((a, r) => a + r.deficit, 0),
    heatedArea: rr.filter((r) => r.hasHeating).reduce((a, r) => a + r.area, 0),
    activeArea: surfacesAll.filter((s) => s.medium === 'water').reduce((a, s) => a + s.area, 0),
    pipeInRooms: circuitsAll.reduce((a, c) => a + c.lengthInRoom, 0),
    pipeFeeders: circuitsAll.reduce((a, c) => a + c.lengthFeeder, 0),
    pipeTotal: circuitsAll.reduce((a, c) => a + c.length, 0),
    pipeByType,
    circuits: circuitsAll.length,
    massFlow: circuitsAll.reduce((a, c) => a + c.massFlow, 0),
    edgeStrip: rr.filter((r) => r.surfaces.some((s) => s.kind === 'floor' && s.area > 0.3)).reduce((a, r) => a + r.perimeter, 0),
    rolls: Object.values(pipeByType).reduce((a, x) => a + x.rolls, 0),
    rollLength: d.rollLength,
    supplyLinesTotal: manifolds.reduce((a, m) => a + 2 * m.supplyLength, 0),
    electricInstalled: surfacesAll.reduce((a, s) => a + (s.electric?.installed ?? 0), 0),
    electricCircuits: surfacesAll.reduce((a, s) => a + (s.electric?.circuits ?? 0), 0),
  };

  return { thetaSupply: thetaV, thetaSupplyAuto: auto, designRoomId, sigmaDesign: d.sigmaDesign, hasManifold, rooms, manifolds, ground: ctx.ground, totals };
}

/**
 * Größter zulässiger Verlegeabstand einer Wasserfläche, mit dem der Bedarf bei der
 * Ziel-Vorlauftemperatur und der Auslegungsspreizung gedeckt wird.
 */
export function bestSpacing(project: Project, room: Room, s: HeatingSurface, qNeeded: number, targetSupply: number): number {
  const allowed = project.design.allowedSpacings.slice().sort((a, b) => b - a);
  if (!allowed.length) return s.spacing;
  const sigma = Math.min(project.design.sigmaDesign, Math.max(0.5, targetSupply - room.thetaI - 0.5));
  const dh = logMeanExcess(targetSupply, targetSupply - sigma, room.thetaI);
  for (const sp of allowed) if (surfaceKH(s, room, project.design, sp) * dh >= qNeeded) return sp;
  return allowed[allowed.length - 1];
}

/** Verlegeabstände aller Wasserflächen an die Ziel-Vorlauftemperatur anpassen; liefert Änderungen je Fläche. */
export function optimizeSpacings(project: Project, targetSupply: number): Map<string, number> {
  const changes = new Map<string, number>();
  const design = computeDesign(project);
  for (const floor of project.floors) {
    for (const room of floor.rooms) {
      const res = design.rooms.get(room.id);
      if (!res) continue;
      for (const sr of res.surfaces) {
        if (sr.medium !== 'water' || sr.area <= 0.3) continue;
        const s = room.surfaces.find((x) => x.id === sr.surfaceId)!;
        const sp = bestSpacing(project, room, s, sr.qEffective, targetSupply);
        if (Math.abs(sp - s.spacing) > 1e-9) changes.set(s.id, sp);
      }
    }
  }
  return changes;
}
