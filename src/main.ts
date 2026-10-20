// HeatCircuits: Heizkreise auf einer geladenen Zeichnung planen – Vorlage, Räume, Heizlast, Loops, Bericht.

import './styles.css';
import type { ImageStore, OpeningStyle, Project, Vec } from './model/types';
import { PHASES, Store, type Phase } from './model/store';
import { migrateProject, newFloor, newProject, newRoom, uid } from './model/factory';
import { createSampleProject } from './model/sample';
import { OPENING_STYLES } from './cad/openings';
import { cloneFloorShell, copySelection, deleteSelection, moveSelection, pasteClip, rotateSelection, type Clip } from './cad/edit';
import { PlanView, type Tool } from './ui/plan';
import { PropsPanel } from './ui/props';
import { WallView } from './ui/wallview';
import { StartWizard, type WizardEntry } from './ui/wizard';
import { openBuildingDialog, openDesignDialog, openModal, resultTable, tableCsv, tableHtml, type ResultsTab } from './ui/dialogs';
import { autosave, loadAutosave, offerDownload, parseProjectFile, safeFilename, toFile } from './io/persist';
import { exportFloorSvg } from './io/export';
import { buildReportHtml } from './io/report';
import { dxfBackground, exportDxf, parseDxf } from './io/dxf';
import { esc, level, num, parseNum } from './ui/format';
import { bbox, v } from './geometry/geom';
import { floorBounds } from './ui/render';
import { autoLayout } from './calc/autolayout';
import { loadGray, recognizeFromGray, type RecognizeOptions } from './geometry/recognize';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

function toast(text: string, kind: 'info' | 'warn' = 'info'): void {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = text;
  $('toasts').appendChild(el);
  setTimeout(() => el.classList.add('out'), kind === 'warn' ? 5600 : 3800);
  setTimeout(() => el.remove(), kind === 'warn' ? 6000 : 4200);
}

const initial = createSampleProject();
const store = new Store(initial.project, initial.images);
let clip: Clip | null = null;
let pasteCount = 0;

// ---------- Dialoge für Texteingaben ----------
function ask(title: string, value: string, unit = ''): Promise<string | null> {
  return new Promise((resolve) => {
    let done = false;
    const m = openModal(title, { onClose: () => !done && resolve(null) });
    m.body.innerHTML = `<form class="ask"><span class="inp-wrap"><input type="text" id="ask-input" value="${esc(value)}" autocomplete="off"/>${unit ? `<span class="unit">${esc(unit)}</span>` : ''}</span><div class="actions"><button type="button" class="btn" data-close-ask>Abbrechen</button><button class="btn primary">OK</button></div></form>`;
    const input = m.body.querySelector('input') as HTMLInputElement;
    setTimeout(() => (input.focus(), input.select()), 0);
    m.body.querySelector('[data-close-ask]')!.addEventListener('click', () => m.close());
    m.body.querySelector('form')!.addEventListener('submit', (e) => {
      e.preventDefault();
      done = true;
      resolve(input.value.trim() || null);
      m.close();
    });
  });
}

// ---------- Hauptbausteine ----------
const plan = new PlanView($('plan-host'), store, {
  status: (t) => ($('hint').textContent = t),
  coords: (p) => renderCoords(p),
  toolChanged: () => renderTools(),
  toast,
  askText: (t, v0) => ask(t, v0),
  askNumber: async (t, v0, unit) => {
    const r = await ask(t, num(v0, 2), unit);
    return r === null ? null : parseNum(r);
  },
  openWallView: (wallId, roomId) => wallView.open(wallId, roomId),
  manifoldPlaced: () => runAutoLayout(true),
});

const wallView = new WallView($('stage'), store, () => plan.render());

const props = new PropsPanel($('sidebar'), store, {
  uploadImage: () => $('file-image').click(),
  calibrate: () => plan.setTool('calibrate'),
  recognize: (opts) => void recognize(store.activeFloorId, opts),
  autoLayout: () => runAutoLayout(false),
  openWallView: (wallId, roomId) => wallView.open(wallId, roomId),
  openBuilding: () => openBuildingDialog(store),
  openDesign: () => openDesignDialog(store, () => runAutoLayout(false)),
  deleteSelection: () => doDelete(),
  rotateSelection: () => store.commit((_p, f) => rotateSelection(f, store.selection, 90)),
  setPhase: (p) => setPhase(p),
  openReport: () => openReport(),
  setTool: (t) => plan.setTool(t),
  toast,
});

const wizard = new StartWizard(store, {
  finish: (entry) => startEntry(entry),
  toast,
});

// ---------- Arbeitsphasen ----------
function setPhase(p: Phase): void {
  if (wallView.isOpen && p === 'build') wallView.close();
  plan.setTool('select');
  store.select(null);
  store.setPhase(p);
  resultsOpen = p === 'results';
  renderResults();
}

function renderPhasebar(): void {
  const d = store.design;
  const p = store.project;
  const rooms = p.floors.reduce((a, f) => a + f.rooms.length, 0);
  const status: Record<Phase, string> = {
    build: `${rooms} Räume`,
    parts: `${num(d.totals.heatLoad / 1000, 1)} kW`,
    heating: `${p.floors.reduce((a, f) => a + f.rooms.filter((r) => r.heated && r.surfaces.length).length, 0)} beheizt`,
    circuits: `${d.totals.circuits} Kreise`,
    results: d.totals.deficit > 5 ? `${num(d.totals.deficit, 0)} W fehlen` : 'vollständig',
  };
  const idx = PHASES.findIndex((x) => x.id === store.phase);
  $('phasebar').innerHTML = PHASES.map((ph, i) => `<li class="${ph.id === store.phase ? 'current' : i < idx ? 'done' : ''}"><button data-phase="${ph.id}" title="${esc(ph.label)}"><span class="ph-n">${i + 1}</span><span class="ph-l">${esc(ph.label)}</span><span class="ph-s">${esc(status[ph.id])}</span></button></li>`).join('');
}
$('phasebar').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>('[data-phase]');
  if (b) setPhase(b.dataset.phase as Phase);
});

// ---------- Werkzeuge je Phase ----------
const ic = (d: string) => `<svg viewBox="0 0 24 24">${d}</svg>`;
const TOOLDEF: Record<Tool, { label: string; key: string; icon: string }> = {
  select: { label: 'Wahl', key: 'V', icon: ic('<path d="M5 3l14 8-6 1.5L10 19z"/>') },
  pan: { label: 'Ansicht', key: 'H', icon: ic('<path d="M12 3v18M3 12h18M12 3l-3 3m3-3 3 3M12 21l-3-3m3 3 3-3M3 12l3-3m-3 3 3 3M21 12l-3-3m3 3-3 3"/>') },
  roomRect: { label: 'Raum', key: 'R', icon: ic('<rect x="4" y="5" width="16" height="14" class="thick"/><path d="M8 9h8v6H8z" class="fillish"/>') },
  wall: { label: 'Wand', key: 'W', icon: ic('<path d="M3 20V8h8V4h10v16z" class="fillish"/>') },
  room: { label: 'Polygon', key: 'P', icon: ic('<path d="M4 5h10v5h6v9H4z"/><circle cx="4" cy="5" r="1.6"/><circle cx="14" cy="10" r="1.6"/><circle cx="20" cy="19" r="1.6"/>') },
  opening: { label: 'Öffnung', key: 'O', icon: ic('<path d="M3 12h4M17 12h4" class="thick"/><path d="M7 12a10 10 0 0 1 10-10M7 12h10"/>') },
  void: { label: 'Aussparung', key: 'U', icon: ic('<rect x="4" y="4" width="16" height="16"/><path d="M4 4l16 16M20 4 4 20"/>') },
  dimension: { label: 'Maß', key: 'D', icon: ic('<path d="M4 8v8M20 8v8M4 12h16M7 9l-3 3 3 3M17 9l3 3-3 3"/>') },
  label: { label: 'Text', key: 'X', icon: ic('<path d="M5 6V4h14v2M12 4v16M9 20h6"/>') },
  calibrate: { label: 'Maßstab', key: 'K', icon: ic('<path d="M3 16 16 3l5 5L8 21z"/><path d="M7 12l2 2M10 9l2 2M13 6l2 2"/>') },
  manifold: { label: 'Verteiler', key: 'M', icon: ic('<rect x="3" y="8" width="18" height="8" rx="1"/><path d="M7 16v4M11 16v4M15 16v4M19 16v4"/>') },
  heatSource: { label: 'Erzeuger', key: 'G', icon: ic('<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M9 16c0-3 3-3 3-7 2 2 3 4 3 7a3 3 0 0 1-6 0z"/>') },
  route: { label: 'Leitung', key: 'L', icon: ic('<path d="M4 20V10h8V4h8"/><path d="M7 20V13h8V7h5"/>') },
  painter: { label: 'Format', key: 'Y', icon: ic('<path d="M4 4h12v5H4z"/><path d="M16 6h3v6h-8v3"/><path d="M10 15h2v6h-2z"/>') },
};
const PHASE_TOOLS: Record<Phase, (Tool | '|')[]> = {
  build: ['select', 'pan', '|', 'calibrate', '|', 'roomRect', 'room', 'void', '|', 'wall', 'opening', '|', 'dimension', 'label'],
  parts: ['select', 'pan', '|', 'painter'],
  heating: ['select', 'pan', '|', 'painter'],
  circuits: ['select', 'pan', '|', 'manifold', 'heatSource', 'route'],
  results: ['select', 'pan'],
};

function renderTools(): void {
  const t = plan.tool;
  $('toolbar').innerHTML = PHASE_TOOLS[store.phase]
    .map((id) => (id === '|' ? '<span class="tool-sep"></span>' : `<button class="tool${t === id ? ' is-active' : ''}" data-tool="${id}" title="${esc(TOOLDEF[id].label)} (${TOOLDEF[id].key})" aria-pressed="${t === id}">${TOOLDEF[id].icon}<span>${esc(TOOLDEF[id].label)}</span></button>`))
    .join('');
  const opts = $('tool-options');
  let h = '';
  if (t === 'opening') h = (Object.keys(OPENING_STYLES) as OpeningStyle[]).map((k) => `<button class="chip-btn${plan.openingStyle === k ? ' on' : ''}" data-op="${k}">${esc(OPENING_STYLES[k].label)}</button>`).join('');
  else if (t === 'wall' || t === 'roomRect') h = `<label for="opt-thick">Wanddicke</label><span class="inp-wrap small"><input id="opt-thick" type="text" inputmode="decimal" value="${num(store.project.settings.wallThickness * 100, 1)}"/><span class="unit">cm</span></span><span class="opt-note">${t === 'wall' ? 'Länge tippen + Enter · Doppelklick beendet' : 'Rechteck = Wandachsen, lichte Maße werden angezeigt'}</span>`;
  else if (t === 'painter') h = `<span class="opt-note strong">${plan.painter ? `Format von ${esc(plan.painter.label)} – Ziele anklicken` : 'Quelle anklicken, dann Ziele'}</span><span class="opt-note">${store.phase === 'build' ? 'überträgt Darstellung und Maße' : store.phase === 'parts' ? 'überträgt Art, Aufbau und U-Werte' : 'überträgt Heizflächen und Belag'}</span>`;
  else if (t === 'calibrate') h = `<span class="opt-note strong">Zwei Punkte einer bekannten Strecke in der Zeichnung anklicken</span>`;
  else if (t === 'manifold') h = `<span class="opt-note strong">Verteiler setzen – danach werden die Heizkreise automatisch verteilt</span>`;
  else if (t === 'route') h = `<span class="opt-note strong">Raum anklicken, Wegpunkte setzen, auf den Verteiler klicken</span>`;
  if (!h && (t === 'select' || t === 'pan')) h = `<span class="opt-note">${t === 'select' ? 'Klicken wählt · Ziehen verschiebt · Rahmen wählt mehrere · ⇧ ergänzt' : 'Ziehen verschiebt die Ansicht · Mausrad zoomt'}</span>`;
  opts.innerHTML = `<span class="opt-tool">${TOOLDEF[t].icon}${esc(TOOLDEF[t].label)}</span>${h}`;
  renderLeft();
}

$('toolbar').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>('[data-tool]');
  if (!b) return;
  if (wallView.isOpen) wallView.close();
  plan.setTool(b.dataset.tool as Tool);
});
$('tool-options').addEventListener('click', (e) => {
  const b = e.target as HTMLElement;
  if (b.dataset.op) {
    plan.openingStyle = b.dataset.op as OpeningStyle;
    renderTools();
  }
});
$('tool-options').addEventListener('change', (e) => {
  const el = e.target as HTMLInputElement;
  if (el.id === 'opt-thick') {
    const n = parseNum(el.value);
    if (n && n > 1) store.commit((p) => (p.settings.wallThickness = n / 100));
  }
});

// Befehle aus den Seitenleisten (z. B. Zeichnung laden)
$('sidebar').addEventListener('click', (e) => {
  const c = (e.target as HTMLElement).closest<HTMLElement>('[data-cmd]');
  if (c) void runCommand(c.dataset.cmd!);
});

// ---------- linke Leiste: Vorlage und Raumliste ----------
function renderLeft(): void {
  const lp = $('leftpanel');
  const f = store.floor;
  const d = store.design;
  // Räume des Geschosses mit Zustand je Phase
  const rows = f.rooms
    .map((r) => {
      const rr = d.rooms.get(r.id);
      let state = '';
      let cls = '';
      if (store.phase === 'build') state = `${num(rr?.area ?? 0, 1)} m²${r.heated ? '' : ' · unbeheizt'}`;
      else if (store.phase === 'parts') state = r.heated ? `${num(r.thetaI, 0)} °C · ${num(rr?.heatLoad.total ?? 0, 0)} W` : 'unbeheizt';
      else if (store.phase === 'heating') {
        state = r.heated ? (r.surfaces.length ? r.surfaces.map((s) => ({ floor: 'Boden', wall: 'Wand', ceiling: 'Decke' })[s.kind]).join(' + ') : 'keine Heizfläche') : 'unbeheizt';
        cls = r.heated && !r.surfaces.length ? 'warn' : '';
      } else {
        state = r.heated ? `${rr?.circuits.length ?? 0} HK · ${num(rr?.heatLoad.total ?? 0, 0)} W` : 'unbeheizt';
        cls = rr && rr.deficit > 5 ? 'warn' : '';
      }
      return `<tr data-sel="room|${r.id}" class="${store.isSelected('room', r.id) ? 'on' : ''} ${cls}"><td>${esc(r.name)}</td><td class="r">${esc(state)}</td></tr>`;
    })
    .join('');
  let extra = '';
  if (store.phase === 'parts')
    extra = `<div class="legend"><h3>Wandarten</h3><span class="lg k-exterior">Außenwand</span><span class="lg k-interior">Innenwand</span><span class="lg k-party">Trennwand Nachbar</span><span class="lg k-unheated">zu unbeheizt</span><span class="lg own">eigener Aufbau</span></div>`;
  if (store.phase === 'circuits' || store.phase === 'results')
    extra = `<div class="lp-head small"><h3>Verteiler</h3></div><div class="fur-list"><table><tbody>${store.project.floors
      .flatMap((fl) => fl.manifolds.map((m) => ({ fl, m, mr: d.manifolds.find((x) => x.manifoldId === m.id) })))
      .map(({ fl, m, mr }) => `<tr data-sel="manifold|${m.id}|${fl.id}"><td>${esc(m.name)}</td><td class="r">${mr?.outlets ?? 0}/${m.maxOutlets} · ${num(mr?.heat ?? 0, 0)} W</td></tr>`)
      .join('') || '<tr><td colspan="2" class="muted">noch kein Verteiler</td></tr>'}</tbody></table></div>`;
  const importCard =
    store.phase === 'build' && !f.background
      ? `<div class="lp-import"><h3>Vorlage für ${esc(f.name)}</h3><div class="imp-grid"><button class="btn small" data-cmd="pdf">PDF</button><button class="btn small" data-cmd="dxf">DXF</button><button class="btn small" data-cmd="image">Bild</button><button class="btn small" data-cmd="ifc">IFC</button></div><p class="note">Grundriss laden, Maßstab prüfen, dann Räume aufziehen (R). IFC übernimmt Räume und Wände direkt.</p></div>`
      : '';
  lp.innerHTML = `${importCard}<div class="lp-head"><h2>Räume · ${esc(f.name)}</h2></div><div class="fur-list rooms"><table><tbody>${rows || '<tr><td class="muted">keine Räume</td></tr>'}</tbody></table></div>${extra}`;
}

$('leftpanel').addEventListener('click', (e) => {
  const t = e.target as HTMLElement;
  const cmd = t.closest<HTMLElement>('[data-cmd]');
  if (cmd) return void runCommand(cmd.dataset.cmd!);
  const row = t.closest<HTMLElement>('[data-sel]');
  if (row) {
    const [kind, id, fid] = row.dataset.sel!.split('|');
    if (fid && fid !== store.activeFloorId) store.setFloor(fid);
    store.select({ kind: kind as never, id });
  }
});

// ---------- Geschosse ----------
function renderLevels(): void {
  const sorted = store.project.floors.slice().sort((a, b) => b.elevation - a.elevation);
  $('levels').innerHTML =
    sorted.map((f) => `<button class="lvl${f.id === store.activeFloorId ? ' on' : ''}" data-lvl="${f.id}" title="OK FFB ${esc(level(f.elevation))} · Doppelklick benennt um">${esc(f.name)}<small>${esc(level(f.elevation))}</small></button>`).join('') +
    `<button class="lvl add" data-lvl-add title="Geschoss hinzufügen"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg></button>`;
}
$('levels').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>('button');
  if (!b) return;
  if (b.dataset.lvl) store.setFloor(b.dataset.lvl);
  else if (b.hasAttribute('data-lvl-add')) addFloorDialog();
});
$('levels').addEventListener('dblclick', async (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>('[data-lvl]');
  const f = store.project.floors.find((x) => x.id === b?.dataset.lvl);
  if (!f) return;
  const name = await ask('Geschoss umbenennen', f.name);
  if (name) store.commit((p) => (p.floors.find((x) => x.id === f.id)!.name = name));
});

function addFloorDialog(): void {
  const m = openModal('Geschoss hinzufügen');
  m.body.innerHTML = `<div class="choice"><button class="btn" data-af="copy">Darüber, Außenwände und Fenster übernehmen</button><button class="btn" data-af="empty">Darüber, leer</button><button class="btn" data-af="below">Darunter (Keller), Außenwände übernehmen</button></div>`;
  m.body.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-af]');
    if (!b) return;
    m.close();
    const mode = b.dataset.af!;
    const sorted = store.project.floors.slice().sort((a, c) => a.elevation - c.elevation);
    const top = sorted[sorted.length - 1];
    const low = sorted[0];
    let id = '';
    store.commit((p) => {
      let f;
      if (mode === 'below') {
        f = cloneFloorShell(low, 'Kellergeschoss', Math.round((low.elevation - 2.6) * 1000) / 1000, 2.6);
        f.clearHeight = 2.3;
        f.belowGrade = true;
      } else {
        const n = sorted.filter((x) => x.elevation >= 0).length;
        const name = n === 1 ? 'Obergeschoss' : n === 2 ? 'Dachgeschoss' : `${n}. Obergeschoss`;
        const z = Math.round((top.elevation + top.storeyHeight) * 1000) / 1000;
        f = mode === 'copy' ? cloneFloorShell(top, name, z, top.storeyHeight) : newFloor(name, z, top.storeyHeight);
      }
      p.floors.push(f);
      id = f.id;
    });
    store.setFloor(id);
    toast('Geschoss angelegt.');
  });
}

// ---------- Automatische Verteilung ----------
function runAutoLayout(afterPlacement: boolean): void {
  if (!store.project.floors.some((f) => f.manifolds.length)) {
    toast('Setzen Sie zuerst einen Heizkreisverteiler.', 'warn');
    return;
  }
  let rep: ReturnType<typeof autoLayout> | null = null;
  store.commit((p) => (rep = autoLayout(p)));
  const r = rep as unknown as ReturnType<typeof autoLayout>;
  const over = r.overCapacity.length ? ` Zu viele Abgänge an ${r.overCapacity.join(', ')} – weiteren Verteiler setzen.` : '';
  toast(`${afterPlacement ? 'Heizkreise erzeugt' : 'Neu verteilt'}: ${r.assigned} Räume zugeordnet, ${r.routed} Leitungen geführt, ${r.spacingChanges} Verlegeabstände angepasst. Vorlauf ${num(r.thetaSupply, 1)} °C.${over}`, over ? 'warn' : 'info');
}

// ---------- Raumerkennung ----------
async function recognize(floorId: string, opts: RecognizeOptions): Promise<void> {
  const floor = store.project.floors.find((f) => f.id === floorId);
  const bg = floor?.background;
  if (!floor || !bg || !store.images[bg.imageId]) return toast('Für dieses Geschoss ist keine Zeichnung geladen.', 'warn');
  if (!bg.calibrated) return toast('Bitte zuerst den Maßstab kalibrieren.', 'warn');
  try {
    $('saved').textContent = 'Erkenne Räume …';
    const { gray, W, H } = await loadGray(store.images[bg.imageId], bg.widthPx, bg.heightPx, bg.pxPerM, opts.res);
    const res = recognizeFromGray(gray, W, H, bg.offset, opts);
    if (!res.rooms.length) return toast('Keine geschlossenen Räume erkannt. Schwellwert oder „Wände im Plan“ anpassen, oder Wände nachzeichnen.', 'warn');
    store.commit((p) => {
      const f = p.floors.find((x) => x.id === floorId)!;
      f.walls = res.walls.map((w) => ({ ...w, kindAuto: true, openings: w.openings.map((o) => ({ ...o, style: o.kind === 'window' ? 'window' : o.kind === 'garage' ? 'garageDoor' : 'door' })) }));
      f.routes = [];
      let n = 0;
      f.rooms = res.rooms
        .sort((a, b) => b.area - a.area)
        .map((rr) => {
          const bb = bbox(rr.polygon);
          const wdt = Math.min(bb.max.x - bb.min.x, bb.max.y - bb.min.y);
          const len = Math.max(bb.max.x - bb.min.x, bb.max.y - bb.min.y);
          const type = wdt < 1.9 && len / wdt > 2.2 ? 'flur' : rr.area < 2.5 ? 'abstell' : 'sonstiges';
          return newRoom(p, f, rr.polygon, type, `Raum ${++n}`);
        });
    });
    store.setFloor(floorId);
    requestAnimationFrame(() => plan.fit());
    toast(`${res.stats.rooms} Räume, ${res.stats.walls} Wände und ${res.stats.openings} Öffnungen erkannt. Bitte Raumarten prüfen.`);
  } catch {
    toast('Die Erkennung ist fehlgeschlagen. Prüfen Sie das Bild oder zeichnen Sie Wände von Hand.', 'warn');
  } finally {
    $('saved').textContent = 'Im Browser gesichert';
  }
}

// ---------- Dateien ----------
async function readImage(file: File): Promise<{ url: string; w: number; h: number }> {
  const url = await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
  const img = new Image();
  img.src = url;
  await img.decode();
  let w = img.naturalWidth || 2000;
  let h = img.naturalHeight || 1400;
  const maxSide = 5000;
  const isSvg = file.type === 'image/svg+xml';
  if (isSvg || Math.max(w, h) > maxSide) {
    const k = isSvg ? Math.min(3, maxSide / Math.max(w, h)) : maxSide / Math.max(w, h);
    const c = document.createElement('canvas');
    c.width = Math.round(w * k);
    c.height = Math.round(h * k);
    const g = c.getContext('2d')!;
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, c.width, c.height);
    g.drawImage(img, 0, 0, c.width, c.height);
    w = c.width;
    h = c.height;
    return { url: c.toDataURL('image/png'), w, h };
  }
  return { url, w, h };
}

$('file-image').addEventListener('change', async (e) => {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  try {
    const { url, w, h } = await readImage(file);
    const imageId = uid('img');
    store.images[imageId] = url;
    const bounds = floorBounds(store.floor, store.project);
    store.commit((_p, f) => {
      f.background = { imageId, widthPx: w, heightPx: h, pxPerM: w / 20, offset: bounds ? v(bounds.min.x - 1, bounds.min.y - 1) : v(-1, -1), opacity: 0.6, visible: true, locked: false, calibrated: false };
    });
    if (store.phase !== 'build') setPhase('build');
    plan.fit();
    plan.setTool('calibrate');
    toast('Bild geladen. Klicken Sie zwei Punkte mit bekanntem Abstand an, um den Maßstab zu kalibrieren.');
  } catch {
    toast('Das Bild konnte nicht gelesen werden. Unterstützt werden PNG, JPG, WebP, GIF und SVG.', 'warn');
  }
});

$('file-dxf').addEventListener('change', async (e) => {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  try {
    const d = parseDxf(await file.text());
    const bg = dxfBackground(d);
    if (!bg) throw new Error('keine Linien gefunden');
    const imageId = uid('img');
    store.images[imageId] = bg.dataUrl;
    store.commit((_p, f) => (f.background = { imageId, ...bg.background }));
    if (store.phase !== 'build') setPhase('build');
    plan.fit();
    toast(`DXF: ${d.segments.length} Linien, Einheit ${d.unit === 0.001 ? 'mm' : d.unit === 0.01 ? 'cm' : 'm'}, ${d.layers.length} Layer – maßstäblich als Vorlage. Jetzt Räume aufziehen (R) oder Wände nachzeichnen (W).`);
  } catch (err) {
    toast(`DXF nicht lesbar: ${(err as Error).message}`, 'warn');
  }
});

$('file-pdf').addEventListener('change', async (e) => {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  try {
    const { openPdf } = await import('./io/pdf');
    openPdfDialog(await openPdf(await file.arrayBuffer()), file.name);
  } catch (err) {
    toast(`PDF nicht lesbar: ${(err as Error).message}`, 'warn');
  }
});

$('file-ifc').addEventListener('change', async (e) => {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  toast(`IFC „${file.name}“ wird gelesen …`);
  try {
    const [{ ifcToProject }, { locateWasm }] = await Promise.all([import('./io/ifc'), import('./io/ifc-wasm')]);
    const { project, stats } = await ifcToProject(new Uint8Array(await file.arrayBuffer()), { locateWasm });
    const modal = openModal(`IFC-Modell · ${file.name}`);
    const cur = store.project;
    modal.body.innerHTML = `<p><b>${esc(project.name)}</b></p>
      <dl class="kv-list"><dt>Geschosse</dt><dd>${project.floors.map((f) => `${esc(f.name)} (${level(f.elevation)})`).join(', ')}</dd><dt>Räume</dt><dd>${stats.spaces}</dd><dt>Wände</dt><dd>${stats.walls}</dd><dt>Fenster / Türen</dt><dd>${stats.windows} / ${stats.doors}</dd></dl>
      ${stats.warnings.length ? `<ul class="warnings">${stats.warnings.slice(0, 6).map((w) => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}
      <label class="field check"><input type="checkbox" id="ifc-keep"${cur.isExample ? '' : ' checked'}/><span class="lab">Standort, Bauteile und Auslegung aus dem aktuellen Projekt übernehmen</span></label>
      <p class="note">Das IFC-Modell wird als neues Projekt geöffnet. Raumarten sind aus den Raumnamen abgeleitet; Wandarten (außen, innen) werden automatisch bestimmt. Bitte danach Räume und Bauteile prüfen.</p>
      <div class="actions end"><button class="btn" data-close-dlg>Abbrechen</button><button class="btn primary" data-apply>Als Projekt öffnen</button></div>`;
    modal.body.querySelector('[data-close-dlg]')!.addEventListener('click', () => modal.close());
    modal.body.querySelector('[data-apply]')!.addEventListener('click', () => {
      if ((modal.body.querySelector('#ifc-keep') as HTMLInputElement).checked) {
        project.site = structuredClone(cur.site);
        project.building = structuredClone(cur.building);
        project.design = structuredClone(cur.design);
        project.roof = structuredClone(cur.roof);
        project.terrain = structuredClone(cur.terrain);
      }
      modal.close();
      loadProject(project, {}, `IFC übernommen: ${project.floors.length} Geschosse, ${stats.spaces} Räume, ${stats.walls} Wände, ${stats.windows} Fenster, ${stats.doors} Türen.`);
      setPhase('build');
    });
  } catch (err) {
    toast(`IFC nicht lesbar: ${(err as Error).message}`, 'warn');
  }
});

/** PDF-Seite wählen, Maßstab prüfen und als Vorlage des aktuellen Geschosses übernehmen */
function openPdfDialog(doc: import('pdfjs-dist/legacy/build/pdf.mjs').PDFDocumentProxy, name: string): void {
  const modal = openModal(`PDF-Grundriss · ${name}`, { wide: true });
  const pages = Math.min(doc.numPages, 24);
  let page = 1;
  modal.body.innerHTML = `<section><h3>Seite</h3><div class="pdf-pages">${Array.from({ length: pages }, (_, i) => `<button class="pdf-page${i === 0 ? ' on' : ''}" data-page="${i + 1}"><span class="pdf-thumb"></span><small>Seite ${i + 1}</small></button>`).join('')}</div>${doc.numPages > pages ? `<p class="note">Es werden die ersten ${pages} von ${doc.numPages} Seiten gezeigt.</p>` : ''}</section>
    <section><h3>Maßstab</h3><div class="fields cols"><label class="field"><span class="lab">Planmaßstab</span><select id="pdf-scale"><option value="0">unbekannt – mit zwei Punkten kalibrieren</option>${[20, 25, 50, 75, 100, 125, 200, 250, 500].map((n) => `<option value="${n}">1 : ${n}</option>`).join('')}</select></label><div class="field"><span class="lab">Papierformat</span><span class="val" id="pdf-paper">–</span></div></div>
    <p class="note" id="pdf-scale-note">Bei bekanntem Maßstab ist die Vorlage sofort maßstäblich. Prüfen Sie danach eine bekannte Länge mit dem Werkzeug Maßstab (K).</p></section>
    <div class="actions end"><button class="btn" data-close-dlg>Abbrechen</button><button class="btn primary" data-apply>Als Vorlage für ${esc(store.floor.name)} übernehmen</button></div>`;
  const sel = modal.body.querySelector<HTMLSelectElement>('#pdf-scale')!;
  const choosePage = async (n: number) => {
    page = n;
    modal.body.querySelectorAll('.pdf-page').forEach((b) => b.classList.toggle('on', Number((b as HTMLElement).dataset.page) === n));
    const { pageText, detectScale, PT_TO_M } = await import('./io/pdf');
    const pg = await doc.getPage(n);
    const vp = pg.getViewport({ scale: 1 });
    const fmtMm = (pt: number) => Math.round(pt * PT_TO_M * 1000);
    $('pdf-paper').textContent = `${fmtMm(vp.width)} × ${fmtMm(vp.height)} mm`;
    const found = detectScale(await pageText(doc, n));
    sel.value = String(found ?? 0);
    $('pdf-scale-note').textContent = found
      ? `Maßstab 1 : ${found} aus dem Plantext erkannt. Bitte danach eine bekannte Länge mit dem Werkzeug Maßstab (K) prüfen.`
      : 'Kein Maßstab im Plantext gefunden – Maßstab wählen oder nach dem Übernehmen zwei Punkte mit bekanntem Abstand anklicken.';
  };
  void (async () => {
    const { renderPdfPage } = await import('./io/pdf');
    await choosePage(1);
    for (let i = 1; i <= pages && document.body.contains(modal.root); i++) {
      const r = await renderPdfPage(doc, i, 240, 'image/jpeg');
      const slot = modal.body.querySelector<HTMLElement>(`.pdf-page[data-page="${i}"] .pdf-thumb`);
      if (slot) slot.style.backgroundImage = `url(${r.dataUrl})`;
    }
  })();
  modal.body.addEventListener('click', async (e) => {
    const t = e.target as HTMLElement;
    const pb = t.closest<HTMLElement>('[data-page]');
    if (pb) return void choosePage(Number(pb.dataset.page));
    if (t.closest('[data-close-dlg]')) return modal.close();
    const apply = t.closest<HTMLButtonElement>('[data-apply]');
    if (!apply) return;
    apply.disabled = true;
    apply.textContent = 'Seite wird aufbereitet …';
    try {
      const { renderPdfPage } = await import('./io/pdf');
      const r = await renderPdfPage(doc, page, 5000);
      const n = Number(sel.value);
      const imageId = uid('img');
      store.images[imageId] = r.dataUrl;
      const bounds = floorBounds(store.floor, store.project);
      store.commit((_p, f) => {
        f.background = { imageId, widthPx: r.widthPx, heightPx: r.heightPx, pxPerM: n ? r.widthPx / (r.paperW * n) : r.widthPx / 20, offset: bounds ? v(bounds.min.x - 1, bounds.min.y - 1) : v(-1, -1), opacity: 0.6, visible: true, locked: false, calibrated: n > 0 };
      });
      modal.close();
      if (store.phase !== 'build') setPhase('build');
      plan.fit();
      if (n) toast(`PDF-Seite ${page} maßstäblich (1 : ${n}) übernommen. Räume aufziehen (R) oder Wände nachzeichnen (W).`);
      else {
        plan.setTool('calibrate');
        toast('PDF übernommen. Zwei Punkte mit bekanntem Abstand anklicken, um den Maßstab festzulegen.');
      }
    } catch (err) {
      apply.disabled = false;
      apply.textContent = 'Übernehmen';
      toast(`PDF-Seite konnte nicht gerastert werden: ${(err as Error).message}`, 'warn');
    }
  });
}

$('file-project').addEventListener('change', async (e) => {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  try {
    const text = await file.text();
    const pf = parseProjectFile(text);
    loadProject(pf.project, pf.images ?? {}, `„${pf.project.name}“ geöffnet.`);
  } catch (err) {
    toast(err instanceof Error ? err.message : 'Die Datei konnte nicht gelesen werden.', 'warn');
  }
});

function loadProject(project: Project, images: ImageStore, message: string): void {
  store.load(migrateProject(project), images);
  plan.setTool('select');
  if (wallView.isOpen) wallView.close();
  requestAnimationFrame(() => plan.fit());
  toast(message);
}

async function saveProjectFile(): Promise<void> {
  const res = await offerDownload(`${safeFilename(store.project.name)}.heatcircuits.json`, JSON.stringify(toFile(store.project, store.images)), 'application/json');
  if (res === 'saved') {
    store.dirty = false;
    toast('Projektdatei gespeichert.');
  } else if (res === 'failed') toast('Speichern ist in dieser Ansicht nicht möglich.', 'warn');
}

function startNew(): void {
  store.load(newProject(), {});
  store.setPhase('build');
  wizard.open(0);
}

function startEntry(entry: WizardEntry): void {
  setPhase('build');
  requestAnimationFrame(() => plan.fit());
  if (entry === 'image') $('file-image').click();
  else if (entry === 'dxf') $('file-dxf').click();
  else if (entry === 'pdf') $('file-pdf').click();
  else if (entry === 'ifc') $('file-ifc').click();
  else if (entry === 'sample') {
    const s = createSampleProject();
    loadProject(s.project, s.images, 'Beispielprojekt geladen.');
  } else {
    plan.setTool('roomRect');
    toast('Ziehen Sie den ersten Raum als Rechteck auf. Wände entstehen automatisch, gemeinsame Wände werden nicht verdoppelt.');
  }
}

// ---------- Menü ----------
const menu = $('menu-project');
const menuBtn = $('btn-menu');
const setMenu = (open: boolean) => {
  menu.hidden = !open;
  menuBtn.setAttribute('aria-expanded', String(open));
};
menuBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  setMenu(menu.hidden);
});
document.addEventListener('click', () => setMenu(false));
menu.addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>('[data-cmd]');
  if (b) void runCommand(b.dataset.cmd!);
});

async function runCommand(cmd: string): Promise<void> {
  setMenu(false);
  const base = safeFilename(store.project.name);
  switch (cmd) {
    case 'new':
      return startNew();
    case 'open':
      return $('file-project').click();
    case 'save':
      return saveProjectFile();
    case 'image':
      return $('file-image').click();
    case 'dxf':
      return $('file-dxf').click();
    case 'pdf':
      return $('file-pdf').click();
    case 'ifc':
      return $('file-ifc').click();
    case 'sample': {
      const s = createSampleProject();
      return loadProject(s.project, s.images, 'Beispielprojekt geladen.');
    }
    case 'export-svg':
    case 'export-svg-bg': {
      const svg = exportFloorSvg(store.project, store.floor, store.design, store.images, cmd === 'export-svg-bg');
      if (!svg) return toast('Das Geschoss ist leer.', 'warn');
      if ((await offerDownload(`${base}_${safeFilename(store.floor.name)}.svg`, svg, 'image/svg+xml')) === 'saved') toast('Plan exportiert.');
      return;
    }
    case 'export-dxf':
      if ((await offerDownload(`${base}_${safeFilename(store.floor.name)}.dxf`, exportDxf(store.project, store.floor), 'application/dxf')) === 'saved') toast('DXF exportiert.');
      return;
    case 'export-csv':
      return exportCsv();
    case 'report':
      return openReport();
    case 'help':
      return showHelp();
  }
}

function showHelp(): void {
  const m = openModal('Bedienung', { wide: true });
  const rows: [string, string][] = [
    ['1 – 5 (mit ⇧)', 'Arbeitsphase: Plan, Heizlast, Heizflächen, Heizkreise, Bericht'],
    ['V / H', 'Auswählen / Ansicht verschieben (auch Leertaste, mittlere Maustaste)'],
    ['K', 'Maßstab der Zeichnung: zwei Punkte mit bekanntem Abstand'],
    ['R / P / U', 'Raum aufziehen / Raum als Polygon / Aussparung (Treppenloch, Einbauten)'],
    ['W / O', 'Wand nachzeichnen (Länge tippen + Enter) / Tür oder Fenster'],
    ['D / X', 'Bemaßung / Text'],
    ['M / G / L', 'Verteiler / Wärmeerzeuger / Anbindeleitung'],
    ['Y', 'Format übertragen'],
    ['Q', 'Auswahl um 90° drehen'],
    ['Pfeile', 'Auswahl um 1 cm verschieben (⇧ 10 cm)'],
    ['⌥ / Alt', 'beim Zeichnen: Fangen aus · auf freier Fläche: Zeichnung verschieben'],
    ['Bild ↑ / ↓', 'Geschoss wechseln'],
    ['Doppelklick', 'Plan: Raum erkennen · Heizflächen: Wandansicht'],
    ['⌘/Strg Z, ⇧Z, C, V, X, D, A, S, O', 'Rückgängig, Wiederholen, Kopieren, Einfügen, Ausschneiden, Duplizieren, Alles, Speichern, Öffnen'],
  ];
  m.body.innerHTML = `<table class="help">${rows.map(([k, t]) => `<tr><td><kbd>${esc(k)}</kbd></td><td>${esc(t)}</td></tr>`).join('')}</table>`;
}

// ---------- Ergebnisse ----------
let resultsTab: ResultsTab = 'rooms';
let resultsOpen = false;
function renderResults(): void {
  const drawer = $('results');
  drawer.hidden = !resultsOpen;
  if (!resultsOpen) return;
  drawer.querySelectorAll<HTMLElement>('[data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === resultsTab)));
  const d = store.design;
  const g = d.ground;
  const intro = resultsTab === 'rooms' ? `<p class="drawer-note">Vorlauf ${num(d.thetaSupply, 1)} °C ${d.thetaSupplyAuto ? '(nach EN 1264-3 ermittelt)' : '(fest)'} · σ ${num(d.sigmaDesign, 0)} K · θe ${num(store.project.building.thetaE, 1)} °C · Bodenplatte U_equiv ${num(g.uSlab, 3)} W/m²K (EN ISO 13370, B′ ${num(g.bPrime, 1)} m) · Heizlast vereinfacht nach EN 12831-1</p>` : '';
  $('results-body').innerHTML = `${intro}<div class="table-wrap">${tableHtml(resultTable(resultsTab, store.project, d))}</div>`;
}
$('btn-results-close').addEventListener('click', () => {
  resultsOpen = false;
  renderResults();
});
$('results').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>('[data-tab]');
  if (!b) return;
  resultsTab = b.dataset.tab as ResultsTab;
  renderResults();
});
async function exportCsv(): Promise<void> {
  const names: Record<ResultsTab, string> = { rooms: 'Raeume', surfaces: 'Heizflaechen', circuits: 'Heizkreise', manifolds: 'Verteiler', material: 'Material' };
  const csv = tableCsv(resultTable(resultsTab, store.project, store.design));
  if ((await offerDownload(`${safeFilename(store.project.name)}_${names[resultsTab]}.csv`, csv, 'text/csv')) === 'saved') toast(`Tabelle „${names[resultsTab]}“ exportiert.`);
}
$('btn-csv').addEventListener('click', () => void exportCsv());
$('btn-report').addEventListener('click', () => openReport());

/** Auslegungsbericht DIN A4: Vorschau, Drucken (PDF) und Speichern als HTML */
function openReport(): void {
  const html = buildReportHtml(store.project, store.design, store.images);
  const modal = openModal('Auslegungsbericht (DIN A4)', { wide: true });
  modal.root.querySelector('.modal')!.classList.add('report');
  modal.body.innerHTML = `<div class="report-bar"><p class="note">Vollständige Auslegung mit Heizlast, Temperaturen, Heizkreisen, Einstellwerten, Plänen und Normwerten – gesetzt für DIN A4 hoch.</p>
    <div class="actions"><button class="btn primary" data-rep="print">Drucken / als PDF</button><button class="btn" data-rep="save">Als HTML speichern</button></div></div>
    <iframe class="report-frame" title="Vorschau Auslegungsbericht"></iframe>`;
  const frame = modal.body.querySelector<HTMLIFrameElement>('.report-frame')!;
  frame.srcdoc = html;
  modal.body.addEventListener('click', async (e) => {
    const act = (e.target as HTMLElement).closest<HTMLElement>('[data-rep]')?.dataset.rep;
    if (act === 'print') {
      try {
        frame.contentWindow?.focus();
        frame.contentWindow?.print();
        toast('Druckdialog: Ziel „Als PDF sichern“, Papier A4, Ränder „Standard“. Erscheint kein Dialog, den Bericht als HTML speichern und im Browser drucken.');
      } catch {
        toast('Drucken ist hier gesperrt – bitte als HTML speichern und im Browser drucken (⌘P).', 'warn');
      }
    }
    if (act === 'save' && (await offerDownload(`${safeFilename(store.project.name)}_Auslegung_A4.html`, html, 'text/html')) === 'saved') toast('Auslegungsbericht gespeichert – im Browser öffnen und drucken (⌘P).');
  });
}

// ---------- Kopfzeile, Status ----------
function renderHeader(): void {
  const p = store.project;
  const d = store.design;
  $('btn-project-name').textContent = p.name;
  $('chip-example').hidden = !p.isExample;
  ($('btn-undo') as HTMLButtonElement).disabled = !store.canUndo();
  ($('btn-redo') as HTMLButtonElement).disabled = !store.canRedo();
  $('summary').innerHTML = `
    <span class="kpi" title="${esc(p.site.place || '')} · θe ${num(p.building.thetaE, 1)} °C"><span class="k">θe</span><span class="val">${num(p.building.thetaE, 0)} °C</span></span>
    <span class="kpi"><span class="k">Heizlast</span><span class="val">${num(d.totals.heatLoad / 1000, 2)} kW</span></span>
    <span class="kpi"><span class="k">Vorlauf</span><span class="val">${num(d.thetaSupply, 1)} °C</span></span>
    <span class="kpi"><span class="k">Kreise</span><span class="val">${d.hasManifold ? d.totals.circuits : '–'}</span></span>
    ${d.totals.deficit > 5 ? `<span class="kpi warn" title="Leistung, die über Zusatzheizflächen gedeckt werden muss"><span class="k">Zusatz</span><span class="val">${num(d.totals.deficit, 0)} W</span></span>` : ''}`;
  ($('compass').firstElementChild as SVGElement).style.transform = `rotate(${p.site.north}deg)`;
}

function renderCoords(p: Vec | null): void {
  const bg = store.floor.background;
  const scale = bg ? ` · Vorlage 1 m = ${num(bg.pxPerM, 1)} px${bg.calibrated ? '' : ' (nicht kalibriert)'}` : '';
  $('coords').textContent = `${p ? `x ${num(p.x, 2)} · y ${num(p.y, 2)} m` : '—'}${scale}`;
}

$('btn-project-name').addEventListener('click', () => openBuildingDialog(store));
$('btn-building').addEventListener('click', () => openBuildingDialog(store));
$('btn-design').addEventListener('click', () => openDesignDialog(store, () => runAutoLayout(false)));
$('btn-undo').addEventListener('click', () => store.undo());
$('btn-redo').addEventListener('click', () => store.redo());
$('btn-zoom-in').addEventListener('click', () => plan.zoom(1.25));
$('btn-zoom-out').addEventListener('click', () => plan.zoom(0.8));
$('btn-fit').addEventListener('click', () => plan.fit());
const darkQuery = matchMedia('(prefers-color-scheme: dark)');
const isDark = () => (document.documentElement.dataset.theme ? document.documentElement.dataset.theme === 'dark' : darkQuery.matches);
function applyTheme(): void {
  const dark = isDark();
  $('btn-theme').innerHTML = dark
    ? '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6"/></svg>'
    : '<svg viewBox="0 0 24 24"><path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z"/></svg>';
  $('btn-theme').title = dark ? 'Helles Farbschema' : 'Dunkles Farbschema';
  plan.render();
}
$('btn-theme').addEventListener('click', () => {
  const root = document.documentElement;
  root.dataset.theme = isDark() ? 'light' : 'dark';
  try {
    localStorage.setItem('hc.theme', root.dataset.theme);
  } catch {
    /* ohne Speicher */
  }
  applyTheme();
});
darkQuery.addEventListener('change', () => !document.documentElement.dataset.theme && applyTheme());

// ---------- Bearbeiten ----------
function doDelete(): void {
  if (!store.selection.length) return;
  const sel = store.selection;
  store.commit((p, f) => deleteSelection(p, f, sel));
  store.select(null);
}
function doCopy(): void {
  if (!store.selection.length || store.phase !== 'build') return;
  clip = copySelection(store.floor, store.selection);
  pasteCount = 0;
}
function doPaste(): void {
  if (!clip || store.phase !== 'build') return;
  pasteCount++;
  let sel: ReturnType<typeof pasteClip> = [];
  const c = clip;
  store.commit((_p, f) => (sel = pasteClip(f, c, { x: 0.5 * pasteCount, y: 0.5 * pasteCount })));
  store.select(sel);
}
function selectAll(): void {
  const f = store.floor;
  if (store.phase !== 'build') return store.select(f.rooms.map((r) => ({ kind: 'room' as const, id: r.id })));
  store.select([
    ...f.walls.map((x) => ({ kind: 'wall' as const, id: x.id })),
    ...f.rooms.map((x) => ({ kind: 'room' as const, id: x.id })),
    ...f.voids.map((x) => ({ kind: 'void' as const, id: x.id })),
    ...f.dimensions.map((x) => ({ kind: 'dimension' as const, id: x.id })),
    ...f.labels.map((x) => ({ kind: 'label' as const, id: x.id })),
  ]);
}

const KEY_TOOLS: Record<string, Tool> = { v: 'select', h: 'pan', w: 'wall', r: 'roomRect', p: 'room', o: 'opening', u: 'void', d: 'dimension', x: 'label', k: 'calibrate', m: 'manifold', g: 'heatSource', l: 'route', y: 'painter' };

window.addEventListener('keydown', (e) => {
  if (document.querySelector('.overlay')) return;
  const t = e.target as HTMLElement;
  if (t.closest('input, select, textarea')) return;
  const mod = e.metaKey || e.ctrlKey;
  const k = e.key.toLowerCase();
  if (plan.key(e)) {
    e.preventDefault();
    return;
  }
  if (mod) {
    const acts: Record<string, () => void> = {
      z: () => (e.shiftKey ? store.redo() : store.undo()),
      y: () => store.redo(),
      c: doCopy,
      x: () => (doCopy(), doDelete()),
      v: doPaste,
      d: () => (doCopy(), doPaste()),
      a: selectAll,
      s: () => void saveProjectFile(),
      o: () => $('file-project').click(),
      n: startNew,
    };
    if (acts[k]) {
      e.preventDefault();
      acts[k]();
    }
    return;
  }
  if (e.key === ' ') {
    e.preventDefault();
    plan.setSpace(true);
    return;
  }
  if (e.key === 'Delete' || e.key === 'Backspace') {
    e.preventDefault();
    return doDelete();
  }
  if (e.key === 'Escape') {
    if (wallView.isOpen) return wallView.close();
    if (plan.tool !== 'select') plan.setTool('select');
    else store.select(null);
    return;
  }
  if (e.key === 'Home') return plan.fit();
  if (e.key === '+' || e.key === '=') return plan.zoom(1.25);
  if (e.key === '-') return plan.zoom(0.8);
  if (e.key === 'PageUp' || e.key === 'PageDown') {
    const sorted = store.project.floors.slice().sort((a, b) => a.elevation - b.elevation);
    const i = sorted.findIndex((f) => f.id === store.activeFloorId) + (e.key === 'PageUp' ? 1 : -1);
    if (sorted[i]) {
      e.preventDefault();
      store.setFloor(sorted[i].id);
    }
    return;
  }
  if (e.key.startsWith('Arrow') && store.selection.length && store.phase === 'build') {
    e.preventDefault();
    const s = e.shiftKey ? 0.1 : 0.01;
    const d = { x: e.key === 'ArrowLeft' ? -s : e.key === 'ArrowRight' ? s : 0, y: e.key === 'ArrowUp' ? -s : e.key === 'ArrowDown' ? s : 0 };
    const base = JSON.parse(JSON.stringify(store.floor));
    const baseP = JSON.parse(JSON.stringify(store.project));
    const sel = store.selection;
    store.commit((p, f) => moveSelection(base, f, sel, d, p, baseP));
    return;
  }
  if (e.shiftKey && /^[1-5!"§$%]$/.test(e.key)) {
    const idx = '1!2"3§4$5%'.indexOf(e.key);
    const n = idx >= 0 ? Math.floor(idx / 2) : Number(e.key) - 1;
    if (PHASES[n]) setPhase(PHASES[n].id);
    return;
  }
  if (e.code?.startsWith('Digit') && e.shiftKey) {
    const n = Number(e.code.slice(5)) - 1;
    if (PHASES[n]) setPhase(PHASES[n].id);
    return;
  }
  if (k === 'q' && store.selection.length && store.phase === 'build') return store.commit((_p, f) => rotateSelection(f, store.selection, e.shiftKey ? -90 : 90));
  const tool = KEY_TOOLS[k];
  if (tool && PHASE_TOOLS[store.phase].includes(tool)) {
    if (wallView.isOpen) wallView.close();
    plan.setTool(tool);
  }
});
window.addEventListener('keyup', (e) => e.key === ' ' && plan.setSpace(false));

// ---------- Zustand → Oberfläche ----------
let saveTimer = 0;
function scheduleSave(): void {
  clearTimeout(saveTimer);
  $('saved').textContent = 'Änderungen …';
  saveTimer = window.setTimeout(async () => {
    const ok = await autosave(store.project, store.images);
    $('saved').textContent = ok ? 'Im Browser gesichert' : 'Nicht gesichert – Projektdatei speichern';
    $('saved').classList.toggle('warn', !ok);
  }, 700);
}

store.on((reason) => {
  if (reason === 'floor' || reason === 'load') requestAnimationFrame(() => plan.fit());
  plan.render();
  if (reason !== 'live') {
    props.render();
    renderLevels();
    renderHeader();
    renderPhasebar();
    renderLeft();
    if (reason !== 'selection') renderResults();
    if (wallView.isOpen) wallView.render();
  }
  if (reason === 'phase') renderTools();
  if (reason === 'project' || reason === 'load') scheduleSave();
});

// ---------- Start ----------
try {
  const th = localStorage.getItem('hc.theme');
  if (th) document.documentElement.dataset.theme = th;
} catch {
  /* ohne Speicher */
}
applyTheme();
renderTools();
renderLevels();
renderHeader();
renderPhasebar();
props.render();
renderLeft();
plan.setTool('select');
requestAnimationFrame(() => plan.fit());

loadAutosave().then((file) => {
  if (file) {
    store.load(migrateProject(file.project), file.images ?? {});
    toast(`Zuletzt bearbeitetes Projekt „${file.project.name}“ wiederhergestellt.`);
  } else toast('Beispielprojekt geladen. „Projekt › Neues Projekt“ startet den Assistenten.');
  $('saved').textContent = 'Im Browser gesichert';
});

