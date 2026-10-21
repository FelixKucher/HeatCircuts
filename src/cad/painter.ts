// „Format übertragen“: Eigenschaften eines Objekts auf andere gleicher Art kopieren (ohne Geometrie).
// Umfang je Arbeitsphase: Heizlast = Hülle und Aufbau, Heizflächen/Heizkreise = Heizung.

import type { Floor, HeatingSurface, Opening, Project, Room, Wall } from '../model/types';
import type { Phase, SelItem } from '../model/store';
import { applyRoomType, uid } from '../model/factory';
import { clampOpening } from './walls';

export interface FormatData {
  kind: 'wall' | 'opening' | 'room';
  phase: Phase;
  data: Record<string, unknown>;
  label: string;
}

const clone = <T>(x: T): T => (x === undefined ? x : JSON.parse(JSON.stringify(x)));

export function pickFormat(floor: Floor, it: SelItem, phase: Phase): FormatData | null {
  if (it.kind === 'wall') {
    const w = floor.walls.find((x) => x.id === it.id);
    if (!w) return null;
    const data: Partial<Wall> = { kind: w.kind, kindAuto: w.kindAuto, construction: clone(w.construction ?? null), thickness: w.thickness };
    return { kind: 'wall', phase, data, label: 'Wand' };
  }
  if (it.kind === 'opening') {
    const w = floor.walls.find((x) => x.id === it.wallId);
    const o = w?.openings.find((x) => x.id === it.id);
    if (!o) return null;
    const data: Partial<Opening> = { style: o.style, width: o.width, height: o.height, sill: o.sill, uValue: o.uValue ?? null };
    return { kind: 'opening', phase, data, label: 'Öffnung' };
  }
  if (it.kind === 'room') {
    const r = floor.rooms.find((x) => x.id === it.id);
    if (!r) return null;
    let data: Partial<Room>;
    if (phase === 'build' || phase === 'parts')
      data = { type: r.type, heated: r.heated, thetaI: r.thetaI, airChange: r.airChange, floorBoundary: r.floorBoundary, ceilingBoundary: r.ceilingBoundary, floorConstruction: clone(r.floorConstruction ?? null), ceilingConstruction: clone(r.ceilingConstruction ?? null) };
    else data = { covering: r.covering, rLambdaB: r.rLambdaB, surfaces: clone(r.surfaces.filter((s) => s.kind !== 'wall')), excludedArea: r.excludedArea };
    return { kind: 'room', phase, data, label: `Raum „${r.name}“` };
  }
  return null;
}

/** überträgt das Format auf ein Ziel; true = angewendet */
export function applyFormat(project: Project, floor: Floor, fmt: FormatData, target: SelItem): boolean {
  if (target.kind !== fmt.kind) return false;
  if (fmt.kind === 'wall') {
    const w = floor.walls.find((x) => x.id === target.id);
    if (!w) return false;
    Object.assign(w, clone(fmt.data));
    for (const o of w.openings) o.offset = clampOpening(w, o, o.offset);
    return true;
  }
  if (fmt.kind === 'opening') {
    const w = floor.walls.find((x) => x.id === target.wallId);
    const o = w?.openings.find((x) => x.id === target.id);
    if (!w || !o) return false;
    Object.assign(o, clone(fmt.data));
    o.offset = clampOpening(w, o, o.offset);
    return true;
  }
  if (fmt.kind === 'room') {
    const r = floor.rooms.find((x) => x.id === target.id);
    if (!r) return false;
    const d = clone(fmt.data) as Partial<Room>;
    if (d.type && d.type !== r.type) applyRoomType(project, r, d.type);
    if (d.surfaces) {
      const walls = r.surfaces.filter((s) => s.kind === 'wall');
      r.surfaces = [...d.surfaces.map((s: HeatingSurface) => ({ ...s, id: uid('s') })), ...walls];
      delete d.surfaces;
    }
    Object.assign(r, d);
    return true;
  }
  return false;
}
