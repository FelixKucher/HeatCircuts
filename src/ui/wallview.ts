// Wandansicht: Abwicklung einer Wand von der Raumseite mit Öffnungen, Heizfeldern und Rohrbahnen.

import type { HeatingSurface, Room, Vec, Wall } from '../model/types';
import type { Store } from '../model/store';
import { BEND_RADIUS_FACTOR, PIPES } from '../model/catalog';
import { centroid, cross, dist, dot, norm, sub, v } from '../geometry/geom';
import { defaultField, fieldRuns, roomSpanOnWall } from '../geometry/wallfield';
import { pipePathD } from '../geometry/pipepath';
import { newSurface } from '../model/factory';
import { pipeOf } from '../calc/surfaces';
import { OPENING_DEFAULTS } from './editor';
import { esc, num } from './format';
import { wallLabel } from './sidebar';

type Drag =
  | { type: 'field'; roomId: string; surfaceId: string; corner: 'x0z0' | 'x1z0' | 'x0z1' | 'x1z1' | 'move'; start: Vec; orig: NonNullable<HeatingSurface['field']> }
  | { type: 'opening'; openingId: string; start: Vec; origOffset: number; origSill: number };

const f = (x: number) => (Math.round(x * 1000) / 1000).toString();

export class WallView {
  private root: HTMLElement;
  private svg: SVGSVGElement;
  private head: HTMLElement;
  wallId: string | null = null;
  roomId: string | null = null;
  private scale = 100;
  private ox = 40;
  private oy = 40;
  private drag: Drag | null = null;
  private mirror = false;

  constructor(
    host: HTMLElement,
    private store: Store,
    private onClose: () => void,
  ) {
    this.root = document.createElement('section');
    this.root.className = 'wall-view';
    this.root.hidden = true;
    this.root.setAttribute('aria-label', 'Wandansicht');
    this.root.innerHTML = `<div class="wv-head"></div><svg class="wv-svg" role="img" aria-label="Wandabwicklung"></svg>`;
    host.appendChild(this.root);
    this.head = this.root.querySelector('.wv-head')!;
    this.svg = this.root.querySelector('svg')!;
    this.head.addEventListener('click', (e) => this.onHeadClick(e));
    this.svg.addEventListener('pointerdown', (e) => this.onDown(e));
    this.svg.addEventListener('pointermove', (e) => this.onMove(e));
    this.svg.addEventListener('pointerup', () => this.endDrag());
    this.svg.addEventListener('pointercancel', () => this.endDrag());
    new ResizeObserver(() => this.isOpen && this.render()).observe(this.root);
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  open(wallId: string, roomId: string | null): void {
    const floor = this.store.floor;
    const wall = floor.walls.find((w) => w.id === wallId);
    if (!wall) return;
    const rooms = this.adjacentRooms(wall);
    this.wallId = wallId;
    this.roomId = roomId ?? rooms.find((r) => r.heated)?.id ?? rooms[0]?.id ?? null;
    this.root.hidden = false;
    if (this.roomId) this.store.select({ kind: 'room', id: this.roomId });
    this.render();
  }

  close(): void {
    this.root.hidden = true;
    this.wallId = null;
    this.onClose();
  }

  private adjacentRooms(wall: Wall): Room[] {
    return this.store.floor.rooms.filter((r) => {
      const s = roomSpanOnWall(wall, r);
      return s && s.t1 - s.t0 > 0.3;
    });
  }

  private get wall(): Wall | undefined {
    return this.store.floor.walls.find((w) => w.id === this.wallId);
  }

  /** Blick von der Raumseite: Wandanfang links oder rechts */
  private computeMirror(wall: Wall, room: Room | undefined): boolean {
    if (!room) return false;
    const dir = norm(sub(wall.b, wall.a));
    const c = centroid(room.polygon);
    const side = cross(dir, sub(c, wall.a)) > 0 ? 1 : -1;
    // Normale zum Raum, Blickrichtung = −Normale, „rechts“ für den Betrachter
    const nRoom = v(-dir.y * side, dir.x * side);
    const facing = v(-nRoom.x, -nRoom.y);
    const right = v(-facing.y, facing.x);
    return dot(dir, right) < 0;
  }

  private toScreen(x: number, z: number, L: number): Vec {
    const xx = this.mirror ? L - x : x;
    return v(this.ox + xx * this.scale, this.oy - z * this.scale);
  }

  private fromScreen(px: number, py: number, L: number): Vec {
    const r = this.svg.getBoundingClientRect();
    let x = (px - r.left - this.ox) / this.scale;
    if (this.mirror) x = L - x;
    return v(x, (this.oy - (py - r.top)) / this.scale);
  }

  render(): void {
    if (!this.isOpen) return;
    const floor = this.store.floor;
    const wall = this.wall;
    if (!wall) {
      this.close();
      return;
    }
    const rooms = this.adjacentRooms(wall);
    const room = rooms.find((r) => r.id === this.roomId);
    this.mirror = this.computeMirror(wall, room);
    const L = dist(wall.a, wall.b);
    const H = floor.storeyHeight;
    const rect = this.svg.getBoundingClientRect();
    const pad = 70;
    this.scale = Math.max(20, Math.min((rect.width - 2 * pad) / L, (rect.height - 2 * pad) / H));
    this.ox = (rect.width - L * this.scale) / 2;
    this.oy = rect.height - (rect.height - H * this.scale) / 2;
    const design = this.store.design;

    // Kopfzeile
    const surfaces = room ? room.surfaces.filter((s) => s.kind === 'wall' && s.wallId === wall.id) : [];
    this.head.innerHTML = `
      <button class="btn small" data-act="back" aria-label="Zurück zum Grundriss">← Grundriss</button>
      <div class="wv-title"><b>${esc(wallLabel(wall, room ?? null))}</b><span class="muted"> · ${num(L, 2)} × ${num(H, 2)} m</span></div>
      <label class="wv-room" for="wv-room">Raumseite <select id="wv-room">${rooms.map((r) => `<option value="${r.id}"${r.id === this.roomId ? ' selected' : ''}>${esc(r.name)}</option>`).join('')}</select></label>
      ${room && room.heated && surfaces.length === 0 ? `<button class="btn small primary" data-act="add-field">+ Wandheizung</button>` : ''}
      ${surfaces.length ? `<button class="btn small" data-act="reset-field">Heizfeld zurücksetzen</button>` : ''}`;
    this.head.querySelector('#wv-room')?.addEventListener('change', (e) => {
      this.roomId = (e.target as HTMLSelectElement).value;
      this.store.select({ kind: 'room', id: this.roomId });
      this.render();
    });

    const P = (x: number, z: number) => this.toScreen(x, z, L);
    let h = '';
    // Wand, Boden, Decke
    const a0 = P(0, 0);
    const a1 = P(L, H);
    h += `<rect x="${f(Math.min(a0.x, a1.x))}" y="${f(a1.y)}" width="${f(L * this.scale)}" height="${f(H * this.scale)}" class="wv-wall"/>`;
    const c0 = P(0, floor.clearHeight);
    const c1 = P(L, floor.clearHeight);
    h += `<line x1="${f(c0.x)}" y1="${f(c0.y)}" x2="${f(c1.x)}" y2="${f(c1.y)}" class="wv-ceiling"/>`;
    h += `<line x1="${f(a0.x - 20)}" y1="${f(a0.y)}" x2="${f(P(L, 0).x + 20)}" y2="${f(a0.y)}" class="wv-floor"/>`;
    // Raumabschnitt
    if (room) {
      const span = roomSpanOnWall(wall, room);
      if (span) {
        const s0 = P(span.t0, 0);
        const s1 = P(span.t1, floor.clearHeight);
        h += `<rect x="${f(Math.min(s0.x, s1.x))}" y="${f(s1.y)}" width="${f(Math.abs(s1.x - s0.x))}" height="${f(s0.y - s1.y)}" class="wv-span"/>`;
      }
    }
    // Heizfelder aller Räume an dieser Wand
    for (const r of rooms) {
      for (const s of r.surfaces.filter((x) => x.kind === 'wall' && x.wallId === wall.id)) {
        const fld = s.field ?? defaultField(wall, r, floor.clearHeight)!;
        const mine = r.id === this.roomId;
        const q0 = P(fld.x0, fld.z0);
        const q1 = P(fld.x1, fld.z1);
        const x = Math.min(q0.x, q1.x);
        const w = Math.abs(q1.x - q0.x);
        h += `<rect x="${f(x)}" y="${f(q1.y)}" width="${f(w)}" height="${f(q0.y - q1.y)}" class="wv-field${mine ? ' mine' : ''}" data-field="${r.id}|${s.id}" data-corner="move"/>`;
        const pipe = PIPES[pipeOf(s, this.store.project.design)] ?? PIPES['10x1.3'];
        const radius = BEND_RADIUS_FACTOR * pipe.outer;
        const rows = fieldRuns(fld, wall.openings, s.spacing);
        const single = rows.every((rw) => rw.runs.length === 1);
        if (single && rows.length) {
          const pts: Vec[] = [];
          rows.forEach((rw, i) => {
            const [xa, xb] = rw.runs[0];
            const seq = i % 2 === 0 ? [xa, xb] : [xb, xa];
            for (const xx of seq) pts.push(P(xx, rw.z));
          });
          const half = Math.ceil(pts.length / 2);
          h += `<path d="${pipePathD(pts.slice(0, half + 1), radius * this.scale)}" class="wv-pipe supply"/>`;
          h += `<path d="${pipePathD(pts.slice(half), radius * this.scale)}" class="wv-pipe return"/>`;
        } else {
          rows.forEach((rw, i) => {
            for (const [xa, xb] of rw.runs) {
              const p1 = P(xa, rw.z);
              const p2 = P(xb, rw.z);
              h += `<line x1="${f(p1.x)}" y1="${f(p1.y)}" x2="${f(p2.x)}" y2="${f(p2.y)}" class="wv-pipe ${i < rows.length / 2 ? 'supply' : 'return'}"/>`;
            }
          });
        }
        if (mine) {
          for (const corner of ['x0z0', 'x1z0', 'x0z1', 'x1z1'] as const) {
            const cp = P(corner[1] === '0' ? fld.x0 : fld.x1, corner[3] === '0' ? fld.z0 : fld.z1);
            h += `<rect x="${f(cp.x - 6)}" y="${f(cp.y - 6)}" width="12" height="12" class="wv-handle" data-field="${r.id}|${s.id}" data-corner="${corner}"/>`;
          }
          const sr = design.rooms.get(r.id)?.surfaces.find((x) => x.surfaceId === s.id);
          const mid = P((fld.x0 + fld.x1) / 2, fld.z1);
          h += `<text x="${f(mid.x)}" y="${f(mid.y - 10)}" class="wv-label">${num(fld.x1 - fld.x0, 2)} × ${num(fld.z1 - fld.z0, 2)} m · ${sr ? `${num(sr.area, 2)} m² netto · ${num(sr.output, 0)} W · VA ${num(s.spacing * 100, 1).replace(/,0$/, '')} cm` : ''}</text>`;
        }
      }
    }
    // Öffnungen
    for (const o of wall.openings) {
      const q0 = P(o.offset - o.width / 2, o.sill);
      const q1 = P(o.offset + o.width / 2, o.sill + o.height);
      const x = Math.min(q0.x, q1.x);
      const w = Math.abs(q1.x - q0.x);
      h += `<rect x="${f(x)}" y="${f(q1.y)}" width="${f(w)}" height="${f(q0.y - q1.y)}" class="wv-opening ${o.kind}" data-opening="${o.id}"/>`;
      if (o.kind === 'window') h += `<line x1="${f(x + w / 2)}" y1="${f(q1.y)}" x2="${f(x + w / 2)}" y2="${f(q0.y)}" class="wv-sash"/>`;
      h += `<text x="${f(x + w / 2)}" y="${f(q1.y - 6)}" class="wv-dim">${esc(OPENING_DEFAULTS[o.kind].label)} ${num(o.width, 2)} × ${num(o.height, 2)}</text>`;
    }
    // Bemaßung Gesamtlänge
    const d0 = P(0, 0);
    const d1 = P(L, 0);
    const yd = d0.y + 34;
    h += `<path d="M${f(d0.x)} ${f(yd)}H${f(d1.x)}M${f(d0.x)} ${f(yd - 6)}v12M${f(d1.x)} ${f(yd - 6)}v12" class="wv-dimline"/>`;
    h += `<text x="${f((d0.x + d1.x) / 2)}" y="${f(yd - 6)}" class="wv-dim">${num(L, 2)} m</text>`;
    const ya = P(0, H);
    h += `<text x="${f(Math.min(d0.x, d1.x) - 10)}" y="${f(ya.y + 4)}" class="wv-dim end">${num(H, 2)}</text>`;
    h += `<text x="${f(Math.min(d0.x, d1.x) - 10)}" y="${f(P(0, floor.clearHeight).y + 4)}" class="wv-dim end">${num(floor.clearHeight, 2)}</text>`;
    // Richtung (Wandanfang a)
    const pa = P(0, 0);
    h += `<text x="${f(pa.x)}" y="${f(pa.y + 56)}" class="wv-dim">A</text>`;
    const pb = P(L, 0);
    h += `<text x="${f(pb.x)}" y="${f(pb.y + 56)}" class="wv-dim">B</text>`;
    this.svg.innerHTML = h;
  }

  private onHeadClick(e: Event): void {
    const t = (e.target as HTMLElement).closest('[data-act]') as HTMLElement | null;
    if (!t) return;
    const act = t.dataset.act;
    const wall = this.wall;
    const fid = this.store.activeFloorId;
    if (act === 'back') return this.close();
    if (!wall || !this.roomId) return;
    const roomId = this.roomId;
    if (act === 'add-field') {
      this.store.commit((p) => {
        const fl = p.floors.find((x) => x.id === fid)!;
        const r = fl.rooms.find((x) => x.id === roomId);
        if (!r) return;
        const s = newSurface('wall', 'wall_wet', 0.1);
        s.wallId = wall.id;
        s.field = defaultField(wall, r, fl.clearHeight);
        r.surfaces.push(s);
      });
    }
    if (act === 'reset-field') {
      this.store.commit((p) => {
        const fl = p.floors.find((x) => x.id === fid)!;
        const r = fl.rooms.find((x) => x.id === roomId);
        r?.surfaces.filter((s) => s.kind === 'wall' && s.wallId === wall.id).forEach((s) => (s.field = defaultField(wall, r, fl.clearHeight)));
      });
    }
  }

  private onDown(e: PointerEvent): void {
    const wall = this.wall;
    if (!wall) return;
    const L = dist(wall.a, wall.b);
    const t = e.target as SVGElement;
    const p = this.fromScreen(e.clientX, e.clientY, L);
    if (t.dataset.field) {
      const [roomId, surfaceId] = t.dataset.field.split('|');
      if (roomId !== this.roomId) {
        this.roomId = roomId;
        this.store.select({ kind: 'room', id: roomId });
        this.render();
        return;
      }
      const r = this.store.floor.rooms.find((x) => x.id === roomId);
      const s = r?.surfaces.find((x) => x.id === surfaceId);
      if (!r || !s) return;
      const orig = { ...(s.field ?? defaultField(wall, r, this.store.floor.clearHeight)!) };
      this.store.beginLive();
      this.drag = { type: 'field', roomId, surfaceId, corner: t.dataset.corner as 'move', start: p, orig };
      this.svg.setPointerCapture(e.pointerId);
    } else if (t.dataset.opening) {
      const o = wall.openings.find((x) => x.id === t.dataset.opening);
      if (!o) return;
      this.store.beginLive();
      this.drag = { type: 'opening', openingId: o.id, start: p, origOffset: o.offset, origSill: o.sill };
      this.svg.setPointerCapture(e.pointerId);
    }
  }

  private onMove(e: PointerEvent): void {
    const d = this.drag;
    const wall = this.wall;
    if (!d || !wall) return;
    const L = dist(wall.a, wall.b);
    const p = this.fromScreen(e.clientX, e.clientY, L);
    const snap = (x: number) => Math.round(x / 0.05) * 0.05;
    const fid = this.store.activeFloorId;
    const H = this.store.floor.clearHeight;
    if (d.type === 'field') {
      const dx = snap(p.x - d.start.x);
      const dz = snap(p.y - d.start.y);
      const o = d.orig;
      const n = { ...o };
      if (d.corner === 'move') {
        const w = o.x1 - o.x0;
        const hgt = o.z1 - o.z0;
        n.x0 = Math.min(L - w, Math.max(0, o.x0 + dx));
        n.x1 = n.x0 + w;
        n.z0 = Math.min(H - hgt, Math.max(0, o.z0 + dz));
        n.z1 = n.z0 + hgt;
      } else {
        if (d.corner[1] === '0') n.x0 = Math.min(o.x1 - 0.3, Math.max(0, o.x0 + dx));
        else n.x1 = Math.max(o.x0 + 0.3, Math.min(L, o.x1 + dx));
        if (d.corner[3] === '0') n.z0 = Math.min(o.z1 - 0.3, Math.max(0, o.z0 + dz));
        else n.z1 = Math.max(o.z0 + 0.3, Math.min(H, o.z1 + dz));
      }
      this.store.live((pr) => {
        const s = pr.floors.find((x) => x.id === fid)?.rooms.find((x) => x.id === d.roomId)?.surfaces.find((x) => x.id === d.surfaceId);
        if (s) s.field = n;
      });
    } else {
      this.store.live((pr) => {
        const w = pr.floors.find((x) => x.id === fid)?.walls.find((x) => x.id === wall.id);
        const o = w?.openings.find((x) => x.id === d.openingId);
        if (!o) return;
        o.offset = Math.min(L - o.width / 2, Math.max(o.width / 2, snap(d.origOffset + (p.x - d.start.x))));
        o.sill = Math.min(H - o.height, Math.max(0, snap(d.origSill + (p.y - d.start.y))));
      });
    }
  }

  private endDrag(): void {
    if (this.drag) this.store.endLive();
    this.drag = null;
  }
}
