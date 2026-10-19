// Raumweise Norm-Heizlast, vereinfachtes Verfahren in Anlehnung an EN 12831-1 / DIN/TS 12831-1.
//   Φ_HL = Φ_T + Φ_V
//   Φ_T  = Σ A·(U + ΔU_WB)·b·(θ_int − θ_e)
//   Erdreich: Φ = f_g1·A·U_equiv·G_w·(θ_int − θ_m,e) mit U_equiv nach EN ISO 13370
//   Φ_V  = ρ·c_p · n_min · V · (θ_int − θ_e) · (1 − η_WRG)
// Nachbarflächen oberhalb/unterhalb werden aus der Überlagerung der Geschosse ermittelt.
// Nicht enthalten: Wiederaufheizleistung, Grundwassereinfluss, Wärmegewinne aus Nachbarräumen.

import type { BuildingData, Floor, Project, Room, Wall } from '../model/types';
import { ROOM_TYPES } from '../model/catalog';
import { layersResistance, uValue } from '../model/constructions';
import { area, collinearOverlap, dist, norm, sub, add, mul } from '../geometry/geom';
import { footprint, inVoid, inWalls, roomAt, samplePolygon } from '../geometry/sampling';
import { roomSpanOnWall } from '../geometry/wallfield';
import { buildingBounds, buriedHeight, type Bounds } from '../geometry/terrain';

/** ρ·c_p der Luft in Wh/(m³·K) */
export const RHO_CP_AIR = 0.34;
const F_G1 = 1.45;
const G_W = 1.0;
const LAMBDA_GROUND = 2.0;
const B_UNHEATED_WALL_DEFAULT = 0.5;
const B_TOP_SLAB = 0.8;
/** U-Wert einer Geschossdecke zwischen beheizten Räumen unterschiedlicher Temperatur */
const U_INTERIOR_SLAB = 1.0;
const SAMPLE_STEP = 0.15;

export interface BoundaryShare {
  /** Fläche in m² */
  area: number;
  /** Wärmestrom in W */
  loss: number;
}

export interface HeatLoadBreakdown {
  extWallLength: number;
  extWallLengthAuto: number;
  unheatedWallLength: number;
  windowArea: number;
  doorArea: number;
  extWall: number;
  /** Haustrennwände zum beheizten Nachbarn */
  partyWalls: number;
  windows: number;
  unheatedWalls: number;
  floor: number;
  ceiling: number;
  interior: number;
  transmission: number;
  ventilation: number;
  total: number;
  volume: number;
  floorParts: Record<string, BoundaryShare>;
  ceilingParts: Record<string, BoundaryShare>;
  /** Bodenfläche über Deckenöffnungen (Treppe, Luftraum) */
  voidArea: number;
  /** erdberührte Außenwandfläche (Hanglage, Keller) in m² und ihr Anteil am Verlust in W */
  earthWallArea: number;
  earthWall: number;
}

// ---------- Erdreich nach EN ISO 13370 ----------

export interface GroundParams {
  area: number;
  perimeter: number;
  bPrime: number;
  dt: number;
  uSlab: number;
  /** Tiefe des Kellerfußbodens unter Gelände (0 = Bodenplatte) */
  z: number;
  uBasementWall: number;
  /** wirksame Dicke der Außenwand d_w nach EN ISO 13370 */
  dw: number;
  /** mittlere Außenwanddicke w */
  wallThickness: number;
}

export function uSlabOnGround(bPrime: number, dt: number): number {
  if (dt < bPrime) return ((2 * LAMBDA_GROUND) / (Math.PI * bPrime + dt)) * Math.log((Math.PI * bPrime) / dt + 1);
  return LAMBDA_GROUND / (0.457 * bPrime + dt);
}

export function uBasementFloor(bPrime: number, dt: number, z: number): number {
  const d = dt + 0.5 * z;
  if (d < bPrime) return ((2 * LAMBDA_GROUND) / (Math.PI * bPrime + d)) * Math.log((Math.PI * bPrime) / d + 1);
  return LAMBDA_GROUND / (0.457 * bPrime + d);
}

export function uBasementWall(z: number, dt: number, dw: number): number {
  if (z <= 0) return 0;
  return ((2 * LAMBDA_GROUND) / (Math.PI * z)) * (1 + (0.5 * dt) / (dt + z)) * Math.log(z / dw + 1);
}

// ---------- Kontext je Projekt ----------

export interface BuildingContext {
  sorted: Floor[];
  below(f: Floor): Floor | null;
  above(f: Floor): Floor | null;
  isTop(f: Floor): boolean;
  isLowest(f: Floor): boolean;
  footprintInside(f: Floor): ((p: { x: number; y: number }) => boolean) | null;
  ground: GroundParams;
  bounds: Bounds | null;
}

export function buildContext(project: Project): BuildingContext {
  const sorted = project.floors.slice().sort((a, b) => a.elevation - b.elevation);
  const idx = new Map(sorted.map((f, i) => [f.id, i]));
  const fpCache = new Map<string, ReturnType<typeof footprint>>();
  const fp = (f: Floor) => {
    if (!fpCache.has(f.id)) fpCache.set(f.id, footprint(f.walls));
    return fpCache.get(f.id)!;
  };
  const lowest = sorted[0];
  const b = project.building;
  const ext = lowest.walls.filter((w) => w.kind === 'exterior');
  const perim = ext.reduce((a, w) => a + dist(w.a, w.b), 0);
  const fpl = fp(lowest);
  const roomsArea = lowest.rooms.reduce((a, r) => a + area(r.polygon), 0);
  const A = fpl?.area ?? roomsArea * 1.15;
  const P = perim > 0 ? perim : 4 * Math.sqrt(Math.max(A, 1));
  const w = ext.length ? ext.reduce((a, x) => a + x.thickness, 0) / ext.length : 0.3;
  const bPrime = Math.max(0.5, A / (0.5 * P));
  const rf = layersResistance(b.constructions.groundSlab.layers);
  const dt = w + LAMBDA_GROUND * (0.17 + rf + 0.04);
  const rw = layersResistance(b.constructions.extWall.layers);
  const dw = LAMBDA_GROUND * (0.13 + rw + 0.04);
  // Einbindetiefe des untersten Fußbodens: längengewichtetes Mittel der Erdanschüttung (Hanglage, Keller)
  const bounds = buildingBounds(project);
  const zBuried = perim > 0 ? ext.reduce((a, x) => a + dist(x.a, x.b) * buriedHeight(project, lowest, x, bounds), 0) / perim : 0;
  const z = lowest.belowGrade ? Math.max(0.5, zBuried) : zBuried > 0.05 ? zBuried : 0;
  const uSlab = z > 0 ? uBasementFloor(bPrime, dt, z) : uSlabOnGround(bPrime, dt);
  return {
    sorted,
    below: (f) => sorted[(idx.get(f.id) ?? 0) - 1] ?? null,
    above: (f) => sorted[(idx.get(f.id) ?? 0) + 1] ?? null,
    isTop: (f) => idx.get(f.id) === sorted.length - 1,
    isLowest: (f) => idx.get(f.id) === 0,
    footprintInside: (f) => fp(f)?.inside ?? null,
    ground: { area: A, perimeter: P, bPrime, dt, uSlab, z, uBasementWall: uBasementWall(z, dt, dw), dw, wallThickness: w },
    bounds,
  };
}

/** U_equiv der Bodenplatte für einen raumeigenen Bodenaufbau (Wärmedurchlasswiderstand R_f) */
function groundU(ctx: BuildingContext, rf: number): number {
  const g = ctx.ground;
  const dt = g.wallThickness + LAMBDA_GROUND * (0.17 + rf + 0.04);
  return g.z > 0 ? uBasementFloor(g.bPrime, dt, g.z) : uSlabOnGround(g.bPrime, dt);
}

// ---------- Kanten und Öffnungen ----------

/** Länge der Raumkanten, die an Wände einer bestimmten Art grenzen. */
export function edgeLengthAlongWalls(room: Room, walls: Wall[], kind: Wall['kind']): number {
  let sum = 0;
  const poly = room.polygon;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    let edgeSum = 0;
    for (const w of walls) {
      if (w.kind !== kind) continue;
      edgeSum += collinearOverlap(a, b, w.a, w.b, w.thickness / 2 + 0.15);
    }
    sum += Math.min(edgeSum, Math.hypot(b.x - a.x, b.y - a.y));
  }
  return sum;
}

/** Gemeinsame Kantenlänge zweier Räume (getrennt durch eine Innenwand bis 40 cm). */
export function sharedEdgeLength(r1: Room, r2: Room): number {
  let sum = 0;
  const p = r1.polygon;
  const q = r2.polygon;
  for (let i = 0; i < p.length; i++) {
    for (let j = 0; j < q.length; j++) {
      sum += collinearOverlap(p[i], p[(i + 1) % p.length], q[j], q[(j + 1) % q.length], 0.4);
    }
  }
  return sum;
}

export interface RoomOpening {
  wall: Wall;
  kind: string;
  area: number;
  /** eigener U-Wert der Öffnung */
  u: number | null;
}

/** Öffnungen in Wänden, die an den Raum grenzen (anteilig nach Überdeckung mit der Raumkante). */
export function openingsOfRoom(room: Room, walls: Wall[], kinds: Wall['kind'][] = ['exterior']): RoomOpening[] {
  const res: RoomOpening[] = [];
  const poly = room.polygon;
  for (const w of walls) {
    if (!kinds.includes(w.kind) || !w.openings.length) continue;
    const dir = norm(sub(w.b, w.a));
    for (const o of w.openings) {
      const p1 = add(w.a, mul(dir, o.offset - o.width / 2));
      const p2 = add(w.a, mul(dir, o.offset + o.width / 2));
      let ov = 0;
      for (let i = 0; i < poly.length; i++) ov += collinearOverlap(poly[i], poly[(i + 1) % poly.length], p1, p2, w.thickness / 2 + 0.15);
      const frac = Math.min(1, ov / Math.max(o.width, 1e-6));
      if (frac > 0.05) res.push({ wall: w, kind: o.kind, area: frac * o.width * o.height, u: o.uValue ?? null });
    }
  }
  return res;
}

const bOf = (r: Room) => (r.heated ? 0 : (ROOM_TYPES[r.type]?.bU ?? B_UNHEATED_WALL_DEFAULT));

function addPart(parts: Record<string, BoundaryShare>, key: string, a: number, loss: number) {
  const p = (parts[key] ??= { area: 0, loss: 0 });
  p.area += a;
  p.loss += loss;
}

// ---------- Heizlast eines Raums ----------

export function roomHeatLoad(project: Project, room: Room, floor: Floor, ctx: BuildingContext): HeatLoadBreakdown {
  const b: BuildingData = project.building;
  const A = area(room.polygon);
  const dT = room.thetaI - b.thetaE;
  const dU = b.deltaUTB;
  const H = floor.storeyHeight;

  // Außenwände, Fenster, Türen
  const extAuto = edgeLengthAlongWalls(room, floor.walls, 'exterior');
  const extLen = room.extWallLengthOverride ?? extAuto;
  const unhLen = edgeLengthAlongWalls(room, floor.walls, 'unheated');
  const ops = openingsOfRoom(room, floor.walls, ['exterior']);
  const winA = ops.filter((o) => o.kind === 'window').reduce((a, o) => a + o.area, 0) + Math.max(0, room.windowArea);
  const doorA = ops.filter((o) => o.kind === 'door' || o.kind === 'entrance' || o.kind === 'garage').reduce((a, o) => a + o.area, 0);
  const site = project.site;
  const thetaN = site?.neighbourTemp ?? 15;
  const uWall = (w: Wall) => (w.construction?.layers.length ? uValue('extWall', w.construction.layers) : b.uExtWall);
  const grossExt = extLen * H;
  const netExt = Math.max(0, grossExt - winA - doorA);
  let extWall: number;
  let earthWallArea = 0;
  let earthWall = 0;
  if (room.extWallLengthOverride != null) {
    // Handangabe: Erdanteil wie Kellergeschoss, sonst Außenluft
    const share = floor.belowGrade ? Math.min(H, ctx.ground.z) / H : 0;
    earthWallArea = netExt * share;
    earthWall = F_G1 * earthWallArea * ctx.ground.uBasementWall * G_W * (room.thetaI - b.thetaMeanYear);
    extWall = netExt * (1 - share) * (b.uExtWall + dU) * dT + earthWall;
  } else {
    // je Außenwand: erdberührter Teil bis h_b (Gelände, Hanglage) nach EN ISO 13370, darüber Außenluft
    extWall = 0;
    for (const w of floor.walls) {
      if (w.kind !== 'exterior') continue;
      const span = roomSpanOnWall(w, room);
      if (!span) continue;
      const len = span.t1 - span.t0;
      if (len < 0.05) continue;
      const hb = buriedHeight(project, floor, w, ctx.bounds, span.t0, span.t1);
      const wOps = ops.filter((o) => o.wall === w).reduce((a, o) => a + o.area, 0);
      const gross = len * H;
      const buried = len * hb;
      const above = Math.max(0, gross - buried - wOps);
      const ew = hb > 0.02 ? F_G1 * buried * uBasementWall(hb, ctx.ground.dt, ctx.ground.dw) * G_W * (room.thetaI - b.thetaMeanYear) : 0;
      earthWallArea += buried;
      earthWall += ew;
      extWall += above * (uWall(w) + dU) * dT + ew;
    }
  }
  // Haustrennwände zum beheizten Nachbarhaus bzw. zur Nachbarwohnung
  let partyWalls = 0;
  for (const w of floor.walls) {
    if (w.kind !== 'party') continue;
    const span = roomSpanOnWall(w, room);
    if (!span) continue;
    const u = w.construction?.layers.length ? uValue('unheatedWall', w.construction.layers) : b.uPartyWall ?? 0.9;
    partyWalls += (span.t1 - span.t0) * H * u * Math.max(0, room.thetaI - thetaN);
  }
  // Fenster und Türen mit eigenem U-Wert je Öffnung (sonst Gebäudewert)
  let windows = Math.max(0, room.windowArea) * (b.uWindow + dU) * dT;
  for (const o of ops) {
    const u = o.u ?? (o.kind === 'window' ? b.uWindow : b.uDoor);
    windows += o.area * (u + dU) * dT;
  }
  const unheatedWalls = unhLen * H * (b.uUnheatedWall + dU) * B_UNHEATED_WALL_DEFAULT * dT;

  // Nachbarräume im Geschoss
  let interior = 0;
  for (const other of floor.rooms) {
    if (other.id === room.id) continue;
    const l = sharedEdgeLength(room, other);
    if (l <= 0) continue;
    if (!other.heated) interior += l * floor.clearHeight * (b.uUnheatedWall + dU) * bOf(other) * dT;
    else if (other.thetaI < room.thetaI) interior += l * floor.clearHeight * b.uInteriorWall * (room.thetaI - other.thetaI);
  }

  // Boden und Decke: Überlagerung mit den Nachbargeschossen
  const pts = samplePolygon(room.polygon, SAMPLE_STEP);
  const cell = pts.length ? A / pts.length : 0;
  const floorParts: Record<string, BoundaryShare> = {};
  const ceilingParts: Record<string, BoundaryShare> = {};
  const below = ctx.below(floor);
  const above = ctx.above(floor);
  const aboveInside = above ? ctx.footprintInside(above) : null;
  const roof = project.roof;
  // Aufbauten nur dieses Raums (sonst Gebäudewerte)
  const fc = room.floorConstruction?.layers.length ? room.floorConstruction.layers : null;
  const cc = room.ceilingConstruction?.layers.length ? room.ceilingConstruction.layers : null;
  const uSlab = fc ? groundU(ctx, layersResistance(fc)) : ctx.ground.uSlab;
  const uFloorUnheated = fc ? uValue('basementSlab', fc) : b.uUnheatedSlab;
  const uRoof = cc ? uValue('roof', cc) : b.uRoof;
  const uTop = cc ? uValue('topSlab', cc) : b.uTopSlab;
  const isFlat = site?.houseType === 'whg';
  const neighborBelow = isFlat && site.unitPosition !== 'ground';
  const neighborAbove = isFlat && site.unitPosition !== 'top';
  const slopeFactor = roof.type === 'flat' || roof.type === 'none' ? 1 : 1 / Math.cos((Math.min(75, Math.max(0, roof.pitch)) * Math.PI) / 180);
  let voidArea = 0;

  for (const p of pts) {
    // --- Boden ---
    if (inVoid(p, floor.voids)) voidArea += cell;
    else if (room.floorBoundary !== 'auto') {
      floorLossFixed(room.floorBoundary);
    } else if (!below) {
      if (neighborBelow) floorLossFixed('neighbor');
      else if (b.basement === 'unheated' && !floor.belowGrade) addPart(floorParts, 'Kellerdecke', cell, cell * (uFloorUnheated + dU) * 0.5 * dT);
      else addPart(floorParts, 'Erdreich', cell, F_G1 * cell * uSlab * G_W * (room.thetaI - b.thetaMeanYear));
    } else {
      const r = roomAt(p, below.rooms);
      if (inVoid(p, below.voids)) {
        // offener Luftraum darunter – kein Verlust
      } else if (r && !r.heated) {
        addPart(floorParts, `über ${r.name}`, cell, cell * (uFloorUnheated + dU) * bOf(r) * dT);
      } else if (r && r.thetaI < room.thetaI) {
        addPart(floorParts, `über ${r.name}`, cell, cell * U_INTERIOR_SLAB * (room.thetaI - r.thetaI));
      } else if (!r && !inWalls(p, below.walls) && !(ctx.footprintInside(below)?.(p) ?? true)) {
        addPart(floorParts, 'gegen Außenluft', cell, cell * (uFloorUnheated + dU) * dT);
      }
    }
    // --- Decke ---
    if (room.ceilingBoundary !== 'auto') {
      ceilingLossFixed(room.ceilingBoundary);
    } else if (!above) {
      if (neighborAbove) ceilingLossFixed('neighbor');
      else topCeiling();
    } else {
      const r = roomAt(p, above.rooms);
      if (inVoid(p, above.voids)) {
        // Treppe/Luftraum nach oben offen
      } else if (r && !r.heated) {
        const isAttic = r.type === 'dachboden';
        addPart(ceilingParts, `unter ${r.name}`, cell, cell * ((isAttic ? uTop : cc ? uTop : b.uUnheatedSlab) + dU) * bOf(r) * dT);
      } else if (r && r.thetaI < room.thetaI) {
        addPart(ceilingParts, `unter ${r.name}`, cell, cell * U_INTERIOR_SLAB * (room.thetaI - r.thetaI));
      } else if (!r && !inWalls(p, above.walls) && !(aboveInside?.(p) ?? true)) {
        if (neighborAbove) ceilingLossFixed('neighbor');
        else topCeiling();
      }
    }

    function topCeiling() {
      if (roof.type === 'none' || roof.type === 'flat' || roof.insulation === 'rafters') {
        addPart(ceilingParts, roof.type === 'flat' || roof.type === 'none' ? 'Flachdach' : 'Dachschräge', cell, cell * slopeFactor * (uRoof + dU) * dT);
      } else addPart(ceilingParts, 'oberste Geschossdecke', cell, cell * (uTop + dU) * B_TOP_SLAB * dT);
    }
    function floorLossFixed(kind: Room['floorBoundary']) {
      if (kind === 'ground') addPart(floorParts, 'Erdreich', cell, F_G1 * cell * uSlab * G_W * (room.thetaI - b.thetaMeanYear));
      else if (kind === 'unheated') addPart(floorParts, 'gegen unbeheizt', cell, cell * (uFloorUnheated + dU) * 0.5 * dT);
      else if (kind === 'outside') addPart(floorParts, 'gegen Außenluft', cell, cell * (uFloorUnheated + dU) * dT);
      else if (kind === 'neighbor') addPart(floorParts, 'über Nachbarwohnung', cell, cell * U_INTERIOR_SLAB * Math.max(0, room.thetaI - thetaN));
    }
    function ceilingLossFixed(kind: Room['ceilingBoundary']) {
      if (kind === 'roof') topCeiling();
      else if (kind === 'unheated') addPart(ceilingParts, 'gegen unbeheizt', cell, cell * (uTop + dU) * B_TOP_SLAB * dT);
      else if (kind === 'neighbor') addPart(ceilingParts, 'unter Nachbarwohnung', cell, cell * U_INTERIOR_SLAB * Math.max(0, room.thetaI - thetaN));
    }
  }

  const floorLoss = Object.values(floorParts).reduce((a, x) => a + x.loss, 0);
  const ceiling = Object.values(ceilingParts).reduce((a, x) => a + x.loss, 0);
  const transmission = Math.max(0, extWall + partyWalls + windows + unheatedWalls + floorLoss + ceiling + interior);
  const volume = A * floor.clearHeight;
  const eta = b.heatRecovery ? Math.min(0.95, Math.max(0, b.etaHR)) : 0;
  const ventilation = Math.max(0, RHO_CP_AIR * room.airChange * volume * dT * (1 - eta));

  return {
    extWallLength: extLen,
    extWallLengthAuto: extAuto,
    unheatedWallLength: unhLen,
    windowArea: winA,
    doorArea: doorA,
    extWall,
    partyWalls,
    windows,
    unheatedWalls,
    floor: floorLoss,
    ceiling,
    interior,
    transmission,
    ventilation,
    total: room.heated ? transmission + ventilation : 0,
    volume,
    floorParts,
    ceilingParts,
    voidArea,
    earthWallArea,
    earthWall,
  };
}
