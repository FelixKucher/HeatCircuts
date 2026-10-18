// Datenmodell von HausCAD. Längen in m, Winkel in Grad, Plan: x nach rechts, y nach unten, Höhe z nach oben.

export interface Vec {
  x: number;
  y: number;
}

export type OpeningType = 'door' | 'doubleDoor' | 'slidingDoor' | 'window' | 'frenchWindow' | 'roofWindow' | 'garageDoor' | 'passage';

/** Tür, Fenster oder Durchgang in einer Wand; Lage über die Mitte entlang der Wandachse ab Punkt a. */
export interface Opening {
  id: string;
  type: OpeningType;
  offset: number;
  width: number;
  height: number;
  sill: number;
  /** Anschlag: Türblatt öffnet zur linken (+n) bzw. rechten Wandseite */
  side: 'left' | 'right';
  /** Bandseite am Anfang (a) oder Ende (b) der Öffnung */
  hinge: 'a' | 'b';
  color: string;
}

export interface Wall {
  id: string;
  a: Vec;
  b: Vec;
  thickness: number;
  /** Wandhöhe; null = Geschosshöhe */
  height: number | null;
  /** Farbe der linken (+n) und rechten Seite */
  colorLeft: string;
  colorRight: string;
  openings: Opening[];
}

export type FloorFinish = 'parkett' | 'laminat' | 'fliesen' | 'naturstein' | 'teppich' | 'beton' | 'farbe';

export interface Room {
  id: string;
  name: string;
  polygon: Vec[];
  floorFinish: FloorFinish;
  floorColor: string;
  ceilingColor: string;
  showFloor: boolean;
  showCeiling: boolean;
  /** Beschriftung (Name, Fläche) im Plan versetzt */
  labelOffset: Vec;
}

export type StairType = 'straight' | 'lshape' | 'spiral';

export interface Furniture {
  id: string;
  /** Schlüssel im Katalog */
  catalog: string;
  name: string;
  pos: Vec;
  /** Drehung im Uhrzeigersinn (Planansicht) in Grad */
  angle: number;
  width: number;
  depth: number;
  height: number;
  /** Höhe Unterkante über Fußboden */
  elevation: number;
  color: string;
  mirrored: boolean;
  visible: boolean;
}

export interface Stair {
  id: string;
  type: StairType;
  pos: Vec;
  angle: number;
  width: number;
  /** Lauflänge (gerade, L) bzw. Durchmesser (Spindel) */
  length: number;
  /** Zweiter Lauf der L-Treppe (Länge) */
  length2: number;
  /** Steigungen; null = aus Höhe (≈ 17,5 cm) */
  steps: number | null;
  /** Spindel: Drehrichtung im Uhrzeigersinn */
  clockwise: boolean;
  color: string;
  /** Deckendurchbruch im darüberliegenden Geschoss */
  cutCeiling: boolean;
}

export interface Dimension {
  id: string;
  a: Vec;
  b: Vec;
  /** Abstand der Maßlinie von der Strecke a–b (links positiv) */
  offset: number;
}

export interface Label {
  id: string;
  pos: Vec;
  text: string;
  size: number;
  angle: number;
}

export interface BackgroundImage {
  dataUrl: string;
  widthPx: number;
  heightPx: number;
  pxPerM: number;
  offset: Vec;
  opacity: number;
  visible: boolean;
}

export interface Level {
  id: string;
  name: string;
  /** OK Fertigfußboden über ±0,00 */
  elevation: number;
  /** Geschosshöhe (OK FFB bis OK FFB) */
  height: number;
  /** Deckenstärke unter diesem Geschoss */
  floorThickness: number;
  visible: boolean;
  walls: Wall[];
  rooms: Room[];
  furniture: Furniture[];
  stairs: Stair[];
  dimensions: Dimension[];
  labels: Label[];
  background: BackgroundImage | null;
}

export type RoofType = 'none' | 'flat' | 'gable' | 'hip' | 'shed';

export interface Roof {
  type: RoofType;
  pitch: number;
  ridge: 'x' | 'y';
  overhang: number;
  color: string;
  /** Kniestock über OK Rohdecke des obersten Geschosses */
  kneeWall: number;
}

export interface Settings {
  wallThickness: number;
  wallHeight: number;
  gridStep: number;
  showGrid: boolean;
  magnetism: boolean;
  /** Nordpfeil: Drehung von Plan-oben im Uhrzeigersinn */
  north: number;
  showRoomArea: boolean;
  showWallDims: boolean;
}

export interface Project {
  format: 'hauscad';
  version: 1;
  name: string;
  levels: Level[];
  roof: Roof;
  settings: Settings;
  ground: { show: boolean; color: string; level: number };
}

// ---------- Fabrik ----------

let counter = 0;
export const uid = (p = 'id'): string => `${p}${Date.now().toString(36)}${(counter++).toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
export const v = (x: number, y: number): Vec => ({ x, y });

export const OPENING_TYPES: Record<OpeningType, { label: string; width: number; height: number; sill: number; color: string }> = {
  door: { label: 'Innentür', width: 0.885, height: 2.01, sill: 0, color: '#f4f1ea' },
  doubleDoor: { label: 'Doppelflügeltür', width: 1.51, height: 2.01, sill: 0, color: '#f4f1ea' },
  slidingDoor: { label: 'Schiebetür (verglast)', width: 2.01, height: 2.135, sill: 0, color: '#ffffff' },
  passage: { label: 'Durchgang', width: 1.01, height: 2.135, sill: 0, color: '#ffffff' },
  window: { label: 'Fenster', width: 1.26, height: 1.385, sill: 0.885, color: '#ffffff' },
  frenchWindow: { label: 'Fenstertür', width: 1.01, height: 2.26, sill: 0, color: '#ffffff' },
  roofWindow: { label: 'Oberlicht', width: 1.01, height: 0.51, sill: 1.76, color: '#ffffff' },
  garageDoor: { label: 'Garagentor', width: 2.5, height: 2.125, sill: 0, color: '#d9dcde' },
};

export const FLOOR_FINISHES: Record<FloorFinish, { label: string; color: string }> = {
  parkett: { label: 'Parkett', color: '#c9a072' },
  laminat: { label: 'Laminat', color: '#d4b48a' },
  fliesen: { label: 'Fliesen', color: '#e3e1dc' },
  naturstein: { label: 'Naturstein', color: '#bdb6aa' },
  teppich: { label: 'Teppich', color: '#9aa3ad' },
  beton: { label: 'Sichtestrich', color: '#a9aaa6' },
  farbe: { label: 'einfarbig', color: '#e8e4dc' },
};

export function newLevel(name: string, elevation: number, height = 2.75): Level {
  return { id: uid('L'), name, elevation, height, floorThickness: 0.25, visible: true, walls: [], rooms: [], furniture: [], stairs: [], dimensions: [], labels: [], background: null };
}

export function newWall(a: Vec, b: Vec, thickness: number): Wall {
  return { id: uid('W'), a: { ...a }, b: { ...b }, thickness, height: null, colorLeft: '#f2efe9', colorRight: '#f2efe9', openings: [] };
}

export function newOpening(type: OpeningType, offset: number): Opening {
  const d = OPENING_TYPES[type];
  return { id: uid('O'), type, offset, width: d.width, height: d.height, sill: d.sill, side: 'left', hinge: 'a', color: d.color };
}

export function newRoom(polygon: Vec[], name = 'Raum'): Room {
  return { id: uid('R'), name, polygon: polygon.map((p) => ({ ...p })), floorFinish: 'parkett', floorColor: FLOOR_FINISHES.parkett.color, ceilingColor: '#fbfaf7', showFloor: true, showCeiling: true, labelOffset: v(0, 0) };
}

export function newStair(type: StairType, pos: Vec): Stair {
  return {
    id: uid('S'),
    type,
    pos: { ...pos },
    angle: 0,
    width: type === 'spiral' ? 1.6 : 1.0,
    length: type === 'spiral' ? 1.6 : type === 'lshape' ? 2.5 : 3.6,
    length2: 1.8,
    steps: null,
    clockwise: true,
    color: '#b88a5a',
    cutCeiling: true,
  };
}

export function defaultSettings(): Settings {
  return { wallThickness: 0.24, wallHeight: 2.5, gridStep: 0.25, showGrid: true, magnetism: true, north: 0, showRoomArea: true, showWallDims: true };
}

export function newProject(): Project {
  return {
    format: 'hauscad',
    version: 1,
    name: 'Neues Haus',
    levels: [newLevel('Erdgeschoss', 0)],
    roof: { type: 'none', pitch: 35, ridge: 'x', overhang: 0.5, color: '#8f3f2c', kneeWall: 0.6 },
    settings: defaultSettings(),
    ground: { show: true, color: '#b9c4a4', level: -0.15 },
  };
}

/** fehlende Felder nach dem Laden ergänzen */
export function migrate(p: Project): Project {
  const base = newProject();
  p.settings = { ...base.settings, ...(p.settings ?? {}) };
  p.roof = { ...base.roof, ...(p.roof ?? {}) };
  p.ground = { ...base.ground, ...(p.ground ?? {}) };
  for (const l of p.levels) {
    l.walls ??= [];
    l.rooms ??= [];
    l.furniture ??= [];
    l.stairs ??= [];
    l.dimensions ??= [];
    l.labels ??= [];
    l.background ??= null;
    l.visible ??= true;
    l.floorThickness ??= 0.25;
    for (const r of l.rooms) r.labelOffset ??= v(0, 0);
  }
  return p;
}

/** effektive Wandhöhe */
export const wallHeight = (w: Wall, l: Level): number => w.height ?? l.height;
