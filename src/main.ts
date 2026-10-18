import './styles.css';
import type { ImageStore, OpeningKind, Project, Vec } from './model/types';
import { Store } from './model/store';
import { migrateProject, newFloor, newProject, newRoom, newWall, uid } from './model/factory';
import { createSampleProject } from './model/sample';
import { ROOM_TYPES, WALL_PRESETS } from './model/catalog';
import { Editor, OPENING_DEFAULTS, type Tool } from './ui/editor';
import { Sidebar, deleteSelection } from './ui/sidebar';
import { openBuildingDialog, openCalibrateDialog, openDesignDialog, resultTable, tableCsv, tableHtml, type ResultsTab } from './ui/dialogs';
import { WallView } from './ui/wallview';
import { Wizard } from './ui/wizard';
import { autosave, loadAutosave, offerDownload, parseProjectFile, safeFilename, toFile } from './io/persist';
import { exportFloorSvg } from './io/export';
import { esc, num, parseNum } from './ui/format';
import { add, bbox, mul, sub, v } from './geometry/geom';
import { floorBounds } from './ui/render';
import { autoLayout } from './calc/autolayout';
import { loadGray, recognizeFromGray, type RecognizeOptions } from './geometry/recognize';
import type { View3D } from './ui/view3d';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

function toast(text: string, kind: 'info' | 'warn' = 'info'): void {
  const host = $('toasts');
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = text;
  host.appendChild(el);
  setTimeout(() => el.classList.add('out'), kind === 'warn' ? 5600 : 3800);
  setTimeout(() => el.remove(), kind === 'warn' ? 6000 : 4200);
}

const initial = createSampleProject();
const store = new Store(initial.project, initial.images);
let view: 'plan' | '3d' = 'plan';
let view3d: View3D | null = null;

const editor = new Editor($('canvas-host'), store, {
  status: (p) => renderCoords(p),
  hint: (t) => ($('hint').textContent = t),
  toast,
  calibrate: (measured, a, b) => openCalibrateDialog(measured, (real) => applyCalibration(measured, real, a, b), () => editor.setTool('select')),
  toolChanged: (t) => renderTools(t),
  manifoldPlaced: () => {
    runAutoLayout(true);
    if (wizard.step === 6) wizard.open(6);
  },
  openWallView: (wallId, roomId) => wallView.open(wallId, roomId),
});

const wallView = new WallView($('stage'), store, () => editor.requestRender());

const sidebar = new Sidebar($('sidebar'), store, {
  uploadImage: () => $('file-image').click(),
  setTool: (t) => editor.setTool(t),
  addFloor,
  toast,
  autoLayout: () => runAutoLayout(false),
  recognize: (opts) => recognize(store.activeFloorId, opts),
  openWallView: (wallId, roomId) => wallView.open(wallId, roomId),
});

const wizard = new Wizard(
  store,
  {
    uploadImage: (fid) => {
      store.setFloor(fid);
      $('file-image').click();
    },
    startCalibrate: (fid) => {
      setView('plan');
      store.setFloor(fid);
      editor.setTool('calibrate');
    },
    recognize: (fid) => recognize(fid, sidebar.recognizeOpts),
    placeManifold: (fid) => {
      setView('plan');
      store.setFloor(fid);
      editor.setTool('manifold');
    },
    autoLayout: () => runAutoLayout(false),
    showResults: () => {
      resultsOpen = true;
      renderResults();
    },
    show3D: () => setView('3d'),
    toast,
  },
  $('stage'),
);

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

// ---------- Kalibrierung ----------
function applyCalibration(measured: number, real: number, a: Vec, _b: Vec): void {
  const s = real / measured;
  store.commit((p) => {
    const f = p.floors.find((x) => x.id === store.activeFloorId)!;
    const bg = f.background;
    if (!bg) return;
    bg.pxPerM = bg.pxPerM / s;
    bg.offset = add(a, mul(sub(bg.offset, a), s));
    bg.calibrated = true;
  });
  editor.setTool('select');
  editor.fit();
  toast(`Maßstab gesetzt: 1 m = ${num(store.floor.background?.pxPerM ?? 0, 1)} px. Jetzt können Räume und Wände erkannt werden.`);
  if (wizard.step === 4) wizard.open(4);
}

// ---------- Raumerkennung ----------
async function recognize(floorId: string, opts: RecognizeOptions): Promise<void> {
  const floor = store.project.floors.find((f) => f.id === floorId);
  const bg = floor?.background;
  if (!floor || !bg || !store.images[bg.imageId]) {
    toast('Für dieses Geschoss ist kein Grundrissbild geladen.', 'warn');
    return;
  }
  if (!bg.calibrated) {
    toast('Bitte zuerst den Maßstab kalibrieren.', 'warn');
    return;
  }
  try {
    $('saved').textContent = 'Erkenne Räume …';
    const { gray, W, H } = await loadGray(store.images[bg.imageId], bg.widthPx, bg.heightPx, bg.pxPerM, opts.res);
    const res = recognizeFromGray(gray, W, H, bg.offset, opts);
    if (!res.rooms.length) {
      toast('Keine geschlossenen Räume erkannt. Schwellwert oder „Wände im Plan“ anpassen, oder Wände nachzeichnen.', 'warn');
      return;
    }
    store.commit((p) => {
      const f = p.floors.find((x) => x.id === floorId)!;
      f.walls = res.walls;
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
    requestAnimationFrame(() => editor.fit());
    toast(`${res.stats.rooms} Räume, ${res.stats.walls} Wände und ${res.stats.openings} Öffnungen erkannt. Bitte Raumarten prüfen.`);
  } catch {
    toast('Die Erkennung ist fehlgeschlagen. Prüfen Sie das Bild oder zeichnen Sie Wände von Hand.', 'warn');
  } finally {
    $('saved').textContent = 'Im Browser gesichert';
    if (wizard.isOpen) wizard.render();
  }
}

// ---------- Grundrissbild laden ----------
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
    const fl = store.floor;
    const bounds = floorBounds(fl, store.project);
    store.commit((p) => {
      const f = p.floors.find((x) => x.id === fl.id)!;
      f.background = { imageId, widthPx: w, heightPx: h, pxPerM: w / 20, offset: bounds ? v(bounds.min.x - 1, bounds.min.y - 1) : v(-1, -1), opacity: 0.6, visible: true, locked: false, calibrated: false };
    });
    setView('plan');
    editor.fit();
    if (wizard.isOpen) wizard.render();
    else {
      editor.setTool('calibrate');
      toast('Grundriss geladen. Klicken Sie zwei Punkte mit bekanntem Abstand an, um den Maßstab zu kalibrieren.');
    }
  } catch {
    toast('Das Bild konnte nicht gelesen werden. Unterstützt werden PNG, JPG, WebP, GIF und SVG.', 'warn');
  }
});

// ---------- Geschosse ----------
function addFloor(): void {
  const floors = store.project.floors.slice().sort((a, b) => a.elevation - b.elevation);
  const top = floors[floors.length - 1];
  const count = floors.filter((f) => /obergeschoss/i.test(f.name)).length;
  const name = count === 0 ? 'Obergeschoss' : `${count + 1}. Obergeschoss`;
  const nf = newFloor(name, Math.round((top.elevation + top.storeyHeight) * 100) / 100);
  nf.storeyHeight = top.storeyHeight;
  nf.clearHeight = top.clearHeight;
  const ext = top.walls.filter((w) => w.kind === 'exterior');
  nf.walls = ext.map((w) => newWall({ ...w.a }, { ...w.b }, w.kind, w.thickness));
  store.commit((p) => p.floors.push(nf));
  store.setFloor(nf.id);
  toast(ext.length ? `${name} angelegt, ${ext.length} Außenwände übernommen.` : `${name} angelegt.`);
}

// ---------- Ansicht Plan / 3D ----------
async function setView(next: 'plan' | '3d'): Promise<void> {
  view = next;
  document.querySelectorAll<HTMLElement>('[data-view]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === view)));
  $('canvas-host').hidden = view !== 'plan';
  $('tool-options').hidden = view !== 'plan' || !$('tool-options').innerHTML;
  document.querySelector<HTMLElement>('.zoom-ctl')!.hidden = view !== 'plan';
  $('view3d-ctl').hidden = view !== '3d';
  if (view === '3d') {
    if (wallView.isOpen) wallView.close();
    if (!view3d) {
      const mod = await import('./ui/view3d');
      view3d = new mod.View3D($('view3d-host'), store, (floorId, roomId) => {
        store.setFloor(floorId);
        store.select({ kind: 'room', id: roomId });
      });
    }
    view3d.show();
    render3dCtl();
  } else {
    view3d?.hide();
    editor.requestRender();
  }
}

function render3dCtl(): void {
  if (!view3d) return;
  const o = view3d.options;
  $('view3d-ctl').innerHTML = `
    <button class="toggle${o.showRoof ? ' on' : ''}" data-v3="showRoof" aria-pressed="${o.showRoof}">Dach</button>
    <button class="toggle${o.upToActive ? ' on' : ''}" data-v3="upToActive" aria-pressed="${o.upToActive}">bis ${esc(store.floor.name)}</button>
    <button class="toggle${o.showCircuits ? ' on' : ''}" data-v3="showCircuits" aria-pressed="${o.showCircuits}">Heizkreise</button>
    <span class="v3-hint">Ziehen: drehen · Rechts ziehen: verschieben · Rad: zoomen · Doppelklick: Raum wählen</span>`;
}

$('view3d-ctl').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest('[data-v3]') as HTMLElement | null;
  if (!b || !view3d) return;
  const k = b.dataset.v3 as 'showRoof' | 'upToActive' | 'showCircuits';
  view3d.options[k] = !view3d.options[k];
  render3dCtl();
  view3d.rebuild();
});
document.querySelectorAll<HTMLElement>('[data-view]').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view as 'plan' | '3d')));

// ---------- Werkzeuge ----------
function renderTools(t: Tool): void {
  document.querySelectorAll<HTMLElement>('.tool').forEach((b) => {
    b.classList.toggle('is-active', b.dataset.tool === t);
    b.setAttribute('aria-pressed', String(b.dataset.tool === t));
  });
  const opts = $('tool-options');
  let h = '';
  const o = editor.options;
  if (t === 'wall') {
    h = `<label for="opt-wall">Wandtyp</label><select id="opt-wall">${WALL_PRESETS.map((w, i) => `<option value="${i}"${i === o.wallPreset ? ' selected' : ''}>${esc(w.label)}</option>`).join('')}</select><span class="opt-note">Achse zeichnen · Länge tippen + Enter</span>`;
  } else if (t === 'room' || t === 'rect' || t === 'detect') {
    h = `<label for="opt-room">Raumart</label><select id="opt-room">${Object.entries(ROOM_TYPES)
      .map(([k, r]) => `<option value="${k}"${k === o.roomType ? ' selected' : ''}>${esc(r.label)} · ${r.thetaI} °C</option>`)
      .join('')}</select>`;
  } else if (t === 'opening') {
    h = `<label for="opt-okind">Öffnung</label><select id="opt-okind">${(Object.keys(OPENING_DEFAULTS) as OpeningKind[])
      .map((k) => `<option value="${k}"${k === o.openingKind ? ' selected' : ''}>${esc(OPENING_DEFAULTS[k].label)}</option>`)
      .join('')}</select>
      <label for="opt-ow">B</label><input id="opt-ow" class="opt-num" type="text" inputmode="decimal" value="${num(o.openingWidth, 3)}"/>
      <label for="opt-oh">H</label><input id="opt-oh" class="opt-num" type="text" inputmode="decimal" value="${num(o.openingHeight, 3)}"/>
      <label for="opt-os">Brüstung</label><input id="opt-os" class="opt-num" type="text" inputmode="decimal" value="${num(o.openingSill, 2)}"/><span class="opt-note">m</span>`;
  } else if (t === 'calibrate') {
    h = `<span class="opt-note strong">Maßstab: Punkt 1 und Punkt 2 einer bekannten Strecke anklicken</span>`;
  } else if (t === 'stair' || t === 'spiral' || t === 'void') {
    h = `<span class="opt-note strong">${t === 'spiral' ? 'Spindeltreppe' : t === 'stair' ? 'Treppe' : 'Luftraum'} im Fußboden von „${esc(store.floor.name)}“ – Öffnung zum Geschoss darunter</span>`;
  }
  opts.innerHTML = h;
  opts.hidden = !h || view !== 'plan';
}

$('tool-options').addEventListener('change', (e) => {
  const el = e.target as HTMLSelectElement | HTMLInputElement;
  if (el.id === 'opt-wall') editor.options.wallPreset = Number(el.value);
  if (el.id === 'opt-room') editor.options.roomType = el.value;
  if (el.id === 'opt-okind') {
    editor.setOpeningKind(el.value as OpeningKind);
    renderTools(editor.tool);
  }
  const n = parseNum(el.value);
  if (el.id === 'opt-ow' && n && n > 0.2) editor.options.openingWidth = n;
  if (el.id === 'opt-oh' && n && n > 0.2) editor.options.openingHeight = n;
  if (el.id === 'opt-os' && n !== null && n >= 0) editor.options.openingSill = n;
});

document.querySelector('.toolbar')!.addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest('[data-tool]') as HTMLElement | null;
  if (!b) return;
  setView('plan');
  if (wallView.isOpen) wallView.close();
  editor.setTool(b.dataset.tool as Tool);
});

// ---------- Statusleiste ----------
type ToggleKey = 'grid' | 'snap' | 'ortho' | 'showCircuits' | 'showLabels' | 'ghost';
const TOGGLES: [ToggleKey, string, string][] = [
  ['grid', 'Raster', 'Raster 5 cm'],
  ['snap', 'Fang', 'Fang an Ecken und Wandenden'],
  ['ortho', 'Ortho', 'Nur 90°-Richtungen (Shift kehrt um)'],
  ['showCircuits', 'Kreise', 'Verlegung der Heizkreise anzeigen'],
  ['showLabels', 'Text', 'Beschriftungen anzeigen'],
  ['ghost', 'Pause', 'Wände des Nachbargeschosses durchscheinen lassen'],
];

function renderToggles(): void {
  $('toggles').innerHTML = TOGGLES.map(([k, label, title]) => `<button class="toggle${editor.options[k] ? ' on' : ''}" data-toggle="${k}" title="${esc(title)}" aria-pressed="${editor.options[k]}">${label}</button>`).join('');
}
$('toggles').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest('[data-toggle]') as HTMLElement | null;
  if (!b) return;
  const k = b.dataset.toggle as ToggleKey;
  editor.options[k] = !editor.options[k];
  renderToggles();
  editor.requestRender();
});

function renderCoords(p: Vec | null): void {
  const bg = store.floor.background;
  const scale = bg ? ` · Plan 1 m = ${num(bg.pxPerM, 1)} px${bg.calibrated ? '' : ' (nicht kalibriert)'}` : '';
  $('coords').textContent = `${p ? `x ${num(p.x, 2)} · y ${num(p.y, 2)} m` : '—'} · Zoom ${num(editor.view.scale, 0)} px/m${scale}`;
}

// ---------- Kopfzeile ----------
function renderHeader(): void {
  const p = store.project;
  const d = store.design;
  $('btn-project-name').textContent = p.name;
  $('chip-example').hidden = !p.isExample;
  ($('btn-undo') as HTMLButtonElement).disabled = !store.canUndo();
  ($('btn-redo') as HTMLButtonElement).disabled = !store.canRedo();
  const deficit = d.totals.deficit > 5;
  $('summary').innerHTML = `
    <span class="kpi"><span class="k">Heizlast</span><span class="val">${num(d.totals.heatLoad / 1000, 2)} kW</span></span>
    <span class="kpi"><span class="k">Vorlauf</span><span class="val">${num(d.thetaSupply, 1)} °C</span></span>
    <span class="kpi"><span class="k">Kreise</span><span class="val">${d.hasManifold ? d.totals.circuits : '–'}</span></span>
    <span class="kpi"><span class="k">Rohr</span><span class="val">${num(d.totals.pipeTotal, 0)} m</span></span>
    ${deficit ? `<span class="kpi warn" title="Leistung, die über Zusatzheizflächen gedeckt werden muss"><span class="k">Zusatz</span><span class="val">${num(d.totals.deficit, 0)} W</span></span>` : ''}`;
}

$('btn-project-name').addEventListener('click', () => openBuildingDialog(store));
$('btn-building').addEventListener('click', () => openBuildingDialog(store));
$('btn-design').addEventListener('click', () => openDesignDialog(store, () => runAutoLayout(false)));
$('btn-wizard').addEventListener('click', () => wizard.open());
$('btn-undo').addEventListener('click', () => store.undo());
$('btn-redo').addEventListener('click', () => store.redo());
$('btn-zoom-in').addEventListener('click', () => editor.zoomBy(1.25));
$('btn-zoom-out').addEventListener('click', () => editor.zoomBy(0.8));
$('btn-fit').addEventListener('click', () => editor.fit());

const menu = $('menu-project');
const menuBtn = $('btn-menu');
function setMenu(open: boolean) {
  menu.hidden = !open;
  menuBtn.setAttribute('aria-expanded', String(open));
}
menuBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  setMenu(menu.hidden);
});
document.addEventListener('click', () => setMenu(false));
menu.addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest('[data-cmd]') as HTMLElement | null;
  if (b) runCommand(b.dataset.cmd!);
});

async function saveProjectFile(): Promise<void> {
  const file = toFile(store.project, store.images);
  const res = await offerDownload(`${safeFilename(store.project.name)}.heatcircuits.json`, JSON.stringify(file), 'application/json');
  if (res === 'saved') toast('Projektdatei gespeichert.');
  else if (res === 'failed') toast('Speichern ist in dieser Ansicht nicht möglich.', 'warn');
}

function loadProject(project: Project, images: ImageStore, message: string): void {
  store.load(migrateProject(project), images);
  editor.setTool('select');
  if (wallView.isOpen) wallView.close();
  requestAnimationFrame(() => editor.fit());
  toast(message);
}

async function runCommand(cmd: string): Promise<void> {
  setMenu(false);
  switch (cmd) {
    case 'new':
      loadProject(newProject(), {}, 'Neues Projekt angelegt.');
      wizard.open(0);
      break;
    case 'open':
      $('file-project').click();
      break;
    case 'save':
      await saveProjectFile();
      break;
    case 'sample': {
      const s = createSampleProject();
      loadProject(s.project, s.images, 'Beispielprojekt geladen.');
      break;
    }
    case 'export-svg':
    case 'export-svg-bg': {
      const svg = exportFloorSvg(store.project, store.floor, store.design, store.images, cmd === 'export-svg-bg');
      if (!svg) {
        toast('Das Geschoss ist leer.', 'warn');
        return;
      }
      const res = await offerDownload(`${safeFilename(store.project.name)}_${safeFilename(store.floor.name)}.svg`, svg, 'image/svg+xml');
      if (res === 'saved') toast('Plan exportiert.');
      break;
    }
    case 'export-png': {
      if (!view3d || view !== '3d') await setView('3d');
      const url = view3d!.snapshot();
      const blob = await (await fetch(url)).blob();
      const res = await offerDownload(`${safeFilename(store.project.name)}_3D.png`, blob, 'image/png');
      if (res === 'saved') toast('3D-Ansicht exportiert.');
      break;
    }
    case 'export-csv':
      await exportCsv();
      break;
  }
}

$('file-project').addEventListener('change', async (e) => {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  try {
    const pf = parseProjectFile(await file.text());
    loadProject(pf.project, pf.images ?? {}, `„${pf.project.name}“ geöffnet.`);
  } catch (err) {
    toast(err instanceof Error ? err.message : 'Die Datei konnte nicht gelesen werden.', 'warn');
  }
});

// ---------- Ergebnisse ----------
let resultsTab: ResultsTab = 'rooms';
let resultsOpen = false;
const TABS: ResultsTab[] = ['rooms', 'surfaces', 'circuits', 'manifolds', 'material'];
try {
  const t = localStorage.getItem('hc.resultsTab') as ResultsTab | null;
  if (t && TABS.includes(t)) resultsTab = t;
} catch {
  /* Speicher nicht verfügbar */
}

function renderResults(): void {
  const drawer = $('results');
  drawer.hidden = !resultsOpen;
  $('btn-results').setAttribute('aria-pressed', String(resultsOpen));
  $('btn-results').classList.toggle('is-active', resultsOpen);
  if (!resultsOpen) return;
  drawer.querySelectorAll<HTMLElement>('[data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === resultsTab)));
  const d = store.design;
  const g = d.ground;
  const intro =
    resultsTab === 'rooms'
      ? `<p class="drawer-note">Vorlauf ${num(d.thetaSupply, 1)} °C ${d.thetaSupplyAuto ? '(nach EN 1264-3 ermittelt)' : '(fest vorgegeben)'} · σ ${num(d.sigmaDesign, 0)} K · θ_e ${num(store.project.building.thetaE, 1)} °C · Bodenplatte U_equiv ${num(g.uSlab, 3)} W/m²K (EN ISO 13370, B′ ${num(g.bPrime, 1)} m) · Heizlast vereinfacht nach EN 12831-1</p>`
      : '';
  $('results-body').innerHTML = `${intro}<div class="table-wrap">${tableHtml(resultTable(resultsTab, store.project, d))}</div>`;
}

$('btn-results').addEventListener('click', () => {
  resultsOpen = !resultsOpen;
  renderResults();
});
$('btn-results-close').addEventListener('click', () => {
  resultsOpen = false;
  renderResults();
});
$('results').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest('[data-tab]') as HTMLElement | null;
  if (!b) return;
  resultsTab = b.dataset.tab as ResultsTab;
  try {
    localStorage.setItem('hc.resultsTab', resultsTab);
  } catch {
    /* ignorieren */
  }
  renderResults();
});

async function exportCsv(): Promise<void> {
  const names: Record<ResultsTab, string> = { rooms: 'Raeume', surfaces: 'Heizflaechen', circuits: 'Heizkreise', manifolds: 'Verteiler', material: 'Material' };
  const csv = tableCsv(resultTable(resultsTab, store.project, store.design));
  const res = await offerDownload(`${safeFilename(store.project.name)}_${names[resultsTab]}.csv`, csv, 'text/csv');
  if (res === 'saved') toast(`Tabelle „${names[resultsTab]}“ exportiert.`);
}
$('btn-csv').addEventListener('click', exportCsv);

// ---------- Tastatur ----------
const SHORTCUTS: Record<string, Tool> = {
  v: 'select',
  h: 'pan',
  w: 'wall',
  r: 'room',
  q: 'rect',
  e: 'detect',
  o: 'opening',
  t: 'stair',
  s: 'spiral',
  u: 'void',
  m: 'manifold',
  g: 'heatSource',
  l: 'route',
  d: 'measure',
  k: 'calibrate',
  b: 'moveImage',
};

window.addEventListener('keydown', (e) => {
  if (document.querySelector('.overlay')) return;
  const t = e.target as HTMLElement;
  const typing = t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT';
  const mod = e.metaKey || e.ctrlKey;
  if (mod && e.key.toLowerCase() === 's') {
    e.preventDefault();
    saveProjectFile();
    return;
  }
  if (mod && e.key.toLowerCase() === 'o') {
    e.preventDefault();
    $('file-project').click();
    return;
  }
  if (typing) return;
  if (mod && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    if (e.shiftKey) store.redo();
    else store.undo();
    return;
  }
  if (mod && e.key.toLowerCase() === 'y') {
    e.preventDefault();
    store.redo();
    return;
  }
  if (mod) return;
  if (view === 'plan' && editor.typeChar(e.key)) {
    e.preventDefault();
    return;
  }
  switch (e.key) {
    case 'Enter':
      if (editor.confirm()) e.preventDefault();
      return;
    case 'Escape':
      if (wallView.isOpen) return wallView.close();
      if (!editor.cancelDraft()) {
        if (editor.tool !== 'select') editor.setTool('select');
        else store.select(null);
      }
      return;
    case 'Delete':
    case 'Backspace':
      if (deleteSelection(store)) e.preventDefault();
      return;
    case '+':
    case '=':
      editor.zoomBy(1.25);
      return;
    case '-':
      editor.zoomBy(0.8);
      return;
    case 'PageUp':
    case 'PageDown': {
      const sorted = store.project.floors.slice().sort((a, b) => a.elevation - b.elevation);
      const i = sorted.findIndex((f) => f.id === store.activeFloorId);
      const n = sorted[i + (e.key === 'PageUp' ? 1 : -1)];
      if (n) store.setFloor(n.id);
      e.preventDefault();
      return;
    }
  }
  const k = e.key.toLowerCase();
  if (k === 'f') return editor.fit();
  if (k === '3') return void setView(view === '3d' ? 'plan' : '3d');
  if (SHORTCUTS[k]) {
    setView('plan');
    if (wallView.isOpen) wallView.close();
    editor.setTool(SHORTCUTS[k]);
  }
});

// ---------- Rendern und Autosave ----------
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
  if (reason === 'floor' || reason === 'load') requestAnimationFrame(() => editor.fit());
  if (view === 'plan') editor.requestRender();
  sidebar.render();
  renderHeader();
  if (wallView.isOpen) wallView.render();
  if (reason !== 'selection') renderResults();
  if (reason === 'project' || reason === 'load') scheduleSave();
  if (view === '3d' && view3d && reason !== 'selection') {
    view3d.requestRebuild();
    render3dCtl();
  }
  if (wizard.isOpen && reason === 'floor') wizard.render();
  renderCoords(null);
});

renderTools('select');
renderToggles();
editor.setTool('select');
sidebar.render();
renderHeader();
renderResults();
requestAnimationFrame(() => editor.fit());

loadAutosave().then((file) => {
  if (file) {
    store.load(migrateProject(file.project), file.images ?? {});
    toast(`Zuletzt bearbeitetes Projekt „${file.project.name}“ wiederhergestellt.`);
  }
  $('saved').textContent = 'Im Browser gesichert';
});

