// Raumweise Norm-Heizlast, vereinfachtes Verfahren in Anlehnung an EN 12831-1 / DIN/TS 12831-1.
//   Φ_HL = Φ_T + Φ_V
//   Φ_T  = Σ A·(U + ΔU_WB)·b·(θ_int − θ_e)  (Erdreich: f_g1·U·(θ_int − θ_m,e)·G_w)
//   Φ_V  = ρ·c_p · n_min · V · (θ_int − θ_e) · (1 − η_WRG)
// Nicht enthalten: Wiederaufheizleistung, Grundwassereinfluss, Wärmegewinne aus Nachbarräumen.

import type { BuildingData, Floor, Room, Wall } from '../model/types';
import { area, collinearOverlap } from '../geometry/geom';

/** ρ·c_p der Luft in Wh/(m³·K) */
export const RHO_CP_AIR = 0.34;
const F_G1 = 1.45;
const G_W = 1.0;
const B_UNHEATED_WALL = 0.5;
const B_UNHEATED_SLAB_BELOW = 0.5;
const B_UNHEATED_ATTIC = 0.8;

export interface HeatLoadBreakdown {
  extWallLength: number;
  extWallLengthAuto: number;
  unheatedWallLength: number;
  extWall: number;
  windows: number;
  unheatedWalls: number;
  floor: number;
  ceiling: number;
  interior: number;
  transmission: number;
  ventilation: number;
  total: number;
  volume: number;
}

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

export function roomHeatLoad(room: Room, floor: Floor, b: BuildingData): HeatLoadBreakdown {
  const A = area(room.polygon);
  const dT = room.thetaI - b.thetaE;
  const dU = b.deltaUTB;
  const extAuto = edgeLengthAlongWalls(room, floor.walls, 'exterior');
  const extLen = room.extWallLengthOverride ?? extAuto;
  const unhLen = edgeLengthAlongWalls(room, floor.walls, 'unheated');
  const H = floor.storeyHeight;
  const winA = Math.max(0, room.windowArea);
  const extWallArea = Math.max(0, extLen * H - winA);

  const extWall = extWallArea * (b.uExtWall + dU) * dT;
  const windows = winA * (b.uWindow + dU) * dT;
  const unheatedWalls = unhLen * H * (b.uUnheatedWall + dU) * B_UNHEATED_WALL * dT;

  let floorLoss = 0;
  switch (room.floorBoundary) {
    case 'ground':
      floorLoss = F_G1 * A * b.uGroundFloor * G_W * (room.thetaI - b.thetaMeanYear);
      break;
    case 'unheated':
      floorLoss = A * (b.uUnheatedSlab + dU) * B_UNHEATED_SLAB_BELOW * dT;
      break;
    case 'outside':
      floorLoss = A * (b.uUnheatedSlab + dU) * dT;
      break;
    case 'heated':
      floorLoss = 0;
  }

  let ceiling = 0;
  switch (room.ceilingBoundary) {
    case 'roof':
      ceiling = A * (b.uRoof + dU) * dT;
      break;
    case 'unheated':
      ceiling = A * (b.uUnheatedSlab + dU) * B_UNHEATED_ATTIC * dT;
      break;
    case 'heated':
      ceiling = 0;
  }

  // Innenwände zu kälteren Räumen desselben Geschosses
  let interior = 0;
  for (const other of floor.rooms) {
    if (other.id === room.id || other.thetaI >= room.thetaI) continue;
    const l = sharedEdgeLength(room, other);
    if (l > 0) interior += l * floor.clearHeight * b.uInteriorWall * (room.thetaI - other.thetaI);
  }

  const transmission = Math.max(0, extWall + windows + unheatedWalls + floorLoss + ceiling + interior);
  const volume = A * floor.clearHeight;
  const eta = b.heatRecovery ? Math.min(0.95, Math.max(0, b.etaHR)) : 0;
  const ventilation = Math.max(0, RHO_CP_AIR * room.airChange * volume * dT * (1 - eta));

  return {
    extWallLength: extLen,
    extWallLengthAuto: extAuto,
    unheatedWallLength: unhLen,
    extWall,
    windows,
    unheatedWalls,
    floor: floorLoss,
    ceiling,
    interior,
    transmission,
    ventilation,
    total: room.heated ? transmission + ventilation : 0,
    volume,
  };
}
