// Eigenschaften der Auswahl bzw. von Geschoss und Projekt (rechte Seitenleiste).

import { CATALOG_BY_KEY } from './catalog';
import { FLOOR_FINISHES, OPENING_TYPES, newWall, type FloorFinish, type Level, type OpeningType, type Project, type RoofType, type StairType } from './model';
import { esc, fmt } from './plan-render';
import { stairGeometry, stepCount } from './stairs';
import type { SelItem, Store } from './store';
import { bindFields, fieldHtml, ICONS, type Field } from './ui';
import { addWallChain } from './edit';
import { clampOpening, splitWall, wallLength } from './walls';
import { add, area, dist, mul, norm, perimeter, sub } from '../../src/geometry/geom';
import { uid } from './model';

const CM = { unit: 'cm', scale: 100, digits: 1 } as const;

export interface PropsActions {
  loadImage(): void;
  calibrate(): void;
  removeBackground(): void;
  deleteSelection(): void;
  rotateSelection(): void;
}

export class PropsPanel {
  constructor(
    private root: HTMLElement,
    private store: Store,
    private actions: PropsActions,
  ) {
    bindFields(root, (k, v, live) => this.apply(k, v, live));
    root.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
      if (b) this.act(b.dataset.act!, b);
    });
  }

  render(): void {
    const s = this.store;
    const sel = s.selection;
    const l = s.level;
    let html = '';
    if (!sel.length) html = this.levelPanel(l) + this.projectPanel(s.project);
    else {
      const kinds = [...new Set(sel.map((x) => x.kind))];
      const head = sel.length > 1 ? `<div class="p-head"><h2>${sel.length} Objekte</h2><span class="muted">${kinds.map(kindLabel).join(', ')}</span></div>` : '';
      const first = sel[0];
      const sameKind = kinds.length === 1;
      html = head + (sameKind ? this.itemPanel(first, sel.length) : '');
      html += `<div class="p-actions"><button class="btn small" data-act="rotate">${ICONS.rotate}Drehen 90°</button><button class="btn small danger" data-act="delete">${ICONS.trash}Löschen</button></div>`;
    }
    const focused = document.activeElement as HTMLElement | null;
    const key = focused && this.root.contains(focused) ? focused.dataset.k : null;
    this.root.innerHTML = html;
    if (key) this.root.querySelector<HTMLElement>(`[data-k="${key}"]`)?.focus();
  }

  private group(title: string, fields: Field[], extra = ''): string {
    return `<section class="p-group"><h3>${esc(title)}</h3><div class="fields">${fields.map(fieldHtml).join('')}</div>${extra}</section>`;
  }

  private itemPanel(it: SelItem, n: number): string {
    const l = this.store.level;
    const multi = n > 1 ? ' (alle gewählten)' : '';
    switch (it.kind) {
      case 'wall': {
        const w = l.walls.find((x) => x.id === it.id);
        if (!w) return '';
        return (
          `<div class="p-head"><h2>Wand</h2><span class="muted">${fmt(wallLength(w))} m</span></div>` +
          this.group('Maße' + multi, [
            { t: 'num', k: 'wall.length', label: 'Länge (Achse)', v: wallLength(w), ...CM },
            { t: 'num', k: 'wall.thickness', label: 'Dicke', v: w.thickness, ...CM },
            { t: 'num', k: 'wall.height', label: 'Höhe', v: w.height, ...CM, ph: `Geschoss ${fmt(l.height * 100, 0)}` },
          ]) +
          this.group('Lage', [
            { t: 'num', k: 'wall.ax', label: 'Anfang X', v: w.a.x, ...CM },
            { t: 'num', k: 'wall.ay', label: 'Anfang Y', v: w.a.y, ...CM },
            { t: 'num', k: 'wall.bx', label: 'Ende X', v: w.b.x, ...CM },
            { t: 'num', k: 'wall.by', label: 'Ende Y', v: w.b.y, ...CM },
          ]) +
          this.group(
            'Oberflächen' + multi,
            [
              { t: 'color', k: 'wall.colorLeft', label: 'Farbe links', v: w.colorLeft },
              { t: 'color', k: 'wall.colorRight', label: 'Farbe rechts', v: w.colorRight },
            ],
            `<div class="p-actions"><button class="btn small" data-act="wall-split">Wand in der Mitte teilen</button><button class="btn small" data-act="wall-reverse">Richtung umkehren</button></div>`,
          ) +
          (w.openings.length
            ? `<section class="p-group"><h3>Öffnungen</h3><ul class="mini-list">${w.openings
                .map((o) => `<li><button class="link" data-act="select-opening" data-id="${o.id}" data-wall="${w.id}">${esc(OPENING_TYPES[o.type].label)}</button><span class="mono">${fmt(o.width * 100, 1)} × ${fmt(o.height * 100, 1)}</span></li>`)
                .join('')}</ul></section>`
            : '')
        );
      }
      case 'opening': {
        const w = l.walls.find((x) => x.id === it.wallId);
        const o = w?.openings.find((x) => x.id === it.id);
        if (!w || !o) return '';
        const L = wallLength(w);
        return (
          `<div class="p-head"><h2>${esc(OPENING_TYPES[o.type].label)}</h2></div>` +
          this.group('Art und Maße', [
            { t: 'sel', k: 'op.type', label: 'Art', v: o.type, opts: Object.entries(OPENING_TYPES).map(([k, d]) => [k, d.label]) },
            { t: 'num', k: 'op.width', label: 'Breite (Rohbau)', v: o.width, ...CM },
            { t: 'num', k: 'op.height', label: 'Höhe', v: o.height, ...CM },
            { t: 'num', k: 'op.sill', label: 'Brüstung', v: o.sill, ...CM },
            { t: 'num', k: 'op.left', label: 'Abstand zum Wandanfang', v: o.offset - o.width / 2, ...CM },
            { t: 'info', label: 'Abstand zum Wandende', v: `${fmt((L - o.offset - o.width / 2) * 100, 1)} cm` },
            { t: 'color', k: 'op.color', label: 'Farbe', v: o.color },
          ]) +
          `<div class="p-actions"><button class="btn small" data-act="op-side">${ICONS.mirror}Öffnungsseite</button><button class="btn small" data-act="op-hinge">Anschlag links/rechts</button></div>`
        );
      }
      case 'room': {
        const r = l.rooms.find((x) => x.id === it.id);
        if (!r) return '';
        return (
          `<div class="p-head"><h2>${esc(r.name)}</h2><span class="muted">${fmt(area(r.polygon))} m²</span></div>` +
          this.group('Raum', [
            { t: 'text', k: 'room.name', label: 'Name', v: r.name },
            { t: 'info', label: 'Fläche', v: `${fmt(area(r.polygon))} m²` },
            { t: 'info', label: 'Umfang', v: `${fmt(perimeter(r.polygon))} m` },
            { t: 'info', label: 'Rauminhalt', v: `${fmt(area(r.polygon) * (l.height - 0.25))} m³` },
          ]) +
          this.group(
            'Boden und Decke' + multi,
            [
              { t: 'sel', k: 'room.floorFinish', label: 'Bodenbelag', v: r.floorFinish, opts: Object.entries(FLOOR_FINISHES).map(([k, d]) => [k, d.label]) },
              { t: 'color', k: 'room.floorColor', label: 'Bodenfarbe', v: r.floorColor },
              { t: 'color', k: 'room.ceilingColor', label: 'Deckenfarbe', v: r.ceilingColor },
              { t: 'check', k: 'room.showFloor', label: 'Boden anzeigen', v: r.showFloor },
              { t: 'check', k: 'room.showCeiling', label: 'Decke anzeigen', v: r.showCeiling },
            ],
            `<div class="p-actions"><button class="btn small" data-act="room-walls">Wände um den Raum erzeugen</button></div>`,
          )
        );
      }
      case 'furniture': {
        const f = l.furniture.find((x) => x.id === it.id);
        if (!f) return '';
        const cat = CATALOG_BY_KEY[f.catalog];
        return (
          `<div class="p-head"><h2>${esc(f.name)}</h2><span class="muted">${esc(cat?.category ?? '')}</span></div>` +
          this.group('Maße' + multi, [
            { t: 'text', k: 'fur.name', label: 'Name', v: f.name },
            { t: 'num', k: 'fur.width', label: 'Breite', v: f.width, ...CM },
            { t: 'num', k: 'fur.depth', label: 'Tiefe', v: f.depth, ...CM },
            { t: 'num', k: 'fur.height', label: 'Höhe', v: f.height, ...CM },
            { t: 'num', k: 'fur.elevation', label: 'Höhe über Boden', v: f.elevation, ...CM },
          ]) +
          this.group('Lage und Aussehen' + multi, [
            { t: 'num', k: 'fur.x', label: 'X', v: f.pos.x, ...CM },
            { t: 'num', k: 'fur.y', label: 'Y', v: f.pos.y, ...CM },
            { t: 'num', k: 'fur.angle', label: 'Winkel', v: f.angle, unit: '°', digits: 0 },
            { t: 'color', k: 'fur.color', label: 'Farbe', v: f.color },
            { t: 'check', k: 'fur.mirrored', label: 'gespiegelt', v: f.mirrored },
            { t: 'check', k: 'fur.visible', label: 'sichtbar', v: f.visible },
          ])
        );
      }
      case 'stair': {
        const s = l.stairs.find((x) => x.id === it.id);
        if (!s) return '';
        const g = stairGeometry(s, l.height);
        const going = s.type === 'spiral' ? (Math.min(2 * Math.PI, (g.steps * 22.5 * Math.PI) / 180) * (s.length / 2) * 0.6) / g.steps : s.type === 'lshape' ? (s.length - s.width + s.length2) / (g.steps - 1) : s.length / g.steps;
        const rule = 2 * g.riser + going;
        const ok = g.riser >= 0.14 && g.riser <= 0.2 && going >= 0.23 && rule >= 0.59 && rule <= 0.65;
        return (
          `<div class="p-head"><h2>Treppe</h2><span class="muted">${g.steps} Steigungen</span></div>` +
          this.group('Treppe', [
            { t: 'sel', k: 'st.type', label: 'Art', v: s.type, opts: [['straight', 'gerade'], ['lshape', 'viertelgewendelt (L, mit Podest)'], ['spiral', 'Spindeltreppe']] },
            { t: 'num', k: 'st.width', label: s.type === 'spiral' ? 'Durchmesser' : 'Laufbreite', v: s.type === 'spiral' ? s.length : s.width, ...CM },
            ...(s.type !== 'spiral' ? ([{ t: 'num', k: 'st.length', label: s.type === 'lshape' ? 'Länge Lauf 1 inkl. Podest' : 'Lauflänge', v: s.length, ...CM }] as Field[]) : []),
            ...(s.type === 'lshape' ? ([{ t: 'num', k: 'st.length2', label: 'Länge Lauf 2', v: s.length2, ...CM }] as Field[]) : []),
            { t: 'num', k: 'st.steps', label: 'Steigungen', v: s.steps, digits: 0, ph: `auto ${stepCount({ ...s, steps: null }, l.height)}` },
            ...(s.type === 'spiral' ? ([{ t: 'check', k: 'st.clockwise', label: 'im Uhrzeigersinn', v: s.clockwise }] as Field[]) : []),
            { t: 'num', k: 'st.angle', label: 'Winkel', v: s.angle, unit: '°', digits: 0 },
            { t: 'color', k: 'st.color', label: 'Farbe', v: s.color },
            { t: 'check', k: 'st.cutCeiling', label: 'Decke darüber aussparen', v: s.cutCeiling },
          ]) +
          this.group('Steigungsverhältnis (DIN 18065, Wohngebäude)', [
            { t: 'info', label: 'Steigung s', v: `${fmt(g.riser * 100, 1)} cm`, tone: g.riser >= 0.14 && g.riser <= 0.2 ? 'ok' : 'warn' },
            { t: 'info', label: s.type === 'spiral' ? 'Auftritt a (Lauflinie)' : 'Auftritt a', v: `${fmt(going * 100, 1)} cm`, tone: going >= 0.23 ? 'ok' : 'warn' },
            { t: 'info', label: 'Schrittmaß 2s + a', v: `${fmt(rule * 100, 1)} cm`, tone: ok ? 'ok' : 'warn' },
          ]) +
          `<p class="note">Richtwerte für notwendige Treppen in Wohngebäuden bis zwei Wohnungen: s 14–20 cm, a ≥ 23 cm, 2s + a = 59–65 cm. Verbindlich sind DIN 18065 und die Landesbauordnung.</p>`
        );
      }
      case 'dimension': {
        const d = l.dimensions.find((x) => x.id === it.id);
        if (!d) return '';
        return `<div class="p-head"><h2>Maßlinie</h2><span class="muted">${fmt(dist(d.a, d.b))} m</span></div>` + this.group('Maßlinie', [{ t: 'num', k: 'dim.offset', label: 'Abstand', v: d.offset, ...CM }]);
      }
      case 'label': {
        const t = l.labels.find((x) => x.id === it.id);
        if (!t) return '';
        return (
          `<div class="p-head"><h2>Text</h2></div>` +
          this.group('Text', [
            { t: 'text', k: 'lab.text', label: 'Text', v: t.text },
            { t: 'num', k: 'lab.size', label: 'Schriftgröße', v: t.size, ...CM },
            { t: 'num', k: 'lab.angle', label: 'Winkel', v: t.angle, unit: '°', digits: 0 },
          ])
        );
      }
    }
  }

  private levelPanel(l: Level): string {
    const bg = l.background;
    return (
      `<div class="p-head"><h2>${esc(l.name)}</h2><span class="muted">Geschoss</span></div>` +
      this.group('Geschoss', [
        { t: 'text', k: 'lvl.name', label: 'Name', v: l.name },
        { t: 'num', k: 'lvl.elevation', label: 'Höhe OK FFB', v: l.elevation, ...CM },
        { t: 'num', k: 'lvl.height', label: 'Geschosshöhe', v: l.height, ...CM },
        { t: 'num', k: 'lvl.floorThickness', label: 'Deckenstärke darunter', v: l.floorThickness, ...CM },
        { t: 'check', k: 'lvl.visible', label: 'in 3D anzeigen', v: l.visible },
        { t: 'info', label: 'Wohnfläche (Summe Räume)', v: `${fmt(l.rooms.reduce((a, r) => a + area(r.polygon), 0))} m²` },
      ]) +
      this.group(
        'Grundrissbild',
        bg
          ? [
              { t: 'range', k: 'bg.opacity', label: 'Deckkraft', v: bg.opacity, min: 0.05, max: 1, step: 0.05 },
              { t: 'check', k: 'bg.visible', label: 'anzeigen', v: bg.visible },
              { t: 'info', label: 'Maßstab', v: `${fmt(bg.pxPerM, 1)} px/m` },
            ]
          : [],
        `<div class="p-actions"><button class="btn small" data-act="bg-load">Bild laden</button>${bg ? '<button class="btn small" data-act="bg-cal">Maßstab kalibrieren</button><button class="btn small" data-act="bg-remove">Entfernen</button>' : ''}</div>${bg ? '<p class="note">⌥/Alt + Ziehen auf freier Fläche verschiebt das Bild.</p>' : ''}`,
      )
    );
  }

  private projectPanel(p: Project): string {
    const st = p.settings;
    return (
      this.group('Zeichnen', [
        { t: 'num', k: 'set.wallThickness', label: 'Wanddicke neu', v: st.wallThickness, ...CM },
        { t: 'num', k: 'set.wallHeight', label: 'Wandhöhe neu', v: st.wallHeight, ...CM },
        { t: 'num', k: 'set.gridStep', label: 'Rasterweite', v: st.gridStep, ...CM },
        { t: 'check', k: 'set.showGrid', label: 'Raster anzeigen', v: st.showGrid },
        { t: 'check', k: 'set.magnetism', label: 'Magnetismus (Fangen, 15°, cm)', v: st.magnetism },
        { t: 'check', k: 'set.showRoomArea', label: 'Raumflächen anzeigen', v: st.showRoomArea },
        { t: 'check', k: 'set.showWallDims', label: 'Wandmaße der Auswahl', v: st.showWallDims },
        { t: 'num', k: 'set.north', label: 'Nordrichtung', v: st.north, unit: '°', digits: 0 },
      ]) +
      this.group('Dach (über dem obersten Geschoss)', [
        { t: 'sel', k: 'roof.type', label: 'Dachform', v: p.roof.type, opts: [['none', 'kein Dach'], ['gable', 'Satteldach'], ['hip', 'Walmdach'], ['shed', 'Pultdach'], ['flat', 'Flachdach']] },
        { t: 'num', k: 'roof.pitch', label: 'Neigung', v: p.roof.pitch, unit: '°', digits: 0 },
        { t: 'sel', k: 'roof.ridge', label: 'First', v: p.roof.ridge, opts: [['x', 'Ost–West'], ['y', 'Nord–Süd']] },
        { t: 'num', k: 'roof.overhang', label: 'Überstand', v: p.roof.overhang, ...CM },
        { t: 'num', k: 'roof.kneeWall', label: 'Kniestock', v: p.roof.kneeWall, ...CM },
        { t: 'color', k: 'roof.color', label: 'Farbe', v: p.roof.color },
      ]) +
      this.group('Gelände', [
        { t: 'check', k: 'gr.show', label: 'anzeigen', v: p.ground.show },
        { t: 'num', k: 'gr.level', label: 'Geländehöhe', v: p.ground.level, ...CM },
        { t: 'color', k: 'gr.color', label: 'Farbe', v: p.ground.color },
      ])
    );
  }

  private act(a: string, el: HTMLElement): void {
    const s = this.store;
    const sel = s.selection;
    const it = sel[0];
    switch (a) {
      case 'delete':
        return this.actions.deleteSelection();
      case 'rotate':
        return this.actions.rotateSelection();
      case 'bg-load':
        return this.actions.loadImage();
      case 'bg-cal':
        return this.actions.calibrate();
      case 'bg-remove':
        return this.actions.removeBackground();
      case 'select-opening':
        return s.select([{ kind: 'opening', id: el.dataset.id!, wallId: el.dataset.wall }]);
      case 'wall-split':
        return s.commit((_p, l) => {
          const w = l.walls.find((x) => x.id === it.id);
          if (!w) return;
          const [w1, w2] = splitWall(w, wallLength(w) / 2, () => uid('W'));
          l.walls.splice(l.walls.indexOf(w), 1, w1, w2);
        });
      case 'wall-reverse':
        return s.commit((_p, l) => {
          for (const x of sel) {
            const w = l.walls.find((y) => y.id === x.id);
            if (!w) continue;
            const L = wallLength(w);
            [w.a, w.b] = [w.b, w.a];
            [w.colorLeft, w.colorRight] = [w.colorRight, w.colorLeft];
            for (const o of w.openings) {
              o.offset = L - o.offset;
              o.side = o.side === 'left' ? 'right' : 'left';
              o.hinge = o.hinge === 'a' ? 'b' : 'a';
            }
          }
        });
      case 'op-side':
      case 'op-hinge':
        return s.commit((_p, l) => {
          const o = l.walls.find((w) => w.id === it.wallId)?.openings.find((x) => x.id === it.id);
          if (!o) return;
          if (a === 'op-side') o.side = o.side === 'left' ? 'right' : 'left';
          else o.hinge = o.hinge === 'a' ? 'b' : 'a';
        });
      case 'room-walls':
        return s.commit((p, l) => {
          const r = l.rooms.find((x) => x.id === it.id);
          if (!r) return;
          // Wandachse um die halbe Wanddicke nach außen versetzt
          const t = p.settings.wallThickness;
          const poly = r.polygon;
          const ccw = poly.reduce((acc, q, i) => acc + (q.x * poly[(i + 1) % poly.length].y - poly[(i + 1) % poly.length].x * q.y), 0) > 0;
          const off = poly.map((q, i) => {
            const prev = poly[(i - 1 + poly.length) % poly.length];
            const next = poly[(i + 1) % poly.length];
            const n1 = norm(sub(q, prev));
            const n2 = norm(sub(next, q));
            const o1 = ccw ? { x: n1.y, y: -n1.x } : { x: -n1.y, y: n1.x };
            const o2 = ccw ? { x: n2.y, y: -n2.x } : { x: -n2.y, y: n2.x };
            const bis = norm(add(o1, o2));
            const cos = Math.max(0.3, bis.x * o1.x + bis.y * o1.y);
            return add(q, mul(bis, t / 2 / cos));
          });
          addWallChain(l, off, t, true);
          void newWall;
        });
    }
  }

  private apply(k: string, v: string | number | boolean | null, live: boolean): void {
    const s = this.store;
    const [g, f] = k.split('.');
    const n = typeof v === 'number' ? v : null;
    const sel = s.selection;
    const run = (fn: (p: Project, l: Level) => void) => (live ? s.live(fn) : s.commit(fn));
    const ids = (kind: SelItem['kind']) => new Set(sel.filter((x) => x.kind === kind).map((x) => x.id));
    switch (g) {
      case 'wall':
        return run((_p, l) => {
          for (const w of l.walls.filter((x) => ids('wall').has(x.id))) {
            if (f === 'length' && n && n > 0.01) w.b = add(w.a, mul(norm(sub(w.b, w.a)), n));
            if (f === 'thickness' && n && n > 0.01) w.thickness = n;
            if (f === 'height') w.height = n && n > 0.1 ? n : null;
            if ((f === 'ax' || f === 'ay' || f === 'bx' || f === 'by') && n !== null) (f[0] === 'a' ? w.a : w.b)[f[1] as 'x' | 'y'] = n;
            if (f === 'colorLeft' || f === 'colorRight') w[f] = String(v);
            for (const o of w.openings) o.offset = clampOpening(w, o, o.offset);
          }
        });
      case 'op':
        return run((_p, l) => {
          const it = sel[0];
          const w = l.walls.find((x) => x.id === it.wallId);
          const o = w?.openings.find((x) => x.id === it.id);
          if (!w || !o) return;
          if (f === 'type') {
            o.type = v as OpeningType;
            const d = OPENING_TYPES[o.type];
            Object.assign(o, { width: d.width, height: d.height, sill: d.sill, color: d.color });
          }
          if (f === 'width' && n && n > 0.2) o.width = Math.min(wallLength(w) - 0.02, n);
          if (f === 'height' && n && n > 0.2) o.height = n;
          if (f === 'sill' && n !== null) o.sill = Math.max(0, n);
          if (f === 'left' && n !== null) o.offset = n + o.width / 2;
          if (f === 'color') o.color = String(v);
          o.offset = clampOpening(w, o, o.offset);
        });
      case 'room':
        return run((_p, l) => {
          for (const r of l.rooms.filter((x) => ids('room').has(x.id))) {
            if (f === 'name' && typeof v === 'string' && v.trim()) r.name = v.trim();
            if (f === 'floorFinish') {
              r.floorFinish = v as FloorFinish;
              r.floorColor = FLOOR_FINISHES[r.floorFinish].color;
            }
            if (f === 'floorColor' || f === 'ceilingColor') r[f] = String(v);
            if (f === 'showFloor' || f === 'showCeiling') r[f] = !!v;
          }
        });
      case 'fur':
        return run((_p, l) => {
          for (const x of l.furniture.filter((y) => ids('furniture').has(y.id))) {
            if (f === 'name' && typeof v === 'string' && v.trim()) x.name = v.trim();
            if ((f === 'width' || f === 'depth' || f === 'height') && n && n > 0.005) x[f] = n;
            if (f === 'elevation' && n !== null) x.elevation = n;
            if (f === 'x' && n !== null) x.pos.x = n;
            if (f === 'y' && n !== null) x.pos.y = n;
            if (f === 'angle' && n !== null) x.angle = ((n % 360) + 360) % 360;
            if (f === 'color') x.color = String(v);
            if (f === 'mirrored' || f === 'visible') x[f] = !!v;
          }
        });
      case 'st':
        return run((_p, l) => {
          const x = l.stairs.find((y) => y.id === sel[0].id);
          if (!x) return;
          if (f === 'type') {
            x.type = v as StairType;
            if (x.type === 'spiral') x.length = x.width = 1.6;
            else if (x.type === 'lshape') Object.assign(x, { width: 1, length: 2.5, length2: 1.8 });
            else Object.assign(x, { width: 1, length: 3.6 });
          }
          if (f === 'width' && n && n > 0.5) {
            if (x.type === 'spiral') x.length = x.width = n;
            else x.width = n;
          }
          if (f === 'length' && n && n > 0.5) x.length = n;
          if (f === 'length2' && n && n > 0.3) x.length2 = n;
          if (f === 'steps') x.steps = n && n >= 3 ? Math.round(n) : null;
          if (f === 'angle' && n !== null) x.angle = ((n % 360) + 360) % 360;
          if (f === 'color') x.color = String(v);
          if (f === 'clockwise' || f === 'cutCeiling') x[f] = !!v;
        });
      case 'dim':
        return run((_p, l) => {
          const d = l.dimensions.find((y) => y.id === sel[0].id);
          if (d && n !== null) d.offset = n;
        });
      case 'lab':
        return run((_p, l) => {
          const t = l.labels.find((y) => y.id === sel[0].id);
          if (!t) return;
          if (f === 'text' && typeof v === 'string' && v.trim()) t.text = v;
          if (f === 'size' && n && n > 0.02) t.size = n;
          if (f === 'angle' && n !== null) t.angle = n;
        });
      case 'lvl':
        return run((_p, l) => {
          if (f === 'name' && typeof v === 'string' && v.trim()) l.name = v.trim();
          if (f === 'elevation' && n !== null) l.elevation = n;
          if (f === 'height' && n && n > 1) l.height = n;
          if (f === 'floorThickness' && n !== null && n >= 0) l.floorThickness = n;
          if (f === 'visible') l.visible = !!v;
        });
      case 'bg':
        return run((_p, l) => {
          if (!l.background) return;
          if (f === 'opacity' && n !== null) l.background.opacity = n;
          if (f === 'visible') l.background.visible = !!v;
        });
      case 'set':
        return run((p) => {
          const st = p.settings as unknown as Record<string, unknown>;
          if (typeof st[f] === 'boolean') st[f] = !!v;
          else if (n !== null && n >= 0) st[f] = f === 'gridStep' ? Math.max(0.01, n) : n;
        });
      case 'roof':
        return run((p) => {
          if (f === 'type') p.roof.type = v as RoofType;
          else if (f === 'ridge') p.roof.ridge = v as 'x' | 'y';
          else if (f === 'color') p.roof.color = String(v);
          else if (n !== null) (p.roof as unknown as Record<string, number>)[f] = f === 'pitch' ? Math.min(75, Math.max(0, n)) : Math.max(0, n);
        });
      case 'gr':
        return run((p) => {
          if (f === 'show') p.ground.show = !!v;
          if (f === 'level' && n !== null) p.ground.level = n;
          if (f === 'color') p.ground.color = String(v);
        });
    }
  }
}

const kindLabel = (k: SelItem['kind']) => ({ wall: 'Wände', opening: 'Öffnungen', room: 'Räume', furniture: 'Möbel', stair: 'Treppen', dimension: 'Maße', label: 'Texte' })[k];
