// Wärmeabgabe von Flächenheizungen je System.
//   Fußboden (Wasser): Kennlinienverfahren EN 1264-2, Überdeckung und Lastverteilschicht je System
//   Wand/Decke (Wasser): Widerstandsmodell Linienquelle in homogener Schicht + Basiskennlinie EN 1264-5
//     K_H = k / (T/(2πλ)·ln(T/(πD)) + s/λ + 1/α),  α_Wand = 8, α_Decke = 6 W/(m²K)
//   Elektro: installierte Leistungsdichte, begrenzt durch die Oberflächentemperatur

import type { DesignParams, HeatingSurface, Room, SurfaceKind } from '../model/types';
import { BATHROOM_TYPES, PIPES, SURFACE_LIMITS } from '../model/catalog';
import { HEATING_SYSTEMS, type HeatingSystem } from '../model/systems';
import { kH as kHFloor } from './en1264';

export const ALPHA: Record<SurfaceKind, number> = { floor: 10.8, wall: 8, ceiling: 6 };

export function systemOf(s: HeatingSurface): HeatingSystem {
  return HEATING_SYSTEMS[s.system] ?? HEATING_SYSTEMS.wet;
}

export function pipeOf(s: HeatingSurface, d: DesignParams): string {
  return systemOf(s).pipe ?? d.pipe;
}

export function coverOf(sys: HeatingSystem, d: DesignParams): number {
  return sys.cover === 'screed' ? d.screedCover : sys.cover === 'milled' ? d.milledCover : sys.cover;
}

export function lambdaOf(sys: HeatingSystem, d: DesignParams): number {
  return sys.lambda === 'screed' ? d.lambdaScreed : sys.lambda;
}

/** Äquivalenter Wärmedurchgangskoeffizient K_H in W/(m²K), q = K_H · Δθ_H */
export function surfaceKH(s: HeatingSurface, room: Room, d: DesignParams, spacing = s.spacing): number {
  const sys = systemOf(s);
  const pipe = PIPES[pipeOf(s, d)] ?? PIPES['16x2'];
  if (sys.model === 'en1264') {
    return sys.kFactor * kHFloor({ spacing, rLambdaB: room.rLambdaB, screedCover: coverOf(sys, d), lambdaScreed: lambdaOf(sys, d), pipeOuter: pipe.outer });
  }
  if (sys.model === 'embedded') {
    const lam = lambdaOf(sys, d);
    const T = Math.max(spacing, Math.PI * pipe.outer * 1.05);
    const rPipe = (T / (2 * Math.PI * lam)) * Math.log(T / (Math.PI * pipe.outer));
    return sys.kFactor / (rPipe + coverOf(sys, d) / lam + 1 / ALPHA[sys.kind]);
  }
  return 0;
}

/** Grenztemperatur der Oberfläche */
export function surfaceLimitTemp(kind: SurfaceKind, room: Room): number {
  if (kind === 'wall') return SURFACE_LIMITS.wall;
  if (kind === 'ceiling') return SURFACE_LIMITS.ceiling;
  return BATHROOM_TYPES.has(room.type) ? SURFACE_LIMITS.bathroom : SURFACE_LIMITS.occupied;
}

/** Wärmestromdichte aus der Oberflächenübertemperatur (Basiskennlinien EN 1264) */
export function fluxFromSurfaceTemp(kind: SurfaceKind, thetaS: number, thetaI: number): number {
  const d = thetaS - thetaI;
  if (d <= 0) return 0;
  if (kind === 'floor') return 8.92 * Math.pow(d, 1.1);
  return ALPHA[kind] * d;
}

export function surfaceTempFromFlux(kind: SurfaceKind, q: number, thetaI: number): number {
  if (q <= 0) return thetaI;
  if (kind === 'floor') return thetaI + Math.pow(q / 8.92, 1 / 1.1);
  return thetaI + q / ALPHA[kind];
}

/** Wärmeleitwiderstand zur Raumseite R_o in m²K/W */
export function resistanceToRoom(s: HeatingSurface, room: Room, d: DesignParams): number {
  const sys = systemOf(s);
  return 1 / ALPHA[sys.kind] + coverOf(sys, d) / lambdaOf(sys, d) + (sys.kind === 'floor' ? room.rLambdaB : 0);
}
