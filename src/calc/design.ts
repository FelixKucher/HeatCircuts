// Projektweite Auslegung: Heizlast → Kreisaufteilung → Vorlauftemperatur (EN 1264-3) → Massenströme → Druckverluste.

import type { Floor, Manifold, Project, Room, Vec } from '../model/types';
import { BATHROOM_TYPES, PIPES, SPACINGS, SUPPLY_PIPES, SURFACE_LIMITS } from '../model/catalog';
import { area, closestPointOnPolygon, manhattanPath, perimeter, polylineLength } from '../geometry/geom';
import { roomHeatLoad, type HeatLoadBreakdown } from './heatload';
import { fluxFromSurface, kH, logMeanExcess, massFlow, resistanceUp, sigmaFor, supplyExcess, surfaceFromFlux, type FloorBuildUp } from './en1264';
import { pipeFlow, toLitresPerMinute } from './hydraulics';

export type Warning =
  | 'no-manifold'
  | 'q-exceeds-limit'
  | 'undersupplied'
  | 'circuit-too-long'
  | 'feeder-too-long'
  | 'covering-too-high'
  | 'pressure-high';

export interface CircuitResult {
  key: string;
  roomId: string;
  floorId: string;
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
  /** zusätzliche Drosselung am Verteiler für den hydraulischen Abgleich, Pa */
  throttle: number;
}

export interface RoomResult {
  roomId: string;
  floorId: string;
  name: string;
  area: number;
  activeArea: number;
  perimeter: number;
  heatLoad: HeatLoadBreakdown;
  hasFloorHeating: boolean;
  qRequired: number;
  qLimit: number;
  qEffective: number;
  /** durch die FBH gedeckte Leistung in W */
  output: number;
  /** ungedeckte Leistung (Zusatzheizfläche) in W */
  deficit: number;
  kH: number;
  dThetaH: number;
  sigma: number;
  thetaReturn: number;
  surfaceTemp: number;
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
  massFlow: number;
  heat: number;
  maxPressureDrop: number;
  supplyLength: number;
  supplyLengthAuto: number | null;
  supplyPipe: string | null;
  supplyVelocity: number;
  supplyPressureDrop: number;
}

export interface DesignResult {
  thetaSupply: number;
  thetaSupplyAuto: boolean;
  designRoomId: string | null;
  sigmaDesign: number;
  rooms: Map<string, RoomResult>;
  manifolds: ManifoldResult[];
  totals: {
    heatLoad: number;
    output: number;
    deficit: number;
    heatedArea: number;
    activeArea: number;
    pipeInRooms: number;
    pipeFeeders: number;
    pipeTotal: number;
    circuits: number;
    massFlow: number;
    edgeStrip: number;
    rolls: number;
    rollLength: number;
    supplyLinesTotal: number;
  };
}

const MIN_SIGMA = 3;
const MAX_CIRCUITS_PER_ROOM = 12;

export function buildUp(project: Project, room: Room): FloorBuildUp {
  const pipe = PIPES[project.design.pipe] ?? PIPES['16x2'];
  return {
    spacing: room.spacing,
    rLambdaB: room.rLambdaB,
    screedCover: project.design.screedCover,
    lambdaScreed: project.design.lambdaScreed,
    pipeOuter: pipe.outer,
  };
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
  const c = room.polygon.length ? room.polygon[0] : { x: 0, y: 0 };
  const sameFloor = all.filter((x) => x.floor.id === floor.id);
  const pool = sameFloor.length ? sameFloor : all;
  let best: { m: Manifold; floor: Floor } | null = null;
  let bd = Infinity;
  for (const x of pool) {
    const p = closestPointOnPolygon(x.m.pos, room.polygon.length ? room.polygon : [c]);
    const d = Math.abs(p.x - x.m.pos.x) + Math.abs(p.y - x.m.pos.y) + Math.abs(x.floor.elevation - floor.elevation) * 2;
    if (d < bd) {
      bd = d;
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

export function surfaceLimit(room: Room): number {
  return BATHROOM_TYPES.has(room.type) ? SURFACE_LIMITS.bathroom : SURFACE_LIMITS.occupied;
}

function thetaBelow(project: Project, room: Room): number {
  switch (room.floorBoundary) {
    case 'ground':
      return project.building.thetaMeanYear;
    case 'unheated':
      return 10;
    case 'outside':
      return project.building.thetaE;
    default:
      return 20;
  }
}

export function computeDesign(project: Project): DesignResult {
  const d = project.design;
  const pipe = PIPES[d.pipe] ?? PIPES['16x2'];
  const rDown = d.insulationThickness / Math.max(0.01, d.lambdaInsulation) + 0.17;
  const rooms = new Map<string, RoomResult>();

  // 1. Heizlast und Basiswerte
  for (const floor of project.floors) {
    for (const room of floor.rooms) {
      const hl = roomHeatLoad(room, floor, project.building);
      const A = area(room.polygon);
      const Af = Math.max(0, A - room.excludedArea);
      const target = resolveManifold(project, room, floor);
      const sameFloor = !!target && target.floor.id === floor.id;
      const connector = connectorFor(room, target ? target.m.pos : null);
      let feederPath: Vec[] = [];
      let feederLength = 0;
      if (target && connector) {
        feederPath = feederPathFor(floor, room, connector, target.m.pos, sameFloor);
        feederLength = polylineLength(feederPath) + Math.abs(target.floor.elevation - floor.elevation);
      }
      const b = buildUp(project, room);
      const K = kH(b);
      const qReq = Af > 0 ? hl.total / Af : 0;
      const qLim = fluxFromSurface(surfaceLimit(room), room.thetaI);
      const warnings: Warning[] = [];
      const hasFBH = room.heated && Af > 0.5;
      if (hasFBH && !target) warnings.push('no-manifold');
      if (room.rLambdaB > 0.15) warnings.push('covering-too-high');
      rooms.set(room.id, {
        roomId: room.id,
        floorId: floor.id,
        name: room.name,
        area: A,
        activeArea: Af,
        perimeter: perimeter(room.polygon),
        heatLoad: hl,
        hasFloorHeating: hasFBH,
        qRequired: qReq,
        qLimit: qLim,
        qEffective: Math.min(qReq, qLim),
        output: 0,
        deficit: 0,
        kH: K,
        dThetaH: 0,
        sigma: 0,
        thetaReturn: 0,
        surfaceTemp: room.thetaI,
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

  // 2. Vorlauftemperatur nach EN 1264-3: maßgebend ist der Raum mit der höchsten Δθ_H (ohne Bäder)
  const all = project.floors.flatMap((f) => f.rooms.map((r) => ({ r, f })));
  let designRoomId: string | null = null;
  let thetaV: number;
  const auto = d.supplyTempFixed == null;
  if (!auto) thetaV = d.supplyTempFixed!;
  else {
    let bestSupply = -Infinity;
    for (const { r } of all) {
      const res = rooms.get(r.id)!;
      if (!res.hasFloorHeating || BATHROOM_TYPES.has(r.type) || res.qEffective <= 0) continue;
      const dh = res.qEffective / res.kH;
      const tv = r.thetaI + supplyExcess(dh, d.sigmaDesign);
      if (tv > bestSupply) {
        bestSupply = tv;
        designRoomId = r.id;
      }
    }
    if (!designRoomId) {
      for (const { r } of all) {
        const res = rooms.get(r.id)!;
        if (!res.hasFloorHeating || res.qEffective <= 0) continue;
        const tv = r.thetaI + supplyExcess(res.qEffective / res.kH, d.sigmaDesign);
        if (tv > bestSupply) {
          bestSupply = tv;
          designRoomId = r.id;
        }
      }
    }
    thetaV = designRoomId ? Math.ceil(bestSupply * 10) / 10 : 35;
  }

  // 3. Raumweise Spreizung, Massenstrom, Heizkreise
  for (const { r, f } of all) {
    const res = rooms.get(r.id)!;
    if (!res.hasFloorHeating) continue;
    let q = res.qEffective;
    let dh = q / res.kH;
    let sigma = sigmaFor(thetaV, r.thetaI, dh);
    if (sigma === null) {
      // Vorlauf reicht nicht: Leistung bei Mindestspreizung, Rest über Zusatzheizfläche
      sigma = MIN_SIGMA;
      dh = logMeanExcess(thetaV, thetaV - sigma, r.thetaI);
      q = Math.max(0, res.kH * dh);
      res.warnings.push('undersupplied');
    }
    if (res.qRequired > res.qLimit + 1e-6) res.warnings.push('q-exceeds-limit');
    res.dThetaH = dh;
    res.sigma = sigma;
    res.thetaReturn = thetaV - sigma;
    res.surfaceTemp = surfaceFromFlux(q, r.thetaI);
    res.output = q * res.activeArea;
    res.deficit = Math.max(0, res.heatLoad.total - res.output);
    const rUp = resistanceUp(buildUp(project, r));
    const mTotal = q > 0 ? massFlow(res.activeArea, q, sigma, rUp, rDown, r.thetaI, thetaBelow(project, r)) : 0;
    res.massFlow = mTotal;

    // Kreisaufteilung: L_i = A/(n·VA) + 2·l_A ≤ L_max
    const lPipeTotal = res.activeArea / r.spacing;
    const lFeed2 = 2 * res.feederLength;
    let n: number;
    if (r.circuitsOverride && r.circuitsOverride > 0) n = Math.round(r.circuitsOverride);
    else {
      const room = d.maxCircuitLength - lFeed2;
      if (room <= 5) {
        n = Math.max(1, Math.ceil(lPipeTotal / Math.max(5, d.maxCircuitLength * 0.5)));
        res.warnings.push('feeder-too-long');
      } else n = Math.max(1, Math.ceil(lPipeTotal / room));
    }
    // weitere Teilung, solange der Druckverlust je Kreis die Grenze überschreitet
    if (!(r.circuitsOverride && r.circuitsOverride > 0)) {
      while (n < MAX_CIRCUITS_PER_ROOM && pipeFlow(mTotal / n, pipe.inner, lPipeTotal / n + lFeed2).pressureDrop > d.maxPressureDrop) n++;
    }
    for (let i = 0; i < n; i++) {
      const lr = lPipeTotal / n;
      const L = lr + lFeed2;
      const m = mTotal / n;
      const pf = pipeFlow(m, pipe.inner, L);
      if (L > d.maxCircuitLength + 0.5 && !res.warnings.includes('circuit-too-long')) res.warnings.push('circuit-too-long');
      if (pf.pressureDrop > d.maxPressureDrop * 1.01 && !res.warnings.includes('pressure-high')) res.warnings.push('pressure-high');
      res.circuits.push({
        key: `${r.id}:${i}`,
        roomId: r.id,
        floorId: f.id,
        index: i,
        label: n > 1 ? `${r.name} ${i + 1}/${n}` : r.name,
        area: res.activeArea / n,
        lengthInRoom: lr,
        lengthFeeder: lFeed2,
        length: L,
        massFlow: m,
        litresPerMinute: toLitresPerMinute(m),
        velocity: pf.velocity,
        pressureDrop: pf.pressureDrop,
        throttle: 0,
      });
    }
  }

  // 4. Verteiler: Abgleich und Anbindung an den Wärmeerzeuger
  const manifolds: ManifoldResult[] = [];
  const hs = project.heatSource;
  const hsFloor = hs ? project.floors.find((f) => f.id === hs.floorId) : undefined;
  for (const { m, floor } of allManifolds(project)) {
    const circuits = [...rooms.values()].filter((r) => r.manifoldId === m.id).flatMap((r) => r.circuits);
    const maxDp = circuits.reduce((a, c) => Math.max(a, c.pressureDrop), 0);
    circuits.forEach((c) => (c.throttle = maxDp - c.pressureDrop));
    const mf = circuits.reduce((a, c) => a + c.massFlow, 0);
    const heat = [...rooms.values()].filter((r) => r.manifoldId === m.id).reduce((a, r) => a + r.output, 0);
    let auto: number | null = null;
    if (hs && hsFloor) auto = Math.abs(hs.pos.x - m.pos.x) + Math.abs(hs.pos.y - m.pos.y) + Math.abs(hsFloor.elevation - floor.elevation);
    const supplyLength = m.supplyLengthOverride ?? auto ?? 0;
    let supplyPipe: string | null = null;
    let supplyVelocity = 0;
    let supplyPressureDrop = 0;
    if (mf > 0) {
      for (const sp of SUPPLY_PIPES) {
        const pf = pipeFlow(mf, sp.inner, 2 * supplyLength);
        if (pf.velocity <= 0.7 && pf.gradient <= 150) {
          supplyPipe = sp.label;
          supplyVelocity = pf.velocity;
          supplyPressureDrop = pf.pressureDrop;
          break;
        }
      }
      if (!supplyPipe) {
        const sp = SUPPLY_PIPES[SUPPLY_PIPES.length - 1];
        const pf = pipeFlow(mf, sp.inner, 2 * supplyLength);
        supplyPipe = sp.label;
        supplyVelocity = pf.velocity;
        supplyPressureDrop = pf.pressureDrop;
      }
    }
    manifolds.push({
      manifoldId: m.id,
      floorId: floor.id,
      name: m.name,
      circuits,
      outlets: circuits.length,
      massFlow: mf,
      heat,
      maxPressureDrop: maxDp,
      supplyLength,
      supplyLengthAuto: auto,
      supplyPipe,
      supplyVelocity,
      supplyPressureDrop,
    });
  }

  // 5. Summen und Material
  const rr = [...rooms.values()];
  const circuitsAll = rr.flatMap((r) => r.circuits);
  const totals = {
    heatLoad: rr.reduce((a, r) => a + r.heatLoad.total, 0),
    output: rr.reduce((a, r) => a + r.output, 0),
    deficit: rr.reduce((a, r) => a + r.deficit, 0),
    heatedArea: rr.filter((r) => r.hasFloorHeating).reduce((a, r) => a + r.area, 0),
    activeArea: rr.filter((r) => r.hasFloorHeating).reduce((a, r) => a + r.activeArea, 0),
    pipeInRooms: circuitsAll.reduce((a, c) => a + c.lengthInRoom, 0),
    pipeFeeders: circuitsAll.reduce((a, c) => a + c.lengthFeeder, 0),
    pipeTotal: circuitsAll.reduce((a, c) => a + c.length, 0),
    circuits: circuitsAll.length,
    massFlow: circuitsAll.reduce((a, c) => a + c.massFlow, 0),
    edgeStrip: rr.filter((r) => r.hasFloorHeating).reduce((a, r) => a + r.perimeter, 0),
    rolls: firstFitDecreasing(circuitsAll.map((c) => c.length), d.rollLength),
    rollLength: d.rollLength,
    supplyLinesTotal: manifolds.reduce((a, m) => a + 2 * m.supplyLength, 0),
  };

  return { thetaSupply: thetaV, thetaSupplyAuto: auto, designRoomId, sigmaDesign: d.sigmaDesign, rooms, manifolds, totals };
}

/**
 * Größtmöglicher Verlegeabstand je Raum, mit dem der Bedarf bei der Ziel-Vorlauftemperatur
 * und der Auslegungsspreizung gedeckt wird. Liefert die geänderten Abstände je Raum-ID.
 */
export function optimizeSpacings(project: Project, targetSupply: number, minSpacing = 0.1): Map<string, number> {
  const changes = new Map<string, number>();
  const design = computeDesign(project);
  for (const floor of project.floors) {
    for (const room of floor.rooms) {
      const res = design.rooms.get(room.id);
      if (!res || !res.hasFloorHeating) continue;
      const sigma = Math.min(project.design.sigmaDesign, Math.max(0.5, targetSupply - room.thetaI - 0.5));
      const dh = logMeanExcess(targetSupply, targetSupply - sigma, room.thetaI);
      const candidates = SPACINGS.filter((s) => s >= minSpacing - 1e-9).sort((a, b) => b - a);
      let chosen = candidates[candidates.length - 1];
      for (const s of candidates) {
        const K = kH({ ...buildUp(project, room), spacing: s });
        if (K * dh >= res.qEffective) {
          chosen = s;
          break;
        }
      }
      if (Math.abs(chosen - room.spacing) > 1e-9) changes.set(room.id, chosen);
    }
  }
  return changes;
}

