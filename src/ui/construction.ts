// Schichtaufbau eines einzelnen Bauteils (Wand, Boden oder Decke eines Raums): eigener Aufbau statt
// Gebäudeaufbau, Vorlage, Schichten, U-Wert nach EN ISO 6946.

import type { Construction, ConstructionSlot, Floor, Project } from '../model/types';
import { CONSTRUCTION_TEMPLATES, MATERIALS, SURFACE_RESISTANCE, constructionFromTemplate, constructionThickness, uValue } from '../model/constructions';
import type { Store } from '../model/store';
import { esc, num, parseNum } from './format';

/** Ziel eines Bauteilaufbaus: „wall:<id>“, „floor:<raumId>“, „ceil:<raumId>“ */
export interface ElementRef {
  get(p: Project, f: Floor): Construction | null | undefined;
  set(p: Project, f: Floor, c: Construction | null): void;
  slot(p: Project, f: Floor): ConstructionSlot;
}

export function elementRef(target: string): ElementRef {
  const [kind, id] = target.split(':');
  if (kind === 'wall')
    return {
      get: (_p, f) => f.walls.find((w) => w.id === id)?.construction,
      set: (_p, f, c) => {
        const w = f.walls.find((x) => x.id === id);
        if (w) w.construction = c;
      },
      slot: (_p, f) => {
        const w = f.walls.find((x) => x.id === id);
        return w?.kind === 'exterior' ? 'extWall' : 'unheatedWall';
      },
    };
  const key = kind === 'floor' ? 'floorConstruction' : 'ceilingConstruction';
  return {
    get: (_p, f) => f.rooms.find((r) => r.id === id)?.[key],
    set: (_p, f, c) => {
      const r = f.rooms.find((x) => x.id === id);
      if (r) r[key] = c;
    },
    slot: (p, f) => {
      const r = f.rooms.find((x) => x.id === id);
      const sorted = p.floors.slice().sort((a, b) => a.elevation - b.elevation);
      if (kind === 'floor') return r?.floorBoundary === 'ground' || (r?.floorBoundary === 'auto' && sorted[0].id === f.id && p.building.basement === 'none') ? 'groundSlab' : 'basementSlab';
      return r?.ceilingBoundary === 'roof' || (r?.ceilingBoundary === 'auto' && sorted[sorted.length - 1].id === f.id && p.roof.insulation === 'rafters') ? 'roof' : 'topSlab';
    },
  };
}

/** U-Wert des Gebäudeaufbaus für die Stelle */
function buildingU(p: Project, slot: ConstructionSlot): number {
  const b = p.building;
  return { extWall: b.uExtWall, roof: b.uRoof, topSlab: b.uTopSlab, groundSlab: b.uGroundFloor, basementSlab: b.uUnheatedSlab, unheatedWall: b.uUnheatedWall }[slot];
}

export function elementConstructionHtml(p: Project, f: Floor, target: string, title: string): string {
  const ref = elementRef(target);
  const c = ref.get(p, f);
  const slot = ref.slot(p, f);
  if (!c) {
    return `<div class="construction compact" data-target="${target}">
      <div class="construction-head"><b>${esc(title)}</b><span class="u-badge muted">Gebäudeaufbau · U ${num(buildingU(p, slot), 3)}</span></div>
      <p class="note">${esc(SURFACE_RESISTANCE[slot].label)} aus den Gebäudedaten.</p>
      <div class="actions"><button class="btn small" data-act="el-own" data-target="${target}">Eigenen Aufbau festlegen</button></div>
    </div>`;
  }
  const u = uValue(slot, c.layers);
  const tpl = Object.entries(CONSTRUCTION_TEMPLATES)
    .filter(([, t]) => t.slot === slot || (slot === 'unheatedWall' && t.slot === 'extWall'))
    .map(([k, t]) => `<option value="${k}"${c.template === k ? ' selected' : ''}>${esc(t.label)}</option>`)
    .join('');
  const matOpts = Object.entries(MATERIALS).map(([k, m]) => `<option value="${k}">${esc(m.label)} (λ ${num(m.lambda, 3)})</option>`).join('');
  const rows = c.layers
    .map(
      (l, i) => `<tr>
      <td><select data-elayer="${target}|${i}|material" aria-label="Baustoff">${matOpts.replace(`value="${l.material}"`, `value="${l.material}" selected`)}</select></td>
      <td><span class="inp-wrap"><input type="text" inputmode="decimal" data-elayer="${target}|${i}|thickness" value="${num(l.thickness * 100, 1)}" aria-label="Dicke"/><span class="unit">cm</span></span></td>
      <td class="r">${num(l.thickness / (MATERIALS[l.material]?.lambda ?? 1), 3)}</td>
      <td><button class="icon-btn small" data-act="el-layer-del" data-target="${target}" data-i="${i}" aria-label="Schicht entfernen"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg></button></td>
    </tr>`,
    )
    .join('');
  return `<div class="construction compact" data-target="${target}">
    <div class="construction-head"><b>${esc(title)}</b><span class="u-badge">U = ${num(u, 3)} W/(m²K)</span><span class="muted">${num(constructionThickness(c.layers) * 100, 1)} cm</span></div>
    <label class="field"><span class="lab">Vorlage</span><select data-etpl="${target}"><option value="custom"${c.template in CONSTRUCTION_TEMPLATES ? '' : ' selected'}>eigener Aufbau</option>${tpl}</select></label>
    <div class="table-wrap"><table class="layers"><thead><tr><th>Schicht (innen → außen)</th><th>Dicke</th><th class="r">R</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>
    <div class="actions"><button class="btn small" data-act="el-layer-add" data-target="${target}">+ Schicht</button><button class="btn small" data-act="el-reset" data-target="${target}">Gebäudeaufbau verwenden</button></div>
  </div>`;
}

/** Ereignisse der Bauteilaufbauten im Bereich `root` */
export function bindElementConstructions(root: HTMLElement, store: Store): void {
  root.addEventListener('change', (e) => {
    const el = e.target as HTMLInputElement | HTMLSelectElement;
    if (el.dataset.etpl) {
      const ref = elementRef(el.dataset.etpl);
      if (el.value !== 'custom') store.commit((p, f) => ref.set(p, f, constructionFromTemplate(el.value)));
      return;
    }
    const key = el.dataset.elayer;
    if (!key) return;
    const [target, idx, field] = key.split('|');
    const ref = elementRef(target);
    store.commit((p, f) => {
      const c = ref.get(p, f);
      const l = c?.layers[Number(idx)];
      if (!c || !l) return;
      if (field === 'material') l.material = el.value;
      if (field === 'thickness') {
        const v = parseNum(el.value);
        if (v && v > 0) l.thickness = v / 100;
      }
      c.template = 'custom';
    });
  });
  root.addEventListener('click', (e) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>('[data-act^="el-"]');
    if (!t?.dataset.target) return;
    const ref = elementRef(t.dataset.target);
    store.commit((p, f) => {
      const slot = ref.slot(p, f);
      const c = ref.get(p, f);
      switch (t.dataset.act) {
        case 'el-own': {
          const src = p.building.constructions[slot];
          ref.set(p, f, JSON.parse(JSON.stringify(src)));
          break;
        }
        case 'el-reset':
          ref.set(p, f, null);
          break;
        case 'el-layer-add':
          c?.layers.push({ material: 'mineralwolle', thickness: 0.1 });
          if (c) c.template = 'custom';
          break;
        case 'el-layer-del':
          c?.layers.splice(Number(t.dataset.i), 1);
          if (c) c.template = 'custom';
          break;
      }
    });
  });
}
