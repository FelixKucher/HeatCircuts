// Import von HausCAD-Projektdateien (Format „hauscad“, Version 1) in das gemeinsame Modell.

import type { FloorFinish, ImageStore, OpeningStyle, Project, Room, StairType, Vec } from '../model/types';
import { applyRoomType, newFloor, newProject, newRoom, uid } from '../model/factory';
import { COVERINGS } from '../model/catalog';
import { roomTypeFromName } from '../cad/edit';
import { normalizeProject } from '../model/normalize';

/* eslint-disable @typescript-eslint/no-explicit-any */
const FINISH_COVER: Record<string, string> = { parkett: 'parkett_klebe', laminat: 'laminat', fliesen: 'fliesen', naturstein: 'naturstein', teppich: 'teppich', beton: 'none', farbe: 'vinyl' };

export function isHausCad(x: any): boolean {
  return x?.format === 'hauscad' && Array.isArray(x.levels);
}

export function fromHausCad(src: any): { project: Project; images: ImageStore } {
  const p = newProject(String(src.name ?? 'HausCAD-Projekt'));
  p.wizard = { done: true, step: 5 };
  const images: ImageStore = {};
  p.floors = [];
  const sorted = [...src.levels].sort((a: any, b: any) => a.elevation - b.elevation);
  for (const l of sorted) {
    const f = newFloor(String(l.name), Number(l.elevation) || 0, Number(l.height) || 2.75);
    f.clearHeight = Math.max(2, f.storeyHeight - 0.3);
    f.floorThickness = Number(l.floorThickness ?? 0.25);
    f.visible = l.visible !== false;
    f.walls = (l.walls ?? []).map((w: any) => ({
      id: String(w.id),
      a: { ...w.a },
      b: { ...w.b },
      thickness: Number(w.thickness),
      kind: 'exterior' as const,
      kindAuto: true,
      height: w.height ?? null,
      colorLeft: w.colorLeft,
      colorRight: w.colorRight,
      openings: (w.openings ?? []).map((o: any) => ({ id: String(o.id), kind: 'door' as const, style: o.type as OpeningStyle, offset: o.offset, width: o.width, height: o.height, sill: o.sill, side: o.side, hinge: o.hinge, color: o.color, uValue: null })),
    }));
    for (const r of l.rooms ?? []) {
      const room: Room = newRoom(p, f, r.polygon.map((q: Vec) => ({ ...q })), 'wohnen', String(r.name));
      applyRoomType(p, room, roomTypeFromName(String(r.name)) ?? 'wohnen');
      room.id = String(r.id);
      room.name = String(r.name);
      const cov = FINISH_COVER[r.floorFinish as FloorFinish];
      if (cov && COVERINGS[cov]) {
        room.covering = cov;
        room.rLambdaB = COVERINGS[cov].rLambdaB;
      }
      room.floorFinish = r.floorFinish;
      room.floorColor = r.floorColor;
      room.ceilingColor = r.ceilingColor;
      room.showFloor = r.showFloor;
      room.showCeiling = r.showCeiling;
      room.labelOffset = r.labelOffset;
      f.rooms.push(room);
    }
    f.furniture = (l.furniture ?? []).map((x: any) => ({ ...x }));
    f.stairs = (l.stairs ?? []).map((x: any) => ({ ...x, type: x.type as StairType }));
    f.dimensions = (l.dimensions ?? []).map((x: any) => ({ ...x }));
    f.labels = (l.labels ?? []).map((x: any) => ({ ...x }));
    for (const fu of f.furniture) if (fu.catalog === 'manifold') f.manifolds.push({ id: uid('m'), name: `HKV ${f.name}`, pos: { ...fu.pos }, supplyLengthOverride: null, maxOutlets: p.design.maxOutlets });
    const hp = f.furniture.find((x) => x.catalog === 'heatpump');
    if (hp && !p.heatSource) p.heatSource = { floorId: f.id, pos: { ...hp.pos }, name: 'Wärmepumpe', type: 'wp_luft' };
    if (l.background?.dataUrl) {
      const id = uid('img');
      images[id] = l.background.dataUrl;
      f.background = { imageId: id, widthPx: l.background.widthPx, heightPx: l.background.heightPx, pxPerM: l.background.pxPerM, offset: { ...l.background.offset }, opacity: l.background.opacity ?? 0.5, visible: l.background.visible !== false, locked: false, calibrated: true };
    }
    p.floors.push(f);
  }
  if (src.roof) Object.assign(p.roof, { type: src.roof.type, pitch: src.roof.pitch, ridge: src.roof.ridge, overhang: src.roof.overhang, kneeWall: src.roof.kneeWall, color: src.roof.color });
  if (src.settings) {
    const s = src.settings;
    Object.assign(p.settings, { wallThickness: s.wallThickness, gridStep: s.gridStep, showGrid: s.showGrid, magnetism: s.magnetism, showRoomArea: s.showRoomArea, showWallDims: s.showWallDims });
    p.site.north = s.north ?? 0;
  }
  if (src.ground?.level != null) p.terrain.gradeLow = Number(src.ground.level);
  normalizeProject(p);
  return { project: p, images };
}
