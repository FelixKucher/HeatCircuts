// HausCAD – eigenständiges Haus-CAD: Grundriss zeichnen, 3D betrachten, exportieren.

import './styles.css';
import { CATALOG, CATEGORIES, CATALOG_BY_KEY, catalogIcon } from './catalog';
import { cloneLevel, copySelection, deleteSelection, moveSelection as moveSel, pasteClip, rotateSelection, type Clip } from './edit';
import { autosave, dxfBackground, exportDxf, loadAutosave, offerDownload, parseDxf, parseProject, safeFilename, serialize, toHeatCircuits } from './io';
import { newLevel, newProject, OPENING_TYPES, type OpeningType, type StairType } from './model';
import { esc, fmt } from './plan-render';
import { PlanView, type Tool } from './plan';
import { PropsPanel } from './props';
import { sampleHouse } from './sample';
import { Store } from './store';
import { askNumber, askText, buildMenus, ICONS, modal, toast } from './ui';
import { View3D } from './view3d';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const store = new Store();
let clip: Clip | null = null;
let pasteCount = 0;

const status = (t: string) => ($('hint').textContent = t);

const plan = new PlanView($('plan-host'), store, {
  status,
  coords: (p) => ($('coords').textContent = p ? `x ${fmt(p.x)}  y ${fmt(p.y)} m` : ''),
  toolChanged: () => renderTools(),
  askText,
  askNumber,
  openProps: () => $('props').querySelector<HTMLInputElement>('input,select')?.focus(),
});

const view = new View3D($('view-host'), store, (kind, id, wallId) => {
  store.select([{ kind: kind as never, id, wallId }]);
});

const props = new PropsPanel($('props'), store, {
  loadImage: () => $('file-image').click(),
  calibrate: () => plan.setTool('calibrate'),
  removeBackground: () => store.commit((_p, l) => (l.background = null)),
  deleteSelection: () => doDelete(),
  rotateSelection: () => store.commit((_p, l) => rotateSelection(l, store.selection, 90)),
});

// ---------- Werkzeuge ----------

const TOOLS: { id: Tool; label: string; key: string; icon: string }[] = [
  { id: 'select', label: 'Auswählen', key: 'V', icon: ICONS.select },
  { id: 'pan', label: 'Verschieben', key: 'H', icon: ICONS.pan },
  { id: 'roomRect', label: 'Raum aufziehen', key: 'R', icon: ICONS.roomRect },
  { id: 'wall', label: 'Wand', key: 'W', icon: ICONS.wall },
  { id: 'room', label: 'Raum (Polygon / Doppelklick)', key: 'P', icon: ICONS.room },
  { id: 'opening', label: 'Tür / Fenster', key: 'O', icon: ICONS.opening },
  { id: 'stair', label: 'Treppe', key: 'T', icon: ICONS.stair },
  { id: 'dimension', label: 'Bemaßung', key: 'M', icon: ICONS.dimension },
  { id: 'label', label: 'Text', key: 'X', icon: ICONS.label },
  { id: 'calibrate', label: 'Maßstab des Bildes', key: 'K', icon: ICONS.calibrate },
];

function renderTools(): void {
  $('tools').innerHTML = TOOLS.map((t) => `<button class="tool${plan.tool === t.id ? ' on' : ''}" data-tool="${t.id}" title="${esc(t.label)} (${t.key})">${t.icon}<span>${t.key}</span></button>`).join('');
  const opts = $('tool-options');
  let html = '';
  if (plan.tool === 'opening') {
    html = (Object.keys(OPENING_TYPES) as OpeningType[]).map((k) => `<button class="chip${plan.openingType === k ? ' on' : ''}" data-op="${k}">${esc(OPENING_TYPES[k].label)}</button>`).join('');
  } else if (plan.tool === 'stair') {
    html = ([['straight', 'gerade'], ['lshape', 'L mit Podest'], ['spiral', 'Spindel']] as [StairType, string][]).map(([k, l]) => `<button class="chip${plan.stairType === k ? ' on' : ''}" data-stair="${k}">${l}</button>`).join('');
  } else if (plan.tool === 'furniture') {
    html = `<span class="chip on">${esc(CATALOG_BY_KEY[plan.catalogKey]?.name ?? '')}</span><span class="muted">Klicken setzt das Möbel · ⇧ für mehrere · Esc beendet</span>`;
  } else if (plan.tool === 'wall' || plan.tool === 'roomRect') {
    const st = store.project.settings;
    html = `<label class="inline">Wanddicke <input id="opt-thick" value="${fmt(st.wallThickness * 100, 1)}" inputmode="decimal"/> cm</label><span class="muted">${plan.tool === 'wall' ? 'Länge tippen + Enter · Doppelklick beendet' : 'Rechteck = Wandachsen'}</span>`;
  }
  opts.innerHTML = html;
  opts.hidden = !html;
}

$('tools').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>('[data-tool]');
  if (b) plan.setTool(b.dataset.tool as Tool);
});
$('tool-options').addEventListener('click', (e) => {
  const b = e.target as HTMLElement;
  if (b.dataset.op) {
    plan.openingType = b.dataset.op as OpeningType;
    renderTools();
  }
  if (b.dataset.stair) {
    plan.stairType = b.dataset.stair as StairType;
    renderTools();
  }
});
$('tool-options').addEventListener('change', (e) => {
  const el = e.target as HTMLInputElement;
  if (el.id === 'opt-thick') {
    const n = parseFloat(el.value.replace(',', '.'));
    if (n > 1) store.commit((p) => (p.settings.wallThickness = n / 100));
  }
});

// ---------- Katalog und Möbelliste ----------

function renderCatalog(): void {
  const q = ($('cat-search') as HTMLInputElement).value.trim().toLowerCase();
  const items = CATALOG.filter((c) => !q || c.name.toLowerCase().includes(q) || c.category.toLowerCase().includes(q));
  $('catalog').innerHTML = CATEGORIES.filter((cat) => items.some((i) => i.category === cat))
    .map(
      (cat) =>
        `<details open><summary>${esc(cat)}</summary><div class="cat-grid">${items
          .filter((i) => i.category === cat)
          .map((i) => `<button class="cat-item${plan.tool === 'furniture' && plan.catalogKey === i.key ? ' on' : ''}" data-cat="${i.key}" draggable="true" title="${esc(i.name)} · ${fmt(i.width * 100, 0)} × ${fmt(i.depth * 100, 0)} × ${fmt(i.height * 100, 0)} cm">${catalogIcon(i)}<span>${esc(i.name)}</span></button>`)
          .join('')}</div></details>`,
    )
    .join('');
}

$('catalog').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>('[data-cat]');
  if (!b) return;
  plan.catalogKey = b.dataset.cat!;
  plan.setTool('furniture');
  renderCatalog();
});
$('catalog').addEventListener('dragstart', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>('[data-cat]');
  if (b) e.dataTransfer?.setData('text/x-hauscad', b.dataset.cat!);
});
$('cat-search').addEventListener('input', renderCatalog);

function renderFurList(): void {
  const l = store.level;
  $('fur-count').textContent = l.furniture.length ? `(${l.furniture.length})` : '';
  $('fur-list').innerHTML = l.furniture.length
    ? `<table><thead><tr><th>Name</th><th>B</th><th>T</th><th>H</th></tr></thead><tbody>${l.furniture
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name, 'de'))
        .map((f) => `<tr data-fid="${f.id}" class="${store.isSelected('furniture', f.id) ? 'on' : ''}${f.visible ? '' : ' off'}"><td>${esc(f.name)}</td><td>${fmt(f.width * 100, 0)}</td><td>${fmt(f.depth * 100, 0)}</td><td>${fmt(f.height * 100, 0)}</td></tr>`)
        .join('')}</tbody></table>`
    : '<p class="muted pad">Noch keine Möbel. Aus dem Katalog anklicken oder in den Plan ziehen.</p>';
}

$('fur-list').addEventListener('click', (e) => {
  const tr = (e.target as HTMLElement).closest<HTMLElement>('[data-fid]');
  if (tr) store.select([{ kind: 'furniture', id: tr.dataset.fid! }]);
});

// ---------- Geschosse ----------

function renderLevels(): void {
  const sorted = store.project.levels.slice().sort((a, b) => b.elevation - a.elevation);
  $('levels').innerHTML =
    sorted.map((l) => `<button class="lvl${l.id === store.levelId ? ' on' : ''}" data-lvl="${l.id}" title="OK FFB ${fmt(l.elevation)} m · Doppelklick benennt um">${esc(l.name)}<small>${l.elevation >= 0 ? '+' : ''}${fmt(l.elevation)}</small></button>`).join('') +
    `<button class="lvl add" data-lvl-add title="Geschoss hinzufügen">${ICONS.plus}</button>` +
    (store.project.levels.length > 1 ? `<button class="lvl del" data-lvl-del title="Aktives Geschoss löschen">${ICONS.trash}</button>` : '');
}

$('levels').addEventListener('click', async (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>('button');
  if (!b) return;
  if (b.dataset.lvl) {
    store.setLevel(b.dataset.lvl);
    plan.render();
    view.syncWalkLevel();
    return;
  }
  if (b.hasAttribute('data-lvl-add')) return addLevelDialog();
  if (b.hasAttribute('data-lvl-del')) {
    const l = store.level;
    const r = await modal('Geschoss löschen', `<p>„${esc(l.name)}“ mit allen Wänden, Räumen und Möbeln löschen?</p>`, [
      { label: 'Abbrechen', value: 'no' },
      { label: 'Löschen', value: 'yes', primary: true },
    ]);
    if (r?.value !== 'yes') return;
    store.commit((p) => (p.levels = p.levels.filter((x) => x.id !== l.id)));
    store.setLevel(store.project.levels[0].id);
  }
});
$('levels').addEventListener('dblclick', async (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>('[data-lvl]');
  if (!b) return;
  const l = store.project.levels.find((x) => x.id === b.dataset.lvl);
  if (!l) return;
  const name = await askText('Geschoss umbenennen', l.name);
  if (name) store.commit((p) => (p.levels.find((x) => x.id === l.id)!.name = name));
});

async function addLevelDialog(): Promise<void> {
  const r = await modal(
    'Geschoss hinzufügen',
    `<div class="choice"><label><input type="radio" name="lv" value="copy" checked/> Darüber, Außenwände des aktiven Geschosses übernehmen</label><label><input type="radio" name="lv" value="empty"/> Darüber, leer</label><label><input type="radio" name="lv" value="below"/> Darunter (Keller), Außenwände übernehmen</label></div>`,
    [
      { label: 'Abbrechen', value: 'no' },
      { label: 'Hinzufügen', value: 'ok', primary: true },
    ],
  );
  if (r?.value !== 'ok') return;
  const mode = (r.root.querySelector('input[name="lv"]:checked') as HTMLInputElement).value;
  const src = store.level;
  const sorted = store.project.levels.slice().sort((a, b) => a.elevation - b.elevation);
  let id = '';
  store.commit((p) => {
    let l;
    if (mode === 'below') {
      l = cloneLevel(p, src, 'Kellergeschoss', true);
      l.height = 2.5;
      l.elevation = sorted[0].elevation - l.height;
      sorted[0].floorThickness = Math.max(sorted[0].floorThickness, 0.25);
    } else {
      const top = sorted[sorted.length - 1];
      const name = sorted.length === 1 ? 'Obergeschoss' : sorted.length === 2 ? 'Dachgeschoss' : `${sorted.length}. Geschoss`;
      l = mode === 'copy' ? cloneLevel(p, top, name, true) : newLevel(name, top.elevation + top.height, top.height);
      l.elevation = top.elevation + top.height;
    }
    // nur Außenwände übernehmen: Wände ohne Raum auf einer Seite (vereinfacht: auf der Hüllbox)
    if (mode !== 'empty') {
      const xs = l.walls.flatMap((w) => [w.a.x, w.b.x]);
      const ys = l.walls.flatMap((w) => [w.a.y, w.b.y]);
      const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
      const onHull = (q: { x: number; y: number }) => Math.abs(q.x - x0) < 0.01 || Math.abs(q.x - x1) < 0.01 || Math.abs(q.y - y0) < 0.01 || Math.abs(q.y - y1) < 0.01;
      l.walls = l.walls.filter((w) => onHull(w.a) && onHull(w.b) && (Math.abs(w.a.x - w.b.x) < 0.01 ? Math.abs(w.a.x - x0) < 0.01 || Math.abs(w.a.x - x1) < 0.01 : Math.abs(w.a.y - y0) < 0.01 || Math.abs(w.a.y - y1) < 0.01));
      for (const w of l.walls) w.openings = w.openings.filter((o) => o.type !== 'door' && o.type !== 'garageDoor' && o.type !== 'slidingDoor' && o.type !== 'doubleDoor');
    }
    p.levels.push(l);
    id = l.id;
  });
  store.setLevel(id);
  plan.fit();
}

// ---------- Ansicht: Plan / geteilt / 3D ----------

function setLayout(m: 'plan' | 'split' | '3d'): void {
  $('center').dataset.layout = m;
  document.querySelectorAll<HTMLElement>('#layout-switch button').forEach((b) => b.classList.toggle('on', b.dataset.layout === m));
  try {
    localStorage.setItem('hauscad.layout', m);
  } catch {
    /* ohne Speicher */
  }
  requestAnimationFrame(() => {
    plan.render();
    if (m !== 'plan') view.rebuild();
  });
}
$('layout-switch').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>('[data-layout]');
  if (b) setLayout(b.dataset.layout as 'plan' | 'split' | '3d');
});

(() => {
  const sp = $('splitter');
  const c = $('center');
  sp.addEventListener('pointerdown', (e) => {
    sp.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const r = c.getBoundingClientRect();
      const f = Math.min(0.85, Math.max(0.15, (ev.clientY - r.top) / r.height));
      c.style.setProperty('--split', `${f * 100}%`);
    };
    const up = () => {
      sp.removeEventListener('pointermove', move);
      sp.removeEventListener('pointerup', up);
      plan.render();
    };
    sp.addEventListener('pointermove', move);
    sp.addEventListener('pointerup', up);
  });
})();

$('view-mode').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>('[data-mode]');
  if (!b) return;
  document.querySelectorAll<HTMLElement>('#view-mode button').forEach((x) => x.classList.toggle('on', x === b));
  view.setMode(b.dataset.mode as 'orbit' | 'walk');
  if (b.dataset.mode === 'walk') {
    view.renderer.domElement.focus();
    status('Rundgang: W/S vor/zurück, A/D seitlich, Pfeile drehen, Maus ziehen schaut, Q/E Höhe. Geschosswahl setzt die Augenhöhe.');
  }
});
for (const [id, key] of [['v-all', 'allLevels'], ['v-roof', 'showRoof'], ['v-shadow', 'shadows']] as const) {
  $(id).addEventListener('change', (e) => {
    view.options[key] = (e.target as HTMLInputElement).checked;
    view.rebuild();
  });
}
$('z-in').addEventListener('click', () => plan.zoom(1.25));
$('z-out').addEventListener('click', () => plan.zoom(0.8));
$('z-fit').addEventListener('click', () => plan.fit());

// ---------- Datei ----------

async function download(name: string, data: string | Blob, mime: string): Promise<void> {
  const r = await offerDownload(name, data, mime);
  if (r === 'saved') toast(`${name} gespeichert`);
  else if (r === 'failed') toast('Speichern nicht möglich');
}

const base = () => safeFilename(store.project.name);

async function saveProject(): Promise<void> {
  await download(`${base()}.hauscad`, serialize(store.project), 'application/json');
  store.dirty = false;
}

async function confirmDiscard(): Promise<boolean> {
  if (!store.dirty) return true;
  const r = await modal('Ungespeicherte Änderungen', '<p>Die Änderungen werden im Browser zwischengespeichert. Trotzdem fortfahren?</p>', [
    { label: 'Abbrechen', value: 'no' },
    { label: 'Fortfahren', value: 'yes', primary: true },
  ]);
  return r?.value === 'yes';
}

function loadProject(p: ReturnType<typeof newProject>): void {
  store.load(p);
  plan.fit();
  view.rebuild();
  view.fit();
}

$<HTMLInputElement>('file-open').addEventListener('change', async (e) => {
  const f = (e.target as HTMLInputElement).files?.[0];
  (e.target as HTMLInputElement).value = '';
  if (!f) return;
  try {
    loadProject(parseProject(await f.text()));
    toast(`${f.name} geöffnet`);
  } catch (err) {
    toast(`Datei nicht lesbar: ${(err as Error).message}`);
  }
});

$<HTMLInputElement>('file-image').addEventListener('change', async (e) => {
  const f = (e.target as HTMLInputElement).files?.[0];
  (e.target as HTMLInputElement).value = '';
  if (!f) return;
  const url = await new Promise<string>((res) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.readAsDataURL(f);
  });
  const img = new Image();
  img.onload = () => {
    store.commit((_p, l) => (l.background = { dataUrl: url, widthPx: img.naturalWidth, heightPx: img.naturalHeight, pxPerM: Math.max(10, img.naturalWidth / 15), offset: { x: 0, y: 0 }, opacity: 0.5, visible: true }));
    plan.fit();
    plan.setTool('calibrate');
    status('Bild geladen. Jetzt zwei Punkte mit bekanntem Abstand anklicken (z. B. eine Maßkette).');
  };
  img.src = url;
});

$<HTMLInputElement>('file-dxf').addEventListener('change', async (e) => {
  const f = (e.target as HTMLInputElement).files?.[0];
  (e.target as HTMLInputElement).value = '';
  if (!f) return;
  try {
    const d = parseDxf(await f.text());
    const bg = dxfBackground(d);
    if (!bg) throw new Error('keine Linien gefunden');
    store.commit((_p, l) => (l.background = bg));
    plan.fit();
    toast(`DXF: ${d.segments.length} Linien, Einheit ${d.unit === 0.001 ? 'mm' : d.unit === 0.01 ? 'cm' : 'm'}, ${d.layers.length} Layer – maßstäblich als Hintergrund`);
  } catch (err) {
    toast(`DXF nicht lesbar: ${(err as Error).message}`);
  }
});

async function exportGlb(): Promise<void> {
  const { GLTFExporter } = await import('three/examples/jsm/exporters/GLTFExporter.js');
  view.rebuild();
  new GLTFExporter().parse(
    view.exportGroup(),
    (res) => void download(`${base()}.glb`, new Blob([res as ArrayBuffer], { type: 'model/gltf-binary' }), 'model/gltf-binary'),
    () => toast('GLB-Export fehlgeschlagen'),
    { binary: true },
  );
}

async function exportObj(): Promise<void> {
  const { OBJExporter } = await import('three/examples/jsm/exporters/OBJExporter.js');
  await download(`${base()}.obj`, new OBJExporter().parse(view.exportGroup()), 'text/plain');
}

async function exportPng(): Promise<void> {
  const blob = await (await fetch(view.snapshot())).blob();
  await download(`${base()}-3D.png`, blob, 'image/png');
}

buildMenus($('menus'), [
  {
    label: 'Datei',
    items: [
      { label: 'Neu', key: '⌘N', act: async () => (await confirmDiscard()) && loadProject(newProject()) },
      { label: 'Öffnen …', key: '⌘O', act: () => $('file-open').click() },
      { label: 'Speichern', key: '⌘S', act: () => void saveProject() },
      { label: 'Beispielhaus laden', act: async () => (await confirmDiscard()) && loadProject(sampleHouse()) },
      { sep: true, label: '' },
      { label: 'Grundrissbild laden …', act: () => $('file-image').click() },
      { label: 'DXF-Grundriss laden …', act: () => $('file-dxf').click() },
      { sep: true, label: '' },
      { label: 'Plan als SVG', act: () => void download(`${base()}-${safeFilename(store.level.name)}.svg`, plan.exportSvg(), 'image/svg+xml') },
      { label: 'Plan als DXF (AutoCAD, CADCraft)', act: () => void download(`${base()}-${safeFilename(store.level.name)}.dxf`, exportDxf(store.project, store.level), 'application/dxf') },
      { label: '3D-Ansicht als PNG', act: () => void exportPng() },
      { label: '3D-Modell als GLB', act: () => void exportGlb() },
      { label: '3D-Modell als OBJ', act: () => void exportObj() },
      { sep: true, label: '' },
      { label: 'An HeatCircuits übergeben (Projektdatei)', act: () => void download(`${base()}.heatcircuits.json`, JSON.stringify(toHeatCircuits(store.project)), 'application/json') },
    ],
  },
  {
    label: 'Bearbeiten',
    items: [
      { label: 'Rückgängig', key: '⌘Z', act: () => store.undo() },
      { label: 'Wiederholen', key: '⇧⌘Z', act: () => store.redo() },
      { sep: true, label: '' },
      { label: 'Ausschneiden', key: '⌘X', act: () => doCut() },
      { label: 'Kopieren', key: '⌘C', act: () => doCopy() },
      { label: 'Einfügen', key: '⌘V', act: () => doPaste() },
      { label: 'Duplizieren', key: '⌘D', act: () => (doCopy(), doPaste()) },
      { label: 'Alles auswählen', key: '⌘A', act: () => selectAll() },
      { sep: true, label: '' },
      { label: 'Um 90° drehen', key: 'Q', act: () => store.commit((_p, l) => rotateSelection(l, store.selection, 90)) },
      { label: 'Löschen', key: 'Entf', act: () => doDelete() },
    ],
  },
  {
    label: 'Ansicht',
    items: [
      { label: 'Raster', key: 'G', checked: () => store.project.settings.showGrid, act: () => store.commit((p) => (p.settings.showGrid = !p.settings.showGrid)) },
      { label: 'Magnetismus', checked: () => store.project.settings.magnetism, act: () => store.commit((p) => (p.settings.magnetism = !p.settings.magnetism)) },
      { label: 'Raumflächen', checked: () => store.project.settings.showRoomArea, act: () => store.commit((p) => (p.settings.showRoomArea = !p.settings.showRoomArea)) },
      { sep: true, label: '' },
      { label: 'Nur Plan', key: '1', act: () => setLayout('plan') },
      { label: 'Plan und 3D', key: '2', act: () => setLayout('split') },
      { label: 'Nur 3D', key: '3', act: () => setLayout('3d') },
      { label: 'Einpassen', key: 'Pos1', act: () => (plan.fit(), view.fit()) },
    ],
  },
  {
    label: 'Hilfe',
    items: [{ label: 'Tastenkürzel und Bedienung', act: () => void showHelp() }],
  },
]);

async function showHelp(): Promise<void> {
  const rows: [string, string][] = [
    ['V / H', 'Auswählen / Ansicht verschieben (auch Leertaste, mittlere Maustaste)'],
    ['R', 'Raum aufziehen: Wände und Raum in einem Zug (RoomSketcher-Stil)'],
    ['W', 'Wand zeichnen: Länge tippen + Enter, Doppelklick oder Esc beendet'],
    ['P', 'Raum als Polygon, Doppelklick in umschlossenen Bereich erkennt den Raum'],
    ['O', 'Tür / Fenster auf eine Wand setzen'],
    ['T', 'Treppe (Decke darüber wird ausgespart)'],
    ['M / X', 'Bemaßung / Text'],
    ['K', 'Maßstab des Grundrissbildes kalibrieren'],
    ['Q', 'Auswahl um 90° drehen'],
    ['Pfeile', 'Auswahl um 1 cm verschieben (⇧ 10 cm)'],
    ['⌥ / Alt', 'beim Ziehen: Fangen aus; auf freier Fläche: Bild verschieben'],
    ['1 / 2 / 3', 'Plan / geteilt / 3D'],
    ['Bild ↑ / ↓', 'Geschoss wechseln'],
    ['⌘/Strg Z, ⇧Z, C, V, X, D, A, S, O', 'Rückgängig, Wiederholen, Kopieren, Einfügen, Ausschneiden, Duplizieren, Alles, Speichern, Öffnen'],
  ];
  await modal('Bedienung', `<table class="help">${rows.map(([k, v]) => `<tr><td><kbd>${esc(k)}</kbd></td><td>${esc(v)}</td></tr>`).join('')}</table><p class="note">Rundgang in 3D: W A S D, Pfeiltasten, Maus ziehen, Q/E für die Höhe.</p>`, [{ label: 'Schließen', value: 'ok', primary: true }]);
}

// ---------- Bearbeiten ----------

function doDelete(): void {
  if (!store.selection.length) return;
  const sel = store.selection;
  store.commit((_p, l) => deleteSelection(l, sel));
  store.select([]);
}

function doCopy(): void {
  if (!store.selection.length) return;
  clip = copySelection(store.level, store.selection);
  pasteCount = 0;
}

function doCut(): void {
  doCopy();
  doDelete();
}

function doPaste(): void {
  if (!clip) return;
  pasteCount++;
  let sel: ReturnType<typeof pasteClip> = [];
  const c = clip;
  store.commit((_p, l) => (sel = pasteClip(l, c, { x: 0.5 * pasteCount, y: 0.5 * pasteCount })));
  store.select(sel);
}

function selectAll(): void {
  const l = store.level;
  store.select([
    ...l.walls.map((x) => ({ kind: 'wall' as const, id: x.id })),
    ...l.rooms.map((x) => ({ kind: 'room' as const, id: x.id })),
    ...l.furniture.map((x) => ({ kind: 'furniture' as const, id: x.id })),
    ...l.stairs.map((x) => ({ kind: 'stair' as const, id: x.id })),
    ...l.dimensions.map((x) => ({ kind: 'dimension' as const, id: x.id })),
    ...l.labels.map((x) => ({ kind: 'label' as const, id: x.id })),
  ]);
}

const KEY_TOOLS: Record<string, Tool> = { v: 'select', h: 'pan', w: 'wall', r: 'roomRect', p: 'room', o: 'opening', t: 'stair', m: 'dimension', x: 'label', k: 'calibrate' };

document.addEventListener('keydown', (e) => {
  const tgt = e.target as HTMLElement;
  if (tgt.closest('input, select, textarea, .modal') || tgt === view.renderer.domElement) return;
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
      x: doCut,
      v: doPaste,
      d: () => (doCopy(), doPaste()),
      a: selectAll,
      s: () => void saveProject(),
      o: () => $('file-open').click(),
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
    doDelete();
    return;
  }
  if (e.key === 'Escape') {
    if (plan.tool !== 'select') plan.setTool('select');
    else store.select([]);
    return;
  }
  if (e.key === 'Home') return plan.fit();
  if (e.key === 'PageUp' || e.key === 'PageDown') {
    const sorted = store.project.levels.slice().sort((a, b) => a.elevation - b.elevation);
    const i = sorted.findIndex((l) => l.id === store.levelId) + (e.key === 'PageUp' ? 1 : -1);
    if (sorted[i]) {
      e.preventDefault();
      store.setLevel(sorted[i].id);
      view.syncWalkLevel();
    }
    return;
  }
  if (e.key.startsWith('Arrow') && store.selection.length) {
    e.preventDefault();
    const s = e.shiftKey ? 0.1 : 0.01;
    const d = { x: e.key === 'ArrowLeft' ? -s : e.key === 'ArrowRight' ? s : 0, y: e.key === 'ArrowUp' ? -s : e.key === 'ArrowDown' ? s : 0 };
    const base = JSON.parse(JSON.stringify(store.level));
    const sel = store.selection;
    store.commit((_p, l) => moveSel(base, l, sel, d));
    return;
  }
  if (k === '1') return setLayout('plan');
  if (k === '2') return setLayout('split');
  if (k === '3') return setLayout('3d');
  if (k === 'g') return store.commit((p) => (p.settings.showGrid = !p.settings.showGrid));
  if (k === 'q' && store.selection.length) return store.commit((_p, l) => rotateSelection(l, store.selection, e.shiftKey ? -90 : 90));
  if (KEY_TOOLS[k]) plan.setTool(KEY_TOOLS[k]);
});
document.addEventListener('keyup', (e) => e.key === ' ' && plan.setSpace(false));


// ---------- Kopfzeile ----------

$('btn-undo').innerHTML = ICONS.undo;
$('btn-redo').innerHTML = ICONS.redo;
$('btn-theme').innerHTML = ICONS.theme;
$('btn-undo').addEventListener('click', () => store.undo());
$('btn-redo').addEventListener('click', () => store.redo());
$('btn-theme').addEventListener('click', () => {
  const root = document.documentElement;
  const dark = root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  root.dataset.theme = dark ? 'light' : 'dark';
  try {
    localStorage.setItem('hauscad.theme', root.dataset.theme);
  } catch {
    /* ohne Speicher */
  }
  plan.render();
});
$('proj-name').addEventListener('click', async () => {
  const n = await askText('Projektname', store.project.name);
  if (n) store.commit((p) => (p.name = n));
});

// ---------- Zustand → Oberfläche ----------

let saveTimer = 0;
store.on((structural) => {
  plan.render();
  props.render();
  renderFurList();
  renderLevels();
  $('proj-name').textContent = store.project.name;
  ($('btn-undo') as HTMLButtonElement).disabled = !store.canUndo;
  ($('btn-redo') as HTMLButtonElement).disabled = !store.canRedo;
  $('compass').style.transform = `rotate(${store.project.settings.north}deg)`;
  if ($('center').dataset.layout !== 'plan') view.requestRebuild();
  if (structural) {
    clearTimeout(saveTimer);
    saveTimer = window.setTimeout(async () => {
      if (await autosave(store.project)) $('saved').textContent = `im Browser gesichert ${new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}`;
    }, 700);
  }
});

window.addEventListener('beforeunload', (e) => {
  if (store.dirty) e.preventDefault();
});

// ---------- Start ----------

(async () => {
  try {
    const t = localStorage.getItem('hauscad.theme');
    if (t) document.documentElement.dataset.theme = t;
  } catch {
    /* ohne Speicher */
  }
  renderTools();
  renderCatalog();
  const saved = await loadAutosave();
  store.load(saved ?? sampleHouse());
  if (!saved) status('Beispielhaus geladen. Datei › Neu für ein leeres Projekt. Mit R einen Raum aufziehen, mit W Wände zeichnen.');
  let layout: 'plan' | 'split' | '3d' = 'split';
  try {
    layout = (localStorage.getItem('hauscad.layout') as typeof layout) || 'split';
  } catch {
    /* ohne Speicher */
  }
  setLayout(layout);
  requestAnimationFrame(() => {
    plan.fit();
    view.rebuild();
    view.fit();
  });
  plan.setTool('select');
})();
