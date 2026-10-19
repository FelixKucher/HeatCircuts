// IFC-Import (BIM): Geschosse, Räume aus IfcSpace, Wände als Achsen mit Dicke, Fenster und Türen.
// web-ifc (MPL-2.0) wird erst beim Import geladen; Geometrie kommt Y-oben (three.js-Konvention).

import type { IfcAPI } from 'web-ifc';
import type { Floor, Project, Vec } from '../model/types';
import { applyRoomType, newFloor, newProject, newRoom, newWall } from '../model/factory';
import { roomTypeFromName } from '../cad/edit';
import { newOpening } from '../cad/openings';
import { normalizeProject } from '../model/normalize';
import { bottomOutline, joinWalls, minAreaRect, polyArea, rectToAxis, segDist, type AxisWall, type Tri3 } from './ifc-geom';

/* eslint-disable @typescript-eslint/no-explicit-any */

interface Solid {
  id: number;
  type: 'space' | 'wall' | 'window' | 'door';
  tris: Tri3[];
  hMin: number;
  hMax: number;
}

export interface IfcStats {
  storeys: number;
  spaces: number;
  walls: number;
  windows: number;
  doors: number;
  warnings: string[];
}

export interface IfcOptions {
  /** Pfad der wasm-Datei (Browser); ohne Angabe sucht web-ifc neben dem Modul */
  locateWasm?: (path: string) => string;
}

const str = (x: any): string => (x && typeof x === 'object' && 'value' in x ? String(x.value ?? '') : x == null ? '' : String(x));
/** sprechender Name: Kennungen wie „ACID0000…“ oder reine Nummern meiden */
function label(a: string, b: string, fallback: string): string {
  const descriptive = (x: string) => /\p{L}{3}/u.test(x) && !/^[A-Z]{2,}\d{4,}|[0-9a-f]{8}-[0-9a-f]{4}-/i.test(x);
  return [a, b].find(descriptive) ?? ([a, b].find((x) => x.trim()) || fallback);
}
const ref = (x: any): number => (x && typeof x === 'object' && 'value' in x ? Number(x.value) : Number(x));

async function api(opts: IfcOptions): Promise<{ ifc: IfcAPI; W: typeof import('web-ifc') }> {
  const W = await import('web-ifc');
  const ifc = new W.IfcAPI();
  await ifc.Init(opts.locateWasm, true);
  return { ifc, W };
}

export async function ifcToProject(data: Uint8Array, opts: IfcOptions = {}): Promise<{ project: Project; stats: IfcStats }> {
  const { ifc, W } = await api(opts);
  const model = ifc.OpenModel(data, { COORDINATE_TO_ORIGIN: true });
  const warnings: string[] = [];
  try {
    // ---------- räumliche Struktur ----------
    const parent = new Map<number, number>();
    for (const id of ifc.GetLineIDsWithType(model, W.IFCRELAGGREGATES)) {
      const r = ifc.GetLine(model, id);
      for (const o of r.RelatedObjects ?? []) parent.set(ref(o), ref(r.RelatingObject));
    }
    for (const id of ifc.GetLineIDsWithType(model, W.IFCRELCONTAINEDINSPATIALSTRUCTURE)) {
      const r = ifc.GetLine(model, id);
      for (const o of r.RelatedElements ?? []) parent.set(ref(o), ref(r.RelatingStructure));
    }
    const storeyIds = [...ifc.GetLineIDsWithType(model, W.IFCBUILDINGSTOREY)];
    const storeySet = new Set(storeyIds);
    const storeyOf = (id: number): number | null => {
      let cur: number | undefined = id;
      for (let i = 0; i < 12 && cur != null; i++) {
        if (storeySet.has(cur)) return cur;
        cur = parent.get(cur);
      }
      return null;
    };

    // ---------- Geometrie ----------
    const typeOf = new Map<number, Solid['type']>();
    const want: [number, Solid['type']][] = [
      [W.IFCSPACE, 'space'],
      [W.IFCWALL, 'wall'],
      [W.IFCWALLSTANDARDCASE, 'wall'],
      [W.IFCWINDOW, 'window'],
      [W.IFCDOOR, 'door'],
    ];
    for (const [t, k] of want) for (const id of ifc.GetLineIDsWithType(model, t)) typeOf.set(id, k);
    const solids = new Map<number, Solid>();
    ifc.StreamAllMeshesWithTypes(
      model,
      want.map((w) => w[0]),
      (mesh) => {
        const type = typeOf.get(mesh.expressID);
        if (!type) return;
        const s: Solid = solids.get(mesh.expressID) ?? { id: mesh.expressID, type, tris: [], hMin: Infinity, hMax: -Infinity };
        const n = mesh.geometries.size();
        for (let g = 0; g < n; g++) {
          const pg = mesh.geometries.get(g);
          const geo = ifc.GetGeometry(model, pg.geometryExpressID);
          const vs = ifc.GetVertexArray(geo.GetVertexData(), geo.GetVertexDataSize());
          const ix = ifc.GetIndexArray(geo.GetIndexData(), geo.GetIndexDataSize());
          const m = pg.flatTransformation;
          const P = (i: number): [number, number, number] => {
            const x = vs[i * 6];
            const y = vs[i * 6 + 1];
            const z = vs[i * 6 + 2];
            const X = m[0] * x + m[4] * y + m[8] * z + m[12];
            const Y = m[1] * x + m[5] * y + m[9] * z + m[13];
            const Z = m[2] * x + m[6] * y + m[10] * z + m[14];
            // Y oben; Plan: x nach Osten, y nach Süden (= three.js z), Höhe = Y
            return [X, Z, Y];
          };
          for (let k = 0; k + 2 < ix.length; k += 3) {
            const t: Tri3 = { p: [P(ix[k]), P(ix[k + 1]), P(ix[k + 2])] };
            for (const q of t.p) {
              s.hMin = Math.min(s.hMin, q[2]);
              s.hMax = Math.max(s.hMax, q[2]);
            }
            s.tris.push(t);
          }
          geo.delete();
        }
        solids.set(mesh.expressID, s);
      },
    );

    // ---------- Geschosse ----------
    interface StoreyData {
      id: number;
      name: string;
      elevationAttr: number;
      spaces: Solid[];
      walls: Solid[];
      openings: Solid[];
    }
    const storeys = new Map<number, StoreyData>();
    for (const id of storeyIds) {
      const l = ifc.GetLine(model, id);
      storeys.set(id, { id, name: label(str(l.Name), str(l.LongName), 'Geschoss'), elevationAttr: Number(str(l.Elevation)) || 0, spaces: [], walls: [], openings: [] });
    }
    let orphan = 0;
    for (const s of solids.values()) {
      if (!s.tris.length) continue;
      let sid = storeyOf(s.id);
      if (sid == null) {
        // ohne Zuordnung: Geschoss mit der nächstgelegenen Unterkante
        const cand = [...storeys.values()];
        if (!cand.length) continue;
        orphan++;
        sid = cand.reduce((b, x) => (Math.abs(x.elevationAttr - s.hMin) < Math.abs(b.elevationAttr - s.hMin) ? x : b)).id;
      }
      const st = storeys.get(sid)!;
      (s.type === 'space' ? st.spaces : s.type === 'wall' ? st.walls : st.openings).push(s);
    }
    if (orphan) warnings.push(`${orphan} Bauteile ohne Geschosszuordnung nach Höhe zugeordnet.`);

    const used = [...storeys.values()].filter((s) => s.spaces.length || s.walls.length);
    if (!used.length) throw new Error('keine Räume oder Wände mit Geometrie gefunden');
    const elev = (s: StoreyData) => {
      const src = s.spaces.length ? s.spaces : s.walls;
      return Math.min(...src.map((x) => x.hMin));
    };
    used.sort((a, b) => elev(a) - elev(b));

    // Ursprung: linke obere Ecke aller Grundrisse
    const allPts = used.flatMap((s) => [...s.spaces, ...s.walls].flatMap((x) => x.tris.flatMap((t) => t.p)));
    const ox = Math.min(...allPts.map((q) => q[0])) - 1;
    const oy = Math.min(...allPts.map((q) => q[1])) - 1;
    const shift = (p: Vec): Vec => ({ x: Math.round((p.x - ox) * 1000) / 1000, y: Math.round((p.y - oy) * 1000) / 1000 });

    const projectName = (() => {
      const pid = [...ifc.GetLineIDsWithType(model, W.IFCPROJECT)][0];
      const bid = [...ifc.GetLineIDsWithType(model, W.IFCBUILDING)][0];
      const b = bid != null ? ifc.GetLine(model, bid) : null;
      const p = pid != null ? ifc.GetLine(model, pid) : null;
      return label(str(b?.LongName), str(b?.Name), '') || label(str(p?.LongName), str(p?.Name), 'IFC-Projekt');
    })();
    const project = newProject(projectName);
    project.wizard = { done: true, step: 5 };
    project.floors = [];
    const stats: IfcStats = { storeys: used.length, spaces: 0, walls: 0, windows: 0, doors: 0, warnings };

    used.forEach((st, i) => {
      const e = Math.round(elev(st) * 1000) / 1000;
      const next = used[i + 1];
      const top = Math.max(...st.walls.map((w) => w.hMax), e + 2.5);
      const height = next ? Math.max(2, elev(next) - e) : Math.max(2.2, top - e);
      const f: Floor = newFloor(st.name, e, Math.round(height * 1000) / 1000);
      f.clearHeight = Math.round(Math.min(f.storeyHeight - 0.2, Math.max(...st.spaces.map((s) => s.hMax - s.hMin), 2.2)) * 100) / 100;
      f.belowGrade = e < -1.2;

      // Wände
      const axes: (AxisWall & { h: number })[] = [];
      for (const w of st.walls) {
        const r = minAreaRect(w.tris.flatMap((t) => t.p.map((q) => ({ x: q[0], y: q[1] }))));
        if (!r || r.length < 0.2 || r.width < 0.04 || r.width > 1.2) continue;
        axes.push({ ...rectToAxis(r), h: w.hMax - w.hMin });
      }
      joinWalls(axes);
      for (const a of axes) {
        const wall = newWall(shift(a.a), shift(a.b), 'exterior', Math.round(a.thickness * 1000) / 1000, true);
        f.walls.push(wall);
      }
      stats.walls += f.walls.length;

      // Räume
      for (const sp of st.spaces) {
        const outline = bottomOutline(sp.tris);
        if (!outline || Math.abs(polyArea(outline)) < 0.5) {
          warnings.push(`Raum #${sp.id} ohne auswertbare Grundfläche übersprungen.`);
          continue;
        }
        const l = ifc.GetLine(model, sp.id);
        const name = label(str(l.LongName), str(l.Name), 'Raum');
        const type = roomTypeFromName(name) ?? 'wohnen';
        const room = newRoom(project, f, outline.map(shift), type, name);
        applyRoomType(project, room, type);
        room.name = name;
        f.rooms.push(room);
        stats.spaces++;
      }

      // Fenster und Türen in die nächstgelegene Wand
      for (const o of st.openings) {
        const r = minAreaRect(o.tris.flatMap((t) => t.p.map((q) => ({ x: q[0], y: q[1] }))));
        if (!r) continue;
        const c = shift(r.center);
        let best: { wi: number; t: number; d: number } | null = null;
        f.walls.forEach((w, wi) => {
          const s = segDist(c, w.a, w.b);
          if (s.d <= w.thickness / 2 + 0.2 && (!best || s.d < best.d)) best = { wi, t: s.t, d: s.d };
        });
        if (!best) {
          warnings.push(`${o.type === 'door' ? 'Tür' : 'Fenster'} #${o.id} keiner Wand zuzuordnen.`);
          continue;
        }
        const { wi, t } = best as { wi: number; t: number; d: number };
        const w = f.walls[wi];
        const L = Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y);
        const sill = Math.max(0, Math.round((o.hMin - e) * 100) / 100);
        const style = o.type === 'door' ? (r.length > 1.3 ? 'doubleDoor' : 'door') : sill < 0.15 ? 'frenchWindow' : 'window';
        const op = newOpening(style, Math.round(t * L * 1000) / 1000, w);
        op.width = Math.round(Math.min(r.length, L) * 1000) / 1000;
        op.height = Math.round((o.hMax - o.hMin) * 1000) / 1000;
        op.sill = sill;
        w.openings.push(op);
        if (o.type === 'door') stats.doors++;
        else stats.windows++;
      }
      project.floors.push(f);
    });
    normalizeProject(project);
    return { project, stats };
  } finally {
    ifc.CloseModel(model);
  }
}
